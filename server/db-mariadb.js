'use strict';

/*
 * MariaDB (or MySQL 8) backend for the multiplayer server.
 *
 * Enabled when DB_HOST or DATABASE_URL is set:
 *   DATABASE_URL     mariadb://user:password@host:3306/database
 *   DB_HOST, DB_PORT (3306), DB_USER, DB_PASSWORD, DB_NAME (pvzge)
 *   DB_POOL          connections in the pool (default 5)
 *   SAVE_HISTORY     previous versions kept per cloud save (default 20)
 *   DB_SYNC_SECONDS  how often save changes made directly in the database
 *                    are picked up (default 30, 0 = never)
 *   DB_MIGRATE       "false" to skip importing DATA_DIR/db.json on first start
 *
 * Legacy import at any time (merges, safe to repeat):
 *   node cli.js import-legacy <dir with db.json and saves/> [--overwrite]
 *   node cli.js import-save <user> <save.json>
 *
 * Tables (created automatically, utf8mb4):
 *   meta           server secret and schema version
 *   users          accounts (password = scrypt hash), stats, save metadata
 *   sessions       login sessions (sha256 of the token)
 *   saves          current cloud save of each account (JSON text)
 *   save_history   previous versions of each save (restorable by admins)
 *   save_profiles  one row per game profile inside each save: name, coins,
 *                  gems, keys, tickets, sprouts and the profile JSON
 *   matches        multiplayer match history
 *   scores         leaderboards (daily challenge, solo survival…)
 *   achievements   unlocked achievements per account
 *   branding_images  logos / images uploaded by admins (meta 'branding'
 *                  holds which game image each one replaces)
 *
 * Users, sessions and recent matches are cached in memory (loaded at start);
 * every change is written through. Saves are always read from the database.
 *
 * Synchronizing with other tools: to change a player's save from outside the
 * server, write `saves.data` and set `saves.updated_at` to the current time
 * in milliseconds (e.g. UNIX_TIMESTAMP()*1000). Within DB_SYNC_SECONDS the
 * server notices it, and the player's game downloads it on its next sync.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BaseStore, profileSummary, MAX_MATCHES, MAX_SCORES } = require('./store');

const SCHEMA_VERSION = 1;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    stats LONGTEXT NOT NULL,
    save_updated_at BIGINT NULL,
    save_size INT NULL,
    save_device VARCHAR(80) NULL,
    UNIQUE KEY username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    expires BIGINT NOT NULL,
    KEY user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS saves (
    user_id CHAR(36) NOT NULL PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    size INT NOT NULL,
    device VARCHAR(80) NOT NULL DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS save_history (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    size INT NOT NULL,
    device VARCHAR(80) NOT NULL DEFAULT '',
    reason VARCHAR(32) NOT NULL DEFAULT 'update',
    archived_at BIGINT NOT NULL,
    KEY user_version (user_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS save_profiles (
    user_id CHAR(36) NOT NULL,
    idx INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    coin BIGINT NOT NULL DEFAULT 0,
    gem BIGINT NOT NULL DEFAULT 0,
    worldkey INT NOT NULL DEFAULT 0,
    ticket INT NOT NULL DEFAULT 0,
    sprout INT NOT NULL DEFAULT 0,
    data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, idx)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS matches (
    id CHAR(36) NOT NULL PRIMARY KEY,
    at BIGINT NOT NULL,
    mode VARCHAR(16) NOT NULL DEFAULT '',
    stage VARCHAR(16) NOT NULL DEFAULT '',
    winner VARCHAR(16) NOT NULL DEFAULT '',
    duration INT NOT NULL DEFAULT 0,
    waves INT NOT NULL DEFAULT 0,
    players LONGTEXT NOT NULL,
    KEY at (at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS scores (
    board VARCHAR(48) NOT NULL,
    user_id CHAR(36) NOT NULL,
    score BIGINT NOT NULL,
    details LONGTEXT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (board, user_id),
    KEY board_score (board, score)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS achievements (
    user_id CHAR(36) NOT NULL,
    achievement VARCHAR(48) NOT NULL,
    unlocked_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, achievement)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS branding_images (
    id CHAR(40) NOT NULL PRIMARY KEY,
    mime VARCHAR(40) NOT NULL,
    data LONGBLOB NOT NULL,
    size INT NOT NULL,
    created_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

function config(env) {
  const base = {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'pvzge',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'pvzge',
  };
  if (env.DATABASE_URL) {
    const u = new URL(env.DATABASE_URL);
    base.host = u.hostname;
    base.port = Number(u.port) || 3306;
    base.user = decodeURIComponent(u.username);
    base.password = decodeURIComponent(u.password);
    base.database = decodeURIComponent(u.pathname.replace(/^\//, '')) || base.database;
  }
  return Object.assign(base, {
    connectionLimit: Number(env.DB_POOL) || 5,
    charset: 'utf8mb4',
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    connectTimeout: 10000,
    // Saves can be several MB.
    maxAllowedPacket: 64 * 1024 * 1024,
  });
}

function parseJson(text, fallback) {
  try {
    return text == null ? fallback : JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

class MariaStore extends BaseStore {
  constructor(env, dataDir) {
    super();
    this.env = env;
    this.dir = dataDir;
    this.cfg = config(env);
    this.historyMax = Math.max(0, Number(env.SAVE_HISTORY == null ? 20 : env.SAVE_HISTORY) || 0);
    this.syncSeconds = env.DB_SYNC_SECONDS == null ? 30 : Number(env.DB_SYNC_SECONDS) || 0;
    this.queue = Promise.resolve();
    this.failures = 0;
  }

  get kind() {
    return 'mariadb';
  }

  get where() {
    return this.cfg.user + '@' + this.cfg.host + ':' + this.cfg.port + '/' + this.cfg.database;
  }

  async init() {
    const mariadb = require('mariadb');
    this.pool = mariadb.createPool(this.cfg);
    // The database container may still be starting: retry for a while.
    let lastError;
    for (let i = 0; i < 30; i++) {
      try {
        const c = await this.pool.getConnection();
        c.release();
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (i === 0) console.log('[db] waiting for MariaDB at %s (%s)', this.where, e.code || e.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (lastError) throw new Error('Cannot connect to MariaDB at ' + this.where + ': ' + lastError.message);
    for (const sql of SCHEMA) await this.pool.query(sql);
    await this.pool.query('INSERT IGNORE INTO meta (k, v) VALUES (?, ?)', ['schema', String(SCHEMA_VERSION)]);

    const empty = (await this.pool.query('SELECT COUNT(*) AS n FROM users'))[0].n === 0;
    if (empty && this.env.DB_MIGRATE !== 'false') await this.migrateFromFiles();

    await this.load();
    if (this.syncSeconds > 0) {
      this.syncTimer = setInterval(() => this.syncSaveMeta().catch((e) => console.error('[db] sync failed: %s', e.message)), this.syncSeconds * 1000);
      this.syncTimer.unref();
    }
    console.log('[db] using MariaDB %s (%d accounts)', this.where, Object.keys(this.db.users).length);
  }

  async load() {
    const meta = await this.pool.query("SELECT v FROM meta WHERE k = 'secret'");
    if (meta.length) this.db.secret = meta[0].v;
    else {
      this.db.secret = crypto.randomBytes(32).toString('hex');
      await this.pool.query("INSERT INTO meta (k, v) VALUES ('secret', ?)", [this.db.secret]);
    }
    const users = {};
    for (const r of await this.pool.query('SELECT * FROM users')) users[r.id] = this.rowToUser(r);
    this.db.users = users;
    const now = Date.now();
    await this.pool.query('DELETE FROM sessions WHERE expires < ?', [now]);
    const sessions = {};
    for (const r of await this.pool.query('SELECT * FROM sessions')) sessions[r.token_hash] = { userId: r.user_id, expires: Number(r.expires) };
    this.db.sessions = sessions;
    this.db.matches = (await this.pool.query('SELECT * FROM matches ORDER BY at DESC LIMIT ?', [MAX_MATCHES])).map((r) => ({
      id: r.id,
      at: Number(r.at),
      mode: r.mode,
      stage: r.stage,
      winner: r.winner,
      duration: r.duration,
      waves: r.waves,
      players: parseJson(r.players, []),
    }));
    const scores = {};
    for (const r of await this.pool.query('SELECT * FROM scores ORDER BY board, score DESC, at ASC')) {
      const list = (scores[r.board] = scores[r.board] || []);
      if (list.length < MAX_SCORES) list.push({ userId: r.user_id, score: Number(r.score), details: parseJson(r.details, null), at: Number(r.at) });
    }
    this.db.scores = scores;
    const ach = {};
    for (const r of await this.pool.query('SELECT * FROM achievements')) {
      (ach[r.user_id] = ach[r.user_id] || {})[r.achievement] = Number(r.unlocked_at);
    }
    this.db.achievements = ach;
    this.index();
  }

  rowToUser(r) {
    return {
      id: r.id,
      username: r.username,
      password: r.password,
      createdAt: Number(r.created_at),
      stats: parseJson(r.stats, null),
      save: r.save_updated_at == null ? undefined : { updatedAt: Number(r.save_updated_at), size: r.save_size || 0, device: r.save_device || '' },
    };
  }

  // Picks up saves changed directly in the database (other tools, restores).
  async syncSaveMeta() {
    // Accounts added or changed outside this process (cli.js import-legacy,
    // password resets, other tools).
    for (const r of await this.pool.query('SELECT * FROM users')) {
      const known = this.db.users[r.id];
      if (!known) {
        const u = this.rowToUser(r);
        if (!u.stats) u.stats = { matches: 0, wins: 0, versus: 0, versusWins: 0, coop: 0, survival: 0, bestWave: 0 };
        this.db.users[u.id] = u;
        this.byName.set(u.username.toLowerCase(), u);
      } else if (known.password !== r.password) {
        // New password set elsewhere: its sessions were ended there too.
        known.password = r.password;
        for (const [k, ss] of Object.entries(this.db.sessions)) if (ss.userId === r.id) delete this.db.sessions[k];
      }
    }
    const rows = await this.pool.query('SELECT user_id, updated_at, size, device FROM saves');
    for (const r of rows) {
      const u = this.db.users[r.user_id];
      if (!u) continue;
      const at = Number(r.updated_at);
      if (!u.save || u.save.updatedAt !== at) {
        u.save = { updatedAt: at, size: r.size, device: r.device || '' };
        await this.pool.query('UPDATE users SET save_updated_at = ?, save_size = ?, save_device = ? WHERE id = ?', [at, r.size, r.device || '', u.id]);
        const data = await this.readSave(u.id);
        if (data) await this.writeProfiles(this.pool, u.id, data, at);
        console.log('[db] save of %s changed in the database, players will get it on their next sync', u.username);
      }
    }
  }

  /* write-through queue: changes are applied in order, retried on failure */

  enqueue(label, fn) {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await fn(this.pool);
          if (this.failures) {
            console.log('[db] writing again after %d failure(s)', this.failures);
            this.failures = 0;
          }
          return;
        } catch (e) {
          this.failures++;
          if (attempt >= 4) {
            console.error('[db] giving up on %s: %s', label, e.message);
            return;
          }
          console.error('[db] %s failed (%s), retrying', label, e.message);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  persistUser(u) {
    const s = u.save || {};
    return this.enqueue('user ' + u.username, (db) =>
      db.query(
        `INSERT INTO users (id, username, password, created_at, stats, save_updated_at, save_size, save_device)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username), password = VALUES(password), stats = VALUES(stats),
           save_updated_at = VALUES(save_updated_at), save_size = VALUES(save_size), save_device = VALUES(save_device)`,
        [u.id, u.username, u.password, u.createdAt, JSON.stringify(u.stats || {}), s.updatedAt == null ? null : s.updatedAt, s.size == null ? null : s.size, s.device == null ? null : s.device],
      ),
    );
  }

  persistSession(hash, s) {
    return this.enqueue('session', (db) => db.query('REPLACE INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)', [hash, s.userId, s.expires]));
  }

  persistSessionDelete(hash) {
    return this.enqueue('session delete', (db) => db.query('DELETE FROM sessions WHERE token_hash = ?', [hash]));
  }

  persistMatch(m) {
    return this.enqueue('match', (db) =>
      db.query('INSERT IGNORE INTO matches (id, at, mode, stage, winner, duration, waves, players) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        m.id,
        m.at,
        m.mode || '',
        m.stage || '',
        m.winner || '',
        m.duration || 0,
        m.waves || 0,
        JSON.stringify(m.players || []),
      ]),
    );
  }

  persistScore(board, e) {
    return this.enqueue('score', (db) =>
      db.query('REPLACE INTO scores (board, user_id, score, details, at) VALUES (?, ?, ?, ?, ?)', [board, e.userId, e.score, e.details == null ? null : JSON.stringify(e.details), e.at]),
    );
  }

  persistAchievements(userId, pairs) {
    return this.enqueue('achievements', (db) =>
      db.batch(
        'INSERT IGNORE INTO achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)',
        pairs.map(([id, at]) => [userId, id, at]),
      ),
    );
  }

  /* saves */

  async readSave(userId) {
    const rows = await this.pool.query('SELECT data FROM saves WHERE user_id = ?', [userId]);
    return rows.length ? rows[0].data : null;
  }

  async writeProfiles(db, userId, data, at) {
    await db.query('DELETE FROM save_profiles WHERE user_id = ?', [userId]);
    const profiles = profileSummary(data);
    if (profiles.length) {
      await db.batch(
        'INSERT INTO save_profiles (user_id, idx, name, coin, gem, worldkey, ticket, sprout, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        profiles.map((p) => [userId, p.index, p.name, p.coin, p.gem, p.worldkey, p.ticket, p.sprout, p.data, at]),
      );
    }
  }

  // Writes the new save (and keeps the previous one in save_history) in one
  // transaction; resolves once it is stored.
  async writeSave(userId, data, device, reason) {
    const meta = { updatedAt: Date.now(), size: Buffer.byteLength(data), device: device || '' };
    const u = this.db.users[userId];
    // Make sure the account row exists before its save (write-through queue).
    await this.queue;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      if (this.historyMax > 0) {
        await conn.query(
          `INSERT INTO save_history (user_id, data, updated_at, size, device, reason, archived_at)
           SELECT user_id, data, updated_at, size, device, ?, ? FROM saves WHERE user_id = ?`,
          [reason || 'update', meta.updatedAt, userId],
        );
        const old = await conn.query('SELECT id FROM save_history WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?', [userId, this.historyMax]);
        if (old.length) await conn.query('DELETE FROM save_history WHERE user_id = ? AND id <= ?', [userId, old[0].id]);
      }
      await conn.query(
        `INSERT INTO saves (user_id, data, updated_at, size, device) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at), size = VALUES(size), device = VALUES(device)`,
        [userId, data, meta.updatedAt, meta.size, meta.device],
      );
      await conn.query('UPDATE users SET save_updated_at = ?, save_size = ?, save_device = ? WHERE id = ?', [meta.updatedAt, meta.size, meta.device, userId]);
      await this.writeProfiles(conn, userId, data, meta.updatedAt);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    if (u) u.save = meta;
    return meta;
  }

  // Every write already keeps the previous version.
  async backupSave() {}

  /* branding */

  async getBranding() {
    const rows = await this.pool.query("SELECT v FROM meta WHERE k = 'branding'");
    return rows.length ? parseJson(rows[0].v, null) : null;
  }

  async setBranding(config) {
    await this.pool.query("REPLACE INTO meta (k, v) VALUES ('branding', ?)", [JSON.stringify(config)]);
  }

  async putBrandingImage(id, mime, buf) {
    await this.pool.query('INSERT IGNORE INTO branding_images (id, mime, data, size, created_at) VALUES (?, ?, ?, ?, ?)', [id, mime, buf, buf.length, Date.now()]);
  }

  async getBrandingImage(id) {
    const rows = await this.pool.query('SELECT mime, data FROM branding_images WHERE id = ?', [id]);
    return rows.length ? { mime: rows[0].mime, data: rows[0].data } : null;
  }

  async deleteBrandingImages(keep) {
    const rows = await this.pool.query('SELECT id FROM branding_images');
    for (const r of rows) if (!keep.has(r.id)) await this.pool.query('DELETE FROM branding_images WHERE id = ?', [r.id]);
  }

  async saveHistory(userId) {
    const rows = await this.pool.query('SELECT id, updated_at, size, device, reason, archived_at FROM save_history WHERE user_id = ? ORDER BY id DESC', [userId]);
    return rows.map((r) => ({ id: String(r.id), updatedAt: Number(r.updated_at), size: r.size, device: r.device, reason: r.reason, archivedAt: Number(r.archived_at) }));
  }

  async readSaveVersion(userId, id) {
    const rows = await this.pool.query('SELECT data FROM save_history WHERE user_id = ? AND id = ?', [userId, Number(id) || 0]);
    return rows.length ? rows[0].data : null;
  }

  async saveProfiles(userId) {
    const rows = await this.pool.query('SELECT idx, name, coin, gem, worldkey, ticket, sprout, updated_at FROM save_profiles WHERE user_id = ? ORDER BY idx', [userId]);
    return rows.map((r) => ({ index: r.idx, name: r.name, coin: Number(r.coin), gem: Number(r.gem), worldkey: r.worldkey, ticket: r.ticket, sprout: r.sprout }));
  }

  /* legacy import: the file store (db.json + saves/*.json) into MariaDB */

  // Merges a legacy data directory into the database. Accounts that already
  // exist (same id or username) are kept; their legacy save is imported when
  // the database has none for them or the legacy one is newer (overwrite:
  // always), and the replaced save goes to save_history. Safe to run again.
  // Returns counts.
  async importLegacy(dir, opts) {
    opts = opts || {};
    const file = path.join(dir || '', 'db.json');
    if (!dir || !fs.existsSync(file)) throw new Error('No db.json in ' + dir);
    let db;
    try {
      db = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error('Cannot read ' + file + ': ' + e.message);
    }
    const out = { users: 0, usersKept: 0, saves: 0, savesKept: 0, history: 0, sessions: 0, matches: 0, scores: 0, achievements: 0 };
    const users = Object.values(db.users || {});
    const idMap = {}; // legacy id -> database id
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      // A fresh database takes over the legacy secret (sessions/tickets stay valid).
      if (db.secret && opts.secret) await conn.query('REPLACE INTO meta (k, v) VALUES (?, ?)', ['secret', db.secret]);
      for (const u of users) {
        if (!u || !u.id || !u.username) continue;
        const found = await conn.query('SELECT id FROM users WHERE id = ? OR username = ? LIMIT 1', [u.id, u.username]);
        if (found.length) {
          idMap[u.id] = found[0].id;
          out.usersKept++;
        } else {
          await conn.query('INSERT INTO users (id, username, password, created_at, stats) VALUES (?, ?, ?, ?, ?)', [
            u.id,
            u.username,
            u.password,
            u.createdAt || Date.now(),
            JSON.stringify(u.stats || {}),
          ]);
          idMap[u.id] = u.id;
          out.users++;
        }
        const target = idMap[u.id];
        const saveFile = path.join(dir, 'saves', String(u.id).replace(/[^a-f0-9-]/gi, '') + '.json');
        let data = null;
        try {
          data = JSON.parse(fs.readFileSync(saveFile, 'utf8')).data;
        } catch (e) {}
        if (typeof data === 'string') {
          const at = (u.save && u.save.updatedAt) || fs.statSync(saveFile).mtimeMs | 0;
          const cur = await conn.query('SELECT updated_at FROM saves WHERE user_id = ?', [target]);
          if (!cur.length || opts.overwrite || at > Number(cur[0].updated_at)) {
            if (cur.length) {
              await conn.query(
                "INSERT INTO save_history (user_id, data, updated_at, size, device, reason, archived_at) SELECT user_id, data, updated_at, size, device, 'import', ? FROM saves WHERE user_id = ?",
                [Date.now(), target],
              );
            }
            const size = Buffer.byteLength(data);
            const device = (u.save && u.save.device) || 'legacy';
            await conn.query(
              `INSERT INTO saves (user_id, data, updated_at, size, device) VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at), size = VALUES(size), device = VALUES(device)`,
              [target, data, at, size, device],
            );
            await conn.query('UPDATE users SET save_updated_at = ?, save_size = ?, save_device = ? WHERE id = ?', [at, size, device, target]);
            await this.writeProfiles(conn, target, data, at);
            out.saves++;
          } else out.savesKept++;
        }
        let bak = null;
        try {
          bak = JSON.parse(fs.readFileSync(saveFile.replace(/\.json$/, '.bak.json'), 'utf8')).data;
        } catch (e) {}
        if (typeof bak === 'string') {
          const size = Buffer.byteLength(bak);
          const dup = await conn.query("SELECT id FROM save_history WHERE user_id = ? AND reason = 'migrated' AND size = ? LIMIT 1", [target, size]);
          if (!dup.length) {
            await conn.query('INSERT INTO save_history (user_id, data, updated_at, size, device, reason, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
              target,
              bak,
              0,
              size,
              'backup',
              'migrated',
              Date.now(),
            ]);
            out.history++;
          }
        }
      }
      for (const [h, ss] of Object.entries(db.sessions || {})) {
        if (ss.expires > Date.now() && idMap[ss.userId] === ss.userId) {
          const r = await conn.query('INSERT IGNORE INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)', [h, ss.userId, ss.expires]);
          out.sessions += r.affectedRows || 0;
        }
      }
      for (const m of db.matches || []) {
        const players = (m.players || []).map((pl) => Object.assign({}, pl, { userId: pl.userId ? idMap[pl.userId] || pl.userId : pl.userId }));
        const r = await conn.query('INSERT IGNORE INTO matches (id, at, mode, stage, winner, duration, waves, players) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          m.id,
          m.at,
          m.mode || '',
          m.stage || '',
          m.winner || '',
          m.duration || 0,
          m.waves || 0,
          JSON.stringify(players),
        ]);
        out.matches += r.affectedRows || 0;
      }
      for (const [board, list] of Object.entries(db.scores || {})) {
        for (const e of list) {
          const uid = idMap[e.userId];
          if (!uid) continue;
          // Keep the best of both.
          const r = await conn.query(
            `INSERT INTO scores (board, user_id, score, details, at) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE details = IF(VALUES(score) > score, VALUES(details), details), at = IF(VALUES(score) > score, VALUES(at), at), score = GREATEST(score, VALUES(score))`,
            [board, uid, e.score, e.details == null ? null : JSON.stringify(e.details), e.at],
          );
          if (r.affectedRows) out.scores++;
        }
      }
      for (const [userId, map] of Object.entries(db.achievements || {})) {
        const uid = idMap[userId];
        if (!uid) continue;
        for (const [id, at] of Object.entries(map)) {
          const r = await conn.query('INSERT IGNORE INTO achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)', [uid, id, at]);
          out.achievements += r.affectedRows || 0;
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw new Error('Import from ' + file + ' failed: ' + e.message);
    } finally {
      conn.release();
    }
    return out;
  }

  // First start on an empty database: import DATA_DIR automatically.
  async migrateFromFiles() {
    const file = path.join(this.dir || '', 'db.json');
    if (!this.dir || !fs.existsSync(file)) return;
    console.log('[db] importing the accounts of %s', file);
    const r = await this.importLegacy(this.dir, { secret: true });
    console.log('[db] imported %d account(s), %d save(s), %d old backup(s), %d match(es)', r.users, r.saves, r.history, r.matches);
    try {
      fs.renameSync(file, file + '.migrated');
    } catch (e) {}
    console.log('[db] %s renamed to db.json.migrated; the save files are kept', file);
  }

  async close() {
    clearInterval(this.syncTimer);
    await this.queue;
    if (this.pool) await this.pool.end();
  }
}

module.exports = { MariaStore, config };

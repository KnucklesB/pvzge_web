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

  /* migration from the file store (DATA_DIR/db.json + saves/*.json) */

  async migrateFromFiles() {
    const file = path.join(this.dir || '', 'db.json');
    if (!this.dir || !fs.existsSync(file)) return;
    let db;
    try {
      db = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('[db] cannot read %s for the migration: %s', file, e.message);
      return;
    }
    const users = Object.values(db.users || {});
    console.log('[db] importing %d account(s) from %s', users.length, file);
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      if (db.secret) await conn.query('REPLACE INTO meta (k, v) VALUES (?, ?)', ['secret', db.secret]);
      for (const u of users) {
        const s = u.save || {};
        await conn.query(
          'INSERT IGNORE INTO users (id, username, password, created_at, stats, save_updated_at, save_size, save_device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [u.id, u.username, u.password, u.createdAt || Date.now(), JSON.stringify(u.stats || {}), s.updatedAt == null ? null : s.updatedAt, s.size == null ? null : s.size, s.device || null],
        );
        const saveFile = path.join(this.dir, 'saves', String(u.id).replace(/[^a-f0-9-]/gi, '') + '.json');
        let data = null;
        try {
          data = JSON.parse(fs.readFileSync(saveFile, 'utf8')).data;
        } catch (e) {}
        if (typeof data === 'string') {
          const at = s.updatedAt || Date.now();
          await conn.query('INSERT IGNORE INTO saves (user_id, data, updated_at, size, device) VALUES (?, ?, ?, ?, ?)', [u.id, data, at, Buffer.byteLength(data), s.device || '']);
          await conn.query('UPDATE users SET save_updated_at = ?, save_size = ? WHERE id = ?', [at, Buffer.byteLength(data), u.id]);
          await this.writeProfiles(conn, u.id, data, at);
        }
        let bak = null;
        try {
          bak = JSON.parse(fs.readFileSync(saveFile.replace(/\.json$/, '.bak.json'), 'utf8')).data;
        } catch (e) {}
        if (typeof bak === 'string') {
          await conn.query('INSERT INTO save_history (user_id, data, updated_at, size, device, reason, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
            u.id,
            bak,
            0,
            Buffer.byteLength(bak),
            'backup',
            'migrated',
            Date.now(),
          ]);
        }
      }
      for (const [h, s] of Object.entries(db.sessions || {})) {
        if (s.expires > Date.now()) await conn.query('INSERT IGNORE INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)', [h, s.userId, s.expires]);
      }
      for (const m of db.matches || []) {
        await conn.query('INSERT IGNORE INTO matches (id, at, mode, stage, winner, duration, waves, players) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          m.id,
          m.at,
          m.mode || '',
          m.stage || '',
          m.winner || '',
          m.duration || 0,
          m.waves || 0,
          JSON.stringify(m.players || []),
        ]);
      }
      for (const [board, list] of Object.entries(db.scores || {})) {
        for (const e of list) {
          await conn.query('INSERT IGNORE INTO scores (board, user_id, score, details, at) VALUES (?, ?, ?, ?, ?)', [board, e.userId, e.score, e.details == null ? null : JSON.stringify(e.details), e.at]);
        }
      }
      for (const [userId, map] of Object.entries(db.achievements || {})) {
        for (const [id, at] of Object.entries(map)) await conn.query('INSERT IGNORE INTO achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)', [userId, id, at]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw new Error('Migration from ' + file + ' failed: ' + e.message);
    } finally {
      conn.release();
    }
    try {
      fs.renameSync(file, file + '.migrated');
    } catch (e) {}
    console.log('[db] migration done (%s renamed to db.json.migrated; the save files are kept)', file);
  }

  async close() {
    clearInterval(this.syncTimer);
    await this.queue;
    if (this.pool) await this.pool.end();
  }
}

module.exports = { MariaStore, config };

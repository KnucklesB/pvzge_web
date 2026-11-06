'use strict';

/*
 * Accounts, sessions, cloud saves, match history, leaderboards and
 * achievements.
 *
 * Two backends share the same in-memory model (users, sessions and recent
 * matches are kept in memory, so most lookups stay synchronous):
 *
 *   - FileStore (default): db.json (written atomically, debounced) plus one
 *     file per cloud save in DATA_DIR/saves.
 *   - MariaStore (when DB_HOST or DATABASE_URL is set, see db-mariadb.js):
 *     every change is written to MariaDB; saves, their history and a
 *     per-profile summary live in tables, so they can be queried, backed up
 *     and synchronized with other tools.
 *
 * openStore() picks the backend from the environment.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newToken, hashToken } = require('./auth');

const SESSION_TTL = 60 * 24 * 3600 * 1000;
const MAX_MATCHES = 2000;
const MAX_SCORES = 500; // kept per board
const MAX_MATCH_PLANTS = 2000;
const MAX_DMS = 20000; // private messages kept by the FileStore

function atomicWrite(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function newStats() {
  return { matches: 0, wins: 0, versus: 0, versusWins: 0, coop: 0, survival: 0, bestWave: 0 };
}

// Coins, gems… of each game profile inside a cloud save blob (for listings
// and the MariaDB save_profiles table). Never throws.
function profileSummary(data) {
  try {
    const blob = JSON.parse(data);
    const players = typeof blob.players === 'string' ? JSON.parse(blob.players) : blob.players;
    if (!Array.isArray(players)) return [];
    return players.slice(0, 50).map((p, i) => {
      const num = (k) => (p && Number.isFinite(Number(p[k])) ? Math.max(0, Math.floor(Number(p[k]))) : 0);
      return {
        index: i,
        name: String((p && p.name) || '?').slice(0, 64),
        coin: num('coin'),
        gem: num('gem'),
        worldkey: num('worldkey'),
        ticket: num('ticket'),
        sprout: num('sprout'),
        data: JSON.stringify(p),
      };
    });
  } catch (e) {
    return [];
  }
}

// Any save file people have (an export from the game's Account window, a
// cloud save {data}, the raw localStorage value, {PvZ2_PlayerProperties}...)
// -> the cloud save text {"v":1,"players":"<json>","settings":...}. Throws
// on anything else.
function normalizeSave(text) {
  let o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.data === 'string' && o.players == null) o = JSON.parse(o.data);
  let players = null;
  let settings = null;
  if (Array.isArray(o)) players = o;
  else if (o && typeof o === 'object') {
    const pl = o.players != null ? o.players : o.PvZ2_PlayerProperties;
    const st = o.settings != null ? o.settings : o.PvZ2_Settings;
    players = typeof pl === 'string' ? JSON.parse(pl) : pl;
    settings = st == null ? null : typeof st === 'string' ? st : JSON.stringify(st);
  }
  const ok = Array.isArray(players) && players.length > 0 && players.every((p) => p && typeof p === 'object' && !Array.isArray(p));
  if (!ok) throw new Error('not a PvZ2 Gardendless save (no player profiles found)');
  return JSON.stringify({ v: 1, players: JSON.stringify(players), settings });
}

/*
 * The shared model. Subclasses persist it: every change calls one of the
 * persist* hooks (no-ops here).
 */
class BaseStore {
  constructor() {
    this.db = { users: {}, sessions: {}, matches: [], secret: '', scores: {}, achievements: {}, matchStats: {}, matchState: {}, matchProfiles: {}, dms: [], dmSeq: 0, matchReports: [] };
    this.byName = new Map();
    setInterval(() => this.pruneSessions(), 3600 * 1000).unref();
  }

  index() {
    this.byName = new Map();
    for (const u of Object.values(this.db.users)) {
      if (!u.stats) u.stats = newStats();
      this.byName.set(u.username.toLowerCase(), u);
    }
  }

  get secret() {
    return this.db.secret;
  }

  get kind() {
    return 'memory';
  }

  /* persistence hooks */
  persistUser() {}
  persistSession() {}
  persistSessionDelete() {}
  persistMatch() {}
  persistScore() {}
  persistAchievements() {}
  persistMatchStats() {}
  persistMatchState() {}
  persistMatchProfile() {}
  persistDm() {}
  persistMatchReport() {}
  checkWritable() {}
  flushSync() {}
  async close() {}

  /* users */

  findUser(username) {
    return this.byName.get(String(username || '').toLowerCase()) || null;
  }

  getUser(id) {
    return this.db.users[id] || null;
  }

  async createUser(username, passwordHash) {
    const id = crypto.randomUUID();
    const user = { id, username, password: passwordHash, createdAt: Date.now(), stats: newStats() };
    this.db.users[id] = user;
    this.byName.set(username.toLowerCase(), user);
    await this.persistUser(user);
    return user;
  }

  setPassword(id, hash) {
    const u = this.db.users[id];
    if (!u) return;
    u.password = hash;
    for (const [k, s] of Object.entries(this.db.sessions)) {
      if (s.userId === id) {
        delete this.db.sessions[k];
        this.persistSessionDelete(k);
      }
    }
    return this.persistUser(u);
  }

  publicUser(u) {
    return {
      id: u.id,
      username: u.username,
      createdAt: u.createdAt,
      stats: u.stats,
      save: this.saveMeta(u.id),
      achievements: Object.keys(this.db.achievements[u.id] || {}).length,
    };
  }

  listUsers() {
    return Object.values(this.db.users);
  }

  /* sessions */

  createSession(userId) {
    const token = newToken();
    const h = hashToken(token);
    const s = { userId, expires: Date.now() + SESSION_TTL };
    this.db.sessions[h] = s;
    this.persistSession(h, s);
    return token;
  }

  userForToken(token) {
    const s = this.db.sessions[hashToken(token)];
    if (!s || s.expires < Date.now()) return null;
    return this.db.users[s.userId] || null;
  }

  deleteSession(token) {
    const h = hashToken(token);
    delete this.db.sessions[h];
    this.persistSessionDelete(h);
  }

  pruneSessions() {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.db.sessions)) {
      if (s.expires < now) {
        delete this.db.sessions[k];
        this.persistSessionDelete(k);
      }
    }
  }

  /* saves: readSave / writeSave / backupSave / saveHistory are backend specific */

  saveMeta(userId) {
    const u = this.db.users[userId];
    return (u && u.save) || null;
  }

  async saveProfiles(userId) {
    const data = await this.readSave(userId);
    return data ? profileSummary(data).map(({ data: _d, ...p }) => p) : [];
  }

  /* matches */

  addMatch(m) {
    const match = Object.assign({ id: crypto.randomUUID(), at: Date.now() }, m);
    this.db.matches.unshift(match);
    if (this.db.matches.length > MAX_MATCHES) this.db.matches.length = MAX_MATCHES;
    for (const p of match.players) {
      const u = p.userId && this.db.users[p.userId];
      if (!u) continue;
      const s = u.stats;
      s.matches++;
      if (p.win) s.wins++;
      if (match.mode === 'versus') {
        s.versus++;
        if (p.win) s.versusWins++;
      } else if (match.mode === 'coop') s.coop++;
      else if (match.mode === 'survival') {
        s.survival++;
        s.bestWave = Math.max(s.bestWave, p.score || 0);
      }
      this.persistUser(u);
    }
    this.persistMatch(match);
    return match;
  }

  listMatches(limit, userId) {
    const out = [];
    for (const m of this.db.matches) {
      if (userId && !m.players.some((p) => p.userId === userId)) continue;
      out.push({
        id: m.id,
        at: m.at,
        mode: m.mode,
        stage: m.stage,
        winner: m.winner,
        duration: m.duration,
        waves: m.waves,
        players: m.players.map((p) => ({ name: p.name, account: p.account, side: p.side, score: p.score, win: p.win })),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* leaderboards: board = "daily:2026-11-04", "survival", "endless"… */

  // Keeps each account's best score on a board. Returns {best, rank, improved}.
  addScore(board, userId, score, details) {
    const list = (this.db.scores[board] = this.db.scores[board] || []);
    let e = list.find((x) => x.userId === userId);
    let improved = false;
    if (!e) {
      e = { userId, score, details: details || null, at: Date.now() };
      list.push(e);
      improved = true;
    } else if (score > e.score) {
      Object.assign(e, { score, details: details || null, at: Date.now() });
      improved = true;
    }
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    if (list.length > MAX_SCORES) list.length = MAX_SCORES;
    if (improved) this.persistScore(board, e);
    const rank = list.indexOf(e) + 1;
    return { best: e.score, rank: rank || null, improved };
  }

  listScores(board, limit) {
    return (this.db.scores[board] || []).slice(0, limit).map((e, i) => {
      const u = this.db.users[e.userId];
      return { rank: i + 1, name: u ? u.username : '?', score: e.score, details: e.details, at: e.at };
    });
  }

  /* Plant Match: how often every plant was liked, matched, won a date…
     (counters from every player; {code: {kind: n}}) */

  addMatchStats(events) {
    const stats = (this.db.matchStats = this.db.matchStats || {});
    const changed = [];
    for (const [code, kinds] of Object.entries(events)) {
      if (!stats[code] && Object.keys(stats).length >= MAX_MATCH_PLANTS) continue;
      const row = (stats[code] = stats[code] || {});
      for (const [kind, n] of Object.entries(kinds)) {
        row[kind] = (row[kind] || 0) + n;
        changed.push([code, kind, row[kind]]);
      }
    }
    if (changed.length) this.persistMatchStats(changed);
  }

  // Top plants of each kind: {kind: [{code, n}]}.
  topMatchStats(kinds, limit) {
    const stats = this.db.matchStats || {};
    const out = {};
    for (const kind of kinds) {
      out[kind] = Object.entries(stats)
        .filter(([, r]) => r[kind] > 0)
        .map(([code, r]) => ({ code, n: r[kind] }))
        .sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1))
        .slice(0, limit);
    }
    return out;
  }

  /* Plant Match progress of each account (partners, chats, likes…):
     {userId: {data: JSON text, updatedAt}} */

  async getMatchState(userId) {
    const e = (this.db.matchState || {})[userId];
    return e ? { data: e.data, updatedAt: e.updatedAt } : null;
  }

  async putMatchState(userId, data) {
    this.db.matchState = this.db.matchState || {};
    const updatedAt = Date.now();
    this.db.matchState[userId] = { data, updatedAt };
    this.persistMatchState(userId, data, updatedAt);
    return updatedAt;
  }

  /* Plant Match players: profiles shown to other players and private
     messages between them. FileStore keeps everything in db.json (the last
     MAX_DMS messages); MariaStore overrides the messages with SQL. */

  getMatchProfile(userId) {
    return (this.db.matchProfiles || {})[userId] || null;
  }

  putMatchProfile(userId, prof) {
    this.db.matchProfiles = this.db.matchProfiles || {};
    this.db.matchProfiles[userId] = prof;
    this.persistMatchProfile(userId, prof);
    return prof;
  }

  listMatchProfiles() {
    return Object.entries(this.db.matchProfiles || {}).map(([userId, p]) => Object.assign({ userId }, p));
  }

  async addDm(fromId, toId, text) {
    const m = { id: ++this.db.dmSeq, from: fromId, to: toId, text, at: Date.now(), read: 0 };
    this.db.dms.push(m);
    if (this.db.dms.length > MAX_DMS) this.db.dms.splice(0, this.db.dms.length - MAX_DMS);
    this.persistDm(m);
    return m;
  }

  // Messages to or from the account after an id (the last `limit` ones).
  async listDms(userId, afterId, limit) {
    const list = this.db.dms.filter((m) => m.id > afterId && (m.from === userId || m.to === userId));
    return list.slice(-limit).map((m) => Object.assign({}, m));
  }

  async markDmsRead(toId, fromId) {
    const now = Date.now();
    let n = 0;
    for (const m of this.db.dms) {
      if (m.to === toId && m.from === fromId && !m.read) {
        m.read = now;
        n++;
      }
    }
    if (n) this.persistDm(null);
    return n;
  }

  // Per correspondent: the last id of the account's messages they have read.
  async lastReads(userId) {
    const out = {};
    for (const m of this.db.dms) {
      if (m.from === userId && m.read && (!out[m.to] || m.id > out[m.to])) out[m.to] = m.id;
    }
    return out;
  }

  addMatchReport(r) {
    this.db.matchReports = this.db.matchReports || [];
    this.db.matchReports.push(r);
    if (this.db.matchReports.length > 1000) this.db.matchReports.shift();
    this.persistMatchReport(r);
  }

  async listMatchReports() {
    return (this.db.matchReports || []).slice().reverse();
  }

  /* achievements: {id: unlockedAt} per account */

  getAchievements(userId) {
    return Object.assign({}, this.db.achievements[userId] || {});
  }

  // Merges unlocked achievements (never removes any). Returns the full map.
  addAchievements(userId, ids) {
    const map = (this.db.achievements[userId] = this.db.achievements[userId] || {});
    const added = [];
    for (const id of ids) {
      if (!map[id]) {
        map[id] = Date.now();
        added.push(id);
      }
    }
    if (added.length) this.persistAchievements(userId, added.map((id) => [id, map[id]]));
    return Object.assign({}, map);
  }
}

/* ------------------------------------------------------------- FileStore */

class FileStore extends BaseStore {
  constructor(dir) {
    super();
    this.dir = dir;
    this.savesDir = path.join(dir, 'saves');
    fs.mkdirSync(this.savesDir, { recursive: true });
    this.file = path.join(dir, 'db.json');
    if (fs.existsSync(this.file)) {
      try {
        this.db = Object.assign(this.db, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch (e) {
        throw new Error('Cannot read ' + this.file + ': ' + e.message);
      }
    }
    if (!this.db.secret) {
      this.db.secret = crypto.randomBytes(32).toString('hex');
      this.flushSync();
    }
    this.index();
    this._timer = null;
  }

  get kind() {
    return 'file';
  }

  dirty() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      try {
        this.flushSync();
      } catch (e) {
        // Keep serving (the data stays in memory and is retried on the next
        // change) instead of crashing the whole server.
        console.error('[store] cannot write %s: %s (disk full or no permission on DATA_DIR?)', this.file, e.message);
      }
    }, 500);
  }

  persistUser() {
    this.dirty();
  }
  persistSession() {
    this.dirty();
  }
  persistSessionDelete() {
    this.dirty();
  }
  persistMatch() {
    this.dirty();
  }
  persistScore() {
    this.dirty();
  }
  persistAchievements() {
    this.dirty();
  }
  persistMatchStats() {
    this.dirty();
  }
  persistMatchState() {
    this.dirty();
  }
  persistMatchProfile() {
    this.dirty();
  }
  persistDm() {
    this.dirty();
  }
  persistMatchReport() {
    this.dirty();
  }

  // Fails early, with a clear message, when DATA_DIR is not writable.
  checkWritable() {
    const probe = path.join(this.dir, '.write-test-' + process.pid);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  }

  flushSync() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    atomicWrite(this.file, JSON.stringify(this.db));
  }

  async close() {
    this.flushSync();
  }

  saveFile(userId) {
    return path.join(this.savesDir, userId.replace(/[^a-f0-9-]/gi, '') + '.json');
  }

  async readSave(userId) {
    try {
      return JSON.parse(fs.readFileSync(this.saveFile(userId), 'utf8')).data;
    } catch (e) {
      return null;
    }
  }

  async backupSave(userId) {
    const file = this.saveFile(userId);
    try {
      fs.copyFileSync(file, file.replace(/\.json$/, '.bak.json'));
    } catch (e) {}
  }

  async saveHistory(userId) {
    const file = this.saveFile(userId).replace(/\.json$/, '.bak.json');
    try {
      const st = fs.statSync(file);
      return [{ id: 'bak', updatedAt: st.mtimeMs | 0, size: st.size, device: 'backup', reason: 'backup' }];
    } catch (e) {
      return [];
    }
  }

  async readSaveVersion(userId, id) {
    if (id !== 'bak') return null;
    try {
      return JSON.parse(fs.readFileSync(this.saveFile(userId).replace(/\.json$/, '.bak.json'), 'utf8')).data;
    } catch (e) {
      return null;
    }
  }

  async writeSave(userId, data, device) {
    const meta = { updatedAt: Date.now(), size: Buffer.byteLength(data), device: device || '' };
    atomicWrite(this.saveFile(userId), JSON.stringify({ data }));
    this.db.users[userId].save = meta;
    this.dirty();
    return meta;
  }

  /* branding: config in db.json, images in DATA_DIR/branding/<id> */

  brandingDir() {
    const dir = path.join(this.dir, 'branding');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async getBranding() {
    return this.db.branding || null;
  }

  async setBranding(config) {
    this.db.branding = config;
    this.flushSync();
  }

  async putBrandingImage(id, mime, buf) {
    atomicWrite(path.join(this.brandingDir(), id), buf);
    this.db.brandingImages = this.db.brandingImages || {};
    this.db.brandingImages[id] = { mime, size: buf.length, at: Date.now() };
    this.dirty();
  }

  async getBrandingImage(id) {
    const meta = this.db.brandingImages && this.db.brandingImages[id];
    if (!meta) return null;
    try {
      return { mime: meta.mime, data: fs.readFileSync(path.join(this.brandingDir(), id)) };
    } catch (e) {
      return null;
    }
  }

  async deleteBrandingImages(keep) {
    const imgs = this.db.brandingImages || {};
    for (const id of Object.keys(imgs)) {
      if (keep.has(id)) continue;
      delete imgs[id];
      try {
        fs.unlinkSync(path.join(this.brandingDir(), id));
      } catch (e) {}
    }
    this.dirty();
  }
}

/* ------------------------------------------------------------- factory */

function dbConfigured(env) {
  return !!(env.DATABASE_URL || env.DB_HOST);
}

// Returns a ready store for this environment (FileStore or MariaStore).
async function openStore(env, dataDir) {
  if (dbConfigured(env)) {
    const { MariaStore } = require('./db-mariadb');
    const store = new MariaStore(env, dataDir);
    await store.init();
    return store;
  }
  return new FileStore(dataDir);
}

module.exports = { BaseStore, FileStore, Store: FileStore, openStore, dbConfigured, profileSummary, normalizeSave, atomicWrite, MAX_MATCHES, MAX_SCORES };

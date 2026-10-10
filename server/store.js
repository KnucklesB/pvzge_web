'use strict';

/*
 * Small file-backed store: accounts, sessions and match history live in
 * db.json (written atomically, debounced); each cloud save is its own file.
 * Plenty for a community server; swap for a database if it ever outgrows it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newToken, hashToken } = require('./auth');

const SESSION_TTL = 60 * 24 * 3600 * 1000;
const MAX_MATCHES = 2000;

function atomicWrite(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.savesDir = path.join(dir, 'saves');
    fs.mkdirSync(this.savesDir, { recursive: true });
    this.file = path.join(dir, 'db.json');
    this.db = { users: {}, sessions: {}, matches: [], secret: '' };
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
    this.byName = new Map();
    for (const u of Object.values(this.db.users)) this.byName.set(u.username.toLowerCase(), u);
    this._timer = null;
    setInterval(() => this.pruneSessions(), 3600 * 1000).unref();
  }

  get secret() {
    return this.db.secret;
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

  /* users */

  findUser(username) {
    return this.byName.get(String(username || '').toLowerCase()) || null;
  }

  getUser(id) {
    return this.db.users[id] || null;
  }

  createUser(username, passwordHash) {
    const id = crypto.randomUUID();
    const user = {
      id,
      username,
      password: passwordHash,
      createdAt: Date.now(),
      stats: { matches: 0, wins: 0, versus: 0, versusWins: 0, coop: 0, survival: 0, bestWave: 0 },
    };
    this.db.users[id] = user;
    this.byName.set(username.toLowerCase(), user);
    this.dirty();
    return user;
  }

  setPassword(id, hash) {
    const u = this.db.users[id];
    if (!u) return;
    u.password = hash;
    for (const [k, s] of Object.entries(this.db.sessions)) if (s.userId === id) delete this.db.sessions[k];
    this.dirty();
  }

  publicUser(u) {
    return { id: u.id, username: u.username, createdAt: u.createdAt, stats: u.stats, save: this.saveMeta(u.id) };
  }

  listUsers() {
    return Object.values(this.db.users);
  }

  /* sessions */

  createSession(userId) {
    const token = newToken();
    this.db.sessions[hashToken(token)] = { userId, expires: Date.now() + SESSION_TTL };
    this.dirty();
    return token;
  }

  userForToken(token) {
    const s = this.db.sessions[hashToken(token)];
    if (!s || s.expires < Date.now()) return null;
    return this.db.users[s.userId] || null;
  }

  deleteSession(token) {
    delete this.db.sessions[hashToken(token)];
    this.dirty();
  }

  pruneSessions() {
    const now = Date.now();
    let changed = false;
    for (const [k, s] of Object.entries(this.db.sessions)) {
      if (s.expires < now) {
        delete this.db.sessions[k];
        changed = true;
      }
    }
    if (changed) this.dirty();
  }

  /* saves */

  saveFile(userId) {
    return path.join(this.savesDir, userId.replace(/[^a-f0-9-]/gi, '') + '.json');
  }

  saveMeta(userId) {
    const u = this.db.users[userId];
    return (u && u.save) || null;
  }

  readSave(userId) {
    try {
      return JSON.parse(fs.readFileSync(this.saveFile(userId), 'utf8')).data;
    } catch (e) {
      return null;
    }
  }

  backupSave(userId) {
    const file = this.saveFile(userId);
    try {
      fs.copyFileSync(file, file.replace(/\.json$/, '.bak.json'));
    } catch (e) {}
  }

  writeSave(userId, data, device) {
    const meta = { updatedAt: Date.now(), size: Buffer.byteLength(data), device: device || '' };
    atomicWrite(this.saveFile(userId), JSON.stringify({ data }));
    this.db.users[userId].save = meta;
    this.dirty();
    return meta;
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
    }
    this.dirty();
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
}

module.exports = { Store };

/*
 * PvZ2 Gardendless - multiplayer server.
 *
 *   /peerjs/   PeerJS signaling (players find each other; the game stream and
 *              inputs then flow directly between the two browsers)
 *   /api/      accounts, cloud saves, public room list and match history
 *
 * Environment:
 *   PORT             listening port (default 9000)
 *   HOST             listening address (default: all interfaces)
 *   DATA_DIR         where accounts/saves/matches are stored (default ./data)
 *   ALLOWED_ORIGINS  comma separated CORS origins allowed to use the API
 *                    (default "*"; the API uses bearer tokens, not cookies)
 *   PEER_KEY         PeerJS API key shared with the clients (default "peerjs")
 *   PROXIED          "true" when running behind a reverse proxy
 *   MAX_SAVE_MB      maximum cloud save size (default 8)
 *   ADMIN_USERS      comma separated usernames allowed to edit saves (their
 *                    own and every player's) and to import save files
 *   SAVE_IMPORT      "admins" (default) or "all": who may import save files
 *   MATCH_PHOTOS     Plant Match player photos: "approve" (default, an admin
 *                    approves each one), "open" or "off"
 *   DB_HOST / DATABASE_URL  store everything in MariaDB instead of DATA_DIR
 *                    (see db-mariadb.js for DB_PORT, DB_USER, DB_PASSWORD,
 *                    DB_NAME, SAVE_HISTORY and DB_SYNC_SECONDS)
 */
'use strict';

const http = require('http');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const { openStore } = require('./store');
const auth = require('./auth');

const VERSION = '4.5.0';
const PORT = Number(process.env.PORT) || 9000;
const MAX_SAVE = (Number(process.env.MAX_SAVE_MB) || 8) * 1024 * 1024;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ROOM_TTL = 45 * 1000;
const MAX_PLAYERS = 4;
const ADMINS = new Set(
  (process.env.ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const IMPORT_ALL = (process.env.SAVE_IMPORT || '').toLowerCase() === 'all';

let store; // opened in start()
const app = express();
const server = http.createServer(app);

if (process.env.PROXIED === 'true') app.set('trust proxy', true);
app.disable('x-powered-by');

/*
 * Compatibility with clients configured for the first version of the server,
 * where signaling lived directly at /peerjs (PeerJS path "/"): rewrite those
 * URLs to the current /peerjs/peerjs mount, both for plain HTTP requests and
 * for the WebSocket upgrade (which never reaches Express).
 */
function legacyPeerUrl(url) {
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? '' : url.slice(q);
  if (path === '/peerjs' || path === '/peerjs/') return '/peerjs/peerjs' + query;
  if (path === '/peerjs/id') return '/peerjs/peerjs/id' + query;
  return url;
}
app.use((req, res, next) => {
  req.url = legacyPeerUrl(req.url);
  next();
});
server.prependListener('upgrade', (req) => {
  req.url = legacyPeerUrl(req.url);
});

/* ------------------------------------------------------------------ CORS */

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ORIGINS.includes('*') || ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', ORIGINS.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ------------------------------------------------------------ rate limit */

const buckets = new Map();
function limit(name, perMinute) {
  return (req, res, next) => {
    const key = name + ':' + req.ip;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > 60000) {
      b = { start: now, count: 0 };
      buckets.set(key, b);
    }
    if (++b.count > perMinute) return res.status(429).json({ error: 'rate_limited' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 120000) buckets.delete(k);
}, 60000).unref();

/* --------------------------------------------------------------- helpers */

const json = express.json({ limit: '64kb' });
const bigJson = express.json({ limit: Math.ceil(MAX_SAVE * 1.4) });

function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
}

function requireUser(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const user = token && store.userForToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  req.token = token;
  next();
}

// Express 4 does not catch rejected promises: pass them to the error handler
// (a crash here would take the signaling server down with it).
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

process.on('unhandledRejection', (e) => console.error('[error] unhandled rejection:', e));

function isAdmin(user) {
  return !!user && ADMINS.has(user.username.toLowerCase());
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'forbidden' });
    next();
  });
}

// The account as its owner sees it, with what it is allowed to do.
function userView(user) {
  const admin = isAdmin(user);
  return Object.assign(store.publicUser(user), { admin, can: { editSave: admin, importSave: admin || IMPORT_ALL } });
}

function validSave(data) {
  if (typeof data !== 'string' || !data.length) return 'bad_save';
  if (Buffer.byteLength(data) > MAX_SAVE) return 'save_too_large';
  try {
    JSON.parse(data);
  } catch (e) {
    return 'bad_save';
  }
  return null;
}

function optionalUser(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  req.user = (token && store.userForToken(token)) || null;
  next();
}

/* ------------------------------------------------------------------- API */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: VERSION, storage: store.kind, features: ['accounts', 'saves', 'rooms', 'matches', 'admin', 'history', 'scores', 'achievements', 'daily', 'branding', 'matchstats', 'matchstate', 'players', 'photos'] });
});

// Accounts ---------------------------------------------------------------

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_\-.]{2,19}$/;

app.post('/api/auth/register', limit('auth', 10), json, wrap(async (req, res) => {
  // Validate the raw value: never "fix" a username into a different one.
  const username = typeof (req.body && req.body.username) === 'string' ? req.body.username : '';
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  if (!USERNAME.test(username)) return res.status(400).json({ error: 'bad_username' });
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: 'bad_password' });
  if (store.findUser(username)) return res.status(409).json({ error: 'username_taken' });
  const hash = await auth.hashPassword(password);
  const user = await store.createUser(username, hash);
  const token = store.createSession(user.id);
  res.json({ token, user: userView(user) });
}));

app.post('/api/auth/login', limit('auth', 10), json, wrap(async (req, res) => {
  const username = typeof (req.body && req.body.username) === 'string' ? req.body.username : '';
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password.slice(0, 128) : '';
  const user = USERNAME.test(username) ? store.findUser(username) : null;
  const ok = user ? await auth.verifyPassword(password, user.password) : await auth.fakeVerify();
  if (!ok) return res.status(401).json({ error: 'bad_credentials' });
  const token = store.createSession(user.id);
  res.json({ token, user: userView(user) });
}));

app.post('/api/auth/logout', requireUser, (req, res) => {
  store.deleteSession(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireUser, (req, res) => {
  res.json({ user: userView(req.user) });
});

app.post('/api/auth/password', limit('auth', 10), requireUser, json, wrap(async (req, res) => {
  const current = typeof (req.body && req.body.current) === 'string' ? req.body.current.slice(0, 128) : '';
  const next = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  if (next.length < 6 || next.length > 128) return res.status(400).json({ error: 'bad_password' });
  if (!(await auth.verifyPassword(current, req.user.password))) return res.status(401).json({ error: 'bad_credentials' });
  await store.setPassword(req.user.id, await auth.hashPassword(next));
  res.json({ ok: true });
}));

// Short-lived signed ticket proving "I am this account" to the other player's
// host, so match results can be credited to the right accounts.
app.get('/api/auth/ticket', requireUser, (req, res) => {
  res.json({ ticket: auth.signTicket(store.secret, req.user.id) });
});

// Cloud saves ------------------------------------------------------------

app.get('/api/save', limit('save', 30), requireUser, wrap(async (req, res) => {
  const meta = store.saveMeta(req.user.id);
  if (!meta) return res.json({ save: null });
  if (req.query.meta) return res.json({ save: meta });
  res.json({ save: Object.assign({ data: await store.readSave(req.user.id) }, meta) });
}));

app.put('/api/save', limit('save', 30), requireUser, bigJson, wrap(async (req, res) => {
  const data = req.body && req.body.data;
  const bad = validSave(data);
  if (bad) return res.status(bad === 'save_too_large' ? 413 : 400).json({ error: bad });
  const meta = store.saveMeta(req.user.id);
  const base = req.body.base;
  if (meta && base != null && Number(base) !== meta.updatedAt && !req.body.force) {
    return res.status(409).json({ error: 'conflict', save: meta });
  }
  const saved = await store.writeSave(req.user.id, data, clean(req.body.device, 60));
  res.json({ save: saved });
}));

// Previous versions of the player's own save, a summary of its profiles and
// restoring one of those versions (the current one is kept in the history).
app.get('/api/save/history', limit('save', 30), requireUser, wrap(async (req, res) => {
  res.json({ history: await store.saveHistory(req.user.id) });
}));

app.get('/api/save/profiles', limit('save', 30), requireUser, wrap(async (req, res) => {
  res.json({ profiles: await store.saveProfiles(req.user.id) });
}));

app.post('/api/save/restore', limit('save', 10), requireUser, json, wrap(async (req, res) => {
  const data = await store.readSaveVersion(req.user.id, clean(req.body && req.body.id, 24));
  if (!data) return res.status(404).json({ error: 'not_found' });
  const saved = await store.writeSave(req.user.id, data, 'restore', 'restore');
  res.json({ save: saved });
}));

// Administration (ADMIN_USERS) -------------------------------------------

app.get('/api/admin/users', limit('admin', 120), requireAdmin, (req, res) => {
  const q = clean(req.query.q, 20).toLowerCase();
  const list = store
    .listUsers()
    .filter((u) => !q || u.username.toLowerCase().includes(q))
    .sort((a, b) => ((b.save && b.save.updatedAt) || 0) - ((a.save && a.save.updatedAt) || 0))
    .slice(0, 50)
    .map((u) => ({ id: u.id, username: u.username, createdAt: u.createdAt, admin: isAdmin(u), save: u.save || null }));
  res.json({ users: list });
});

function targetUser(req, res) {
  const u = store.findUser(req.params.name);
  if (!u) res.status(404).json({ error: 'not_found' });
  return u;
}

app.get('/api/admin/users/:name/save', limit('admin', 120), requireAdmin, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const meta = store.saveMeta(u.id);
  res.json({ save: meta ? Object.assign({ data: await store.readSave(u.id) }, meta) : null });
}));

app.get('/api/admin/users/:name/history', limit('admin', 120), requireAdmin, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  res.json({ history: await store.saveHistory(u.id), profiles: await store.saveProfiles(u.id) });
}));

app.get('/api/admin/users/:name/history/:id', limit('admin', 120), requireAdmin, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const data = await store.readSaveVersion(u.id, clean(req.params.id, 24));
  if (!data) return res.status(404).json({ error: 'not_found' });
  res.json({ save: { data } });
}));

app.post('/api/admin/users/:name/restore', limit('admin', 30), requireAdmin, json, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const data = await store.readSaveVersion(u.id, clean(req.body && req.body.id, 24));
  if (!data) return res.status(404).json({ error: 'not_found' });
  const saved = await store.writeSave(u.id, data, 'admin:' + req.user.username, 'restore');
  console.log('[admin] %s restored an older save of %s', req.user.username, u.username);
  res.json({ save: saved });
}));

// Replaces a player's cloud save (the previous one is kept as a backup).
// Their game downloads it on its next sync.
app.put('/api/admin/users/:name/save', limit('admin', 60), requireAdmin, bigJson, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const data = req.body && req.body.data;
  const bad = validSave(data);
  if (bad) return res.status(bad === 'save_too_large' ? 413 : 400).json({ error: bad });
  await store.backupSave(u.id);
  const saved = await store.writeSave(u.id, data, 'admin:' + req.user.username, 'admin');
  console.log('[admin] %s replaced the save of %s', req.user.username, u.username);
  res.json({ save: saved });
}));

// Sets a new password for a player who forgot theirs (their sessions end).
app.post('/api/admin/users/:name/password', limit('admin', 30), requireAdmin, json, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: 'bad_password' });
  await store.setPassword(u.id, await auth.hashPassword(password));
  console.log('[admin] %s set a new password for %s', req.user.username, u.username);
  res.json({ ok: true });
}));

// Server maintenance (cli.js) -------------------------------------------
// Only from inside the server's own container/machine (loopback) and with
// the key derived from the data directory's secret, which only that machine
// can read. Not under /api, so the bundled nginx never proxies it.

function localOnly(req, res, next) {
  const ip = req.socket.remoteAddress || '';
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const key = String(req.headers['x-local-key'] || '');
  if (!loopback || !key || key !== localKey(store.secret)) return res.status(404).end();
  next();
}

function localKey(secret) {
  return require('crypto').createHash('sha256').update('local:' + secret).digest('hex');
}

app.get('/local/users', localOnly, (req, res) => {
  const users = store
    .listUsers()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((u) => ({ username: u.username, createdAt: u.createdAt, admin: isAdmin(u), save: u.save || null }));
  res.json({ users });
});

app.post('/local/users/:name/password', localOnly, json, wrap(async (req, res) => {
  const u = store.findUser(req.params.name);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: 'bad_password' });
  await store.setPassword(u.id, await auth.hashPassword(password));
  console.log('[cli] new password set for %s', u.username);
  res.json({ ok: true, username: u.username });
}));

// Imports a save file for a player (cli.js import-save).
app.post('/local/users/:name/save', localOnly, bigJson, wrap(async (req, res) => {
  const u = store.findUser(req.params.name);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const data = req.body && req.body.data;
  const bad = validSave(data);
  if (bad) return res.status(400).json({ error: bad });
  await store.backupSave(u.id);
  const saved = await store.writeSave(u.id, data, 'import', 'import');
  console.log('[cli] save imported for %s', u.username);
  res.json({ ok: true, username: u.username, save: saved });
}));

// Public rooms -----------------------------------------------------------

const rooms = new Map();

function publicRoom(r) {
  return {
    code: r.code,
    host: r.host,
    mode: r.mode,
    stage: r.stage,
    players: r.players,
    max: r.max,
    status: r.status,
    hasAccount: !!r.userId,
    updatedAt: r.updatedAt,
  };
}

app.get('/api/rooms', limit('rooms', 120), (req, res) => {
  const now = Date.now();
  const list = [];
  for (const r of rooms.values()) {
    if (now - r.updatedAt > ROOM_TTL) rooms.delete(r.code);
    else if (r.public) list.push(publicRoom(r));
  }
  list.sort((a, b) => (a.status === b.status ? b.updatedAt - a.updatedAt : a.status === 'waiting' ? -1 : 1));
  res.json({ rooms: list.slice(0, 100) });
});

app.put('/api/rooms/:code', limit('rooms', 120), optionalUser, json, (req, res) => {
  const code = clean(req.params.code, 8).toUpperCase();
  const body = req.body || {};
  const key = clean(body.key, 64);
  if (!/^[A-Z0-9]{5}$/.test(code) || key.length < 16) return res.status(400).json({ error: 'bad_room' });
  const existing = rooms.get(code);
  if (existing && existing.key !== key && Date.now() - existing.updatedAt < ROOM_TTL) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!existing && rooms.size > 5000) return res.status(503).json({ error: 'busy' });
  rooms.set(code, {
    code,
    key,
    host: clean(body.host, 20) || 'Player',
    mode: clean(body.mode, 16),
    stage: clean(body.stage, 16),
    max: Math.max(2, Math.min(MAX_PLAYERS, Number(body.max) || 2)),
    players: Math.max(1, Math.min(MAX_PLAYERS, Number(body.players) || 1)),
    status: body.status === 'playing' ? 'playing' : 'waiting',
    public: body.public !== false,
    userId: req.user ? req.user.id : null,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  });
  res.json({ ok: true });
});

app.delete('/api/rooms/:code', limit('rooms', 120), json, (req, res) => {
  const code = clean(req.params.code, 8).toUpperCase();
  const r = rooms.get(code);
  if (r && r.key === clean((req.body && req.body.key) || req.query.key, 64)) rooms.delete(code);
  res.json({ ok: true });
});

// Match history -----------------------------------------------------------

app.post('/api/matches', limit('matches', 20), optionalUser, json, (req, res) => {
  const b = req.body || {};
  const code = clean(b.room, 8).toUpperCase();
  const room = rooms.get(code);
  // Only the host of a live room may report its results.
  if (!room || room.key !== clean(b.key, 64)) return res.status(403).json({ error: 'forbidden' });
  const players = (Array.isArray(b.players) ? b.players : []).slice(0, MAX_PLAYERS).map((p) => {
    let userId = null;
    if (p && p.self && req.user) userId = req.user.id;
    else if (p && p.ticket) userId = auth.verifyTicket(store.secret, String(p.ticket));
    const user = userId ? store.getUser(userId) : null;
    return {
      name: user ? user.username : clean(p && p.name, 20) || 'Player',
      account: !!user,
      userId: user ? user.id : null,
      side: clean(p && p.side, 16),
      score: Math.max(0, Math.min(1e6, Number(p && p.score) || 0)),
      win: !!(p && p.win),
    };
  });
  const match = store.addMatch({
    mode: clean(b.mode, 16),
    stage: clean(b.stage, 16),
    winner: clean(b.winner, 16),
    duration: Math.max(0, Math.min(36000, Number(b.duration) || 0)),
    waves: Math.max(0, Math.min(1000, Number(b.waves) || 0)),
    players,
  });
  res.json({ ok: true, id: match.id });
});

app.get('/api/matches', limit('matches', 120), (req, res) => {
  const user = req.query.user ? store.findUser(clean(req.query.user, 20)) : null;
  if (req.query.user && !user) return res.json({ matches: [] });
  const list = store.listMatches(Math.min(100, Number(req.query.limit) || 30), user ? user.id : null);
  res.json({ matches: list });
});

app.get('/api/users/:name', limit('rooms', 120), (req, res) => {
  const user = store.findUser(clean(req.params.name, 20));
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json({ user: store.publicUser(user) });
});

// Leaderboards and achievements -----------------------------------------

// The server's date decides the daily challenge, so every player gets the
// same one whatever their clock says.
function today(offsetDays) {
  return new Date(Date.now() + (offsetDays || 0) * 86400000).toISOString().slice(0, 10);
}

app.get('/api/daily', (req, res) => {
  const date = today();
  res.json({ date, seed: parseInt(require('crypto').createHash('sha256').update('daily:' + date).digest('hex').slice(0, 8), 16) });
});

// daily:YYYY-MM-DD (today or yesterday, for runs that end after midnight),
// survival (solo endless waves) and challenge:<id> boards.
function validBoard(board) {
  const m = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(board);
  if (m) return m[1] === today() || m[1] === today(-1);
  return board === 'survival' || /^challenge:[a-z0-9_-]{1,32}$/.test(board);
}

app.get('/api/scores/:board', limit('rooms', 120), optionalUser, (req, res) => {
  const board = clean(req.params.board, 48);
  const list = store.listScores(board, Math.min(100, Number(req.query.limit) || 20));
  let me = null;
  if (req.user) {
    const all = store.db.scores[board] || [];
    const i = all.findIndex((e) => e.userId === req.user.id);
    if (i >= 0) me = { rank: i + 1, score: all[i].score };
  }
  res.json({ board, scores: list, me });
});

app.post('/api/scores/:board', limit('scores', 20), requireUser, json, (req, res) => {
  const board = clean(req.params.board, 48);
  if (!validBoard(board)) return res.status(400).json({ error: 'bad_board' });
  // Computed by the server from the synced Plant Match progress.
  if (board === 'challenge:couple') return res.status(400).json({ error: 'reserved_board' });
  const score = Math.floor(Number(req.body && req.body.score));
  if (!Number.isFinite(score) || score < 0 || score > 1e9) return res.status(400).json({ error: 'bad_score' });
  const d = (req.body && req.body.details) || {};
  const details = {};
  for (const k of ['waves', 'time', 'kills', 'sun', 'plants', 'stage', 'mutators', 'plant', 'rel', 'team']) {
    if (d[k] != null) details[k] = typeof d[k] === 'number' ? Math.max(0, Math.min(1e9, d[k])) : clean(d[k], 80);
  }
  const r = store.addScore(board, req.user.id, score, details);
  if (board === 'survival' && (Number(details.waves) || 0) > (req.user.stats.bestSoloWave || 0)) {
    req.user.stats.bestSoloWave = Number(details.waves) || 0;
    store.persistUser(req.user);
  }
  res.json(r);
});

// Branding (logos and game images replaced by admins) -----------------------
//
// config: { version, title, icon, menuLogo: {img, x, y, scale}, frames:
// {"<sprite frame name>": "<image id>"}, faces: {"<world>": {head, jaw,
// hideJaw}} } - image ids are content hashes, so images are immutable and
// cached for good.

const BRAND_MIME = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
const BRAND_ID = /^[a-f0-9]{40}$/;
const brandJson = express.json({ limit: '12mb' });

function brandingIds(cfg) {
  const ids = new Set();
  if (!cfg) return ids;
  if (cfg.icon) ids.add(cfg.icon);
  if (cfg.menuLogo && cfg.menuLogo.img) ids.add(cfg.menuLogo.img);
  Object.values(cfg.frames || {}).forEach((id) => ids.add(id));
  Object.values(cfg.faces || {}).forEach((f) => {
    if (f.head) ids.add(f.head);
    if (f.jaw) ids.add(f.jaw);
  });
  return ids;
}

app.get('/api/branding', limit('rooms', 240), wrap(async (req, res) => {
  res.json({ branding: (await store.getBranding()) || null });
}));

app.get('/api/branding/img/:id', limit('brandimg', 600), wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!BRAND_ID.test(id)) return res.status(404).end();
  const img = await store.getBrandingImage(id);
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(img.data);
}));

// {data: "data:image/png;base64,..."} -> {id}
app.post('/api/admin/branding/img', limit('admin', 120), requireAdmin, brandJson, wrap(async (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.data) || ''));
  if (!m || !BRAND_MIME[m[1]]) return res.status(400).json({ error: 'bad_image' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'too_large' });
  const id = require('crypto').createHash('sha1').update(buf).digest('hex');
  await store.putBrandingImage(id, m[1], buf);
  res.json({ id, url: '/api/branding/img/' + id });
}));

app.put('/api/admin/branding', limit('admin', 60), requireAdmin, json, wrap(async (req, res) => {
  const b = (req.body && req.body.branding) || {};
  const okId = (v) => (typeof v === 'string' && BRAND_ID.test(v) ? v : null);
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
  const frames = {};
  Object.keys(b.frames || {})
    .slice(0, 300)
    .forEach((name) => {
      const n = clean(name, 80);
      const id = okId(b.frames[name]);
      if (n && id) frames[n] = id;
    });
  // Zombie faces per world: {world: {head, jaw, hideJaw}}.
  const faces = {};
  Object.keys(b.faces || {})
    .slice(0, 40)
    .forEach((w) => {
      const f = b.faces[w] || {};
      if (!/^[a-z]{2,16}$/.test(w) || !okId(f.head)) return;
      faces[w] = { head: okId(f.head), jaw: okId(f.jaw), hideJaw: !!f.hideJaw && !okId(f.jaw) };
    });
  const cfg = {
    version: Date.now(),
    faces,
    title: clean(b.title, 80),
    icon: okId(b.icon),
    menuLogo: b.menuLogo && okId(b.menuLogo.img) ? { img: okId(b.menuLogo.img), x: num(b.menuLogo.x, -1, 1, 0), y: num(b.menuLogo.y, -1, 1, 0.22), scale: num(b.menuLogo.scale, 0.05, 2, 0.55) } : null,
    frames,
    updatedBy: req.user.username,
  };
  await store.setBranding(cfg);
  await store.deleteBrandingImages(brandingIds(cfg));
  console.log('[admin] %s changed the branding (%d image(s))', req.user.username, brandingIds(cfg).size);
  res.json({ branding: cfg });
}));

// Plant Match: anonymous counters of what players do with each plant, to
// show the most liked / most dated plants of the whole server.
const MATCH_KINDS = ['like', 'super', 'match', 'date', 'partner', 'wed'];
const PLANT_CODE = /^[a-z0-9_]{1,40}$/;

// Each account (or address) adds at most this many counts a day.
const STATS_PER_DAY = 600;
const statBudget = new Map();

app.post('/api/match/stats', limit('matchstats', 12), optionalUser, json, (req, res) => {
  const ev = (req.body && req.body.events) || {};
  const events = {};
  let count = 0;
  let total = 0;
  for (const [code, kinds] of Object.entries(typeof ev === 'object' ? ev : {})) {
    if (!PLANT_CODE.test(code) || !kinds || typeof kinds !== 'object' || ++count > 40) continue;
    for (const kind of MATCH_KINDS) {
      const n = Math.floor(Number(kinds[kind]));
      if (n > 0) {
        (events[code] = events[code] || {})[kind] = Math.min(n, 10);
        total += Math.min(n, 10);
      }
    }
  }
  const key = req.user ? 'u:' + req.user.id : 'ip:' + req.ip;
  const day = today();
  let b = statBudget.get(key);
  if (!b || b.day !== day) statBudget.set(key, (b = { day, n: 0 }));
  if (b.n + total > STATS_PER_DAY) return res.json({ ok: true, dropped: true });
  b.n += total;
  if (statBudget.size > 50000) statBudget.clear();
  store.addMatchStats(events);
  res.json({ ok: true });
});

// Plant Match progress of the account (partners, chats, likes…), synced by
// the game. The partners feed the couples ranking, so the server checks
// them: relationship points grow at most MATCH_XP_PER_DAY a day (plus a
// first upload of offline progress), at most MAX_PARTNERS partners, a
// wedding needs an engaged partner; the couple score is computed here.
const MATCH_STATE_MAX = 600 * 1024;
const MATCH_XP_PER_DAY = 40;
const MATCH_XP_FIRST = 30;
const MAX_PARTNERS = 5;
const matchJson = express.json({ limit: '700kb' });
const STATE_KEY = /^match[A-Za-z]{1,24}$/;

function relStage(r) {
  return r.married ? 3 : r.xp >= 8 ? 2 : r.xp >= 3 ? 1 : 0;
}

function couplePoints(ps) {
  return Object.values(ps).reduce((n, r) => n + Math.max(0, r.xp) + (r.married ? 10 : 0), 0);
}

function smallMap(o, valid) {
  const out = {};
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o).slice(0, 20)) {
      if (/^[a-z]{1,16}$/.test(k) && valid(v)) out[k] = v;
    }
  }
  return out;
}

function checkPartners(next, prev, srv) {
  const out = {};
  const first = !prev;
  prev = prev || {};
  const day = today();
  if (srv.day !== day) Object.assign(srv, { day, gained: 0 });
  for (const [code, r] of Object.entries(next && typeof next === 'object' ? next : {})) {
    if (!PLANT_CODE.test(code) || !r || typeof r !== 'object' || Object.keys(out).length >= MAX_PARTNERS) continue;
    const p = prev[code];
    const base = p ? Math.max(0, Number(p.xp) || 0) : 0;
    let xp = Math.floor(Number(r.xp) || 0);
    if (first) xp = Math.min(xp, MATCH_XP_FIRST);
    else if (xp > base) {
      const gain = Math.min(xp - base, Math.max(0, MATCH_XP_PER_DAY - srv.gained));
      srv.gained += gain;
      xp = base + gain;
    }
    xp = Math.max(-1, xp);
    const married = !!r.married && ((p && p.married) || xp >= 8 || base >= 8);
    out[code] = {
      since: Math.min(Date.now(), Number(r.since) || Date.now()),
      xp,
      married,
      dates: smallMap(r.dates, (v) => Number.isInteger(v) && v >= 0 && v <= 3),
      gifts: smallMap(r.gifts, (v) => typeof v === 'string' && v.length <= 10),
    };
  }
  return out;
}

function readMatchState(entry) {
  if (!entry) return null;
  try {
    const o = JSON.parse(entry.data);
    return { state: o.state || {}, srv: o.srv || {}, updatedAt: entry.updatedAt };
  } catch (e) {
    return null;
  }
}

app.get('/api/match/state', limit('save', 60), requireUser, wrap(async (req, res) => {
  const cur = readMatchState(await store.getMatchState(req.user.id));
  res.json({ state: cur ? cur.state : null, updatedAt: cur ? cur.updatedAt : 0 });
}));

app.put('/api/match/state', limit('save', 30), requireUser, matchJson, wrap(async (req, res) => {
  const body = req.body && req.body.state;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_state' });
  const cur = readMatchState(await store.getMatchState(req.user.id));
  const state = {};
  for (const [k, v] of Object.entries(body)) if (STATE_KEY.test(k)) state[k] = v;
  const srv = Object.assign({ day: '', gained: 0 }, cur ? cur.srv : {});
  state.matchPartners = checkPartners(state.matchPartners, cur ? cur.state.matchPartners || {} : null, srv);
  const data = JSON.stringify({ v: 1, state, srv });
  if (Buffer.byteLength(data) > MATCH_STATE_MAX) return res.status(413).json({ error: 'too_large' });
  const updatedAt = await store.putMatchState(req.user.id, data);
  const ps = state.matchPartners;
  const best = Object.keys(ps).sort((a, b) => ps[b].xp + (ps[b].married ? 10 : 0) - (ps[a].xp + (ps[a].married ? 10 : 0)))[0];
  const points = couplePoints(ps);
  let couple = null;
  if (points > 0) couple = store.addScore('challenge:couple', req.user.id, points, { plant: best || '', rel: best ? String(relStage(ps[best])) : '', plants: Object.keys(ps).length });
  res.json({ updatedAt, partners: ps, couple });
}));

app.get('/api/match/stats', limit('rooms', 120), (req, res) => {
  res.json({ top: store.topMatchStats(MATCH_KINDS, Math.min(30, Number(req.query.limit) || 10)) });
});

// Plant Match players -----------------------------------------------------
//
// Players who create a profile appear to each other and can send private
// messages (polled by the game). Profiles: gender, who they look for, a bio
// and a favorite plant; the partner shown comes from the synced progress.
// Each player can block (no messages either way, hidden from each other) and
// report (kept for the admins: GET /api/admin/match/reports).

const GENDERS = ['f', 'm', 'n'];
const ONLINE_MS = 90 * 1000;

// Profile customization (the client has the texts of these keys).
const PRONOUNS = ['ele', 'ela', 'elu', 'any'];
const COLORS = ['pink', 'sun', 'leaf', 'sky', 'night', 'zombie'];
const INTERESTS = ['strategy', 'speedrun', 'survival', 'multiplayer', 'achievements', 'collect', 'sandbox', 'chill', 'music', 'memes', 'art', 'history'];
const WORLDS = ['frontyard', 'egypt', 'pirate', 'cowboy', 'kongfu', 'future', 'dark', 'beach', 'iceage', 'lostcity', 'eighties', 'dino', 'sky'];
const PROMPTS = ['lucky', 'secret', 'hate', 'date', 'song', 'first'];

// Player photos: MATCH_PHOTOS=approve (default: an admin approves each photo
// before other players see it), open (shown right away) or off.
const PHOTOS_MODE = ['approve', 'open', 'off'].includes((process.env.MATCH_PHOTOS || '').toLowerCase()) ? process.env.MATCH_PHOTOS.toLowerCase() : 'approve';
const PHOTO_MIME = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };
const PHOTO_MAX = 1.5 * 1024 * 1024;
const PHOTOS_PER_PLAYER = 6;
const PHOTO_ID = /^[a-f0-9]{40}$/;
const photoJson = express.json({ limit: '3mb' });

function photosOf(p, owner) {
  return (p.photos || []).filter((id) => {
    const m = store.matchPhotoMeta(id);
    return m && (owner ? m.status !== 'rejected' : m.status === 'approved');
  });
}

function customFields(b) {
  return {
    nick: clean(b.nick, 24),
    pronouns: PRONOUNS.includes(b.pronouns) ? b.pronouns : '',
    mood: clean(b.mood, 8),
    color: COLORS.includes(b.color) ? b.color : 'pink',
    interests: (Array.isArray(b.interests) ? b.interests : []).filter((k) => INTERESTS.includes(k)).slice(0, 5),
    world: WORLDS.includes(b.world) ? b.world : '',
    prompts: (Array.isArray(b.prompts) ? b.prompts : [])
      .filter((q) => q && PROMPTS.includes(q.q) && clean(q.a, 120))
      .slice(0, 3)
      .map((q) => ({ q: q.q, a: clean(q.a, 120) })),
  };
}

async function bestPartner(userId) {
  const cur = readMatchState(await store.getMatchState(userId));
  const ps = (cur && cur.state.matchPartners) || {};
  const best = Object.keys(ps).sort((a, b) => ps[b].xp + (ps[b].married ? 10 : 0) - (ps[a].xp + (ps[a].married ? 10 : 0)))[0];
  return best ? { partner: best, rel: relStage(ps[best]), points: couplePoints(ps) } : { partner: '', rel: -1, points: 0 };
}

function publicProfile(userId, p, owner) {
  const u = store.getUser(userId);
  if (!u || !p) return null;
  return {
    name: u.username,
    nick: p.nick || '',
    pronouns: p.pronouns || '',
    mood: p.mood || '',
    color: p.color || 'pink',
    interests: p.interests || [],
    world: p.world || '',
    prompts: p.prompts || [],
    photos: photosOf(p, owner),
    gender: p.gender,
    interest: p.interest,
    bio: p.bio,
    plant: p.plant,
    team: p.team,
    partner: p.partner,
    rel: p.rel,
    points: p.points || 0,
    online: Date.now() - (p.lastSeen || 0) < ONLINE_MS,
    lastSeen: p.lastSeen || 0,
    visible: !!p.visible,
  };
}

// Marks the account as seen (written at most once a minute).
function touch(userId) {
  const p = store.getMatchProfile(userId);
  if (!p) return;
  const now = Date.now();
  const write = now - (p.savedSeen || 0) > 60000;
  p.lastSeen = now;
  if (write) {
    p.savedSeen = now;
    store.putMatchProfile(userId, p);
  }
}

function blockedBetween(a, b) {
  const pa = store.getMatchProfile(a);
  const pb = store.getMatchProfile(b);
  return !!((pa && (pa.blocked || []).includes(b)) || (pb && (pb.blocked || []).includes(a)));
}

app.get('/api/match/me', limit('rooms', 120), requireUser, (req, res) => {
  const p = store.getMatchProfile(req.user.id);
  const mine = store.listMatchPhotos((m) => m.owner === req.user.id && m.status !== 'rejected').map((m) => ({ id: m.id, status: m.status }));
  const rejected = store.listMatchPhotos((m) => m.owner === req.user.id && m.status === 'rejected').map((m) => m.id);
  res.json({
    photosMode: PHOTOS_MODE,
    photos: mine,
    rejected,
    profile: p ? Object.assign(publicProfile(req.user.id, p, true), { blocked: (p.blocked || []).map((id) => (store.getUser(id) || {}).username).filter(Boolean) }) : null,
  });
});

app.put('/api/match/profile', limit('save', 30), requireUser, json, wrap(async (req, res) => {
  const b = req.body || {};
  const prev = store.getMatchProfile(req.user.id) || {};
  const bp = await bestPartner(req.user.id);
  const ownPhotos = (Array.isArray(b.photos) ? b.photos : []).filter((id) => {
    const m = PHOTO_ID.test(id) && store.matchPhotoMeta(id);
    return m && m.owner === req.user.id && m.status !== 'rejected';
  });
  const prof = Object.assign(customFields(b), {
    photos: [...new Set(ownPhotos)].slice(0, PHOTOS_PER_PLAYER),
    visible: !!b.visible,
    gender: GENDERS.includes(b.gender) ? b.gender : '',
    interest: GENDERS.concat(['all']).includes(b.interest) ? b.interest : 'all',
    bio: clean(b.bio, 160),
    plant: PLANT_CODE.test(b.plant || '') ? b.plant : '',
    team: (Array.isArray(b.team) ? b.team : []).filter((c) => typeof c === 'string' && PLANT_CODE.test(c)).slice(0, 8),
    partner: bp.partner,
    rel: bp.rel,
    points: bp.points,
    blocked: prev.blocked || [],
    lastSeen: Date.now(),
    savedSeen: Date.now(),
  });
  store.putMatchProfile(req.user.id, prof);
  res.json({ profile: publicProfile(req.user.id, prof, true) });
}));

app.get('/api/match/players', limit('rooms', 120), requireUser, (req, res) => {
  touch(req.user.id);
  const me = req.user.id;
  const list = store
    .listMatchProfiles()
    .filter((p) => p.userId !== me && p.visible && !blockedBetween(me, p.userId))
    .map((p) => publicProfile(p.userId, p))
    .filter(Boolean)
    .sort((a, b) => b.online - a.online || b.lastSeen - a.lastSeen)
    .slice(0, 100);
  res.json({ players: list });
});

function nameOf(id) {
  const u = store.getUser(id);
  return u ? u.username : '?';
}

app.get('/api/match/dm', limit('dm', 120), requireUser, wrap(async (req, res) => {
  touch(req.user.id);
  const me = req.user.id;
  const after = Math.max(0, Math.floor(Number(req.query.after) || 0));
  const msgs = (await store.listDms(me, after, after ? 500 : 300)).filter((m) => !blockedBetween(me, m.from === me ? m.to : m.from));
  const reads = {};
  for (const [id, last] of Object.entries(await store.lastReads(me))) reads[nameOf(id)] = last;
  const profiles = {};
  for (const m of msgs) {
    const other = m.from === me ? m.to : m.from;
    if (!profiles[nameOf(other)]) profiles[nameOf(other)] = publicProfile(other, store.getMatchProfile(other));
  }
  res.json({
    me: req.user.username,
    messages: msgs.map((m) => ({ id: m.id, from: nameOf(m.from), to: nameOf(m.to), text: m.text, at: m.at, read: m.read || 0 })),
    reads,
    profiles,
  });
}));

app.post('/api/match/dm', limit('dmsend', 30), requireUser, json, wrap(async (req, res) => {
  const b = req.body || {};
  const text = clean(b.text, 500);
  const target = store.findUser(String(b.to || ''));
  if (!text) return res.status(400).json({ error: 'empty' });
  if (!target || target.id === req.user.id) return res.status(404).json({ error: 'no_player' });
  const mine = store.getMatchProfile(req.user.id);
  const theirs = store.getMatchProfile(target.id);
  if (!mine) return res.status(400).json({ error: 'no_profile' });
  if (!theirs || !theirs.visible) return res.status(403).json({ error: 'hidden' });
  if (blockedBetween(req.user.id, target.id)) return res.status(403).json({ error: 'blocked' });
  touch(req.user.id);
  const m = await store.addDm(req.user.id, target.id, text);
  res.json({ message: { id: m.id, from: req.user.username, to: target.username, text: m.text, at: m.at, read: 0 } });
}));

app.post('/api/match/dm/read', limit('dm', 120), requireUser, json, wrap(async (req, res) => {
  const other = store.findUser(String((req.body && req.body.with) || ''));
  if (!other) return res.status(404).json({ error: 'no_player' });
  res.json({ read: await store.markDmsRead(req.user.id, other.id) });
}));

app.post('/api/match/block', limit('save', 30), requireUser, json, (req, res) => {
  const other = store.findUser(String((req.body && req.body.name) || ''));
  if (!other || other.id === req.user.id) return res.status(404).json({ error: 'no_player' });
  const p = store.getMatchProfile(req.user.id) || { visible: false, gender: '', interest: 'all', bio: '', plant: '', team: [], lastSeen: Date.now() };
  const set = new Set(p.blocked || []);
  if (req.body.block === false) set.delete(other.id);
  else set.add(other.id);
  p.blocked = [...set].slice(0, 500);
  store.putMatchProfile(req.user.id, p);
  res.json({ blocked: p.blocked.map(nameOf) });
});

app.post('/api/match/report', limit('save', 10), requireUser, json, (req, res) => {
  const other = store.findUser(String((req.body && req.body.name) || ''));
  if (!other || other.id === req.user.id) return res.status(404).json({ error: 'no_player' });
  store.addMatchReport({ reporter: req.user.id, target: other.id, reason: clean(req.body.reason, 200) || 'report', excerpt: clean(req.body.excerpt, 1000), at: Date.now() });
  console.log('[report] %s reported %s', req.user.username, other.username);
  res.json({ ok: true });
});

// Photos ---------------------------------------------------------------------

app.post('/api/match/photo', limit('photo', 10), requireUser, photoJson, wrap(async (req, res) => {
  if (PHOTOS_MODE === 'off') return res.status(403).json({ error: 'photos_off' });
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.data) || ''));
  if (!m || !PHOTO_MIME[m[1]]) return res.status(400).json({ error: 'bad_image' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > PHOTO_MAX) return res.status(413).json({ error: 'too_large' });
  const own = store.listMatchPhotos((x) => x.owner === req.user.id && x.status !== 'rejected');
  if (own.length >= PHOTOS_PER_PLAYER) return res.status(400).json({ error: 'too_many' });
  const id = require('crypto').createHash('sha1').update(buf).digest('hex');
  const prev = store.matchPhotoMeta(id);
  if (prev && prev.owner !== req.user.id) return res.status(409).json({ error: 'taken' });
  const status = PHOTOS_MODE === 'open' ? 'approved' : 'pending';
  if (!prev) {
    await store.putMatchPhoto(id, req.user.id, m[1], buf, status);
    if (status === 'pending') console.log('[photos] %s sent a photo for approval (%s)', req.user.username, id.slice(0, 8));
  }
  res.json({ id, status: prev ? prev.status : status });
}));

// Approved photos are public; pending ones only for their owner and admins.
app.get('/api/match/photo/:id', limit('brandimg', 600), optionalUser, wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const meta = PHOTO_ID.test(id) && store.matchPhotoMeta(id);
  if (!meta) return res.status(404).end();
  const allowed = meta.status === 'approved' || (req.user && (req.user.id === meta.owner || isAdmin(req.user)));
  if (!allowed) return res.status(404).end();
  const img = await store.getMatchPhoto(id);
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', meta.status === 'approved' ? 'public, max-age=3600' : 'private, no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(img.data);
}));

function dropPhotoFromProfile(ownerId, id) {
  const p = store.getMatchProfile(ownerId);
  if (p && (p.photos || []).includes(id)) {
    p.photos = p.photos.filter((x) => x !== id);
    store.putMatchProfile(ownerId, p);
  }
}

app.delete('/api/match/photo/:id', limit('photo', 30), requireUser, wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const meta = PHOTO_ID.test(id) && store.matchPhotoMeta(id);
  if (!meta || (meta.owner !== req.user.id && !isAdmin(req.user))) return res.status(404).json({ error: 'not_found' });
  dropPhotoFromProfile(meta.owner, id);
  await store.deleteMatchPhoto(id);
  res.json({ ok: true });
}));

app.get('/api/admin/match/photos', limit('admin', 120), requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  res.json({
    mode: PHOTOS_MODE,
    photos: store
      .listMatchPhotos((m) => m.status === status)
      .slice(0, 200)
      .map((m) => ({ id: m.id, user: nameOf(m.owner), at: m.at, size: m.size, status: m.status })),
  });
});

app.post('/api/admin/match/photos/:id', limit('admin', 240), requireAdmin, json, wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const status = req.body && req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'bad_status' });
  const meta = PHOTO_ID.test(id) && store.matchPhotoMeta(id);
  if (!meta) return res.status(404).json({ error: 'not_found' });
  await store.setMatchPhotoStatus(id, status);
  if (status === 'rejected') dropPhotoFromProfile(meta.owner, id);
  console.log('[photos] %s %s a photo of %s', req.user.username, status, nameOf(meta.owner));
  res.json({ ok: true });
}));

app.get('/api/admin/match/reports', limit('admin', 60), requireAdmin, wrap(async (req, res) => {
  const list = await store.listMatchReports();
  res.json({ reports: list.map((r) => ({ reporter: nameOf(r.reporter), target: nameOf(r.target), reason: r.reason, excerpt: r.excerpt, at: r.at })) });
}));

const ACHIEVEMENT = /^[a-z0-9_]{2,40}$/;

app.get('/api/achievements', limit('save', 60), requireUser, (req, res) => {
  res.json({ achievements: store.getAchievements(req.user.id) });
});

app.put('/api/achievements', limit('save', 30), requireUser, json, (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).filter((id) => typeof id === 'string' && ACHIEVEMENT.test(id)).slice(0, 200);
  res.json({ achievements: store.addAchievements(req.user.id, ids) });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error] %s %s:', req.method, req.originalUrl, err);
  res.status(status).json({ error: status === 413 ? 'too_large' : status >= 400 && status < 500 ? 'bad_request' : 'server_error' });
});

/* --------------------------------------------------------------- PeerJS */

const peer = ExpressPeerServer(server, {
  path: '/',
  key: process.env.PEER_KEY || 'peerjs',
  proxied: process.env.PROXIED === 'true',
  allow_discovery: false,
  alive_timeout: 60000,
  expire_timeout: 5000,
  concurrent_limit: 5000,
});
app.use('/peerjs', peer);

async function start() {
  const dataDir = process.env.DATA_DIR || require('path').join(__dirname, 'data');
  try {
    store = await openStore(process.env, dataDir);
  } catch (e) {
    console.error('[store] %s', e.message);
    process.exit(1);
  }
  try {
    store.checkWritable();
  } catch (e) {
    console.error('[store] DATA_DIR %s is not writable: %s. Accounts and saves will fail until this is fixed.', store.dir, e.message);
  }
  server.listen(PORT, process.env.HOST || undefined, () => {
    console.log(`PvZ2 Gardendless multiplayer server ${VERSION} listening on :${PORT} (storage: ${store.kind})`);
  });
}
start();

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  Promise.resolve(store && store.close())
    .catch((e) => console.error('[store] %s', e.message))
    .finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

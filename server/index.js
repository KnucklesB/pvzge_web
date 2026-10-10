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
 */
'use strict';

const http = require('http');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const { Store } = require('./store');
const auth = require('./auth');

const VERSION = '2.2.0';
const PORT = Number(process.env.PORT) || 9000;
const MAX_SAVE = (Number(process.env.MAX_SAVE_MB) || 8) * 1024 * 1024;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ROOM_TTL = 45 * 1000;
const ADMINS = new Set(
  (process.env.ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const IMPORT_ALL = (process.env.SAVE_IMPORT || '').toLowerCase() === 'all';

const store = new Store(process.env.DATA_DIR || require('path').join(__dirname, 'data'));
try {
  store.checkWritable();
} catch (e) {
  console.error('[store] DATA_DIR %s is not writable: %s. Accounts and saves will fail until this is fixed.', store.dir, e.message);
}
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
  res.json({ ok: true, version: VERSION, features: ['accounts', 'saves', 'rooms', 'matches', 'admin'] });
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
  const user = store.createUser(username, hash);
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
  store.setPassword(req.user.id, await auth.hashPassword(next));
  res.json({ ok: true });
}));

// Short-lived signed ticket proving "I am this account" to the other player's
// host, so match results can be credited to the right accounts.
app.get('/api/auth/ticket', requireUser, (req, res) => {
  res.json({ ticket: auth.signTicket(store.secret, req.user.id) });
});

// Cloud saves ------------------------------------------------------------

app.get('/api/save', limit('save', 30), requireUser, (req, res) => {
  const meta = store.saveMeta(req.user.id);
  if (!meta) return res.json({ save: null });
  if (req.query.meta) return res.json({ save: meta });
  res.json({ save: Object.assign({ data: store.readSave(req.user.id) }, meta) });
});

app.put('/api/save', limit('save', 30), requireUser, bigJson, (req, res) => {
  const data = req.body && req.body.data;
  const bad = validSave(data);
  if (bad) return res.status(bad === 'save_too_large' ? 413 : 400).json({ error: bad });
  const meta = store.saveMeta(req.user.id);
  const base = req.body.base;
  if (meta && base != null && Number(base) !== meta.updatedAt && !req.body.force) {
    return res.status(409).json({ error: 'conflict', save: meta });
  }
  const saved = store.writeSave(req.user.id, data, clean(req.body.device, 60));
  res.json({ save: saved });
});

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

app.get('/api/admin/users/:name/save', limit('admin', 120), requireAdmin, (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const meta = store.saveMeta(u.id);
  res.json({ save: meta ? Object.assign({ data: store.readSave(u.id) }, meta) : null });
});

// Replaces a player's cloud save (the previous one is kept as a backup).
// Their game downloads it on its next sync.
app.put('/api/admin/users/:name/save', limit('admin', 60), requireAdmin, bigJson, (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const data = req.body && req.body.data;
  const bad = validSave(data);
  if (bad) return res.status(bad === 'save_too_large' ? 413 : 400).json({ error: bad });
  store.backupSave(u.id);
  const saved = store.writeSave(u.id, data, 'admin:' + req.user.username);
  console.log('[admin] %s replaced the save of %s', req.user.username, u.username);
  res.json({ save: saved });
});

// Sets a new password for a player who forgot theirs (their sessions end).
app.post('/api/admin/users/:name/password', limit('admin', 30), requireAdmin, json, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: 'bad_password' });
  store.setPassword(u.id, await auth.hashPassword(password));
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
  store.setPassword(u.id, await auth.hashPassword(password));
  console.log('[cli] new password set for %s', u.username);
  res.json({ ok: true, username: u.username });
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
    players: Math.max(1, Math.min(2, Number(body.players) || 1)),
    max: 2,
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
  const players = (Array.isArray(b.players) ? b.players : []).slice(0, 2).map((p) => {
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

server.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`PvZ2 Gardendless multiplayer server ${VERSION} listening on :${PORT}`);
});

function shutdown() {
  store.flushSync();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

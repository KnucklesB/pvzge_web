#!/usr/bin/env node
/*
 * PvZ2 Gardendless - multiplayer server maintenance.
 *
 *   node cli.js users                       list every account
 *   node cli.js password <user> [password]  set a new password (random if
 *                                           omitted); the user's sessions end
 *   node cli.js import-save <user> <file>   replace a player's cloud save with
 *                                           a save .json (game export, cloud
 *                                           save or raw localStorage value)
 *   node cli.js import-legacy <dir> [--overwrite]
 *                                           MariaDB: merge an old file-store
 *                                           data dir (db.json + saves/) into
 *                                           the database
 *
 * Run it on the machine/container of the server (Docker: open a console on
 * the "multiplayer" container, or `docker compose exec multiplayer node cli.js users`).
 * It talks to the running server; when the server is stopped it edits the
 * data directory directly.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PORT = Number(process.env.PORT) || 9000;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

let storePromise = null;
// The same storage as the server (DATA_DIR files, or MariaDB when DB_HOST /
// DATABASE_URL is set).
function offlineStore() {
  if (!storePromise) {
    storePromise = require('./store')
      .openStore(Object.assign({}, process.env, { DB_SYNC_SECONDS: '0', DB_MIGRATE: 'false' }), DATA_DIR)
      .catch((e) => fail('Cannot open the server data (' + e.message + '). Is DATA_DIR / DB_HOST right?'));
  }
  return storePromise;
}

async function readSecret() {
  if (!require('./store').dbConfigured(process.env)) {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8')).secret || '';
    } catch (e) {
      fail('Cannot read ' + path.join(DATA_DIR, 'db.json') + ' (' + e.message + '). Is DATA_DIR right?');
    }
  }
  return (await offlineStore()).secret;
}

function localKey(secret) {
  return crypto.createHash('sha256').update('local:' + secret).digest('hex');
}

// Request to the running server; resolves null when it isn't running.
async function call(method, url, body) {
  const data = body ? JSON.stringify(body) : null;
  const key = localKey(await readSecret());
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: url,
        method,
        headers: Object.assign({ 'x-local-key': key }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {}
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', (e) => (e.code === 'ECONNREFUSED' ? resolve(null) : reject(e)));
    if (data) req.write(data);
    req.end();
  });
}

function fmtDate(ts) {
  return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '-';
}

function printUsers(users) {
  if (!users.length) return console.log('No accounts yet.');
  const w = Math.max(8, ...users.map((u) => u.username.length));
  console.log('USERNAME'.padEnd(w) + '  CREATED           LAST SAVE         ADMIN');
  for (const u of users) {
    console.log(u.username.padEnd(w) + '  ' + fmtDate(u.createdAt) + '  ' + fmtDate(u.save && u.save.updatedAt).padEnd(16) + '  ' + (u.admin ? 'yes' : ''));
  }
  console.log('\n' + users.length + ' account(s).');
}

async function users() {
  const r = await call('GET', '/local/users');
  if (r && r.status === 200) return printUsers(r.json.users);
  if (r) fail('The server refused the request (' + r.status + '). Run this inside the server container.');
  const admins = new Set((process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()));
  const store = await offlineStore();
  printUsers(
    store
      .listUsers()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((u) => ({ username: u.username, createdAt: u.createdAt, admin: admins.has(u.username.toLowerCase()), save: u.save })),
  );
}

async function password(name, pass) {
  if (!name) fail('Usage: node cli.js password <user> [new password]');
  const generated = !pass;
  if (generated) pass = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, 'x');
  if (pass.length < 6 || pass.length > 128) fail('The password must have 6 to 128 characters.');
  const r = await call('POST', '/local/users/' + encodeURIComponent(name) + '/password', { password: pass });
  let username;
  if (r) {
    if (r.status === 404) fail('No account named "' + name + '". See: node cli.js users');
    if (r.status !== 200) fail('The server refused the request (' + r.status + ').');
    username = r.json.username;
  } else {
    const store = await offlineStore();
    const u = store.findUser(name);
    if (!u) fail('No account named "' + name + '". See: node cli.js users');
    await store.setPassword(u.id, await require('./auth').hashPassword(pass));
    await store.close();
    username = u.username;
  }
  console.log('New password for ' + username + (generated ? ': ' + pass : ' set.'));
  console.log('Log in with it in the game (Account), then change it if you like.');
}

async function importSave(name, file) {
  if (!name || !file) fail('Usage: node cli.js import-save <user> <save.json>');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail('Cannot read ' + file + ': ' + e.message);
  }
  let data;
  try {
    data = require('./store').normalizeSave(text);
  } catch (e) {
    fail(file + ' is not a save file: ' + e.message);
  }
  const profiles = JSON.parse(JSON.parse(data).players).map((p) => p.name || '?');
  const r = await call('POST', '/local/users/' + encodeURIComponent(name) + '/save', { data });
  let username;
  if (r) {
    if (r.status === 404) fail('No account named "' + name + '". See: node cli.js users');
    if (r.status !== 200) fail('The server refused the save (' + r.status + (r.json && r.json.error ? ', ' + r.json.error : '') + ').');
    username = r.json.username;
  } else {
    const store = await offlineStore();
    const u = store.findUser(name);
    if (!u) fail('No account named "' + name + '". See: node cli.js users');
    await store.backupSave(u.id);
    await store.writeSave(u.id, data, 'import', 'import');
    await store.close();
    username = u.username;
  }
  console.log('Save imported for ' + username + ' (' + profiles.length + ' profile(s): ' + profiles.join(', ') + ').');
  console.log('The previous save was kept; the game downloads the new one on its next sync.');
}

async function importLegacy(dir, flag) {
  if (!dir) fail('Usage: node cli.js import-legacy <data dir with db.json and saves/> [--overwrite]');
  if (!require('./store').dbConfigured(process.env)) fail('import-legacy imports into MariaDB: set DB_HOST (or DATABASE_URL) like the server.');
  const store = await offlineStore();
  const r = await store.importLegacy(path.resolve(dir), { overwrite: flag === '--overwrite' });
  await store.close();
  console.log('Accounts: ' + r.users + ' imported, ' + r.usersKept + ' already in the database.');
  console.log('Saves: ' + r.saves + ' imported, ' + r.savesKept + ' kept (the database copy is as new or newer; --overwrite replaces them).');
  console.log('Also: ' + r.history + ' old backup(s), ' + r.sessions + ' session(s), ' + r.matches + ' match(es), ' + r.scores + ' score(s), ' + r.achievements + ' achievement(s).');
  console.log('A running server picks the new accounts and saves up within DB_SYNC_SECONDS.');
}

const [cmd, a, b] = process.argv.slice(2);
(cmd === 'users' ? users() : cmd === 'password' ? password(a, b) : cmd === 'import-save' ? importSave(a, b) : cmd === 'import-legacy' ? importLegacy(a, b) : Promise.resolve(console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).map((l) => l.replace(/^ \*? ?/, '')).join('\n'))))
  .then(() => process.exit(0))
  .catch((e) => fail(e.message));

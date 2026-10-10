#!/usr/bin/env node
/*
 * PvZ2 Gardendless - multiplayer server maintenance.
 *
 *   node cli.js users                       list every account
 *   node cli.js password <user> [password]  set a new password (random if
 *                                           omitted); the user's sessions end
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

function readSecret() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8')).secret || '';
  } catch (e) {
    fail('Cannot read ' + path.join(DATA_DIR, 'db.json') + ' (' + e.message + '). Is DATA_DIR right?');
  }
}

function localKey(secret) {
  return crypto.createHash('sha256').update('local:' + secret).digest('hex');
}

// Request to the running server; resolves null when it isn't running.
function call(method, url, body) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: url,
        method,
        headers: Object.assign({ 'x-local-key': localKey(readSecret()) }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
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

function offlineStore() {
  const { Store } = require('./store');
  return new Store(DATA_DIR);
}

async function users() {
  const r = await call('GET', '/local/users');
  if (r && r.status === 200) return printUsers(r.json.users);
  if (r) fail('The server refused the request (' + r.status + '). Run this inside the server container.');
  const admins = new Set((process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()));
  const store = offlineStore();
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
    const store = offlineStore();
    const u = store.findUser(name);
    if (!u) fail('No account named "' + name + '". See: node cli.js users');
    store.setPassword(u.id, await require('./auth').hashPassword(pass));
    store.flushSync();
    username = u.username;
  }
  console.log('New password for ' + username + (generated ? ': ' + pass : ' set.'));
  console.log('Log in with it in the game (Account), then change it if you like.');
}

const [cmd, a, b] = process.argv.slice(2);
(cmd === 'users' ? users() : cmd === 'password' ? password(a, b) : Promise.resolve(console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map((l) => l.replace(/^ \*? ?/, '')).join('\n'))))
  .then(() => process.exit(0))
  .catch((e) => fail(e.message));

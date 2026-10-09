'use strict';

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

// "scrypt$<salt b64>$<hash b64>"
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return 'scrypt$' + salt.toString('base64') + '$' + key.toString('base64');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const key = await scrypt(password, salt);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Same cost as a real check, so unknown usernames can't be told apart by timing.
async function fakeVerify() {
  await scrypt('x', crypto.randomBytes(16));
  return false;
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

const TICKET_TTL = 12 * 3600 * 1000;

function signTicket(secret, userId) {
  const payload = userId + '.' + (Date.now() + TICKET_TTL);
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + mac;
}

function verifyTicket(secret, ticket) {
  const [p, mac] = String(ticket).split('.');
  if (!p || !mac) return null;
  const payload = Buffer.from(p, 'base64url').toString();
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  const [userId, exp] = payload.split('.');
  return Number(exp) > Date.now() ? userId : null;
}

module.exports = { hashPassword, verifyPassword, fakeVerify, newToken, hashToken, signTicket, verifyTicket };

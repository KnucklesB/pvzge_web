#!/usr/bin/env node
/*
 * Writes docs/version.json after a game update:
 *   node tools/game-version.js <previous game commit> <build name>
 * e.g. node tools/game-version.js 0e4a0534 0.16.1
 *
 * "refresh" lists the files under docs/ that changed between the two
 * versions while keeping their path: browsers that cached the previous
 * build download those again before starting the game (see docs/index.html).
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [base, build] = process.argv.slice(2);
if (!base || !build) {
  console.error('Usage: node tools/game-version.js <previous game commit> <build name>');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const out = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD', '--', 'docs'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
const refresh = out
  .split('\n')
  .filter((l) => l.startsWith('M\t'))
  .map((l) => l.slice(2).replace(/^docs\//, ''))
  // The page and the multiplayer files are never cached without revalidation.
  .filter((p) => p !== 'index.html' && p !== 'version.json' && !p.startsWith('multiplayer/'))
  .sort();
fs.writeFileSync(path.join(root, 'docs', 'version.json'), JSON.stringify({ build, refresh }, null, 1) + '\n');
console.log('docs/version.json: build %s, %d files to refresh', build, refresh.length);

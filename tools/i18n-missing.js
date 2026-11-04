#!/usr/bin/env node
/*
 * Lists the game texts that have no Portuguese translation yet.
 *
 * The game keeps its texts as {"en": ..., "zh": ...} objects inside the asset
 * JSON files; docs/i18n/pt-BR.json maps the English text to Portuguese. Run
 * this after updating the game from upstream:
 *
 *     node tools/i18n-missing.js            # print the missing texts
 *     node tools/i18n-missing.js --json     # as {"English": ""} to fill in
 *
 * Translate the new texts, add them to the map (texts that stay the same,
 * such as names, are kept as "X": "X" so they count as done) and bump
 * MP.VERSION so browsers fetch the new file.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'docs');
const map = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'pt-BR.json'), 'utf8'));

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function collect(v, found) {
  if (Array.isArray(v)) v.forEach((x) => collect(x, found));
  else if (v && typeof v === 'object') {
    if (typeof v.en === 'string' && typeof v.zh === 'string') {
      if (/\p{L}/u.test(v.en)) found.add(v.en); // skip "!!", "150"...
      return;
    }
    for (const k in v) collect(v[k], found);
  }
}

const found = new Set();
for (const file of walk(path.join(root, 'assets'), [])) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    continue;
  }
  collect(data, found);
}

const missing = [...found].filter((en) => !(en in map)).sort();
if (process.argv.includes('--json')) {
  const out = {};
  missing.forEach((en) => (out[en] = ''));
  console.log(JSON.stringify(out, null, 1));
} else {
  missing.forEach((en) => console.log(JSON.stringify(en)));
  console.error('%d texts, %d translated, %d missing', found.size, found.size - missing.length, missing.length);
}

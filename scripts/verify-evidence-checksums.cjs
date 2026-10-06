'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceDirectory = path.join(root, 'research/data-readiness/evidence');
const manifest = path.join(evidenceDirectory, 'SHA256SUMS');
const lines = fs.readFileSync(manifest, 'utf8').trim().split('\n').filter(Boolean);
let failed = false;
const listed = new Set();

for (const line of lines) {
  const match = /^([a-f0-9]{64})  (research\/data-readiness\/evidence\/(?!SHA256SUMS$).+)$/.exec(line);
  if (!match) {
    console.error(`invalid manifest entry: ${line}`);
    failed = true;
    continue;
  }
  const [, expected, relativePath] = match;
  if (listed.has(relativePath)) {
    console.error(`duplicate manifest entry: ${relativePath}`);
    failed = true;
    continue;
  }
  listed.add(relativePath);
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    console.error(`missing evidence payload: ${relativePath}`);
    failed = true;
    continue;
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) {
    console.error(`checksum mismatch: ${relativePath}`);
    failed = true;
  }
}

for (const name of fs.readdirSync(evidenceDirectory).sort()) {
  if (name === 'SHA256SUMS') continue;
  const relativePath = path.posix.join('research/data-readiness/evidence', name);
  if (!fs.statSync(path.join(evidenceDirectory, name)).isFile() || !listed.has(relativePath)) {
    console.error(`unlisted evidence payload: ${relativePath}`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
else console.log(`verified ${listed.size} evidence payload checksum(s)`);

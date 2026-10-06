const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const verifier = path.join(root, 'scripts/verify-evidence-checksums.cjs');
const evidence = path.join(root, 'research/data-readiness/evidence');

function run() {
  return spawnSync(process.execPath, [verifier], { cwd: root, encoding: 'utf8' });
}

test('evidence checksum manifest verifies all payloads and never lists itself', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const manifest = fs.readFileSync(path.join(evidence, 'SHA256SUMS'), 'utf8');
  assert.doesNotMatch(manifest, /\sSHA256SUMS$/m);
});

test('checksum verifier rejects a tampered payload', () => {
  const payload = path.join(evidence, 'hsi-api-details.json');
  const original = fs.readFileSync(payload);
  const temporary = path.join(os.tmpdir(), `hsi-evidence-${process.pid}.tmp`);
  fs.renameSync(payload, temporary);
  try {
    fs.writeFileSync(payload, Buffer.concat([original, Buffer.from('\nTAMPERED\n')]));
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
  } finally {
    fs.unlinkSync(payload);
    fs.renameSync(temporary, payload);
  }
  assert.equal(run().status, 0);
});

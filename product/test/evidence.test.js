'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  buildRecord, chainNext, verifyChain, recordHash, deriveScopes, redact, mapControls,
} = require('../src/lib/evidence');

function chain(events) {
  const recs = [];
  let prev = null;
  for (const e of events) {
    const r = chainNext(prev, buildRecord(e));
    recs.push(r);
    prev = r;
  }
  return recs;
}

test('chain verifies for an untampered log', () => {
  const recs = chain([
    { tool: 'Read', input: { file_path: 'a.js' }, status: 'success', session_id: 's' },
    { tool: 'Write', input: { file_path: 'a.js' }, status: 'success', session_id: 's' },
    { tool: 'Bash', input: { command: 'git push' }, status: 'success', session_id: 's' },
  ]);
  const res = verifyChain(recs);
  assert.ok(res.ok, JSON.stringify(res.errors));
  assert.strictEqual(recs[0].prev_hash, 'sha256:' + '0'.repeat(64));
  assert.strictEqual(recs[1].prev_hash, recs[0].hash);
});

test('tampering with a record is detected', () => {
  const recs = chain([
    { tool: 'Read', input: { file_path: 'a.js' }, status: 'success', session_id: 's' },
    { tool: 'Bash', input: { command: 'rm -rf /' }, status: 'success', session_id: 's' },
  ]);
  recs[0].outcome.summary = 'edited after the fact';
  const res = verifyChain(recs);
  assert.ok(!res.ok);
  assert.ok(res.errors.some((e) => /tampered/.test(e.reason)));
});

test('reordering / deleting breaks the chain link', () => {
  const recs = chain([
    { tool: 'Read', input: { file_path: 'a.js' }, status: 'success', session_id: 's' },
    { tool: 'Write', input: { file_path: 'b.js' }, status: 'success', session_id: 's' },
    { tool: 'Bash', input: { command: 'ls' }, status: 'success', session_id: 's' },
  ]);
  const removedMiddle = [recs[0], recs[2]];
  const res = verifyChain(removedMiddle);
  assert.ok(!res.ok);
});

test('blocked action records deny with empty granted scopes', () => {
  const s = deriveScopes('Bash', { command: 'curl https://x' }, 'default', 'blocked');
  assert.strictEqual(s.decision, 'deny');
  assert.deepStrictEqual(s.granted, []);
  assert.ok(s.requested.includes('net:egress'));
});

test('secrets are redacted from intent', () => {
  const r = buildRecord({ tool: 'Bash', input: { command: 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123' }, status: 'success', session_id: 's' });
  assert.ok(/redacted:github-token/.test(r.action.intent));
  assert.ok(r.redactions.includes('github-token'));
});

test('control mapping tags fs.write to integrity + audit controls', () => {
  const r = buildRecord({ tool: 'Write', input: { file_path: 'x.js' }, status: 'success', session_id: 's' });
  const controls = mapControls(r);
  assert.ok(controls.includes('SOC2:CC6.1'));
  assert.ok(controls.includes('HIPAA:164.312(c)(1)'));
});

test('hash is stable for identical hashable content', () => {
  const a = chainNext(null, buildRecord({ tool: 'Read', input: { file_path: 'a' }, status: 'success', session_id: 's', ts: '2026-01-01T00:00:00Z', id_fixed: 1 }));
  // recordHash must be deterministic given the same record object
  assert.strictEqual(recordHash(a), a.hash);
});

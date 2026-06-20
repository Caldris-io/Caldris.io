'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildRecord, chainNext, verifyChain, recordHash, deriveScopes, redact, mapEvidenceTags, scriptSafeJson,
} = require('../src/lib/evidence');
const { scanRecords } = require('../src/scan');
const { appendEvidence, readRecords } = require('../src/lib/store');

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

test('evidence tags carry ids + confidence for fs.write', () => {
  const r = buildRecord({ event_type: 'executed', tool: 'Write', input: { file_path: 'x.js' }, session_id: 's' });
  const ids = r.evidence_tags.map((t) => t.id);
  assert.ok(ids.includes('SOC2:CC6.1'));
  assert.ok(ids.includes('HIPAA:164.312(c)(1)'));
  const integrity = r.evidence_tags.find((t) => t.id === 'HIPAA:164.312(c)(1)');
  assert.strictEqual(integrity.confidence, 'direct');
  // the catch-all "any" rule must be downgraded, never presented as strong
  const audit = r.evidence_tags.find((t) => t.id === 'HIPAA:164.312(b)');
  assert.strictEqual(audit.confidence, 'weak');
});

test('event lifecycle: attempt and outcome correlate by action_id', () => {
  const attempt = buildRecord({ event_type: 'attempted', action_id: 'tu_1', tool: 'Bash', input: { command: 'ls' }, session_id: 's' });
  const done = buildRecord({ event_type: 'executed', action_id: 'tu_1', tool: 'Bash', input: { command: 'ls' }, session_id: 's' });
  assert.strictEqual(attempt.action_id, done.action_id);
  assert.strictEqual(attempt.scopes.decision, 'pending');
  assert.deepStrictEqual(attempt.scopes.granted, []);
  assert.strictEqual(done.scopes.decision, 'allow');
});

test('permission_denied is observed (claude_permission), executed is inferred', () => {
  const denied = buildRecord({ event_type: 'permission_denied', action_id: 'tu_2', tool: 'Bash', input: { command: 'curl https://x' }, session_id: 's' });
  assert.strictEqual(denied.scopes.decision, 'deny');
  assert.deepStrictEqual(denied.scopes.granted, []);
  assert.strictEqual(denied.scopes.auth_source, 'claude_permission');
  const ran = buildRecord({ event_type: 'executed', tool: 'Read', input: { file_path: 'a' }, session_id: 's' });
  assert.strictEqual(ran.scopes.auth_source, 'inferred');
});

test('scanner flags emails and home paths, passes clean records', () => {
  const dirty = [{ seq: 0, action: { intent: 'mail to a@b.com', target: '/home/alice/.ssh/id_rsa' }, outcome: {}, actor: {} }];
  const found = scanRecords(dirty);
  assert.ok(found.some((f) => f.kind === 'email'));
  assert.ok(found.some((f) => f.kind === 'home-path'));
  const clean = [{ seq: 0, action: { intent: 'Read src/app.js', target: 'src/app.js' }, outcome: { summary: 'ok' }, actor: { principal: 'demo-user' } }];
  assert.deepStrictEqual(scanRecords(clean), []);
});

test('appendEvidence links a valid chain across sequential writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caldris-'));
  const file = path.join(dir, 's.jsonl');
  for (let i = 0; i < 5; i++) {
    appendEvidence(file, buildRecord({ event_type: 'executed', action_id: 'c' + i, tool: 'Read', input: { file_path: 'f' + i }, session_id: 's' }));
  }
  const recs = readRecords(file);
  assert.strictEqual(recs.length, 5);
  assert.ok(verifyChain(recs).ok);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scriptSafeJson neutralizes </script> breakout but round-trips', () => {
  const evil = { records: [{ outcome: { summary: '</script><img src=x onerror=alert(1)>' } }], amp: 'a&b', sep: 'a\u2028b\u2029c' };
  const out = scriptSafeJson(evil);
  // No characters that could break out of a <script> element remain raw.
  assert.ok(!/[<>&]/.test(out), 'raw < > & must not survive');
  assert.ok(!/<\/script/i.test(out), 'no </script breakout');
  assert.ok(!/[\u2028\u2029]/.test(out), 'JS line terminators escaped');
  // Still valid JSON that parses back to the original value.
  assert.deepStrictEqual(JSON.parse(out), evil);
});

test('viewer template escapes seq and the tamper banner (no raw injection sink)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'artifact', 'evidence-viewer.html'), 'utf8');
  assert.ok(html.includes('${esc(r.seq)}'), 'seq must be escaped before innerHTML');
  assert.ok(!/\$\{r\.seq\}[^}]*<\/td>/.test(html), 'no unescaped ${r.seq} in a table cell');
  assert.ok(html.includes('[...bad].map(esc).join'), 'tamper banner must escape seq values');
});

test('hash is stable for identical hashable content', () => {
  const a = chainNext(null, buildRecord({ tool: 'Read', input: { file_path: 'a' }, status: 'success', session_id: 's', ts: '2026-01-01T00:00:00Z', id_fixed: 1 }));
  // recordHash must be deterministic given the same record object
  assert.strictEqual(recordHash(a), a.hash);
});

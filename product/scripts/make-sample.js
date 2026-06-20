#!/usr/bin/env node
'use strict';
/**
 * Generate the committed demo evidence bundle + viewer artifact from SYNTHETIC
 * events (no real session data, no PII). Deterministic output so the committed
 * files don't churn. Fails if the bundle does not pass the disclosure scan.
 *
 *   node scripts/make-sample.js
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildRecord, chainNext, scriptSafeJson } = require('../src/lib/evidence');
const { scanRecords } = require('../src/scan');

const SID = 'demo-session-0001';
const ev = (o) => Object.assign(
  { session_id: SID, principal: 'demo-user', cwd: '/workspace/demo', permission_mode: 'default', agent: 'claude-code', agent_type: 'main' },
  o
);

// A synthetic tool-call lifecycle: a read, a permissioned write, a DENIED
// network attempt, a sub-agent MCP call, a failure, and a push.
const events = [
  ev({ event_type: 'executed', action_id: 'call_a', tool: 'Read', input: { file_path: 'src/app.js' }, output: 'export function handler() { return ok; }' }),
  ev({ event_type: 'permission_requested', action_id: 'call_b', tool: 'Write', input: { file_path: 'src/app.js' } }),
  ev({ event_type: 'executed', action_id: 'call_b', tool: 'Write', input: { file_path: 'src/app.js' }, output: 'wrote 51 lines', permission_mode: 'acceptEdits' }),
  ev({ event_type: 'attempted', action_id: 'call_c', tool: 'Bash', input: { command: 'curl -s internal-metadata/secrets' } }),
  ev({ event_type: 'permission_denied', action_id: 'call_c', tool: 'Bash', input: { command: 'curl -s internal-metadata/secrets' } }),
  ev({ event_type: 'executed', action_id: 'call_d', tool: 'mcp__github__create_pull_request', input: { owner: 'acme', repo: 'widgets', title: 'Add handler', head: 'feature', base: 'main' }, output: 'opened PR 8', agent_type: 'subagent' }),
  ev({ event_type: 'failed', action_id: 'call_e', tool: 'Bash', input: { command: 'npm test' }, error: '1 test failed' }),
  ev({ event_type: 'executed', action_id: 'call_f', tool: 'Bash', input: { command: 'git push -u origin feature' }, output: 'pushed 1 commit' }),
];

// Build, then pin id/ts deterministically, then chain (hash covers id/ts).
const built = events.map(buildRecord);
built.forEach((r, i) => {
  r.id = '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0');
  r.ts = '2026-06-18T14:' + String(i).padStart(2, '0') + ':00Z';
});

const records = [];
let prev = null;
for (const r of built) {
  const linked = chainNext(prev, r);
  records.push(linked);
  prev = linked;
}

const bundle = {
  caldris_bundle_version: 1,
  generated_at: '2026-06-18T14:30:00Z',
  record_count: records.length,
  frameworks: ['SOC2', 'HIPAA'],
  records,
};
bundle.manifest_hash = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');

const findings = scanRecords(records);
if (findings.length) {
  console.error('Refusing to write sample: disclosure scan found sensitive content:', findings);
  process.exit(1);
}

const artifactDir = path.join(__dirname, '..', 'artifact');
const fixturesDir = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

const template = fs.readFileSync(path.join(artifactDir, 'evidence-viewer.html'), 'utf8');
const html = template.replace(
  /\/\* __CALDRIS_BUNDLE__ \*\/[\s\S]*?\/\* __END__ \*\//,
  () => `/* __CALDRIS_BUNDLE__ */ ${scriptSafeJson(bundle)} /* __END__ */`
);
fs.writeFileSync(path.join(artifactDir, 'sample-evidence-bundle.html'), html);
fs.writeFileSync(path.join(fixturesDir, 'demo-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');

console.log(`Wrote ${records.length} synthetic records; scan clean.`);
console.log('  artifact/sample-evidence-bundle.html');
console.log('  fixtures/demo-bundle.json');

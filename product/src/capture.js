#!/usr/bin/env node
'use strict';
/**
 * Caldris capture hook (M0).
 *
 * Wired as a Claude Code PreToolUse + PostToolUse hook. Reads the hook payload
 * from stdin, builds a single evidence record, and appends it to an append-only,
 * hash-chained JSONL log under .caldris/evidence/<session>.jsonl.
 *
 * CRITICAL: this runs on EVERY tool call. It must be fast and FAIL-OPEN — a
 * capture failure must never block or slow the agent. All errors are swallowed
 * to a side log and we always exit 0.
 */

const path = require('node:path');
const fs = require('node:fs');
const { buildRecord, chainNext } = require('./lib/evidence');
const { evidenceDir, lastRecord, appendRecord } = require('./lib/store');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;
  const payload = JSON.parse(raw);

  const phase = payload.hook_event_name || process.argv[2] || 'tool_call';
  // PostToolUse carries the outcome; PreToolUse is the attempt.
  let status;
  if (phase === 'PreToolUse') status = 'requested';
  else status = payload.tool_output && /error|failed|denied/i.test(String(payload.tool_output)) ? 'error' : 'success';

  const event = {
    phase,
    tool: payload.tool_name,
    input: payload.tool_input,
    output: payload.tool_output,
    status,
    session_id: payload.session_id,
    cwd: payload.cwd,
    permission_mode: payload.permission_mode,
    agent: 'claude-code',
    agent_type: payload.agent_id ? 'subagent' : 'main',
    ts: new Date().toISOString(),
  };

  const record = buildRecord(event);
  const file = path.join(evidenceDir(payload.cwd), `${event.session_id || 'session'}.jsonl`);
  const linked = chainNext(lastRecord(file), record);
  appendRecord(file, linked);
}

try {
  main();
} catch (err) {
  // Fail open: never block the agent. Record the failure out of band.
  try {
    const dir = path.join(process.cwd(), '.caldris');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'capture-errors.log'), `${new Date().toISOString()} ${err.stack || err}\n`);
  } catch (_) {
    /* give up silently */
  }
}
process.exit(0);

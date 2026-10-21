#!/usr/bin/env node
'use strict';
/**
 * Caldris capture hook (M0 demo slice).
 *
 * Wired as Claude Code hooks for the full tool-call lifecycle:
 *   PreToolUse → PermissionRequest → PermissionDenied → PostToolUse / PostToolUseFailure
 * Each hook fires its own immutable evidence record; records for the same tool
 * call share `action_id` (Claude Code's tool_use_id) so attempt, permission
 * decision, and outcome can be correlated downstream.
 *
 * CRITICAL: this runs on EVERY tool call. It must be fast and FAIL-OPEN — a
 * capture failure must never block or slow the agent. All errors are swallowed
 * to a side log and we always exit 0.
 */

const path = require('node:path');
const fs = require('node:fs');
const { buildRecord, eventTypeFromHook } = require('./lib/evidence');
const { evidenceDir, appendEvidence } = require('./lib/store');

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

  const hookName = payload.hook_event_name || process.argv[2] || 'PostToolUse';
  const event = {
    event_type: eventTypeFromHook(hookName, payload.tool_use_succeeded),
    action_id: payload.tool_use_id || null,
    tool: payload.tool_name,
    input: payload.tool_input,
    output: payload.tool_output,
    error: payload.tool_error,
    session_id: payload.session_id,
    cwd: payload.cwd,
    permission_mode: payload.permission_mode,
    agent: 'claude-code',
    agent_type: payload.agent_id ? 'subagent' : 'main',
    ts: new Date().toISOString(),
  };

  const record = buildRecord(event);
  const file = path.join(evidenceDir(payload.cwd), `${event.session_id || 'session'}.jsonl`);
  appendEvidence(file, record);
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

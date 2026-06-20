'use strict';
/**
 * Transcript miner (M0).
 *
 * Reconstructs evidence records from a Claude Code session transcript
 * (~/.claude/projects/<project>/<session>.jsonl) — no live instrumentation
 * required. Schema verified against real sessions:
 *   - records have type/timestamp/sessionId/uuid/parentUuid/cwd/gitBranch/permissionMode
 *   - message.content[] holds tool_use {name,id,input} and tool_result {tool_use_id,is_error,content}
 *   - subagents/agent-*.jsonl carry isSidechain + agentId (the delegation chain)
 */

const fs = require('node:fs');
const { buildRecord, chainNext } = require('./lib/evidence');

function parseLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c.text || c.content || '')).join(' ');
  }
  return '';
}

/** Build a map of tool_use_id -> { status, output } from tool_result blocks. */
function indexResults(rows) {
  const results = {};
  for (const row of rows) {
    const content = row.message && row.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_result') {
        results[block.tool_use_id] = {
          status: block.is_error ? 'error' : 'success',
          output: textOf(block.content),
        };
      }
    }
  }
  return results;
}

/**
 * Convert a transcript file (and any subagent sidechains) into a chained array
 * of evidence records.
 */
function importTranscript(files) {
  const rows = [];
  for (const f of files) rows.push(...parseLines(f));
  const results = indexResults(rows);

  const events = [];
  for (const row of rows) {
    const content = row.message && row.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use') {
        const res = results[block.id] || { status: 'success', output: '' };
        const failed = res.status === 'error';
        events.push({
          // A transcript only records executed/failed outcomes; the permission
          // decision is not in the transcript, so auth_source stays "inferred".
          event_type: failed ? 'failed' : 'executed',
          action_id: block.id || null,
          tool: block.name,
          input: block.input || {},
          output: failed ? undefined : res.output,
          error: failed ? res.output : undefined,
          session_id: row.sessionId,
          cwd: row.cwd,
          permission_mode: row.permissionMode || 'default',
          agent: 'claude-code',
          agent_type: row.isSidechain ? 'subagent' : 'main',
          principal: 'transcript-import',
          ts: row.timestamp,
        });
      }
    }
  }

  const records = [];
  let prev = null;
  for (const ev of events) {
    const linked = chainNext(prev, buildRecord(ev));
    records.push(linked);
    prev = linked;
  }
  return records;
}

module.exports = { importTranscript };

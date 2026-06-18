'use strict';
/**
 * Caldris evidence core (M0).
 *
 * Zero-dependency, Node >=18. Turns a normalized agent tool-call event into an
 * evidence record, chains records into a tamper-evident hash chain, derives
 * requested-vs-granted scopes, maps compliance controls, and redacts secrets.
 *
 * The canonicalization + hashing here is mirrored byte-for-byte in
 * artifact/evidence-viewer.html so the browser can independently verify a chain.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GENESIS = 'sha256:' + '0'.repeat(64);

/**
 * Deterministic JSON serialization (simplified RFC 8785 / JCS): object keys are
 * sorted recursively. Records must contain no `undefined` values. This exact
 * algorithm is replicated in the browser viewer.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** The bytes that get hashed: the record minus its own hash/sig fields. */
function hashableString(record) {
  const copy = Object.assign({}, record);
  delete copy.hash;
  delete copy.sig;
  return canonicalize(copy);
}

function recordHash(record) {
  return 'sha256:' + sha256Hex(hashableString(record));
}

/** Strip undefined values so canonicalization is well-defined. */
function pruneUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(pruneUndefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (obj[k] === undefined) continue;
      out[k] = pruneUndefined(obj[k]);
    }
    return out;
  }
  return obj;
}

/**
 * Link a built record into the chain after `prev` (or genesis if null).
 * Returns a new record with seq, prev_hash and hash set.
 */
function chainNext(prev, record) {
  const linked = pruneUndefined(Object.assign({}, record));
  linked.seq = prev ? prev.seq + 1 : 0;
  linked.prev_hash = prev ? prev.hash : GENESIS;
  linked.hash = recordHash(linked);
  return linked;
}

/** Verify an ordered array of records. Returns { ok, errors:[{seq,reason}] }. */
function verifyChain(records) {
  const errors = [];
  let prevHash = GENESIS;
  let expectedSeq = 0;
  for (const rec of records) {
    if (rec.seq !== expectedSeq) {
      errors.push({ seq: rec.seq, reason: `seq gap: expected ${expectedSeq}, got ${rec.seq}` });
    }
    if (rec.prev_hash !== prevHash) {
      errors.push({ seq: rec.seq, reason: 'broken link: prev_hash does not match previous record hash' });
    }
    if (recordHash(rec) !== rec.hash) {
      errors.push({ seq: rec.seq, reason: 'tampered: recomputed hash does not match stored hash' });
    }
    prevHash = rec.hash;
    expectedSeq = rec.seq + 1;
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9]{20,}/g, 'openai-key'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'github-token'],
  [/AKIA[0-9A-Z]{16}/g, 'aws-access-key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'slack-token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'private-key'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt'],
  [/\b[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{12}\b/g, 'uuid-secret'],
];

/** Redact known secret shapes from a string. Returns { text, kinds:[...] }. */
function redact(text) {
  if (typeof text !== 'string') return { text, kinds: [] };
  const kinds = new Set();
  let out = text;
  for (const [re, kind] of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      kinds.add(kind);
      return `« redacted:${kind} »`;
    });
  }
  return { text: out, kinds: [...kinds] };
}

// ---------------------------------------------------------------------------
// Scope derivation
// ---------------------------------------------------------------------------

function classify(tool) {
  if (/^mcp__/.test(tool)) return 'mcp';
  if (tool === 'Bash') return 'shell';
  if (tool === 'Read') return 'fs.read';
  if (['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(tool)) return 'fs.write';
  return 'tool';
}

/**
 * Derive requested-vs-granted scopes. In M0 the real auth decision is not yet
 * captured, so granted defaults to requested unless the outcome shows the action
 * was blocked. M1 wires in the actual permission decision.
 */
function deriveScopes(tool, input, permissionMode, status) {
  input = input || {};
  const category = classify(tool);
  const requested = [];
  let target = '';

  if (category === 'shell') {
    const cmd = String(input.command || '');
    target = cmd.slice(0, 120);
    requested.push('shell:exec');
    if (/\b(curl|wget|nc|ssh|scp)\b|https?:\/\//.test(cmd)) requested.push('net:egress');
    if (/\bgit\s+push\b/.test(cmd)) requested.push('git:push');
    if (/\brm\s+-rf?\b|\bsudo\b|>\s*\/etc|~\/\.ssh|\.env\b/.test(cmd)) requested.push('fs:sensitive');
  } else if (category === 'fs.write') {
    target = String(input.file_path || input.path || '');
    requested.push('fs:write:' + (target || '?'));
  } else if (category === 'fs.read') {
    target = String(input.file_path || input.path || '');
    requested.push('fs:read:' + (target || '?'));
  } else if (category === 'mcp') {
    const method = tool.replace(/^mcp__/, '').replace(/__/g, ':');
    requested.push('mcp:' + method);
    if (input.owner && input.repo) target = `${input.owner}/${input.repo}`;
    else if (input.repo) target = String(input.repo);
  } else {
    requested.push('tool:' + tool);
  }

  const blocked = status === 'blocked' || status === 'error';
  return {
    requested,
    granted: blocked ? [] : requested.slice(),
    decision: blocked ? 'deny' : 'allow',
    permission_mode: permissionMode || 'default',
    target,
    category,
  };
}

// ---------------------------------------------------------------------------
// Control mapping
// ---------------------------------------------------------------------------

let _mappingsCache = null;
function loadMappings() {
  if (_mappingsCache) return _mappingsCache;
  const dir = path.join(__dirname, '..', 'controls');
  const frameworks = ['soc2', 'hipaa'];
  const all = [];
  for (const fw of frameworks) {
    try {
      const file = path.join(dir, `mappings.${fw}.json`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      all.push({ framework: data.framework || fw.toUpperCase(), controls: data.controls || {} });
    } catch (_) {
      /* framework file optional */
    }
  }
  _mappingsCache = all;
  return all;
}

/** Return the control ids (e.g. "SOC2:CC6.1") that apply to a record. */
function mapControls(record, mappings) {
  mappings = mappings || loadMappings();
  const out = [];
  const category = record.action.category;
  const requested = record.scopes.requested || [];
  for (const fw of mappings) {
    for (const [id, ctrl] of Object.entries(fw.controls)) {
      const m = ctrl.match || {};
      let hit = false;
      if (m.any) hit = true;
      if (!hit && Array.isArray(m.category) && m.category.includes(category)) hit = true;
      if (!hit && Array.isArray(m.scope_prefix)) {
        hit = requested.some((s) => m.scope_prefix.some((p) => s.startsWith(p)));
      }
      if (hit) out.push(`${fw.framework}:${id}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Record building
// ---------------------------------------------------------------------------

function summarizeIntent(tool, input) {
  input = input || {};
  if (tool === 'Bash') return `$ ${input.command || ''}`;
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    return `${tool} ${input.file_path || input.path || ''}`;
  }
  if (tool === 'Read') return `Read ${input.file_path || input.path || ''}`;
  if (/^mcp__/.test(tool)) {
    const t = tool.replace(/^mcp__/, '').replace(/__/g, '.');
    return `${t}(${Object.keys(input).join(', ')})`;
  }
  return `${tool}(${Object.keys(input).join(', ')})`;
}

/**
 * Build an evidence record (without chain fields) from a normalized event:
 *   { phase, tool, input, output, status, session_id, cwd,
 *     permission_mode, agent, agent_type, principal, ts }
 */
function buildRecord(event) {
  const tool = event.tool || 'unknown';
  const status = event.status || (event.phase === 'PreToolUse' ? 'requested' : 'success');
  const scopes = deriveScopes(tool, event.input, event.permission_mode, status);

  const intentRedact = redact(summarizeIntent(tool, event.input));
  const outputRedact = redact(typeof event.output === 'string' ? event.output.slice(0, 240) : '');
  const redactions = [...new Set([...intentRedact.kinds, ...outputRedact.kinds])];

  const record = {
    v: 1,
    id: crypto.randomUUID(),
    ts: event.ts || new Date().toISOString(),
    actor: {
      agent: event.agent || 'claude-code',
      session_id: event.session_id || 'unknown',
      agent_type: event.agent_type || 'main',
      principal: event.principal || process.env.CALDRIS_PRINCIPAL || process.env.USER || 'unknown',
    },
    action: {
      tool,
      category: scopes.category,
      phase: event.phase || 'tool_call',
      intent: intentRedact.text,
      target: scopes.target || '',
    },
    scopes: {
      requested: scopes.requested,
      granted: scopes.granted,
      decision: scopes.decision,
      permission_mode: scopes.permission_mode,
    },
    outcome: {
      status,
      summary: outputRedact.text || (status === 'requested' ? 'action attempted' : status),
    },
    controls: [],
    redactions,
  };
  record.controls = mapControls(record);
  return record;
}

module.exports = {
  GENESIS,
  canonicalize,
  sha256Hex,
  recordHash,
  chainNext,
  verifyChain,
  redact,
  deriveScopes,
  loadMappings,
  mapControls,
  buildRecord,
  pruneUndefined,
};

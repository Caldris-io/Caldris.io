'use strict';
/** Append-only JSONL evidence store helpers. */

const fs = require('node:fs');
const path = require('node:path');
const { chainNext } = require('./evidence');

function evidenceDir(cwd) {
  return path.join(cwd || process.cwd(), '.caldris', 'evidence');
}

function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function lastRecord(file) {
  const recs = readRecords(file);
  return recs.length ? recs[recs.length - 1] : null;
}

function appendRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

function writeRecords(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

/**
 * Run `fn` while holding an exclusive lock on `file`. Claude Code can run tool
 * calls in parallel (PostToolBatch), so two capture hooks may append to the
 * same session log concurrently; without a lock both could read the same head
 * and write conflicting chain links. We use an O_EXCL lockfile with bounded
 * spin-wait, and treat a stale lock (older than `staleMs`) as abandoned.
 */
function withLock(file, fn, { retries = 100, waitMs = 20, staleMs = 10000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      try {
        return fn();
      } finally {
        try { fs.unlinkSync(lock); } catch (_) { /* already gone */ }
      }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Reclaim a stale lock left by a crashed process.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.unlinkSync(lock); continue; }
      } catch (_) { /* lock vanished; retry */ }
      const until = Date.now() + waitMs;
      while (Date.now() < until) { /* brief busy wait; hooks are short-lived */ }
    }
  }
  throw new Error(`could not acquire evidence lock for ${file}`);
}

/**
 * Atomically link a built record (no chain fields) onto the tail of `file` and
 * append it. Safe under concurrent writers via withLock.
 */
function appendEvidence(file, builtRecord) {
  return withLock(file, () => {
    const linked = chainNext(lastRecord(file), builtRecord);
    appendRecord(file, linked);
    return linked;
  });
}

module.exports = { evidenceDir, readRecords, lastRecord, appendRecord, writeRecords, withLock, appendEvidence };

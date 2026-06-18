'use strict';
/** Append-only JSONL evidence store helpers. */

const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { evidenceDir, readRecords, lastRecord, appendRecord, writeRecords };

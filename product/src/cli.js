#!/usr/bin/env node
'use strict';
/**
 * caldris CLI (M0): init | import | verify | map | export
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyChain, mapControls, recordHash } = require('./lib/evidence');
const { evidenceDir, readRecords, writeRecords } = require('./lib/store');
const { importTranscript } = require('./import');

function listEvidenceFiles(cwd) {
  const dir = evidenceDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f));
}

function loadAllRecords(cwd) {
  return listEvidenceFiles(cwd).flatMap(readRecords);
}

function cmdInit() {
  const dir = path.join(process.cwd(), '.caldris', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Initialized Caldris evidence store at ${path.relative(process.cwd(), dir)}/`);
  console.log('Add ".caldris/" to .gitignore if you do not want evidence committed.');
}

function cmdImport(args) {
  const out = takeFlag(args, '--out');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: caldris import <transcript.jsonl> [more.jsonl ...] [--out file]');
    process.exit(2);
  }
  const records = importTranscript(files);
  const dest = out || path.join(evidenceDir(process.cwd()), `imported-${Date.now()}.jsonl`);
  writeRecords(dest, records);
  const res = verifyChain(records);
  console.log(`Imported ${records.length} evidence records -> ${dest}`);
  console.log(res.ok ? 'Chain verified OK.' : `Chain INVALID: ${res.errors.length} error(s).`);
}

function cmdVerify(args) {
  const files = args.filter((a) => !a.startsWith('--'));
  const targets = files.length ? files : listEvidenceFiles(process.cwd());
  if (!targets.length) {
    console.error('No evidence files found. Run "caldris import" or capture some activity first.');
    process.exit(2);
  }
  let allOk = true;
  for (const file of targets) {
    const recs = readRecords(file);
    const res = verifyChain(recs);
    allOk = allOk && res.ok;
    console.log(`${res.ok ? 'OK  ' : 'FAIL'}  ${path.relative(process.cwd(), file)}  (${recs.length} records)`);
    for (const e of res.errors) console.log(`        seq ${e.seq}: ${e.reason}`);
  }
  process.exit(allOk ? 0 : 1);
}

function cmdMap() {
  const records = loadAllRecords(process.cwd());
  const coverage = {};
  for (const r of records) {
    const controls = r.controls && r.controls.length ? r.controls : mapControls(r);
    for (const c of controls) coverage[c] = (coverage[c] || 0) + 1;
  }
  console.log(`Control coverage across ${records.length} records:`);
  for (const [c, n] of Object.entries(coverage).sort()) console.log(`  ${c.padEnd(24)} ${n}`);
}

function cmdExport(args) {
  const out = takeFlag(args, '--out') || path.join(process.cwd(), 'caldris-evidence-bundle');
  // Each evidence file is its own chain; concatenate without touching seq/hash
  // so the exported bundle stays independently verifiable.
  const records = listEvidenceFiles(process.cwd()).flatMap(readRecords);
  if (!records.length) {
    console.error('No evidence to export.');
    process.exit(2);
  }

  const bundle = {
    caldris_bundle_version: 1,
    generated_at: new Date().toISOString(),
    record_count: records.length,
    frameworks: ['SOC2', 'HIPAA'],
    records,
  };
  bundle.manifest_hash = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify(bundle, null, 2));

  // Build the self-contained viewer (artifact) with the bundle embedded.
  const template = fs.readFileSync(path.join(__dirname, '..', 'artifact', 'evidence-viewer.html'), 'utf8');
  const html = template.replace(
    /\/\* __CALDRIS_BUNDLE__ \*\/[\s\S]*?\/\* __END__ \*\//,
    `/* __CALDRIS_BUNDLE__ */ ${JSON.stringify(bundle)} /* __END__ */`
  );
  fs.writeFileSync(path.join(out, 'index.html'), html);

  console.log(`Exported evidence bundle to ${path.relative(process.cwd(), out)}/`);
  console.log('  bundle.json  – machine-readable evidence (for Vanta/Drata/auditor)');
  console.log('  index.html   – self-contained Evidence Viewer (open in any browser)');
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const val = args[i + 1];
  args.splice(i, 2);
  return val;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init': return cmdInit();
    case 'import': return cmdImport(args);
    case 'verify': return cmdVerify(args);
    case 'map': return cmdMap();
    case 'export': return cmdExport(args);
    default:
      console.log('caldris <command>');
      console.log('  init                       create .caldris/ evidence store');
      console.log('  import <transcript.jsonl>  reconstruct evidence from a session transcript');
      console.log('  verify [file ...]          verify hash-chain integrity (exit 1 if broken)');
      console.log('  map                        show compliance-control coverage');
      console.log('  export [--out dir]         build evidence bundle + self-contained viewer');
      process.exit(cmd ? 1 : 0);
  }
}

main();

#!/usr/bin/env node
'use strict';
/**
 * caldris CLI (M0): init | import | verify | map | export
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyChain, mapEvidenceTags, scriptSafeJson } = require('./lib/evidence');
const { evidenceDir, readRecords, writeRecords } = require('./lib/store');
const { importTranscript } = require('./import');
const { scanRecords } = require('./scan');

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
  const tally = {};
  for (const r of records) {
    const tags = (r.evidence_tags && r.evidence_tags.length ? r.evidence_tags : mapEvidenceTags(r));
    for (const t of tags) {
      const key = `${t.id} [${t.confidence}]`;
      tally[key] = (tally[key] || 0) + 1;
    }
  }
  console.log(`Candidate evidence tags across ${records.length} records`);
  console.log('(heuristic, NOT reviewed — not a claim of compliance coverage):');
  for (const [k, n] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(40)} ${n}`);
}

function recordsFromFile(file) {
  if (file.endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : data.records || [];
  }
  return readRecords(file);
}

function cmdScan(args) {
  const files = args.filter((a) => !a.startsWith('--'));
  const records = files.length ? files.flatMap(recordsFromFile) : loadAllRecords(process.cwd());
  if (!records.length) {
    console.error('Nothing to scan.');
    process.exit(2);
  }
  const findings = scanRecords(records);
  if (!findings.length) {
    console.log(`Scan clean: no denylisted content in ${records.length} records.`);
    process.exit(0);
  }
  console.log(`Found ${findings.length} sensitive item(s) — do NOT publish this bundle as-is:`);
  for (const f of findings.slice(0, 50)) console.log(`  ${f.kind.padEnd(14)} seq ${f.seq} ${f.field}: ${f.sample}`);
  process.exit(1);
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

  // Build the self-contained viewer (artifact) with the bundle embedded. The
  // JSON is script-context-escaped (see SCRIPT_UNSAFE) so untrusted record
  // content (e.g. file contents an agent read) cannot break out via
  // "</script>". A replacement FUNCTION is used so "$"-sequences in the data
  // are not interpreted as String.prototype.replace patterns.
  const template = fs.readFileSync(path.join(__dirname, '..', 'artifact', 'evidence-viewer.html'), 'utf8');
  const safeJson = scriptSafeJson(bundle);
  const html = template.replace(
    /\/\* __CALDRIS_BUNDLE__ \*\/[\s\S]*?\/\* __END__ \*\//,
    () => `/* __CALDRIS_BUNDLE__ */ ${safeJson} /* __END__ */`
  );
  fs.writeFileSync(path.join(out, 'index.html'), html);

  console.log(`Exported demo evidence bundle to ${path.relative(process.cwd(), out)}/`);
  console.log('  bundle.json  – machine-readable evidence (demo slice; not signed/anchored yet)');
  console.log('  index.html   – self-contained Evidence Viewer (open in any browser)');
  console.log('Run "caldris scan" before sharing — bundles may contain sensitive tool output.');
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
    case 'scan': return cmdScan(args);
    case 'export': return cmdExport(args);
    default:
      console.log('caldris <command>');
      console.log('  init                       create .caldris/ evidence store');
      console.log('  import <transcript.jsonl>  reconstruct evidence from a session transcript');
      console.log('  verify [file ...]          verify hash-chain integrity (exit 1 if broken)');
      console.log('  map                        show candidate evidence tags (heuristic)');
      console.log('  scan [file ...]            flag sensitive content before sharing a bundle');
      console.log('  export [--out dir]         build demo evidence bundle + self-contained viewer');
      process.exit(cmd ? 1 : 0);
  }
}

main();

'use strict';
/**
 * Bundle disclosure scanner (M0).
 *
 * Evidence bundles are valuable *because* they are rich, and dangerous for the
 * same reason. Treat any bundle you share as a public disclosure artifact and
 * run this first. It flags denylisted content (emails, tokens, secret shapes,
 * URLs, absolute/home paths) in the human-readable record fields.
 *
 * This is a tripwire, not a guarantee — passing the scan does not make a bundle
 * safe to publish; failing it definitely means it is not.
 */

const DENYLIST = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'email'],
  [/sk-[A-Za-z0-9]{20,}/g, 'openai-key'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'github-token'],
  [/AKIA[0-9A-Z]{16}/g, 'aws-access-key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'slack-token'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private-key'],
  [/https?:\/\/[^\s"'`)]+/g, 'url'],
  [/(?:\/Users\/|\/home\/|~\/)[^\s"'`:]+/g, 'home-path'],
];

const SCANNED_FIELDS = [
  (r) => ['action.intent', r.action && r.action.intent],
  (r) => ['action.target', r.action && r.action.target],
  (r) => ['outcome.summary', r.outcome && r.outcome.summary],
  (r) => ['actor.principal', r.actor && r.actor.principal],
];

/** Return findings: [{ seq, field, kind, sample }]. Empty array == clean. */
function scanRecords(records) {
  const findings = [];
  records.forEach((r) => {
    for (const get of SCANNED_FIELDS) {
      const [field, value] = get(r);
      if (typeof value !== 'string' || !value) continue;
      for (const [re, kind] of DENYLIST) {
        const m = value.match(re);
        if (m) {
          const sample = m[0].length > 40 ? m[0].slice(0, 37) + '...' : m[0];
          findings.push({ seq: r.seq, field, kind, sample });
        }
      }
    }
  });
  return findings;
}

module.exports = { scanRecords, DENYLIST };

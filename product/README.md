# Caldris — evidence layer for coding agents (M0 demo slice)

Caldris captures every tool action a coding agent takes and turns it into a
**tamper-evident, lifecycle-aware audit trail**. This is the **M0 demo slice** —
enough to prove the thesis end to end for a design partner, with the milestone
boundaries kept honest (see "Scope & honesty" below). Zero runtime
dependencies, Node ≥ 18, targets **Claude Code**.

```
agent tool call ──▶ hooks / transcript ──▶ evidence event ──▶ hash-chained JSONL
                                                                 │
                                   caldris verify / map / scan / export ──▶ bundle + viewer
```

## Event model

Claude Code fires a hook at each step of a tool call, and every step carries a
`tool_use_id`. Caldris records one immutable event per step and correlates them
via `action_id` (= `tool_use_id`):

| Hook event | Caldris `event_type` | decision / `auth_source` |
| --- | --- | --- |
| `PreToolUse` | `attempted` | pending / inferred |
| `PermissionRequest` | `permission_requested` | pending / claude_permission |
| `PermissionDenied` | `permission_denied` | **deny** / claude_permission |
| `PostToolUse` | `executed` | allow / inferred |
| `PostToolUseFailure` | `failed` | allow / inferred |

`auth_source` is explicit: `claude_permission` means the decision was *observed*
from Claude's permission system; `inferred` means we only know the tool ran.
We do not claim "granted" where we only inferred it.

## Two ways to capture

**1. Live (plugin).** Hooks in `hooks/hooks.json` record the lifecycle above to
`.caldris/evidence/<session>.jsonl`. Capture is **fail-open** (never blocks the
agent) and **lock-guarded** (Claude batches parallel tool calls, so concurrent
hooks can append to the same log).

**2. Retroactive (transcript mining).** Reconstruct `executed`/`failed` events
from a session that already happened (the transcript has no permission events):

```bash
node src/cli.js import ~/.claude/projects/<project>/<session>.jsonl --out .caldris/evidence/self.jsonl
```

## CLI

```bash
node src/cli.js init                 # create the .caldris/ evidence store
node src/cli.js import <transcript>  # reconstruct evidence from a session transcript
node src/cli.js verify               # recompute the hash chain (exit 1 if broken)
node src/cli.js map                  # candidate evidence tags (heuristic, with confidence)
node src/cli.js scan [file ...]      # flag sensitive content before sharing a bundle
node src/cli.js export               # build a demo bundle + self-contained viewer
```

`export` writes `caldris-evidence-bundle/`: `bundle.json` (machine-readable) and
`index.html` (the **Evidence Viewer** — a single self-contained file that
recomputes every hash in the browser to detect tampering).

## Evidence tags ≠ compliance coverage

`map` emits **candidate evidence tags** with a confidence level
(`direct` / `supporting` / `weak`) sourced from `src/controls/mappings.*.json`.
A tag means an event *may* serve as evidence toward a control — it is **not** a
claim of coverage or compliance, and the catch-all rules are deliberately
`weak`. Mappings must be reviewed by a compliance owner before any auditor use.

## Before you share a bundle

Bundles are valuable because they are rich, and dangerous for the same reason.
**Always scan first** — `caldris scan` flags emails, tokens, secret shapes, URLs
and home/absolute paths. The committed demo (`fixtures/demo-bundle.json`,
`artifact/sample-evidence-bundle.html`) is generated from **synthetic** events
by `npm run make:sample` and is verified scan-clean; never commit real evidence.

## Tests

```bash
node --test    # chain verify, tamper detection, event lifecycle/correlation,
               # scopes, redaction, evidence tags, XSS escaping, scan, locked append
```

## Scope & honesty

M0 is tamper-**evident** (a local hash chain), not tamper-**proof**, and it is a
**demo slice**, not an auditor deliverable. Roadmap (see `PLAN.md`):

- **M0 (this):** capture lifecycle + correlation, hash chain + verify, importer,
  candidate tags, scan, demo viewer/export.
- **M1:** treat the observed permission decision as authoritative `granted`;
  begin moving evidence out of the agent's reach (signing / remote sink).
- **M2:** hardened export package (signing, external anchoring) — the point at
  which "hand to an auditor" becomes a fair claim.

See `THREAT_MODEL.md` for what M0 does and does not defend against.

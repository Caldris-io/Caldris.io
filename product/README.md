# Caldris — evidence layer for coding agents (M0)

Caldris captures every tool action a coding agent takes and turns it into a
**tamper-evident, compliance-mapped audit trail** you can hand to an auditor.
This is **M0**: capture + hash-chained evidence + control mapping + export, for
**Claude Code**. Zero runtime dependencies, Node ≥ 18.

```
agent tool call ──▶ hooks / transcript ──▶ evidence record ──▶ hash-chained JSONL
                                                                  │
                                            caldris verify / map / export ──▶ bundle + viewer
```

## Two ways to capture

**1. Live (plugin).** Install as a Claude Code plugin; `PreToolUse` + `PostToolUse`
hooks record every tool call to `.caldris/evidence/<session>.jsonl`. Capture is
**fail-open** — it never blocks or slows the agent.

**2. Retroactive (transcript mining).** Reconstruct evidence from sessions that
already happened — no instrumentation needed:

```bash
node src/cli.js import ~/.claude/projects/<project>/<session>.jsonl --out .caldris/evidence/self.jsonl
```

## CLI

```bash
node src/cli.js init                 # create the .caldris/ evidence store
node src/cli.js import <transcript>  # reconstruct evidence from a session transcript
node src/cli.js verify               # recompute the hash chain (exit 1 if broken)
node src/cli.js map                  # show SOC 2 / HIPAA control coverage
node src/cli.js export               # build bundle.json + a self-contained viewer
```

`export` writes `caldris-evidence-bundle/`:
- **`bundle.json`** — machine-readable evidence (for Vanta / Drata / an auditor).
- **`index.html`** — the **Evidence Viewer** artifact: a single self-contained file
  that renders the audit trail and **recomputes every hash in the browser** to prove
  (or detect tampering in) the chain. No backend, no network.

## Evidence record

Each record carries actor, intent, **scopes requested vs. granted**, outcome, mapped
controls, and the hash chain (`prev_hash` → `hash`, SHA-256 over canonical JSON). See
`PLAN.md` (repo root → `product/PLAN.md`) for the full schema and roadmap (M1 scopes
from the real permission decision, M2 redaction/export hardening, M3 multi-agent reach).

## Install as a Claude Code plugin (dev)

The plugin manifest is `.claude-plugin/plugin.json` and hooks are in `hooks/hooks.json`
(`node "${CLAUDE_PLUGIN_ROOT}/src/capture.js"`). Load this directory with Claude Code's
`--plugin-dir` during development, or publish it to a marketplace.

## Tests

```bash
node --test        # chain verify, tamper detection, scope derivation, redaction, mapping
```

## Status & honesty

M0 is tamper-**evident** (a local hash chain), not tamper-**proof**. Signing keys,
WORM/anchored storage, real auth-decision capture, and the hosted backend are tracked
in `PLAN.md` and `THREAT_MODEL.md`. Control mappings are **draft** and must be reviewed
by a compliance-literate owner before auditor use.

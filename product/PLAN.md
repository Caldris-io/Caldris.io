# Caldris MVP — Product Plan

> Status: draft for review. Captures the agreed direction, the research that grounds
> it, and the open decisions. No product code committed yet — this doc is the spec we
> build from.

## 1. What we're building

Caldris (per [caldris.io](https://caldris.io)) is an **evidence layer for AI agents**:
immutable, compliance-mapped audit trails that prove agents only did what they were
authorized to do. The site positions it *below* the orchestrator and auth layer,
*above* the external systems being acted on, and promises three things:

1. **Immutable decision logs** — actor, intent, scopes requested vs. granted, outcome.
2. **Pre-mapped compliance controls** — SOC 2 CC6.1/CC7.2, HIPAA §164.312, etc.
3. **One-click evidence export** — auditor / Vanta / Drata bundles.

**MVP wedge (decided):** a **Caldris plugin for coding agents**, starting with
**Claude Code**, built in **TypeScript/Node**, living in `/product` in this repo.

Why coding agents: they already take consequential actions (`Bash`, file writes,
`git push`, `mcp__github__*`), the buyer (security/compliance) already has a real
"prove the agent was controlled" problem, and the capture point is free and clean.

## 2. "Agent traces" — what we ingest (research-grounded)

- **OTel GenAI semantic conventions** define agent spans (`invoke_agent`,
  `execute_tool`, `gen_ai.tool.name`, request/response, token usage) — the emerging
  standard, still "Development" status.
  ([agent spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/),
  [GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/))
- **IETF draft "Agent Audit Trail"** (`draft-sharif-agent-audit-trail`) — JSON audit
  records **hash-chained with SHA-256 over RFC 8785 canonical JSON**, optional ECDSA
  signatures. Nearly identical to Caldris's "immutable decision log."
  ([IETF](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/))
- **Industry consensus on mandatory fields**: stable agent identity, session context,
  delegation chain (who authorized whom), and tool-level detail capturing **both halves
  of the loop — intent (what was asked) and invocation (what it did)**.
  ([WorkOS](https://workos.com/blog/agent-audit-logs),
  [API Stronghold](https://www.apistronghold.com/blog/ai-agents-stateless-audit-trail),
  [LoginRadius](https://www.loginradius.com/blog/engineering/auditing-and-logging-ai-agent-activity))

### Two capture surfaces in Claude Code (both verified against docs + a live session)

**(a) Live capture — plugin hooks.** A plugin shipping `PreToolUse` + `PostToolUse`
hooks with `matcher: "*"`. Hook stdin delivers `session_id`, `cwd`, `permission_mode`,
`tool_name`, `tool_input` (the *requested scope / intent*), and on Post `tool_output`
(the *outcome*); the permission decision gives **requested-vs-granted** directly.
Hooks ship inside the plugin and reference scripts via `${CLAUDE_PLUGIN_ROOT}`.
([hooks](https://code.claude.com/docs/en/hooks.md),
[plugins reference](https://code.claude.com/docs/en/plugins-reference.md))

**(b) Retroactive capture — transcript mining.** Claude Code already writes every
session to JSONL at `~/.claude/projects/<project>/<session>.jsonl`. We can reconstruct
evidence records from sessions that already happened — no instrumentation required.
**Verified live** against this session's own transcript:

| Transcript field | Evidence use |
|---|---|
| record `type` (`assistant`/`user`/`system`) | record classification |
| `timestamp`, `sessionId`, `uuid`, `parentUuid` | ordering + causal/delegation chain |
| `cwd`, `gitBranch`, `entrypoint`, `version` | actor / environment context |
| `permissionMode` | granted scope / risk mode (e.g. `bypassPermissions`) |
| `message.content[]` block `tool_use` `{name, id, input}` | action + **requested** scope (intent) |
| block `tool_result` `{tool_use_id, is_error, content}` + top-level `toolUseResult` | **outcome** (matched by `tool_use_id`) |
| `subagents/agent-*.jsonl`, `isSidechain`, `agentId` | multi-agent **delegation chain** |
| `hookInfos` / `hookErrors` / `hookAdditionalContext` | policy/hook activity already recorded |

This makes transcript mining the fastest path to a believable demo bundle (see §6).

## 3. Architecture

```
Coding agent (Claude Code)
   │  every tool call
   ▼
PreToolUse / PostToolUse hooks  ──►  caldris capture (Node)
   │                                    • normalize to evidence record
   │                                    • derive requested vs granted scopes
   ▼                                    • hash-chain + sign, append-only
External systems (fs, shell,        ──►  evidence log (.caldris/evidence/*.jsonl)
git, MCP/GitHub, Slack…)                  │
                              caldris CLI │ verify  → chain-integrity proof
                                          │ map     → SOC 2 / HIPAA controls
                                          │ export  → auditor / Vanta / Drata bundle
```

Core pieces:
1. **Capture hook** — dependency-light, fast-startup Node script (runs on *every* tool
   call; latency and fail-open behavior matter). Reads stdin, writes one signed record.
2. **Transcript importer** — backfills evidence records from existing session JSONL.
3. **Evidence record + chain** — the core asset (schema below).
4. **Scope deriver** — turns `tool_input` + permission decision into requested-vs-granted.
5. **Control mapper** — declarative rules tag records to SOC 2 / HIPAA controls.
6. **CLI** — `caldris init | verify | map | export`.

## 4. Evidence record schema

```jsonc
{
  "v": 1,
  "id": "uuid",
  "ts": "2026-06-18T...Z",
  "seq": 42,
  "actor":   { "agent": "claude-code", "session_id": "...", "agent_type": "main|subagent", "principal": "chris@…" },
  "action":  { "tool": "Bash", "category": "shell|fs.write|git|network|mcp",
               "intent": "<tool_input summary>", "target": "path/repo/url" },
  "scopes":  { "requested": ["fs:write:/src", "net:github.com"],
               "granted":   ["fs:write:/src"],
               "decision":  "allow|deny|ask",
               "permission_mode": "default|acceptEdits|bypassPermissions" },
  "outcome": { "status": "success|error|blocked", "summary": "...", "exit_code": 0 },
  "controls": ["SOC2:CC6.1", "SOC2:CC7.2", "HIPAA:164.312(b)"],
  "redactions": ["action.intent"],
  "prev_hash": "sha256:…",          // RFC 8785 JCS over previous record
  "hash":      "sha256:…",
  "sig":       "ecdsa:…"            // optional, per-record signature
}
```

Tamper-evidence = hash chain (cheap, local) + optional signing key. "Immutable" here
means tamper-*evident*; true immutability needs an append-only backend (see §7).

## 5. Repo layout (`/product`)

```
product/
  PLAN.md                 # this file
  package.json            # @caldris/plugin (TS, own test runner)
  .claude-plugin/plugin.json
  hooks/hooks.json        # PreToolUse + PostToolUse, matcher "*"
  src/
    capture.ts            # hook entrypoint (stdin → record)
    import.ts             # transcript JSONL → evidence records
    chain.ts              # canonicalize (RFC 8785), hash, sign, verify
    scopes.ts             # tool_input → requested/granted scopes
    controls/
      mapper.ts
      mappings.soc2.json
      mappings.hipaa.json
    redact.ts             # PII / secret redaction
    cli.ts                # init | verify | map | export
    export/bundle.ts      # auditor zip + Vanta/Drata-shaped JSON
  fixtures/               # labeled efficacy scenarios (see §6)
  test/                   # unit + golden-file tests
  README.md  THREAT_MODEL.md
```

## 6. Proving efficacy — test data strategy

Efficacy is not volume; it's **labeled scenarios with ground truth**, covering both:
- **Positive:** authorized actions captured completely, chain verifies, controls map.
- **Adversarial:** denied/out-of-scope action recorded as such, network-egress attempt,
  `bypassPermissions` run, and a **tampered log that `verify` catches**. Without
  violation cases the demo proves nothing.

Data sources, ranked by realism vs. effort:
1. **Transcript mining (fastest, real, zero new code)** — reconstruct evidence from
   existing sessions, including this repo's own agent-authored history. Schema verified
   in §2(b).
2. **Dogfooding (most authentic, compounding)** — ship M0's hook, run normal dev work;
   every session (incl. `git push`, MCP/GitHub) becomes signed test data. Also the
   credibility story: "the evidence trail of Caldris building Caldris."
3. **Seeded scenario script (produces the adversarial cases)** — agent runs against a
   throwaway sandbox repo with planted situations: in/out-of-scope writes, network
   egress allow/deny, out-of-scope `mcp__github__*`, a `bypassPermissions` run, then a
   post-hoc byte-flip to show `verify` fails.
4. **Public/framework traces (breadth, later)** — OTel GenAI samples, LangSmith/Langfuse
   examples, agent-trajectory benchmarks; lack the authorization signal, so supplementary.

**Plan:** build `product/fixtures/` with ~10–15 labeled scenarios from sources 1 + 3,
each as `input.jsonl` + `expected.json` (record, controls, verdict). This set does triple
duty: **design-partner demo bundle**, **regression suite**, and **evidence of efficacy**.

## 7. What else we need to make this real

| Area | Gap / decision |
|---|---|
| Immutability for real | Local hash chain is tamper-*evident*, not tamper-*proof*. Buyers want WORM / external anchoring (S3 Object Lock, transparency log, notarization). MVP stance: tamper-evident local + optional managed sink. |
| Key management | Signing key the agent's own session can't forge. MVP: local dev key; real: KMS / per-tenant keys. This is "log" vs. "evidence." |
| PII / secrets | Tool I/O contains source, tokens, customer data. Redaction on by **default** and provable, or we create a liability instead of solving one. |
| Multi-agent reach | Claude Code is the wedge; the moat is a normalizer that also ingests **OTel GenAI spans** so any framework feeds Caldris. |
| Control-mapping credibility | Tagging to SOC 2 / HIPAA is a claim auditors test. Needs a versioned mapping reviewed by someone compliance-literate; "evidence supports control," not "guarantees compliance." |
| The "auth layer" claim | Site puts Caldris below Arcade/Merge. For coding agents the analog is Claude Code's permission system — record its decisions; design ingest so an external auth layer can attach its decision later. |
| Hosted backend | Local-first is great for demos; buyers want dashboard + retention. Design the record format now so local and hosted share one schema. |
| Performance / safety | Hook runs on every tool call — fast, and must **never block the agent on capture failure** (fail-open for capture; fail-closed only when explicitly enforcing policy). |
| Trust boundary | An agent that can run `Bash` can edit its own evidence log. Threat-model explicitly (append-only perms, out-of-process writer, or remote sink) — this is the product's whole credibility. See `THREAT_MODEL.md`. |
| GTM proof | Produce a **sample evidence bundle** showable to a design partner without them installing anything — fastest validation of the pitch. |

## 8. Milestones

Honest boundaries (a staff review flagged an earlier draft for compressing three
milestones into "M0 complete" — fixed here). What shipped is the **M0 demo slice**:
it spans capture/chain/tags/scan/viewer so the thesis is demoable, but it does **not**
yet claim authoritative authorization, signing, or an auditor deliverable.

- **M0 demo slice (shipped):** plugin scaffold; full-lifecycle hooks (`PreToolUse`,
  `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`) with
  `tool_use_id` correlation; lock-guarded append-only hash chain + `verify`; transcript
  importer; heuristic **candidate evidence tags** (with confidence) via `map`; disclosure
  `scan`; synthetic demo bundle + self-contained viewer via `export`; `THREAT_MODEL.md`.
- **M1 — Authoritative authorization:** join permission events to executed actions by
  `action_id` so `granted`/`auth_source` reflect the *observed* decision; begin moving
  evidence out of the agent's reach (per-tenant signing key in KMS / remote sink).
- **M2 — Auditor-grade export:** signing + external anchoring (WORM / transparency log)
  and Vanta/Drata-shaped output. This is the point at which "hand to an auditor" is a
  fair claim — not before.
- **M3 — Reach:** second agent surface (Cursor/Copilot via MCP or OTel GenAI ingest).

**Note on the demo bundle:** the committed sample is generated from **synthetic** events
(`npm run make:sample`) and verified scan-clean — never real session data, which the
`scan` command shows is riddled with paths/PII.

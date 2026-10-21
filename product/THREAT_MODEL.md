# Caldris M0 — Threat Model

The product's whole value is that the evidence is **trustworthy**. This file states
plainly what M0 defends against, what it does not, and how each gap closes.

## What we defend against (M0)

- **Silent post-hoc edits.** Every record is hashed (SHA-256 over canonical JSON) and
  chained to its predecessor via `prev_hash`. Editing, reordering, inserting, or
  deleting any record breaks the chain. `caldris verify` and the in-browser viewer both
  recompute the whole chain and flag the exact offending record.
- **Capture taking down the agent.** The hook is **fail-open**: any error is swallowed
  to `.caldris/capture-errors.log` and it always exits 0. Capture failure never blocks
  or slows a tool call.
- **Obvious secret leakage.** Known secret shapes (API keys, tokens, JWTs, private keys)
  are redacted from `intent`/`summary` before they are written, and the redaction is
  recorded on the record. Before a bundle is shared, `caldris scan` is a tripwire for
  emails, tokens, URLs and home/absolute paths that survived redaction.
- **Concurrent capture corrupting the chain.** Claude Code batches parallel tool calls,
  so multiple hooks may append at once. Appends are guarded by an `O_EXCL` lockfile
  (with stale-lock reclaim) so each chain link reads a consistent tail.
- **Over-claiming authorization.** Records distinguish an *observed* permission decision
  (`auth_source: claude_permission`, from `PermissionRequest`/`PermissionDenied`) from an
  *inferred* one (`auth_source: inferred`, "the tool simply ran"). We never label an
  inferred grant as observed.

## What we do NOT yet defend against (and the fix)

| Threat | M0 gap | Planned fix |
| --- | --- | --- |
| An agent that can run `Bash` rewrites the **entire** local chain | A local hash chain proves internal consistency, not external truth — a full rewrite re-verifies | Out-of-process / append-only writer; ship records to a remote sink or WORM store (S3 Object Lock); anchor periodic chain heads externally (transparency log / notarization) |
| Forged signatures | M0 does not sign records (`sig` is reserved) | Per-tenant signing key held in KMS, outside the agent's reach — the line between "log" and "evidence" |
| `granted` on `executed` events is inferred, not authoritative | M0 captures the permission events but does not yet *join* them to mark the executed action's grant as observed | M1: correlate by `action_id` and treat the observed permission decision as the authoritative `granted`; later, an external auth layer (Arcade/Merge) |
| PII beyond known secret shapes | Regex redaction + scan miss novel/contextual PII | Configurable redaction policy, default-deny field capture, review before any data leaves the machine |
| Tags over-claim compliance | Draft, heuristic SOC 2 / HIPAA evidence tags | Versioned, compliance-reviewed mappings; "candidate evidence," never "coverage" or "guarantees compliance" |

## Trust boundary (M0)

Capture runs **inside** the agent's trust boundary (same host, same permissions). M0 is
therefore suitable for *demonstrating efficacy* and for environments where the operator
is trusted but needs provable, structured evidence. It is **not** yet a control against
a fully adversarial agent rewriting its own history — that requires moving the evidence
out of the agent's reach (remote sink / WORM / signing), which is the first hardening
step after M0.

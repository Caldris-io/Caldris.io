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
  recorded on the record.

## What we do NOT yet defend against (and the fix)

| Threat | M0 gap | Planned fix |
| --- | --- | --- |
| An agent that can run `Bash` rewrites the **entire** local chain | A local hash chain proves internal consistency, not external truth — a full rewrite re-verifies | Out-of-process / append-only writer; ship records to a remote sink or WORM store (S3 Object Lock); anchor periodic chain heads externally (transparency log / notarization) |
| Forged signatures | M0 does not sign records (`sig` is reserved) | Per-tenant signing key held in KMS, outside the agent's reach — the line between "log" and "evidence" |
| "Granted" scope is asserted, not observed | M0 infers `granted` from the outcome; it does not read the real authorization decision | M1: capture the actual permission decision (Claude Code permission system; later, an external auth layer such as Arcade/Merge) |
| PII beyond known secret shapes | Regex redaction misses novel/contextual PII | Configurable redaction policy, default-deny field capture, review before any data leaves the machine |
| Mapping over-claims compliance | Draft SOC 2 / HIPAA mappings | Versioned, compliance-reviewed mappings; "evidence supports control," never "guarantees compliance" |

## Trust boundary (M0)

Capture runs **inside** the agent's trust boundary (same host, same permissions). M0 is
therefore suitable for *demonstrating efficacy* and for environments where the operator
is trusted but needs provable, structured evidence. It is **not** yet a control against
a fully adversarial agent rewriting its own history — that requires moving the evidence
out of the agent's reach (remote sink / WORM / signing), which is the first hardening
step after M0.

---
name: adr
description: Record, update or supersede an architecture decision in docs/DECISIONS.md with Flagship's ADR format. Use when a change makes or reverses an architectural decision, when the user asks to "write an ADR" or "document this decision", or when reviewing whether something deserves an ADR.
---

# Architecture decision records

ADRs live in `docs/DECISIONS.md`. They exist to tell a future developer *why* the system is shaped this way, so they must stay short and worth reading.

## Does it deserve an ADR?

Write one only if **at least one** applies:

- It constrains future code (an invariant others must follow).
- It is costly or hard to reverse (storage, protocol, data model, security model).
- There were credible alternatives that someone could reasonably propose again.

**Not ADRs:** UI details, naming, library-internal choices, anything obvious from reading the code, or temporary task decisions. If unsure, ask the user instead of writing one.

## Format

Append a new numbered entry: the next number, never reused. Add it to the index table with status `Accepted`.

```markdown
### N. <Decision as a short statement>

**Context.** <The problem or force that requires a decision. 1–3 sentences.>

**Decision.** <What we do, concretely: name the code (files, functions) that implements it. 1–4 sentences, or a short bullet list.>

**Alternatives considered.** <Optional; see the rules below.>
- *<Alternative>.* Rejected: <the concrete reason it lost>.

**Consequences.** <What follows, especially the costs and limitations we accept. 2–4 sentences.>
```

Rules:

- **Alternatives are optional.** Include them only when a credible option was actually weighed, and list one to three, each with the reason it was rejected; these reasons are the decision's rationale, so there is no separate rationale section. If there was no real choice, leave the section out and let Context explain why.
- **Length budget:** about 15 lines per entry. If it needs more, it's probably two decisions, or it contains reference detail that belongs in `docs/REFERENCE.md`.
- **Facts, not intent:** describe what the code does now. Verify names and behaviour in the code before writing.
- **Cross-reference** related entries by number ("guarded by decision 7") instead of repeating them.

## Changing a decision

Never rewrite an accepted entry's substance.

1. Add a new entry whose Context says what changed, with the old decision among its alternatives.
2. Set the old entry's status in the index to `Superseded by #N`, and add one line at the top of the old entry: `**Superseded by [N](#anchor).**`

Fixing typos, broken links or stale code names in an old entry is fine.

## Before finishing

Check every sentence: would a future developer miss it if it were gone? Remove it if not. Make sure the index links resolve (the anchor is the heading, lowercased, with spaces as hyphens and punctuation dropped).

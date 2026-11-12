# Frozen material

The commit and content hash of every frozen version of the material, recorded **before** the runs that use it.

- `eval/run.sh e1/run.eval.ts --final` refuses to run unless the current material's hash appears below as an `e1-material:` line.
- A change after a freeze is recorded in `DEVIATIONS.md`, with its reason.
- Hashes come from `EVAL_NO_DB=1 eval/run.sh e1/hash.eval.ts`. They cover:
  - `eval/e1/scenarios` (intents, base forms, responses, scripts with gold specs)
  - `prompts/`
  - `compat.json`
  - `measures.ts`
  - `pipelines.ts`
  - `material.ts`
  - `responses.ts`

## E1, draft 1 (2026-11-12): not reviewed

These are the gold specs as drafted, before the authors' review. Two runs may happen at this point:
- a **plumbing check** (`--check`), which computes no measures;
- nothing else.

The final runs need the reviewed version recorded as `e1-material:`.

- commit: `a0bd1f4`
- e1-material-draft: 4d628b5073b7a5d9e2400293df20566e401a7af19be4b2528bca882223d6ace8
- prompts:
  - w-change.md: `4205e0ba…`
  - w-derive.md: `5c4d1826…`
  - form rules: `0ee15abb…`
  - carrier question: `e1077927…`

## E1, draft 2 (2026-11-12): not reviewed

Draft 1 plus the summarizer (`e1/summarize.ts`: how measures are aggregated, and the bootstrap). The scripts and gold specs are unchanged from draft 1. Recorded before the plumbing check.

- commit: `c3967a7`
- e1-material-draft: b58b07290933edb167d3198390a99978156a41b7384d558ab2f47326399b2739

## E1, reviewed (2026-11-12): frozen for the dry run and the final runs

The authors set every gold spec to `reviewed: true`. Compared with draft 2, nothing else changed in substance.
- One options list was re-wrapped by an editor.
- Three soccer assertions that a find-and-replace (`false` → `true`) had flipped were restored as drafted, at the authors' instruction: soccer-3 `required: false`, soccer-4 and soccer-5 `exists: false`.
- The orthopedic intent, written from the paper's description, is accepted as drafted.

Only the plumbing check had run at this point. It computed no measures.

- commit: `3679584`
- e1-material: 52b0d7de479edb11911a0f72b189b3d4026e5b89b7540e7bf65c0edd2f85bd66

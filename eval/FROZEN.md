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

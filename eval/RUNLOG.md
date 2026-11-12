# Run log

Every run that calls a model is listed here, including failed and aborted ones. Costs come from the calls' token counts at the frozen prices in `eval/prices.json`. They are cross-checked against the Anthropic Console where possible.

| Date (UTC) | Run | Purpose | Calls | Input / output tokens | Cost (USD) | Outcome |
|---|---|---|---|---|---|---|
| 2026-11-12 | smoke-anthropic-route | One structured call (`schemaPatchSchema`) on `claude-sonnet-5` through the new direct route | 1 | 3,105 / 96 | 0.007 | OK: native structured output; 6.7 s |
| 2026-11-12 | e1-generate-base | Freeze the three base forms (`intentToSchemaAction`, once) | 3 | 9,656 / 5,136 | 0.071 | OK: soccer 7, sales 6, orthopedic 11 fields |
| 2026-11-12 | `check-2026-11-12T21-56-28-827Z` | E1 plumbing check on draft 2: soccer-1 and soccer-5, P/W/R, one run each; no measures computed | 7 | (in the run files) | 0.131 | OK: all three pipelines completed both requests |

| 2026-11-12 | `dry-2026-11-12T22-20-21-560Z` | E1 dry run on the reviewed material: all 24 requests, P/W/R, one run each; cost projection only | 93 + 2 aborted | (in the run files) | 1.556 | 8 runs completed, 1 failed (see below). Projection for the final runs: **$7.78**, under the $30 rule, so no approval was needed. |

**The failed dry run.** In orthopedic R-r1, request orthopedic-6 failed with "The AI took too long to answer". That is the app's own generation action (`withLlmRetry`: 45 s, then one retry) giving up on the regeneration. Its two aborted calls returned no token counts:
- they are counted at $0 in `spend.json` and are missing from the run file;
- they may still have been billed, at most about $0.06 at that request's size;
- to be reconciled with the Anthropic Console.

**Running total:** $1.765. The ledger is in `eval/out/spend.json`.

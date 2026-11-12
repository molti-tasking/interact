# Run log

Every run that calls a model is listed here, including failed and aborted ones. Costs come from the calls' token counts at the frozen prices in `eval/prices.json`. They are cross-checked against the Anthropic Console where possible.

| Date (UTC) | Run | Purpose | Calls | Input / output tokens | Cost (USD) | Outcome |
|---|---|---|---|---|---|---|
| 2026-11-12 | smoke-anthropic-route | One structured call (`schemaPatchSchema`) on `claude-sonnet-5` through the new direct route | 1 | 3,105 / 96 | 0.007 | OK: native structured output; 6.7 s |
| 2026-11-12 | e1-generate-base | Freeze the three base forms (`intentToSchemaAction`, once) | 3 | 9,656 / 5,136 | 0.071 | OK: soccer 7, sales 6, orthopedic 11 fields |

**Running total:** $0.078. The ledger is in `eval/out/spend.json`.

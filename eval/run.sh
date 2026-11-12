#!/usr/bin/env bash
# One command per experiment step:
#
#   eval/run.sh test                          unit tests of the harness (no model, no database)
#   eval/run.sh e1/generate-base.eval.ts      freeze the base forms (model; once)
#   eval/run.sh e1/run.eval.ts [--dry|--final] [--pipelines P,W,R] [--scenarios a,b] [--runs N]
#
# Loads eval/.env.eval (the evaluation's own model key; git-ignored) and, for
# steps that need it, the settings of the current profile's local stack
# (eval/stacks.sh current up). The scripts check the environment again
# before they run anything (lib/env.ts).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
step=${1:?usage: eval/run.sh test | <script.eval.ts> [args]}
shift || true

if [ "$step" = test ]; then
  exec ./node_modules/.bin/vitest run --config vitest.config.ts "$@"
fi

[ -f .env.eval ] || { echo "eval/.env.eval is missing (see eval/README.md)" >&2; exit 1; }
set -a
. ./.env.eval
set +a

# The fixtures switch would answer from recordings; the rate limit is for people
unset USE_FIXTURES RECORD_FIXTURES
export LLM_RATE_LIMIT_PER_MIN=0

if [ "${EVAL_NO_DB:-0}" != 1 ]; then
  eval "$(./stacks.sh current env)"
fi

export EVAL_SCRIPT="$step"
export EVAL_ARGS="$*"
exec ./node_modules/.bin/vitest run --config vitest.config.ts

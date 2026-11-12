#!/usr/bin/env bash
# Local databases (and the pilot's code) for the evaluation profiles.
#
#   eval/stacks.sh current up     isolated Supabase stack of this tree (ports 563xx)
#   eval/stacks.sh pilot up       worktree of the pilot commit + its own stack (ports 573xx)
#   eval/stacks.sh <profile> env  print the stack's settings as shell exports
#   eval/stacks.sh <profile> down stop the stack (data is kept by Docker volumes)
#
# Never touches the default ports 54321/54322: another project's stack, or
# the developer's own, may hold them. Everything generated lives under
# eval/.worktrees/ (git-ignored).
#
# The pilot profile is the code that ran the workshop pilot on 2026-10-27:
# commit a64d230, confirmed by the deployment history (eval/PLAN.md, 4C).
# It gets its own dependency install from its own lockfile, and a database
# with its own migrations (001–011).
set -euo pipefail

PILOT_COMMIT=a64d230
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
BASE="$ROOT/eval/.worktrees"
SUPABASE="$ROOT/apps/docs/node_modules/.bin/supabase"

profile=${1:?usage: eval/stacks.sh current|pilot up|env|down}
action=${2:?usage: eval/stacks.sh current|pilot up|env|down}

case "$profile" in
  current) src="$ROOT/apps/docs/supabase"; stack="$BASE/current-stack"; prefix=563; project=interact-eval-current; inspector=18083 ;;
  # The pilot's own Supabase CLI (2.x): its config.toml predates CLI 3
  pilot)   src="$BASE/pilot/apps/docs/supabase"; stack="$BASE/pilot-stack"; prefix=573; project=interact-eval-pilot; inspector=18084
           SUPABASE="$BASE/pilot/apps/docs/node_modules/.bin/supabase" ;;
  *) echo "unknown profile: $profile" >&2; exit 2 ;;
esac

pilot_worktree() {
  local wt="$BASE/pilot"
  if [ ! -d "$wt" ]; then
    git -C "$ROOT" worktree add --detach "$wt" "$PILOT_COMMIT"
  fi
  local head
  head=$(git -C "$wt" rev-parse --short=7 HEAD)
  if [ "$head" != "$PILOT_COMMIT" ]; then
    echo "pilot worktree is at $head, expected $PILOT_COMMIT" >&2
    exit 1
  fi
  if [ ! -d "$wt/node_modules" ]; then
    (cd "$wt" && corepack pnpm install --frozen-lockfile)
  fi
}

prepare_stack() {
  # A copy of the profile's supabase folder with its own project id and ports
  rm -rf "$stack"
  mkdir -p "$stack"
  cp -R "$src" "$stack/supabase"
  rm -rf "$stack/supabase/.temp" "$stack/supabase/.branches"
  perl -pi -e "s/^project_id = .*/project_id = \"$project\"/; s/^(port|shadow_port) = 543(\d\d)/\$1 = ${prefix}\$2/; s/^inspector_port = \d+/inspector_port = $inspector/" \
    "$stack/supabase/config.toml"
}

case "$action" in
  up)
    [ "$profile" = pilot ] && pilot_worktree
    prepare_stack
    "$SUPABASE" start --workdir "$stack" \
      -x studio,imgproxy,edge-runtime,logflare,vector,postgres-meta,inbucket
    ls "$stack/supabase/migrations"
    ;;
  env)
    status=$("$SUPABASE" status --workdir "$stack" -o env)
    get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }
    cat <<EOF
export E2E_SUPABASE_URL=$(get API_URL)
export E2E_SUPABASE_ANON_KEY=$(get ANON_KEY)
export E2E_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)
export E2E_DB_URL=$(get DB_URL)
export NEXT_PUBLIC_SUPABASE_URL=$(get API_URL)
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(get ANON_KEY)
EOF
    ;;
  down)
    "$SUPABASE" stop --workdir "$stack"
    ;;
  *) echo "unknown action: $action" >&2; exit 2 ;;
esac

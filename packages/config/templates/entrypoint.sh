#!/bin/sh
# What the app does before it starts serving.
#
# Better Auth's own tables are created by its CLI, which nothing else does: Hasura's migrations
# are the other half of the schema. Idempotent, so it runs on every start. A database that is
# not up yet must not wedge the app: say so loudly and serve anyway; the next start tries again.
set -e

if [ -n "${DATABASE_URL}" ]; then
  ./node_modules/.bin/better-auth migrate --config {{auth_config}} --yes \
    || echo "{{name}}: better-auth migrate failed; nobody can sign in until it succeeds" >&2
fi

exec ./node_modules/.bin/next start -p "${PORT:-{{port}}}"

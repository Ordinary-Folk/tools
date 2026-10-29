#!/bin/bash
# Deploys the hub (of-tools Pages project, account Ordinary Folk Assets).
# Stages only what the site needs, so .git, docs, the icon builder and the
# publisher never get published, then runs wrangler (OAuth login as
# jorge@ordinaryfolk.co; `unset CLOUDFLARE_API_TOKEN` because the token in
# .dev.vars has no Pages-deploy scope and would shadow the login).
set -euo pipefail
cd "$(dirname "$0")"
export CLOUDFLARE_ACCOUNT_ID=ef803ddd03bdba02130ed576873a4187
unset CLOUDFLARE_API_TOKEN
STAGE=/tmp/of-tools-deploy
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp index.html _worker.js "$STAGE/"
cp -R icons fonts scripts "$STAGE/"
rm -rf "$STAGE/scripts/publisher" "$STAGE/scripts/icons/build.py"
find "$STAGE" -name .DS_Store -delete
npx wrangler@latest pages deploy "$STAGE" --project-name of-tools --branch main "$@"

#!/bin/bash
# Puts this Mac's publish secret on the hub as the SCRIPTS_PUBLISH_SECRET Pages
# secret (production + preview) through the Cloudflare API, using the token in
# the hub's gitignored .dev.vars. Prints nothing secret.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HUB="$(cd "$HERE/../.." && pwd)"
CONF="$HOME/Library/Application Support/Ordinary Folk/Scripts Catalog"
ACCT=ef803ddd03bdba02130ed576873a4187
TOKEN=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$HUB/.dev.vars" | tr -d '"\r')
SECRET=$(tr -d '\n' < "$CONF/publish-secret")
[ -n "$TOKEN" ] && [ -n "$SECRET" ] || { echo "missing token (.dev.vars) or secret ($CONF/publish-secret)"; exit 1; }
BODY=$(SECRET="$SECRET" /usr/bin/python3 -c 'import json,os;v={"type":"secret_text","value":os.environ["SECRET"]};print(json.dumps({"deployment_configs":{"production":{"env_vars":{"SCRIPTS_PUBLISH_SECRET":v}},"preview":{"env_vars":{"SCRIPTS_PUBLISH_SECRET":v}}}}))')
curl -s -X PATCH "https://api.cloudflare.com/client/v4/accounts/$ACCT/pages/projects/of-tools" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "$BODY" \
  | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);print("success:",d.get("success"),"errors:",d.get("errors"));p=d.get("result",{}).get("deployment_configs",{}).get("production",{});print("production secrets:",sorted((p.get("env_vars") or {}).keys()))'
echo "The running deployment picks it up on the next hub deploy (or immediately for new requests, Pages re-reads project secrets per deployment: redeploy to be sure)."

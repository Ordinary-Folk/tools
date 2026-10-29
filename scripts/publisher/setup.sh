#!/bin/bash
# One-time setup on the publishing Mac (Jorge's), run from a Terminal:
#   1. install.sh         scanner + launchd agent; makes the publish secret if missing
#   2. set-hub-secret.sh  puts that secret on the hub (Pages secret SCRIPTS_PUBLISH_SECRET)
#   3. deploy.sh          redeploys the hub so the running worker sees the secret
#   4. first publish      so tools.ordinary.co/scripts shows the shelf right away
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/install.sh"
"$HERE/set-hub-secret.sh"
"$HERE/../../deploy.sh"
/usr/bin/python3 "$HOME/.local/bin/of-scripts-catalog" --force
echo
echo "Done. Check https://tools.ordinary.co/scripts/ (versions and dates should be filled in)."

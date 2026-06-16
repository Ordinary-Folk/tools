# Ordinary Folk Tools hub (tools.ordinary.co)

One front door for OF's internal apps: **one Google login, each tool on a path**,
all under `tools.ordinary.co`. This folder is the hub itself (a Cloudflare Pages
project). Individual tools live in their own folders/repos and are proxied in.

- **Live:** https://tools.ordinary.co  (landing grid of tools)
- **First tool:** https://tools.ordinary.co/review  (OF Review)
- **Pages project:** `of-tools` · **Source of truth:** this Dropbox folder.
  `github.com/Ordinary-Folk/tools` is a **backup snapshot only** — it is NOT
  connected to deploys and does not auto-sync. To publish changes you must run
  the wrangler deploy below (or ask Jorge to); pushing to GitHub does nothing.

> New here / migrating an app? Read **MIGRATING.md** for the step-by-step.

## Architecture

```
  Browser ── tools.ordinary.co ──► Cloudflare Access (Google login, @ordinaryfolk.co)
                                         │
                                         ▼
                              of-tools Pages project
                                  _worker.js (router)
                          ┌──────────────┴───────────────┐
                  static assets here            reverse-proxy by path prefix
                  (landing page,                /review  → of-review-hub.pages.dev
                   single-file tools)           /schedule → <stefan's origin>
```

- **Hosting:** Cloudflare Pages, "advanced mode". `_worker.js` is the router.
- **Auth:** Cloudflare **Access** (Zero Trust), Google IdP locked to the
  `ordinaryfolk.co` Workspace. It gates the whole hostname. Specific public
  paths are exempted with Access **bypass** policies (e.g. OF Review's share
  links). Team login domain: `ordinaryfolk.cloudflareaccess.com`.
- **DNS:** `tools.ordinary.co` is a proxied CNAME → `of-tools.pages.dev`. The
  `ordinary.co` zone is on Cloudflare (account "Ordinary Folk Assets"); apex/www
  301 to `www.ordinaryfolk.co`. The `ordinaryfolk.co` marketing site is on a
  separate registrar and is NOT touched by any of this.

## `_worker.js` routing

- `APPS` maps a path prefix → `{ origin, strip }`:
  - `strip: true`  — upstream serves at its ROOT with asset base = the prefix
    (Vite `base: '/<tool>/'`). The hub strips the prefix when proxying. Use for
    Vite/CRA SPAs (of-review does this).
  - `strip: false` — upstream already serves UNDER the prefix (Next.js
    `basePath: '/<tool>'`, or files deployed in a `/<tool>` subfolder). Path is
    forwarded unchanged.
- Anything not matching an `APPS` prefix is served as a **static asset** from
  this repo (the landing page + any single-file tools you drop in).
- `/<tool>/__sso/firebase-token` is a reserved path for the **SSO bridge** (see
  below).

## Auth model — Access gate + per-tool bypass

Access gates `tools.ordinary.co/*`. To let a tool have **public** (no-login)
URLs, add an Access application on that path with a **Bypass** policy. Current
apps (managed in Zero Trust → Access controls → Applications):

| App / path | Policy |
|---|---|
| `tools.ordinary.co` | **Allow** email domain `ordinaryfolk.co` (the gate) |
| `tools.ordinary.co/review/v` | **Bypass** everyone (public share links) |
| `tools.ordinary.co/review/assets` | **Bypass** everyone (so share pages load their JS/CSS) |

The most-specific path wins, so the public paths stay open while everything else
requires login.

## Single sign-on into a tool (the Firebase pattern)

Because the app UI is behind Access, the hub already knows who the user is. A
tool can avoid a *second* login by exchanging the Access identity for its own
session. OF Review does this with Firebase:

1. App calls same-origin `GET /review/__sso/firebase-token` (gated, so it carries
   the `Cf-Access-Jwt-Assertion`).
2. `_worker.js` `handleSso()` verifies the Access JWT (JWKS + `aud`), then POSTs
   the verified email to the tool's worker `/sso/mint` with a shared secret.
3. The tool's worker maps the email → its user record and mints a session token;
   the app signs in silently.

To reuse for another tool: gate `/<tool>/__sso`, add a `handleSso`-style branch
pointing at that tool's mint endpoint, and keep the tool's secrets in its own
worker. (A tool with no login of its own can skip all this and just read the
Access identity from `/cdn-cgi/access/get-identity`.)

## Deploy the hub

```bash
# from this folder. Account: Ordinary Folk Assets.
export CLOUDFLARE_ACCOUNT_ID=ef803ddd03bdba02130ed576873a4187
# stage so .git/CLAUDE.md/docs aren't published:
rm -rf /tmp/of-tools-deploy && mkdir -p /tmp/of-tools-deploy
cp index.html _worker.js /tmp/of-tools-deploy/
npx wrangler@latest pages deploy /tmp/of-tools-deploy --project-name of-tools --branch main
```

Logged-in account must be `jorge@ordinaryfolk.co` (`wrangler whoami`). For DNS /
Access / Pages-domain changes via API, use the token in `.dev.vars`
(`CLOUDFLARE_API_TOKEN`, gitignored).

## Adding a tool — short version

- **Static single-file tool:** drop `<name>/index.html` in this repo, add a card
  to `index.html`. Done (served directly).
- **App tool:** build it to serve under `/<tool>` → deploy it → add a line to
  `APPS` in `_worker.js` → add a card to `index.html` → if it has public URLs,
  add an Access bypass for them. Full walkthrough in **MIGRATING.md**.

## Key infra values

- Cloudflare account "Ordinary Folk Assets": `ef803ddd03bdba02130ed576873a4187`
- `ordinary.co` zone id: `a05a2d05a285d043e5831b740e0ed8fb`
- Hub Pages project: `of-tools` (`of-tools.pages.dev`)
- OF Review app build: `of-review-hub` (`of-review-hub.pages.dev`, served under
  `/review`); standalone legacy build still at `of-review.pages.dev` (untouched)
- OF Review API: `of-review-worker.ordinary-folk-hosting.workers.dev`
- Access team: `ordinaryfolk.cloudflareaccess.com`; hub app AUD:
  `5bff407839e790119d8676e372b3b612c00ea2958271d51e7e8c045cff997fbc`

## Style

- No em dashes. Geist + Geist Mono. Direct, concise, Slack-native tone.

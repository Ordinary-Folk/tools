# Ordinary Folk Tools hub (tools.ordinary.co)

One front door for OF's internal apps: **one Google login, each tool on a path**,
all under `tools.ordinary.co`. This folder is the hub itself (a Cloudflare Pages
project). Individual tools live in their own folders/repos and are proxied in.

- **Live:** https://tools.ordinary.co  (landing grid of tools)
- **First tool:** https://tools.ordinary.co/review  (OF Review)
- **Pages project:** `of-tools` · **Source of truth:** the GitHub repo
  `github.com/Ordinary-Folk/tools`. Unlike the Vercel apps, **pushing here does
  NOT deploy** — GitHub isn't wired to the Pages build; publish with the wrangler
  deploy below (or ask Jorge). The Cloudflare API token lives in `.dev.vars`
  (gitignored).

> **Source control & multi-editor workflow (Jorge + Stefan).** This repo lives in the `Ordinary-Folk` GitHub org. **GitHub is how we sync — never Dropbox.** Work from a clone on a NON-Dropbox path (a shared Dropbox folder corrupts `.git` and makes conflict copies instead of merging).
>
> Every session:
> 1. `git checkout main && git pull` — start from the latest.
> 2. Branch your work: `git checkout -b <name>`.
> 3. Commit and push the branch as you go (`git push -u origin <name>`) so the other person can see it.
> 4. Before merging to main: **give the other person a heads-up**, then `git checkout main && git pull` once more so you merge on top of their latest.
> 5. Merge, push main. Depending on the app, **a push to main may auto-deploy to production** — treat merging as shipping (see the deploy section below).
>
> Secrets (`.env*`, `worker/.dev.vars`, `.wrangler`) are gitignored — they live only on disk and in the Cloudflare / Firebase / Supabase consoles. A fresh clone needs them copied in.

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
                  (landing page, /scripts,      /review  → of-review-hub.pages.dev
                   single-file tools)           /schedule → <stefan's origin>
                                                /time-tracker → of-time-tracker-hub.vercel.app
                                                /admin → of-admin.vercel.app
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

**Session length:** the gate app's session is **730h (1 month)** — bumped from
the 24h default on 2026-07-02 because daily re-logins were annoying. If people
start getting login prompts more often than ~monthly, check the app's Session
Duration in Zero Trust before suspecting anything else. (Note: deploys never
log anyone out — Access cookies are independent of Pages deployments.)

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

## Shared people photos (one avatar everywhere)

Every tool shows an OF teammate the same way: their **Slack profile photo** in a
circle, falling back to **initials** when they have no custom Slack photo, the
image fails to load, or the viewer isn't OF staff. Clients/guests always get
initials.

- **Source:** `GET /__people/avatars` (same origin, gated by Access, so it
  works from any tool page an OF user has open; a logged-out client on a public
  review link gets a 302 and should just fall back to initials) →
  `{ people: [{ email, name, display, photo }] }`. `name` = Slack real name,
  `display` = Slack display name, `photo` = 72px image URL. `_worker.js`
  `handlePeopleAvatars()` re-checks the Access JWT, then fetches the list from
  the of-review Worker (`/hub/people-avatars`, hub secret; it holds the Slack
  token, maps Slack emails back to OF emails through its alias table and
  caches 6h). The browser may keep the response for an hour.
- **Matching:** by **email** when the tool knows it; otherwise by an exact,
  case-insensitive match on the person's Slack `name` or `display`. A name two
  people share matches nobody (no wrong faces).
- **Look:** circle, photo `object-cover`; fallback initials = first letters of
  the FIRST TWO words (`Jorge R. Canedo E.` → `JR`, same as OF Review) on the
  person's colour. Comment-style avatars use OF Review's `commenterColor`
  (`oklch(0.62 0.16 hue)`, hue from a name hash). Presence rows (Schedule,
  whiteboard) keep their own per-user colour as a ring, since it matches that
  person's cursor/selection.

Copy-paste client snippet (no dependencies):

```ts
let peoplePromise: Promise<{ email: string; name: string; display: string; photo: string }[]> | null = null
export function loadOfPeople() {
  peoplePromise ??= fetch('/__people/avatars', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { people: [] }))
    .then((d) => d.people ?? [])
    .catch(() => [])
  return peoplePromise
}
const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
export function photoFor(people: { email: string; name: string; display: string; photo: string }[], who: { email?: string | null; name?: string | null }) {
  if (who.email) return people.find((p) => p.email === who.email!.toLowerCase())?.photo ?? null
  const n = who.name ? norm(who.name) : ''
  if (!n) return null
  const hits = people.filter((p) => norm(p.name) === n || (p.display && norm(p.display) === n))
  return hits.length === 1 ? hits[0].photo : null
}
```

## SSO variant: Time Tracker (real Supabase session)

Time Tracker (`/time-tracker`, `strip: true`) has real per-user RLS (Postgres
policies read `auth.jwt()->>'email'`), so trusting the Access email client-side is
not enough; it needs a genuine Supabase session whose JWT carries that email.
Instead of the Firebase worker bridge above, the mint lives inside the tool as a
Vercel function (no `_worker.js` `__sso` branch needed):

1. App (`useAuth`) calls same-origin `GET /time-tracker/api/sso/session?have=<currentEmail>`
   (gated, so it carries `Cf-Access-Jwt-Assertion`).
2. The function verifies the Access JWT, then with the Supabase service-role key
   ensures the auth user exists, generates a magic-link token, and exchanges it
   for a real session (`generateLink` + `verifyOtp`).
3. It returns `{ access_token, refresh_token }` and the app calls
   `supabase.auth.setSession`. The `?have=` param lets the function skip minting
   when the existing session already belongs to the Access user (a stale-session
   guard for shared browsers; mismatches get re-minted).

Sign-out clears the Supabase session AND redirects to `/cdn-cgi/access/logout` so
the hub login is cleared too, not just the app session. The service-role key lives
in the tool's own Vercel project env (`SUPABASE_SERVICE_ROLE_KEY`), never here.

## Deploy the hub

```bash
./deploy.sh        # from this folder; stages index.html, _worker.js, icons/, fonts/, scripts/ (minus the publisher + icon builder) and runs wrangler pages deploy
```

Logged-in account must be `jorge@ordinaryfolk.co` (`wrangler whoami`; the script
unsets `CLOUDFLARE_API_TOKEN` so the token in `.dev.vars` doesn't shadow the
login). For DNS / Access / Pages-config changes via API, use that token
(`CLOUDFLARE_API_TOKEN`, gitignored). Secrets and bindings (R2, env) live on the
Pages project and survive deploys.

## Scripts page (`/scripts`): what is on the OF shelf

`scripts/index.html` lists the AE scripts and other OF-made tools (Lapiz, Dropbox
Finder Links, the Time Tracker Mac app, the GOOGWC tools) with the newest version
of each, when it changed, what's new, where it lives in Dropbox (Copy path, and
Open in Finder through the dbxlinks helper on `localhost:48620`), install steps
and a KBar icon per script. Two sources, merged in the browser:

- **`scripts/catalog.json`** (hand-written, in this repo): the folders to watch
  (paths relative to the Dropbox root), the groups, and per tool: blurb, longer
  text, install steps, KBar button name, which files are the loader / versioned
  build / extras (regexes), tile colour and a 16×16 pixel glyph. Edit this to
  change wording or add a tool. Shelf files no tool claims show up under "Also
  in …, not described yet", so a new script is visible before anyone writes it up.
- **`/scripts/manifest.json`** (live): what the folders actually hold right now:
  file names, sizes, dates, versions (from the filename, an `.app`'s Info.plist, a
  `VERSION` file or `data-…-version` in HTML) and the newest changelog entry read
  from each script's header. Produced by the **publisher**.

**Publisher** (`scripts/publisher/`): `of-scripts-catalog.py` runs on one OF Mac
with the team Dropbox synced (Jorge's). `install.sh` puts it at
`~/.local/bin/of-scripts-catalog` with a launchd agent
(`com.ordinaryfolk.scripts-catalog`: fires when a watched folder changes, every
6 h, and at login; log `~/Library/Logs/of-scripts-catalog.log`; config + state in
`~/Library/Application Support/Ordinary Folk/Scripts Catalog/`). It fetches the
catalog from `of-tools.pages.dev` (the watch list comes from there), scans, and
POSTs the manifest to `/scripts/__publish` on the **pages.dev host** (Access does
not gate it) with `X-Hub-Secret` = the Pages secret `SCRIPTS_PUBLISH_SECRET`
(`set-hub-secret.sh` copies the Mac's `publish-secret` file onto the project).
The worker stores it in the **R2 bucket `of-tools-data`**, bound as `TOOLS_DATA`
(production + preview; bound through the Pages API, no wrangler.toml here).
`GET /scripts/manifest.json` answers only on `tools.ordinary.co` (already behind
Access) or localhost, or anywhere with the secret header (the publisher's
self-check). Unchanged shelf = no publish, but it republishes every 6 h so
"shelf checked" stays honest. Re-run `install.sh` after adding a folder to the
catalog so launchd watches it too. Dry run: `of-scripts-catalog --dry-run`.

**Icons:** `python3 scripts/icons/build.py` regenerates `scripts/icons/*.svg|png`
(colour tile + mono) and `of-kbar-icons.zip` from the catalog glyphs; run it after
touching a glyph and commit the output. The page draws the same glyphs inline.

**Adding a script:** put it on the shelf with the usual loader + versioned file;
add a catalog entry (copy a sibling, draw a glyph); run the icon builder; deploy.
Until the catalog entry exists the file already shows under "Also in …".

**Local dev:** `npx wrangler pages dev . --r2 TOOLS_DATA --binding SCRIPTS_PUBLISH_SECRET=local-dev-secret --port 8788`
then publish into the local R2 with
`python3 scripts/publisher/of-scripts-catalog.py --catalog-url file://$PWD/scripts/catalog.json --publish-url http://127.0.0.1:8788/scripts/__publish --secret-file <file holding local-dev-secret> --force`.

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
- Time Tracker hub build: `of-time-tracker-hub` (`of-time-tracker-hub.vercel.app`,
  served under `/time-tracker`, Vite base `/time-tracker/`, also serves the
  `/api/sso/session` mint function). Standalone `time-tracker-web-six.vercel.app`
  (base `/`) is kept for the Chrome extension + Mac app direct links.
- OF Admin: `of-admin` Vercel project (`of-admin.vercel.app`), served under
  `/admin`, Vite base `/admin/`, serves its own `/api/sso/session` mint function.
  The bare host also answers at `/admin/…` (Xero/Gmail OAuth callbacks + the
  gmail-sync cron stay there). Same monorepo as the Time Tracker (`apps/admin`).
- Time Tracker repo: `Ordinary-Folk/of-time-tracker`; shares Supabase project
  `gpzizkqnwiqdwqkyukcp` (same DB as OF Schedule)
- Scripts manifest: R2 bucket `of-tools-data` (binding `TOOLS_DATA`), Pages
  secret `SCRIPTS_PUBLISH_SECRET`, publisher on Jorge's Mac (launchd
  `com.ordinaryfolk.scripts-catalog`)
- Access team: `ordinaryfolk.cloudflareaccess.com`; hub app AUD:
  `5bff407839e790119d8676e372b3b612c00ea2958271d51e7e8c045cff997fbc`

## Style

- No em dashes. Direct, concise, Slack-native tone.
- OF Review design system (light adaptation): cool-neutral paper, Inter + DM Sans
  (self-hosted in `fonts/`), system mono for paths/codes, radius 0, single blue
  accent reserved for actions. Tile colors are identity only (rebrand
  secondaries + ink for Admin).

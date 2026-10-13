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
                  (landing page,                /review  → of-review-hub.pages.dev
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
# from this folder. Account: Ordinary Folk Assets.
export CLOUDFLARE_ACCOUNT_ID=ef803ddd03bdba02130ed576873a4187
# stage so .git/CLAUDE.md/docs aren't published:
rm -rf /tmp/of-tools-deploy && mkdir -p /tmp/of-tools-deploy
cp index.html _worker.js /tmp/of-tools-deploy/
cp -R icons fonts /tmp/of-tools-deploy/
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
- Access team: `ordinaryfolk.cloudflareaccess.com`; hub app AUD:
  `5bff407839e790119d8676e372b3b612c00ea2958271d51e7e8c045cff997fbc`

## Style

- No em dashes. Direct, concise, Slack-native tone.
- OF Review design system (light adaptation): cool-neutral paper, Inter + DM Sans
  (self-hosted in `fonts/`), system mono for paths/codes, radius 0, single blue
  accent reserved for actions. Tile colors are identity only (rebrand
  secondaries + ink for Admin).

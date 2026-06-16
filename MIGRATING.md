# Migrating an app into the Ordinary Folk Tools hub

Goal: your app lives at `tools.ordinary.co/<your-tool>`, behind one OF Google
login, alongside the others. Read `CLAUDE.md` first for the architecture.

## What you can do vs. what needs Jorge

- **You (Stefan) can do solo:** all the changes inside *your* app, deploy *your*
  app, and edit the two hub files in this Dropbox repo (`_worker.js` and
  `index.html`).
- **Needs Jorge (2-minute job, Cloudflare account access):** deploying the hub
  (`of-tools` Pages project) and any **Access** policy changes (e.g. a public
  bypass). Ping him with the line you added to `APPS` and which paths, if any,
  should be public.

## The five steps

1. **Serve your app under your tool's path.** Pick a prefix, e.g. `/schedule`.
   - **Next.js:** set `basePath: '/schedule'` in `next.config.js`. App now serves
     under `/schedule` on its origin → use `strip: false` in the hub.
   - **Vite / CRA SPA:** set `base: '/schedule/'` and your router `basename`
     `/schedule`, deploy at the origin root → use `strip: true`.
2. **Deploy your app** so it has a reachable HTTPS origin. Keeping it on Vercel
   is fine (the hub proxies to it). Moving to a Cloudflare Pages project is the
   cleaner long-term option but not required to start.
3. **Register it in the hub** — edit `_worker.js`, add one line to `APPS`:
   ```js
   '/schedule': { origin: 'https://<your-app-origin>', strip: false },
   ```
4. **Add a card** in `index.html` (copy the "Master Schedule" card, point it at
   `/schedule/`, swap the icon, remove the `soon` class + badge).
5. **Tell Jorge** to deploy the hub and add an Access **bypass** for any paths
   that must be public (none, if the whole app is OF-only).

## Auth: you probably don't need your own login

Once the app is behind the hub, **Cloudflare Access has already authenticated the
user**, and the hub forwards the signed `Cf-Access-Jwt-Assertion` header to your
origin on every request. So your backend can identify the user (email, name)
straight from that header — no separate login screen. Two options:

- **Simplest:** drop your app's login and read the user from the
  `Cf-Access-Jwt-Assertion` header server-side (verify it against
  `https://ordinaryfolk.cloudflareaccess.com/cdn-cgi/access/certs`, check `aud`
  for the hub app). Client-side you can also call `/cdn-cgi/access/get-identity`.
- **Keep your own login for now:** also fine — users just sign in twice until you
  wire up the single-sign-on bridge (see the Firebase example in `CLAUDE.md`).

---

# Brief: migrate the Master Schedule app (for Stefan → Claude Code)

Open Claude Code in your `of-master-schedule` project folder and paste this:

> I want to migrate this app into the Ordinary Folk Tools hub so it lives at
> `https://tools.ordinary.co/schedule` behind the hub's single Google login. It's
> currently deployed at `https://of-master-schedule.vercel.app`. Please:
>
> 1. Detect the framework and tell me what it is before changing anything.
> 2. Make the app serve under the path `/schedule`:
>    - If **Next.js**: add `basePath: '/schedule'` (and `assetPrefix` if needed)
>      to `next.config.js`. Update any hard-coded absolute links/fetches to be
>      relative or prefixed. This means the hub uses `strip: false`.
>    - If **Vite/React SPA**: set `base: '/schedule/'`, set the router `basename`
>      to `/schedule`, and confirm an SPA fallback exists. This means `strip:true`.
> 3. Handle auth: the app will sit behind Cloudflare Access, which authenticates
>    the OF user at the edge and forwards a signed `Cf-Access-Jwt-Assertion`
>    header to the origin. If this app has its own login, propose the smallest
>    change to read the user identity from that header (verify against
>    `https://ordinaryfolk.cloudflareaccess.com/cdn-cgi/access/certs`, audience =
>    the hub app) instead of a second login. If it has no login, no change needed.
> 4. Redeploy the app to Vercel and confirm `https://of-master-schedule.vercel.app/schedule`
>    loads correctly (page, assets, and any API routes all under `/schedule`).
> 5. In the Dropbox hub repo at
>    `_Ordinary Folk Projects/_OF TOOL BOX/Apps - OF/tools/`:
>    - add `'/schedule': { origin: 'https://of-master-schedule.vercel.app', strip: false }`
>      to the `APPS` object in `_worker.js`,
>    - and flip the "Master Schedule" card in `index.html` from the disabled
>      `soon` placeholder to a live `<a href="/schedule/">` card.
> 6. List exactly what's left for Jorge to run (deploy the `of-tools` Pages
>    project, and confirm whether any `/schedule` paths must be public so he can
>    add an Access bypass). Do NOT attempt the hub deploy or Access changes
>    yourself — those need the Ordinary Folk Assets Cloudflare account.
>
> Read `tools/CLAUDE.md` and `tools/MIGRATING.md` in that Dropbox folder for the
> full architecture before you start.

## After Stefan's done, Jorge runs

```bash
cd ".../Apps - OF/tools"
export CLOUDFLARE_ACCOUNT_ID=ef803ddd03bdba02130ed576873a4187
rm -rf /tmp/of-tools-deploy && mkdir -p /tmp/of-tools-deploy
cp index.html _worker.js /tmp/of-tools-deploy/
npx wrangler@latest pages deploy /tmp/of-tools-deploy --project-name of-tools --branch main
```

Then, only if some `/schedule` paths must be public, add an Access **bypass**
application on those paths (Zero Trust → Access controls → Applications), the same
way `/review/v` is set up. Verify: `https://tools.ordinary.co/schedule` prompts
the Google login, then loads the app.

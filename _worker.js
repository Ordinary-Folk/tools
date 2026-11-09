// tools.ordinary.co - hub router (Cloudflare Pages advanced mode)
//
// Two kinds of tools live here:
//   1. Static single-file tools in this repo (g-gradient-26, soccer-field-3d, the
//      landing page). Served directly as static assets by Cloudflare Pages.
//   2. "App" tools that are their own built deployments (OF Review, etc.). We
//      reverse-proxy a path prefix to that app's origin so it lives at
//      tools.ordinary.co/<prefix> instead of its own subdomain.
//
// Access (Zero Trust) gates this whole hostname to the ordinaryfolk.co Google
// Workspace. Public share links are exempted with an Access *bypass* policy on
// the path patterns listed in PUBLIC_PATHS below (configured in the dashboard,
// not here - listed only for documentation).

// Each app maps a URL path prefix to an upstream origin.
//   strip: true   -> upstream serves at its ROOT, with its asset base set to the
//                    prefix (Vite `base: '/<tool>/'`, deployed at origin root).
//                    The hub strips the prefix: /review/assets/x -> origin
//                    /assets/x, /review/v/slug -> origin /v/slug (SPA fallback).
//                    Use for Vite/CRA SPAs (like of-review).
//   strip: false  -> upstream already serves UNDER the prefix (Next.js
//                    `basePath: '/<tool>'`, or files deployed into a /<tool>
//                    subfolder). The path is forwarded unchanged.
const APPS = {
  '/review': { origin: 'https://of-review-hub.pages.dev', strip: true },
  '/project-tracker': { origin: 'https://of-project-tracker.vercel.app', strip: false },
  '/schedule': { origin: 'https://of-master-schedule.vercel.app', strip: false },
  // Time Tracker is a Vite SPA built with base '/time-tracker/' (VITE_BASE_PATH),
  // deployed at the Vercel project root (which also serves api/sso/session). So
  // strip:true, like /review: the hub drops the prefix and the origin sees
  // /assets/x, / (SPA fallback) and /api/sso/session. This is the dedicated hub
  // build (base /time-tracker/); the standalone time-tracker-web-six.vercel.app
  // (base /) stays for the Chrome extension + Mac app direct links.
  '/time-tracker': { origin: 'https://of-time-tracker-hub.vercel.app', strip: true },
  // OF Admin is a Vite SPA built with base '/admin/' (VITE_BASE_PATH), deployed
  // at the root of its ONE Vercel project (which also serves its /api/* functions
  // incl. api/sso/session, the Access → Supabase bridge). strip:true like
  // /time-tracker. The same project answers on of-admin.vercel.app/admin/… via
  // its own rewrite — the Xero/Gmail OAuth callbacks and the gmail-sync cron
  // stay on that bare host. Access already gates /admin/ (no policy change).
  '/admin': { origin: 'https://of-admin.vercel.app', strip: true },
}

// For reference only - these are enforced as Access *bypass* policies in the
// Zero Trust dashboard so non-OF clients can open share links without a login.
// const PUBLIC_PATHS = [
//   '/review/v/*',
//   // Project Tracker public board-review links (Next.js app under /project-tracker):
//   // the page, its data endpoint, and its JS/CSS chunks all need bypassing or a
//   // logged-out client gets a blank page (the _next/* analog of /review/assets).
//   '/project-tracker/review/*',
//   '/project-tracker/api/review/*',
//   '/project-tracker/_next/*',
// ]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Single sign-on bridge: this path is gated by Cloudflare Access (it is NOT
    // under a bypass), so a request reaching here carries a verified Access JWT.
    // We turn that into a Firebase custom token for the of-review app, so an OF
    // user who logged into the hub doesn't log in again. (Reusable shape for any
    // future Firebase-backed tool: gate /<tool>/__sso and point it at that tool's
    // mint endpoint.)
    if (url.pathname === '/review/__sso/firebase-token') {
      return handleSso(request, env)
    }

    // Shared OF people photos (Slack profile pictures) for every tool on the
    // hub, so a teammate looks the same everywhere. Gated like the rest of the
    // hostname (NOT under a bypass): signed-in OF staff get the list; clients on
    // public review links get a 302 and their tools fall back to initials.
    // The tracker asks under its own path so the request stays inside its own
    // Access app (staff Google + invited guests); guests get a 403 → initials.
    if (url.pathname === '/__people/avatars' || url.pathname === '/project-tracker/__people/avatars') {
      return handlePeopleAvatars(request, env)
    }

    // Scripts catalog (tools.ordinary.co/scripts): the live manifest of what
    // sits on the OF shelf in Dropbox. The publisher on one OF Mac (see
    // scripts/publisher) POSTs it with the publish secret to the pages.dev host,
    // which Access does not gate; the page reads it back on tools.ordinary.co,
    // where Access has already signed the reader in. Stored in the TOOLS_DATA
    // R2 bucket (of-tools-data), nothing else lives there yet.
    if (url.pathname === '/scripts/__publish') {
      return handleScriptsPublish(request, env)
    }
    if (url.pathname === '/scripts/manifest.json') {
      return handleScriptsManifest(request, env, url)
    }
    // Look custom icons (tools.ordinary.co/look/icons#custom): icons saved
    // from the icon maker, shared by the team. One JSON list in TOOLS_DATA.
    if (url.pathname === '/look/__icons') {
      return handleCustomIcons(request, env, url)
    }

    // One URL per tool (/scripts/smart-queue): same page, it reads the path.
    // Real files under /scripts/ have an extension or a deeper path, so only a
    // bare one-segment id is rewritten.
    const toolPage = url.pathname.match(/^\/scripts\/([a-z0-9-]+)\/?$/)
    if (toolPage && !['icons', 'publisher'].includes(toolPage[1]) && (request.method === 'GET' || request.method === 'HEAD')) {
      return env.ASSETS.fetch(new Request(new URL('/scripts/', url).toString(), request))
    }

    // OF Review share links: give the page real link-preview tags (title,
    // picture, a video-shaped player) so Notion, Slack etc. show a card and
    // can embed the ?embed view instead of the whole page.
    const share = url.pathname.match(/^\/review\/v\/([a-z0-9-]{1,80})\/?$/i)
    if (share && request.method === 'GET') {
      const res = await proxyTo(request, url, APPS['/review'], '/review')
      return withReviewPreview(res, share[1], url)
    }

    for (const [prefix, app] of Object.entries(APPS)) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
        return proxyTo(request, url, app, prefix)
      }
    }

    // Landing page: fill in who is signed in (and the Admin row) before it
    // leaves here, so nothing pops in after load.
    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      return landingWithIdentity(request, env, url)
    }

    // Everything else: static landing page + single-file tools in this repo.
    return env.ASSETS.fetch(request)
  },
}

// --- Landing page identity ----------------------------------------------------
// Same list the page used client-side. Cosmetic only: OF Admin gates itself.
const HUB_ADMINS = ['stefan@ordinaryfolk.co', 'mona@ordinaryfolk.co', 'jorge@ordinaryfolk.co']

// Reads the Access identity (JWT header, else the CF_Authorization cookie) and
// writes the email and the Admin row (or drops it) into index.html. With no
// identity (pages.dev, local dev) the page is served as is and its own script
// asks /cdn-cgi/access/get-identity like before. Locally, DEV_IDENTITY (a
// `--binding`) stands in for Access so the server path can be tested.
async function landingWithIdentity(request, env, url) {
  const res = await env.ASSETS.fetch(request)
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res

  let email = ''
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || readCookie(request, 'CF_Authorization')
  if (jwt) {
    const claims = await verifyAccessJwt(jwt).catch(() => null)
    email = String(claims?.email || '').toLowerCase()
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (!email && local && env.DEV_IDENTITY) email = String(env.DEV_IDENTITY).toLowerCase()
  if (!email) return res

  const admin = HUB_ADMINS.includes(email)
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('etag')
  // Per-person HTML: never let the edge or a shared cache keep it.
  headers.set('cache-control', 'private, no-store')
  headers.set('vary', 'Cookie, Cf-Access-Jwt-Assertion')
  return new HTMLRewriter()
    .on('html', { element: (el) => el.setAttribute('data-identity', 'server') })
    .on('#email', { element: (el) => el.setInnerContent(email) })
    .on('#admin-card', {
      element: (el) => {
        if (admin) el.removeAttribute('style')
        else el.remove()
      },
    })
    .transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers }))
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

// --- Cloudflare Access SSO bridge ----------------------------------------
const ACCESS_TEAM_DOMAIN = 'ordinaryfolk.cloudflareaccess.com'
// AUD tags of the gated Access applications: "OF Tools hub" (tools.ordinary.co)
// and "Project Tracker" (tools.ordinary.co/project-tracker, staff + invited guests).
const ACCESS_AUDS = [
  '5bff407839e790119d8676e372b3b612c00ea2958271d51e7e8c045cff997fbc',
  '10fd8a305b8df2f2cd5bafc4bd89ad6de665305ebd9a504aa205c97cfa663f18',
]
const OF_REVIEW_WORKER = 'https://of-review-worker.ordinary-folk-hosting.workers.dev'

let jwksCache = null // { keys, fetchedAt }

async function handleSso(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwt) return jsonResp({ error: 'no-access' }, 401)
  const claims = await verifyAccessJwt(jwt)
  if (!claims) return jsonResp({ error: 'invalid-access' }, 401)
  const email = String(claims.email || '').toLowerCase()
  if (!email.endsWith('@ordinaryfolk.co')) return jsonResp({ error: 'bad-domain' }, 403)
  if (!env.HUB_SSO_SECRET) return jsonResp({ error: 'unconfigured' }, 500)
  // Hand the verified email to the of-review Worker (which holds the Firebase
  // service-account key) to mint a custom token for the user's account.
  const res = await fetch(`${OF_REVIEW_WORKER}/sso/mint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-secret': env.HUB_SSO_SECRET },
    body: JSON.stringify({ email }),
  })
  const data = await res.json().catch(() => ({ error: 'mint-failed' }))
  return jsonResp(data, res.status)
}

// GET /__people/avatars → { people: [{ email, name, display, photo }] }: every OF
// teammate with a custom Slack photo (name = Slack real name, display = Slack
// display name). The of-review Worker holds the Slack token and caches the list
// (6h); this route re-checks the Access JWT, fetches it with the hub secret, and
// lets the browser keep it for an hour. Tools match a person by email when they
// have one, else by an exact (case-insensitive) real/display name; a name two
// people share matches nobody. See CLAUDE.md "Shared people photos".
async function handlePeopleAvatars(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwt) return jsonResp({ error: 'no-access' }, 401)
  const claims = await verifyAccessJwt(jwt)
  const email = String(claims?.email || '').toLowerCase()
  if (!claims || !email.endsWith('@ordinaryfolk.co')) return jsonResp({ error: 'forbidden' }, 403)
  if (!env.HUB_SSO_SECRET) return jsonResp({ error: 'unconfigured' }, 500)
  const res = await fetch(`${OF_REVIEW_WORKER}/hub/people-avatars`, {
    headers: { 'x-hub-secret': env.HUB_SSO_SECRET },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) return jsonResp({ error: 'unavailable' }, 502)
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' },
  })
}

async function verifyAccessJwt(jwt) {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  let header, payload
  try {
    header = JSON.parse(b64urlToString(parts[0]))
    payload = JSON.parse(b64urlToString(parts[1]))
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (payload.iss !== `https://${ACCESS_TEAM_DOMAIN}`) return null
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.some((a) => ACCESS_AUDS.includes(a))) return null
  if (typeof payload.exp === 'number' && payload.exp < now) return null
  const keys = await getAccessJwks()
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) return null
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  return ok ? payload : null
}

async function getAccessJwks() {
  const now = Date.now()
  if (jwksCache && now - jwksCache.fetchedAt < 3600_000) return jwksCache.keys
  const res = await fetch(`https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
  const data = await res.json()
  jwksCache = { keys: data.keys || [], fetchedAt: now }
  return jwksCache.keys
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s))
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

// --- Scripts catalog manifest ------------------------------------------------
const SCRIPTS_MANIFEST_KEY = 'scripts/manifest.json'

// POST /scripts/__publish, body = the manifest JSON, header x-hub-secret =
// SCRIPTS_PUBLISH_SECRET (a Pages secret; the same value sits on the publishing
// Mac in ~/Library/Application Support/Ordinary Folk/Scripts Catalog/).
async function handleScriptsPublish(request, env) {
  if (request.method !== 'POST') return jsonResp({ error: 'method' }, 405)
  if (!env.SCRIPTS_PUBLISH_SECRET || !env.TOOLS_DATA) return jsonResp({ error: 'unconfigured' }, 500)
  if (!sameSecret(request.headers.get('x-hub-secret'), env.SCRIPTS_PUBLISH_SECRET)) return jsonResp({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > 1_000_000) return jsonResp({ error: 'too-large' }, 413)
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return jsonResp({ error: 'not-json' }, 400)
  }
  if (!data || typeof data !== 'object' || !data.folders || typeof data.folders !== 'object') {
    return jsonResp({ error: 'bad-shape' }, 400)
  }
  data.received = new Date().toISOString()
  await env.TOOLS_DATA.put(SCRIPTS_MANIFEST_KEY, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  })
  return jsonResp({ ok: true, received: data.received })
}

// GET /scripts/manifest.json. Only answered on the gated hostname (Access has
// signed the reader in before the request gets here) or locally; elsewhere it
// needs the publish secret, which lets the publisher check its own upload.
async function handleScriptsManifest(request, env, url) {
  if (request.method !== 'GET') return jsonResp({ error: 'method' }, 405)
  const host = url.hostname
  const gated = host === 'tools.ordinary.co' || host === 'localhost' || host === '127.0.0.1'
  const withSecret = Boolean(env.SCRIPTS_PUBLISH_SECRET) && sameSecret(request.headers.get('x-hub-secret'), env.SCRIPTS_PUBLISH_SECRET)
  if (!gated && !withSecret) return jsonResp({ error: 'not-here' }, 404)
  if (!env.TOOLS_DATA) return jsonResp({ error: 'unconfigured' }, 500)
  const obj = await env.TOOLS_DATA.get(SCRIPTS_MANIFEST_KEY)
  if (!obj) return jsonResp({ error: 'no-manifest' }, 404)
  return new Response(obj.body, {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function sameSecret(given, expected) {
  const a = String(given || '')
  const b = String(expected || '')
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// --- OF Review link previews ----------------------------------------------
const escAttr = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A comment (?c=) or time (?t=) link gets its own card: that comment and frame.
function reviewAt(url) {
  const q = new URLSearchParams()
  const c = url.searchParams.get('c')
  const t = url.searchParams.get('t')
  if (c) q.set('c', c)
  else if (t) q.set('t', t)
  return q.toString()
}

async function reviewMeta(slug, at = '') {
  try {
    const r = await fetch(`${OF_REVIEW_WORKER}/meta?slug=${encodeURIComponent(slug)}${at ? `&${at}` : ''}`, {
      cf: { cacheTtl: 300, cacheEverything: true },
    })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function withReviewPreview(res, slug, url) {
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res
  const m = await reviewMeta(slug, reviewAt(url))
  if (!m) return res
  // The worker echoes back the ?c= / ?t= it actually used (none if it didn't
  // apply, e.g. a protected cut), so the card's URL matches what it shows.
  const page = `${url.origin}/review/v/${slug}${m.url.includes('?') ? m.url.slice(m.url.indexOf('?')) : ''}`
  const tags = [
    ['property', 'og:site_name', 'OF Review'],
    ['property', 'og:type', 'video.other'],
    ['property', 'og:title', m.title],
    ['property', 'og:description', m.description],
    ['property', 'og:url', page],
    ...(m.image
      ? [
          ['property', 'og:image', m.image],
          ['property', 'og:image:width', '1280'],
          ['property', 'og:image:height', '720'],
        ]
      : []),
    // The embeddable player (the share page's ?embed view).
    ['property', 'og:video:url', m.embedUrl],
    ['property', 'og:video:secure_url', m.embedUrl],
    ['property', 'og:video:type', 'text/html'],
    ['property', 'og:video:width', String(m.width)],
    ['property', 'og:video:height', String(m.height)],
    ['name', 'twitter:card', 'player'],
    ['name', 'twitter:title', m.title],
    ['name', 'twitter:description', m.description],
    ...(m.image ? [['name', 'twitter:image', m.image]] : []),
    ['name', 'twitter:player', m.embedUrl],
    ['name', 'twitter:player:width', String(m.width)],
    ['name', 'twitter:player:height', String(m.height)],
    ['name', 'description', m.description],
  ]
  const head =
    tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${escAttr(v)}">`).join('') +
    `<link rel="alternate" type="application/json+oembed" href="${escAttr(
      `${OF_REVIEW_WORKER}/oembed?format=json&url=${encodeURIComponent(page)}`,
    )}" title="${escAttr(m.title)}">`
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  return new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(`${m.title} · OF Review`) })
    .on('head', { element: (el) => el.append(head, { html: true }) })
    .transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers }))
}

async function proxyTo(request, url, app, prefix) {
  const { origin, strip } = app
  // strip:true  -> drop the prefix so a root-served upstream sees the path it
  //               expects (/review/v/x -> /v/x, /review -> /).
  // strip:false -> forward unchanged (upstream already serves under the prefix).
  const path = strip ? url.pathname.slice(prefix.length) || '/' : url.pathname
  const target = new URL(path + url.search, origin)

  const headers = new Headers(request.headers)
  headers.set('Host', new URL(origin).host)
  // Pass the original client host through in case the app needs to build
  // absolute URLs (e.g. share links) pointing back at tools.ordinary.co.
  headers.set('X-Forwarded-Host', url.host)
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''))

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  // Hashed build files (/assets/…). Right after a Pages deploy the alias can
  // answer a brand-new file with the SPA's index.html for a few seconds. Those
  // files are served "immutable, 1 year", so that HTML got cached (here and in
  // browsers) and the app went blank. So: never read this proxy's cache for
  // them (a unique query string; Pages ignores it, browsers still cache the
  // real file for a year), and never pass HTML through for one.
  const isAsset = /\/assets\/[^/]+\.[a-z0-9]+$/i.test(path)
  if (isAsset && request.method === 'GET') target.searchParams.set('hub-nocache', String(Date.now()))

  const upstream = await fetch(target, init)

  if (isAsset && (upstream.headers.get('content-type') || '').includes('text/html')) {
    return new Response('Not found (yet)', {
      status: 404,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    })
  }

  // Clone so we can return a streamed, mutable response.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  })
}

// --- Look custom icons ---------------------------------------------------------
// GET    /look/__icons             -> { icons: [{ name, grid, open, checked, by, at }] }
// POST   /look/__icons  body JSON  -> save (or replace) one icon by name
// DELETE /look/__icons?name=<name> -> remove one
// Only for a signed-in OF person: a verified Access JWT (tools.ordinary.co),
// or DEV_IDENTITY on localhost. The pages.dev host is not behind Access, so
// the JWT check (not the hostname) is what keeps it private.
const CUSTOM_ICONS_KEY = 'look/custom-icons.json'
const ICON_PATH_RE = /^[MmHhVvLlZz0-9 .,-]*$/

async function lookIdentity(request, env, url) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || readCookie(request, 'CF_Authorization')
  if (jwt) {
    const claims = await verifyAccessJwt(jwt).catch(() => null)
    const email = String(claims?.email || '').toLowerCase()
    if (email) return email
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (local && env.DEV_IDENTITY) return String(env.DEV_IDENTITY).toLowerCase()
  return ''
}

async function readCustomIcons(env) {
  const obj = await env.TOOLS_DATA.get(CUSTOM_ICONS_KEY)
  if (!obj) return []
  try {
    const data = await obj.json()
    return Array.isArray(data?.icons) ? data.icons : []
  } catch {
    return []
  }
}

async function handleCustomIcons(request, env, url) {
  if (!env.TOOLS_DATA) return jsonResp({ error: 'unconfigured' }, 500)
  const email = await lookIdentity(request, env, url)
  if (!email) return jsonResp({ error: 'sign-in' }, 401)

  if (request.method === 'GET') return jsonResp({ icons: await readCustomIcons(env) })

  if (request.method === 'POST') {
    const text = await request.text()
    if (text.length > 100_000) return jsonResp({ error: 'too-large' }, 413)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return jsonResp({ error: 'not-json' }, 400)
    }
    const name = String(body?.name || '').trim().toLowerCase()
    const grid = Number(body?.grid)
    const open = String(body?.open || '')
    const checked = String(body?.checked || '')
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) return jsonResp({ error: 'bad-name' }, 400)
    if (grid !== 12 && grid !== 24) return jsonResp({ error: 'bad-grid' }, 400)
    if (!open || open.length > 20_000 || !ICON_PATH_RE.test(open)) return jsonResp({ error: 'bad-path' }, 400)
    if (checked.length > 20_000 || !ICON_PATH_RE.test(checked)) return jsonResp({ error: 'bad-path' }, 400)
    const icons = (await readCustomIcons(env)).filter((i) => i.name !== name)
    const icon = { name, grid, open, checked: checked && checked !== open ? checked : '', by: email, at: new Date().toISOString() }
    icons.unshift(icon)
    if (icons.length > 500) return jsonResp({ error: 'full' }, 409)
    await env.TOOLS_DATA.put(CUSTOM_ICONS_KEY, JSON.stringify({ icons }), {
      httpMetadata: { contentType: 'application/json' },
    })
    return jsonResp({ ok: true, icon })
  }

  if (request.method === 'DELETE') {
    const name = String(url.searchParams.get('name') || '').toLowerCase()
    const icons = await readCustomIcons(env)
    const next = icons.filter((i) => i.name !== name)
    if (next.length === icons.length) return jsonResp({ error: 'not-found' }, 404)
    await env.TOOLS_DATA.put(CUSTOM_ICONS_KEY, JSON.stringify({ icons: next }), {
      httpMetadata: { contentType: 'application/json' },
    })
    return jsonResp({ ok: true })
  }

  return jsonResp({ error: 'method' }, 405)
}

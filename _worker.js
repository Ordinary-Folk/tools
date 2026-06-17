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

    for (const [prefix, app] of Object.entries(APPS)) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
        return proxyTo(request, url, app, prefix)
      }
    }

    // Everything else: static landing page + single-file tools in this repo.
    return env.ASSETS.fetch(request)
  },
}

// --- Cloudflare Access SSO bridge ----------------------------------------
const ACCESS_TEAM_DOMAIN = 'ordinaryfolk.cloudflareaccess.com'
// AUD tag of the gated "OF Tools hub" Access application (tools.ordinary.co).
const ACCESS_AUD = '5bff407839e790119d8676e372b3b612c00ea2958271d51e7e8c045cff997fbc'
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
  if (!aud.includes(ACCESS_AUD)) return null
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

  const upstream = await fetch(target, init)

  // Clone so we can return a streamed, mutable response.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  })
}

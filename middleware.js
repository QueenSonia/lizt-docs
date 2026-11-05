// Login gate. Vercel runs this before serving anything, including the search index, so no file
// is readable without a valid docs_session cookie. Who gets in is decided by the Lizt app
// (lizt-frontend/src/app/docs-access/route.ts), not here. See "Login gate" in the README.
import { nowSeconds, signToken, toBase64Url, verifyToken } from './docs-token.js';

const CALLBACK_PATH = '/__auth/callback'; // sync-docs never publishes "_" paths, so no page can clash
const SESSION_COOKIE = 'docs_session';
const SESSION_SECONDS = 24 * 60 * 60;
const VERIFIER_SECONDS = 10 * 60; // long enough to sign in at the app
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax';

// Tells Vercel to serve the requested file. This is all next() from @vercel/functions does, and
// that package would add 24 dependencies to this site for it.
const serveFile = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

const plainResponse = (body, status, contentType = 'text/plain') =>
  new Response(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': `${contentType}; charset=utf-8` },
  });

const redirect = (location, cookie) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};

const readCookies = (request) =>
  Object.fromEntries(
    (request.headers.get('cookie') ?? '').split(';').map((pair) => {
      const separator = pair.indexOf('=');
      return [pair.slice(0, separator).trim(), pair.slice(separator + 1).trim()];
    }),
  );

const sha256 = async (text) =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));

// One cookie per login attempt, so two tabs signing in at once don't overwrite each other's secret.
const verifierCookieName = (challenge) => `docs_verifier_${challenge.slice(0, 16)}`;

// Where to go after signing in: a page on this site, whatever the link says.
function localPath(value, url) {
  try {
    const target = new URL(value ?? '/', url.origin);
    return target.origin === url.origin ? `${target.pathname}${target.search}${target.hash}` : '/';
  } catch {
    return '/';
  }
}

async function startLogin(request, url, appUrl) {
  // Only a page load starts a login. A background request (asset, search) gets a plain refusal.
  const accept = request.headers.get('accept') ?? '';
  const isPageLoad =
    request.method === 'GET' && (request.headers.get('sec-fetch-dest') === 'document' || accept.includes('text/html'));
  if (!isPageLoad) return plainResponse('Sign in required.', 401);

  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await sha256(verifier);

  const target = new URL('/docs-access', appUrl);
  target.searchParams.set('challenge', challenge);
  target.searchParams.set('next', `${url.pathname}${url.search}`);

  return redirect(
    target.href,
    `${verifierCookieName(challenge)}=${verifier}; ${COOKIE_ATTRIBUTES}; Max-Age=${VERIFIER_SECONDS}`,
  );
}

async function finishLogin(url, cookies, secret) {
  // The pass only counts in the browser that started this login: it must hold the secret whose
  // hash the app wrote into the pass. A pass copied from a URL fails here.
  const pass = await verifyToken(url.searchParams.get('pass'), secret, 'docs-pass');
  const verifier = pass && cookies[verifierCookieName(String(pass.challenge))];
  if (!verifier || (await sha256(verifier)) !== pass.challenge) {
    return plainResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lizt Docs</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
        `<p>We couldn't confirm your sign-in.</p><p><a href="/">Try again</a></p></body></html>`,
      400,
      'text/html',
    );
  }

  const session = await signToken(
    { typ: 'docs-session', sub: pass.sub, role: pass.role, exp: nowSeconds() + SESSION_SECONDS },
    secret,
  );
  return redirect(
    localPath(url.searchParams.get('next'), url),
    `${SESSION_COOKIE}=${session}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_SECONDS}`,
  );
}

export default async function middleware(request) {
  const secret = process.env.DOCS_ACCESS_SECRET;
  const appUrl = process.env.LIZT_APP_URL;
  // Stay locked if the settings are missing, rather than opening the site.
  if (!secret || !appUrl) return plainResponse('Docs access is not configured.', 503);

  const url = new URL(request.url);
  const cookies = readCookies(request);
  const hasSession = (await verifyToken(cookies[SESSION_COOKIE], secret, 'docs-session')) !== null;

  if (url.pathname === CALLBACK_PATH) {
    // Already signed in (back button, a second tab): the pass isn't needed.
    if (hasSession) return redirect(localPath(url.searchParams.get('next'), url));
    return finishLogin(url, cookies, secret);
  }

  return hasSession ? serveFile() : startLogin(request, url, appUrl);
}

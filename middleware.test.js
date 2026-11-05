import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import middleware from './middleware.js';
import { nowSeconds, signToken } from './docs-token.js';

const SECRET = 'test-secret';
const SITE = 'https://docs.example.com';
const APP = 'https://www.lizt.co';

const page = (path = '/', headers = {}) =>
  new Request(`${SITE}${path}`, { headers: { accept: 'text/html', ...headers } });

const isPassedThrough = (response) => response.headers.get('x-middleware-next') === '1';

const hash = (text) => createHash('sha256').update(text).digest('base64url');

const pass = (claims = {}, secret = SECRET) =>
  signToken({ typ: 'docs-pass', sub: 'account-1', role: 'admin', exp: nowSeconds() + 60, ...claims }, secret);

const sessionCookie = async (claims = {}, secret = SECRET) =>
  `docs_session=${await signToken(
    { typ: 'docs-session', sub: 'account-1', role: 'admin', exp: nowSeconds() + 3600, ...claims },
    secret,
  )}`;

// Starts a login the way a browser would, returning the secret cookie and the hash it sent.
async function startLogin(path = '/features/payments/') {
  const response = await middleware(page(path));
  const target = new URL(response.headers.get('location'));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { response, target, cookie, challenge: target.searchParams.get('challenge') };
}

const callback = (passToken, cookie, next = '/features/payments/') =>
  new Request(`${SITE}/__auth/callback?pass=${passToken}&next=${encodeURIComponent(next)}`, {
    headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
  });

beforeEach(() => {
  process.env.DOCS_ACCESS_SECRET = SECRET;
  process.env.LIZT_APP_URL = APP;
});

describe('without a session', () => {
  it('sends a page load to the app with only a hash of the secret', async () => {
    const { response, target, cookie, challenge } = await startLogin('/features/payments/?x=1');

    assert.equal(response.status, 302);
    assert.equal(target.origin, APP);
    assert.equal(target.pathname, '/docs-access');
    assert.equal(target.searchParams.get('next'), '/features/payments/?x=1');

    const verifier = cookie.split('=')[1];
    assert.equal(hash(verifier), challenge);
    assert.ok(!response.headers.get('location').includes(verifier));
  });

  it('keeps the secret cookie out of scripts and off plain http', async () => {
    const { response } = await startLogin();
    const cookie = response.headers.get('set-cookie');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) {
      assert.ok(cookie.includes(attribute), attribute);
    }
  });

  it('refuses background requests without starting a login', async () => {
    for (const path of ['/pagefind/pagefind.js', '/_astro/site.css', '/sitemap-index.xml']) {
      const response = await middleware(new Request(`${SITE}${path}`, { headers: { accept: '*/*' } }));
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get('set-cookie'), null, path);
    }
  });

  it('refuses a page load that is not GET', async () => {
    const response = await middleware(new Request(`${SITE}/`, { method: 'POST', headers: { accept: 'text/html' } }));
    assert.equal(response.status, 401);
  });
});

describe('finishing a login', () => {
  it('turns a valid pass into a 24-hour cookie and returns to the page', async () => {
    const { cookie, challenge } = await startLogin();

    const response = await middleware(callback(await pass({ challenge }), cookie));

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/features/payments/');
    const session = response.headers.get('set-cookie');
    assert.ok(session.startsWith('docs_session='));
    assert.ok(session.includes('Max-Age=86400') && session.includes('HttpOnly') && session.includes('Secure'));

    const claims = JSON.parse(Buffer.from(session.split('=')[1].split(';')[0].split('.')[1], 'base64url').toString());
    assert.equal(claims.exp, nowSeconds() + 86400);

    const followUp = await middleware(page('/features/payments/', { cookie: session.split(';')[0] }));
    assert.ok(isPassedThrough(followUp));
  });

  it('rejects a stolen pass in a browser without the secret', async () => {
    const { challenge } = await startLogin();
    const response = await middleware(callback(await pass({ challenge })));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  it('rejects a stolen pass in a browser holding a different secret', async () => {
    const victim = await startLogin();
    const attacker = await startLogin();
    const forgedCookie = `${victim.cookie.split('=')[0]}=${attacker.cookie.split('=')[1]}`;

    const response = await middleware(callback(await pass({ challenge: victim.challenge }), forgedCookie));

    assert.equal(response.status, 400);
  });

  it('rejects an expired pass', async () => {
    const { cookie, challenge } = await startLogin();
    const response = await middleware(callback(await pass({ challenge, exp: nowSeconds() - 1 }), cookie));
    assert.equal(response.status, 400);
  });

  it('rejects a pass signed with another key', async () => {
    const { cookie, challenge } = await startLogin();
    const response = await middleware(callback(await pass({ challenge }, 'wrong-secret'), cookie));
    assert.equal(response.status, 400);
  });

  it('rejects an edited pass', async () => {
    const { cookie, challenge } = await startLogin();
    const [header, payload, signature] = (await pass({ challenge, role: 'landlord' })).split('.');
    const edited = Buffer.from(payload, 'base64url').toString().replace('landlord', 'admin');
    const token = `${header}.${Buffer.from(edited).toString('base64url')}.${signature}`;

    const response = await middleware(callback(token, cookie));

    assert.equal(response.status, 400);
  });

  it('rejects an unsigned token claiming alg none', async () => {
    const { cookie, challenge } = await startLogin();
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      typ: 'docs-pass',
      challenge,
      exp: nowSeconds() + 60,
    })}.`;

    const response = await middleware(callback(token, cookie));

    assert.equal(response.status, 400);
  });

  it('rejects a session cookie used as a pass', async () => {
    const { cookie, challenge } = await startLogin();
    const token = (await sessionCookie({ challenge })).split('=')[1];
    const response = await middleware(callback(token, cookie));
    assert.equal(response.status, 400);
  });

  it('rejects a callback with no pass', async () => {
    const response = await middleware(page('/__auth/callback'));
    assert.equal(response.status, 400);
  });

  it('never returns to another site', async () => {
    for (const next of ['https://evil-site.com/', '//evil-site.com/', '/\\evil-site.com/', 'https://']) {
      const { cookie, challenge } = await startLogin();
      const response = await middleware(callback(await pass({ challenge }), cookie, next));
      assert.equal(response.headers.get('location'), '/', next);
    }
  });

  it('lets two tabs log in at once', async () => {
    const first = await startLogin();
    const second = await startLogin();
    const bothCookies = `${first.cookie}; ${second.cookie}`;

    const response = await middleware(callback(await pass({ challenge: first.challenge }), bothCookies));

    assert.equal(response.status, 302);
    assert.ok(response.headers.get('set-cookie').startsWith('docs_session='));
  });

  it('skips the pass when already signed in', async () => {
    const response = await middleware(callback('old-pass', await sessionCookie()));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/features/payments/');
    assert.equal(response.headers.get('set-cookie'), null);
  });
});

describe('with a session cookie', () => {
  it('serves pages, assets and the search index', async () => {
    const cookie = await sessionCookie();
    for (const path of ['/', '/features/payments/', '/_astro/site.css', '/pagefind/pagefind.js']) {
      assert.ok(isPassedThrough(await middleware(page(path, { cookie }))), path);
    }
  });

  it('starts a new login when the cookie is expired, edited, or signed with another key', async () => {
    const valid = await sessionCookie();
    const cookies = [
      await sessionCookie({ exp: nowSeconds() - 1 }),
      await sessionCookie({}, 'wrong-secret'),
      `${valid}x`,
      'docs_session=garbage',
    ];
    for (const cookie of cookies) {
      const response = await middleware(page('/', { cookie }));
      assert.equal(response.status, 302, cookie);
      assert.ok(response.headers.get('location').startsWith(`${APP}/docs-access`), cookie);
    }
  });

  it('rejects a pass used as the cookie', async () => {
    const response = await middleware(page('/', { cookie: `docs_session=${await pass({ challenge: 'x' })}` }));
    assert.equal(response.status, 302);
    assert.ok(response.headers.get('location').startsWith(`${APP}/docs-access`));
  });
});

describe('when settings are missing', () => {
  it('stays locked, even with a valid cookie', async () => {
    const cookie = await sessionCookie();
    for (const name of ['DOCS_ACCESS_SECRET', 'LIZT_APP_URL']) {
      const saved = process.env[name];
      delete process.env[name];
      const response = await middleware(page('/', { cookie }));
      assert.equal(response.status, 503, name);
      assert.ok(!isPassedThrough(response), name);
      process.env[name] = saved;
    }
  });
});

describe('a pass from the Lizt app', () => {
  it('is accepted when signed the way lizt-frontend signs it', async () => {
    const { cookie, challenge } = await startLogin();
    // Same construction as lizt-frontend/src/utils/docs-pass.ts.
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({ sub: 'account-1', role: 'comms_manager', challenge, typ: 'docs-pass', exp: nowSeconds() + 60 });
    const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');

    const response = await middleware(callback(`${header}.${payload}.${signature}`, cookie));

    assert.equal(response.status, 302);
    assert.ok(response.headers.get('set-cookie').startsWith('docs_session='));
  });
});

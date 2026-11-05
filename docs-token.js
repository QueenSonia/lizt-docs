// Signed tokens for the login gate (HS256 JWTs). The Lizt app signs passes with the same
// DOCS_ACCESS_SECRET in lizt-frontend/src/utils/docs-pass.ts; this site signs its own cookie.
const encoder = new TextEncoder();

export const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

// Only this exact header is accepted, so a token can't choose a weaker algorithm.
const HEADER = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

const importKey = (secret) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function signToken(claims, secret) {
  const unsigned = `${HEADER}.${toBase64Url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

// The token's claims, or null unless it's genuine, unexpired and of the expected type.
// The type stops a pass being used as the cookie, or the other way round.
export async function verifyToken(token, secret, type) {
  try {
    const [header, payload, signature, ...extra] = token.split('.');
    if (header !== HEADER || !payload || !signature || extra.length > 0) return null;

    const genuine = await crypto.subtle.verify(
      'HMAC',
      await importKey(secret),
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
    );
    if (!genuine) return null;

    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (claims.typ !== type || typeof claims.exp !== 'number' || claims.exp <= nowSeconds()) return null;
    return claims;
  } catch {
    return null; // missing or malformed
  }
}

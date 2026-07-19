/** 웹훅 서명/시크릿 검증 — 전부 fail-closed: secret 미설정이나 헤더 부재는 무조건 false. */
const te = new TextEncoder();

async function hmacSha256(secret: string, body: string): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(body)));
}

function timingSafeEqual(a: string, b: string): boolean {
    const ab = te.encode(a);
    const bb = te.encode(b);
    if (ab.length !== bb.length) return false;
    let diff = 0;
    for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
    return diff === 0;
}

const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

function toBase64(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

/** Shopify: X-Shopify-Hmac-Sha256 (base64) */
export async function verifyShopifyHmac(
    secret: string | undefined,
    rawBody: string,
    header: string | null,
): Promise<boolean> {
    if (!secret || !header) return false;
    return timingSafeEqual(toBase64(await hmacSha256(secret, rawBody)), header);
}

/** Polar: x-webhook-signature (hex) */
export async function verifyPolarSignature(
    secret: string | undefined,
    rawBody: string,
    signature: string | null,
): Promise<boolean> {
    if (!secret || !signature) return false;
    return timingSafeEqual(toHex(await hmacSha256(secret, rawBody)), signature);
}

/** 정적 헤더 시크릿 (Cafe24 / DB webhook / cron) */
export function verifySharedSecret(expected: string | undefined, provided: string | null): boolean {
    if (!expected || !provided) return false;
    return timingSafeEqual(expected, provided);
}

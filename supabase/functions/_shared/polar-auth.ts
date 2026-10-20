const te = new TextEncoder();
function timingSafeEqual(a: string,b: string): boolean {
 const x=te.encode(a),y=te.encode(b); if(x.length!==y.length)return false;
 let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
function toBase64(bytes: Uint8Array): string {
 let value='';for(const byte of bytes)value+=String.fromCharCode(byte);return btoa(value);
}

/** Standard Webhooks: HMAC of id.timestamp.raw-body, base64-decoded whsec key. */
export async function verifyPolarStandardSignature(
    secret: string | undefined,
    rawBody: string,
    headers: Headers,
    now = Date.now(),
    allowLegacyKey = false,
): Promise<boolean> {
    const id = headers.get('webhook-id');
    const timestamp = headers.get('webhook-timestamp');
    const signatures = headers.get('webhook-signature');
    if (!secret || !id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
    if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
    const keys: Uint8Array<ArrayBuffer>[] = [];
    try {
        let encoded = secret.replace(allowLegacyKey ? /^(whsec_|polar_whs_)/ : /^whsec_/, '');
        if (allowLegacyKey) {
            encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
            encoded += '='.repeat((4 - encoded.length % 4) % 4);
        }
        keys.push(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    } catch {
        // Invalid Standard key must not prevent the explicitly old-slot SDK fallback.
    }
    if (allowLegacyKey) keys.push(te.encode(secret));
    for (const bytes of keys) {
        const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const digest = toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(`${id}.${timestamp}.${rawBody}`))));
        if (signatures.split(/\s+/).some(value => value.startsWith('v1,') && timingSafeEqual(digest, value.slice(3)))) return true;
    }
    return false;
}

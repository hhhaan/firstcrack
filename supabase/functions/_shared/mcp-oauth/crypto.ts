const base64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
export const opaque = (kind: 'at' | 'rt' | 'code') =>
    `fcmcp_${kind}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
export const isOpaque = (token: string, kind: 'at' | 'rt' | 'code') =>
    new RegExp(`^fcmcp_${kind}_[A-Za-z0-9_-]{43}$`).test(token);
export async function digest(value: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function pkce(value: string): Promise<string> {
    return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

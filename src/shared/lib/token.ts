/** URL-safe unguessable token (~22 chars). */
export function generateToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @deprecated Prefer generateToken — cupping-era name kept for call-site clarity. */
export function generateCuppingToken(): string {
    return generateToken();
}

/** URL-safe unguessable token (~22 chars). */
export function generateCuppingToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CUPPING_PORT = 5174;

let cachedLanBase: string | null = null;
let lanBasePromise: Promise<string> | null = null;

function envBase(): string | null {
    const fromEnv = import.meta.env.VITE_CUPPING_PUBLIC_BASE_URL as string | undefined;
    if (fromEnv?.trim()) return fromEnv.replace(/\/$/, '');
    return null;
}

function hostFromWindow(): string | null {
    if (typeof window === 'undefined') return null;
    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
    return host;
}

/** Sync fallback (env → window host → localhost). Prefer resolveCuppingPublicBaseUrl for QR. */
export function cuppingPublicBaseUrl(): string {
    const env = envBase();
    if (env) return env;
    if (cachedLanBase) return cachedLanBase;
    const host = hostFromWindow();
    if (host) return `http://${host}:${CUPPING_PORT}`;
    return `http://localhost:${CUPPING_PORT}`;
}

/** Prefer LAN IP so phones on same Wi‑Fi can open the cupping form. */
export async function resolveCuppingPublicBaseUrl(): Promise<string> {
    const env = envBase();
    if (env) return env;

    if (cachedLanBase) return cachedLanBase;

    const host = hostFromWindow();
    if (host) {
        cachedLanBase = `http://${host}:${CUPPING_PORT}`;
        return cachedLanBase;
    }

    if (!lanBasePromise) {
        lanBasePromise = (async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const ip = await invoke<string | null>('local_lan_ip');
                if (ip?.trim()) {
                    cachedLanBase = `http://${ip.trim()}:${CUPPING_PORT}`;
                    return cachedLanBase;
                }
            } catch {
                // web-only / invoke unavailable
            }
            return `http://localhost:${CUPPING_PORT}`;
        })();
    }
    return lanBasePromise;
}

export function cuppingInviteUrl(token: string, base?: string): string {
    return `${(base ?? cuppingPublicBaseUrl()).replace(/\/$/, '')}/c/${token}`;
}

export async function resolveCuppingInviteUrl(token: string): Promise<string> {
    const base = await resolveCuppingPublicBaseUrl();
    return cuppingInviteUrl(token, base);
}

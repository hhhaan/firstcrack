export { generateCuppingToken, generateToken } from '@shared/lib/token';

/** Cloudflare Pages project for apps/cupping (fc-landing monorepo). */
export const DEFAULT_CUPPING_PUBLIC_BASE = 'https://fc-cupping.pages.dev';

export function cuppingPublicBaseUrl(): string {
    const fromEnv = import.meta.env.VITE_CUPPING_PUBLIC_BASE_URL;
    if (fromEnv?.trim()) return fromEnv.replace(/\/$/, '');
    return DEFAULT_CUPPING_PUBLIC_BASE;
}

export function cuppingInviteUrl(token: string, base?: string): string {
    return `${(base ?? cuppingPublicBaseUrl()).replace(/\/$/, '')}/c/${token}`;
}

/** Alias for call sites that previously resolved LAN IP async. */
export async function resolveCuppingPublicBaseUrl(): Promise<string> {
    return cuppingPublicBaseUrl();
}

export async function resolveCuppingInviteUrl(token: string): Promise<string> {
    return cuppingInviteUrl(token);
}

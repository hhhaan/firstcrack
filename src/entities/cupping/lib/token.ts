export { generateCuppingToken } from '@shared/lib/token';

/** Public cupping web app (custom domain). */
export const DEFAULT_CUPPING_PUBLIC_BASE = 'https://cup.firstcrackiscoming.com';

export function cuppingPublicBaseUrl(): string {
    const fromEnv = import.meta.env.VITE_CUPPING_PUBLIC_BASE_URL;
    if (fromEnv?.trim()) return fromEnv.replace(/\/$/, '');
    return DEFAULT_CUPPING_PUBLIC_BASE;
}

export function cuppingInviteUrl(token: string, base?: string): string {
    return `${(base ?? cuppingPublicBaseUrl()).replace(/\/$/, '')}/c/${token}`;
}

/** Post-session public results (host + cuppers). */
export function cuppingResultsUrl(token: string, base?: string): string {
    return `${(base ?? cuppingPublicBaseUrl()).replace(/\/$/, '')}/r/${token}`;
}

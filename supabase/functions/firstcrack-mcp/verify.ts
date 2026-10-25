import type { VerifiedClaims } from './auth.ts';

type AuthVerifier = {
    getClaims(token: string): Promise<{ data: { claims: VerifiedClaims } | null; error: unknown }>;
    getUser(token: string): Promise<{ data: { user: { id: string; is_anonymous?: boolean } | null }; error: unknown }>;
};

export async function verifySupabaseToken(auth: AuthVerifier, token: string): Promise<VerifiedClaims | null> {
    try {
        // getClaims verifies the signature; getUser also checks the current Auth identity.
        const { data, error } = await auth.getClaims(token);
        if (error || !data?.claims) return null;
        const { data: identity, error: identityError } = await auth.getUser(token);
        if (identityError || !identity.user || identity.user.is_anonymous || identity.user.id !== data.claims.sub) {
            return null;
        }
        return data.claims;
    } catch {
        // Some SDK versions throw plain errors for expired or malformed JWTs.
        return null;
    }
}

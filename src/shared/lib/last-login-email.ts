const STORAGE_KEY = 'fc.lastLoginEmail';

const usableEmail = (email: string): boolean =>
    email.length > 0 && email.length <= 320 && email.includes('@') && !/\s/.test(email);

type StoredEmailLogin = { method: 'email'; email: string };

type RememberedLoginUser = {
    email?: string | null;
    app_metadata?: { provider?: unknown; providers?: unknown } | null;
    identities?: { provider?: string }[] | null;
};

const providersOf = (user: RememberedLoginUser): string[] => {
    const names = new Set<string>();
    const provider = user.app_metadata?.provider;
    if (typeof provider === 'string' && provider.length > 0) names.add(provider);
    const listed = user.app_metadata?.providers;
    if (Array.isArray(listed)) {
        for (const name of listed) {
            if (typeof name === 'string' && name.length > 0) names.add(name);
        }
    }
    for (const identity of user.identities ?? []) {
        if (identity.provider) names.add(identity.provider);
    }
    return [...names];
};

/** Email/password accounts only. Google sign-in must not prefill the form. */
const isEmailPasswordLogin = (user: RememberedLoginUser): boolean => {
    const providers = providersOf(user);
    return providers.includes('email') && !providers.includes('google');
};

const isGoogleLogin = (user: RememberedLoginUser): boolean => providersOf(user).includes('google');

/** Last email/password account on this device. Empty when none has been stored. */
export function readLastLoginEmail(): string {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return '';
        const parsed = JSON.parse(raw) as Partial<StoredEmailLogin>;
        const email = parsed.method === 'email' ? (parsed.email?.trim() ?? '') : '';
        if (usableEmail(email)) return email;
        forgetLastLoginEmail();
        return '';
    } catch {
        // Older builds stored a bare address for every session, including Google.
        forgetLastLoginEmail();
        return '';
    }
}

/** Keep the email of a successful email/password sign-in or sign-up. Logout does not clear it. */
export function rememberLastLoginEmail(email: string | null | undefined): void {
    const trimmed = email?.trim() ?? '';
    if (!usableEmail(trimmed)) return;
    try {
        const stored: StoredEmailLogin = { method: 'email', email: trimmed };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
        /* Storage can be unavailable in private mode. */
    }
}

function forgetLastLoginEmail(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* Storage can be unavailable in private mode. */
    }
}

/** Remember an email/password session. Google sign-in never writes an address. */
export function syncRememberedLoginEmail(user: RememberedLoginUser | null): void {
    if (!user || isGoogleLogin(user)) return;
    if (isEmailPasswordLogin(user)) rememberLastLoginEmail(user.email);
}

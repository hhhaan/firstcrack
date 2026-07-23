import type { Page } from '@playwright/test';
import { authStorageKey, E2E_PROJECT_REF, E2E_USER } from './constants';

/** Seed supabase-js persistSession so auth store sees a logged-in user. */
export async function seedAuthSession(page: Page, projectRef = E2E_PROJECT_REF) {
    const session = {
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: {
            id: E2E_USER.id,
            email: E2E_USER.email,
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            created_at: new Date().toISOString(),
        },
    };

    await page.addInitScript(
        ({ key, value, themeKey }) => {
            localStorage.setItem(key, JSON.stringify(value));
            localStorage.setItem(themeKey, 'light');
            localStorage.setItem('fc.language', 'en');
        },
        { key: authStorageKey(projectRef), value: session, themeKey: 'fc_theme' },
    );
}

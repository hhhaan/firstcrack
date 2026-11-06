// @vitest-environment jsdom
import { act, createElement, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signInWithEmail = vi.fn();
const signUpWithEmail = vi.fn();
const startOAuth = vi.fn();
const cancelOAuth = vi.fn();

vi.mock('@shared/store/auth', () => ({
    useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
        sel({
            signInWithEmail,
            signUpWithEmail,
            startOAuth,
            cancelOAuth,
            oauthError: null,
        }),
}));

vi.mock('@shared/lib/logger', () => ({
    logger: { capture: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

vi.mock('@shared/lib/supabase', () => ({
    supabase: { auth: { signInWithOAuth: vi.fn() } },
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import { useLogin } from './useLogin';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useLogin>;

const Probe = ({ onReady }: { onReady: (hook: Hook) => void }) => {
    const hook = useLogin();
    onReady(hook);
    return null;
};

describe('useLogin signup', () => {
    afterEach(() => {
        signInWithEmail.mockReset();
        signUpWithEmail.mockReset();
        startOAuth.mockReset();
        cancelOAuth.mockReset();
    });

    const mount = async (): Promise<{ hook: () => Hook; unmount: () => void }> => {
        let current: Hook | undefined;
        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => {
            root.render(
                createElement(Probe, {
                    onReady: (h) => {
                        current = h;
                    },
                }),
            );
        });
        return {
            hook: () => {
                if (!current) throw new Error('hook missing');
                return current;
            },
            unmount: () => root.unmount(),
        };
    };

    const submitSignUp = async (
        hook: () => Hook,
        fields: { confirmPassword?: string; agreedToTerms?: boolean } = {},
    ) => {
        await act(async () => {
            hook().setScreen('sign-up');
        });
        await act(async () => {
            hook().setEmail('a@b.com');
            hook().setPassword('password1');
            if (fields.confirmPassword !== undefined) hook().setConfirmPassword(fields.confirmPassword);
            if (fields.agreedToTerms !== undefined) hook().setAgreedToTerms(fields.agreedToTerms);
        });
        await act(async () => {
            await hook().handleSubmit({ preventDefault: () => undefined } as unknown as FormEvent);
        });
    };

    it('does not sign up without terms', async () => {
        const { hook, unmount } = await mount();
        await submitSignUp(hook);
        expect(signUpWithEmail).not.toHaveBeenCalled();
        unmount();
    });

    it('moves to check-inbox when signUp needs email confirm', async () => {
        signUpWithEmail.mockResolvedValue('confirm_email');
        const { hook, unmount } = await mount();
        await submitSignUp(hook, { confirmPassword: 'password1', agreedToTerms: true });
        expect(signUpWithEmail).toHaveBeenCalledWith('a@b.com', 'password1');
        expect(hook().screen).toBe('check-inbox');
        unmount();
    });

    it('does not sign up when passwords differ', async () => {
        const { hook, unmount } = await mount();
        await submitSignUp(hook, { confirmPassword: 'password2', agreedToTerms: true });
        expect(signUpWithEmail).not.toHaveBeenCalled();
        expect(hook().displayError).toBe('password_mismatch');
        unmount();
    });
});

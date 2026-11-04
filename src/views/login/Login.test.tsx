// @vitest-environment jsdom
import { i18n, initI18n } from '@shared/i18n';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

const { signUpWithEmail, settingsSet } = vi.hoisted(() => ({
    signUpWithEmail: vi.fn(),
    settingsSet: vi.fn(),
}));

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: async () => 'ko',
    settingsSet,
}));
vi.mock('@shared/store/auth', () => ({
    useAuthStore: (select: (state: Record<string, unknown>) => unknown) =>
        select({
            signInWithEmail: vi.fn(),
            signUpWithEmail,
            startOAuth: vi.fn(),
            cancelOAuth: vi.fn(),
            oauthError: null,
        }),
}));
vi.mock('@shared/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth: vi.fn() } } }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Login', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
        await initI18n({ persist: false });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<Login />));
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        host?.remove();
        vi.unstubAllGlobals();
    });

    const button = (text: string) => {
        const match = [...host.querySelectorAll('button')].find((node) => node.textContent?.trim() === text);
        if (!match) throw new Error(`Button not found: ${text}`);
        return match;
    };

    const fill = async (id: string, value: string) => {
        const input = host.querySelector<HTMLInputElement>(`#${id}`);
        if (!input) throw new Error(`Input not found: ${id}`);
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    it('switches and persists language before authentication without losing signup input', async () => {
        await act(async () => button('회원가입').click());
        await fill('auth-email', 'roaster@example.com');
        const picker = host.querySelector('[role="combobox"]');
        expect(picker).not.toBeNull();
        Element.prototype.scrollIntoView = () => {};
        await act(async () => picker?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        await act(async () => {
            document.querySelector<HTMLElement>('[role="option"][data-value="en"]')?.click();
        });
        expect(i18n.resolvedLanguage).toBe('en');
        expect(document.documentElement.lang).toBe('en');
        expect(settingsSet).toHaveBeenCalledWith('language', 'en');
        expect(host.querySelector('h1')?.textContent).toBe('Sign up');
        expect(host.querySelector<HTMLLabelElement>('label[for="auth-password"]')?.textContent).toBe('Password');
        expect(host.querySelector<HTMLInputElement>('#auth-email')?.value).toBe('roaster@example.com');
        expect(host.querySelector<HTMLInputElement>('#auth-confirm-password')?.required).toBe(true);
    });

    it('keeps confirmation, consent and email-confirmation navigation working in the new form', async () => {
        signUpWithEmail.mockResolvedValue('confirm_email');
        await act(async () => button('회원가입').click());
        await fill('auth-email', 'roaster@example.com');
        await fill('auth-password', 'password1');
        await fill('auth-confirm-password', 'password2');
        const consent = host.querySelector<HTMLInputElement>('#auth-terms');
        expect(consent?.required).toBe(true);
        await act(async () => consent?.click());
        const submit = async () => {
            await act(async () =>
                host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
            );
        };
        await submit();
        expect(signUpWithEmail).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('비밀번호가 일치하지 않습니다');
        await fill('auth-confirm-password', 'password1');
        await submit();
        expect(signUpWithEmail).toHaveBeenCalledWith('roaster@example.com', 'password1');
        expect(host.querySelector('[role="status"]')?.textContent).toContain('확인 메일');
        expect(host.querySelector('form')).toBeNull();
        await act(async () => button('로그인').click());
        expect(host.querySelector<HTMLInputElement>('#auth-password')?.value).toBe('');
        expect(host.querySelector('#auth-confirm-password')).toBeNull();
    });
});

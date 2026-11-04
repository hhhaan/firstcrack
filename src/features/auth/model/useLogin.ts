import { mapAuthError } from '@features/auth/lib/mapAuthError';
import { logger } from '@shared/lib/logger';
import { supabase } from '@shared/lib/supabase';
import type { AuthErrorCode } from '@shared/store/auth';
import { useAuthStore } from '@shared/store/auth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useState } from 'react';

// fallback은 반드시 Tauri deep-link 스킴(firstcrack://)과 isOAuthCallbackUrl 조건(auth/callback)을
// 동시에 만족해야 함. tauri://localhost/callback 같은 값은 두 조건을 모두 실패시켜 OAuth가 영원히 안 끝남.
const OAUTH_REDIRECT = import.meta.env.PUBLIC_TAURI_REDIRECT ?? 'firstcrack://auth/callback';

export type AuthScreen = 'sign-in' | 'sign-up' | 'check-inbox';

export const useLogin = (onLogin?: () => void) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<AuthErrorCode | null>(null);
    const [screen, setScreenState] = useState<AuthScreen>('sign-in');
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
    const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
    const startOAuth = useAuthStore((s) => s.startOAuth);
    const cancelOAuth = useAuthStore((s) => s.cancelOAuth);
    const oauthError = useAuthStore((s) => s.oauthError);

    const displayError = error ?? oauthError;

    const setScreen = useCallback(
        (next: AuthScreen) => {
            setScreenState(next);
            setError(null);
            cancelOAuth();
            if (next !== 'sign-up') setAgreedToTerms(false);
            if (next !== 'sign-up') setConfirmPassword('');
            if (next === 'check-inbox') setPassword('');
        },
        [cancelOAuth],
    );

    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (screen === 'check-inbox') return;
            setLoading(true);
            setError(null);
            cancelOAuth(); // clear session_replaced / oauth notice
            try {
                const trimmedEmail = email.trim();
                if (screen === 'sign-up') {
                    if (!agreedToTerms) return;
                    if (password.length < 8) {
                        setError('weak_password');
                        return;
                    }
                    if (password !== confirmPassword) {
                        setError('password_mismatch');
                        return;
                    }
                    const result = await signUpWithEmail(trimmedEmail, password);
                    if (result === 'session') onLogin?.();
                    else setScreen('check-inbox');
                    return;
                }
                await signInWithEmail(trimmedEmail, password);
                onLogin?.();
            } catch (err: unknown) {
                logger.capture(err, {
                    scope: screen === 'sign-up' ? 'useLogin.signUpWithEmail' : 'useLogin.signInWithEmail',
                });
                setError(mapAuthError(err));
            } finally {
                setLoading(false);
            }
        },
        [
            screen,
            agreedToTerms,
            email,
            password,
            confirmPassword,
            signInWithEmail,
            signUpWithEmail,
            onLogin,
            cancelOAuth,
            setScreen,
        ],
    );

    const handleGoogleOAuth = useCallback(async () => {
        setError(null);
        startOAuth();
        try {
            const { data, error: oauthStartError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: OAUTH_REDIRECT,
                    ...(import.meta.env.DEV ? {} : { skipBrowserRedirect: true }),
                },
            });
            if (oauthStartError) {
                logger.capture(oauthStartError, { context: 'auth.google.start' });
                cancelOAuth('oauth_failed');
                return;
            }
            if (!data?.url) {
                logger.capture(new Error('OAuth URL missing'), {
                    context: 'auth.google.start',
                });
                cancelOAuth('oauth_failed');
                return;
            }

            if (import.meta.env.DEV) {
                window.location.href = data.url;
            } else {
                await openUrl(data.url);
            }
        } catch (e) {
            logger.capture(e, { context: 'auth.google.start' });
            cancelOAuth('oauth_failed');
        }
    }, [startOAuth, cancelOAuth]);

    return {
        email,
        setEmail,
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        showPassword,
        setShowPassword,
        loading,
        displayError,
        handleSubmit,
        handleGoogleOAuth,
        screen,
        setScreen,
        agreedToTerms,
        setAgreedToTerms,
    };
};

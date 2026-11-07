import { useLogin } from '@features/auth';
import { labelCls, loginInputCls } from '@shared/ui/form-styles';
import { PillButton } from '@shared/ui/PillButton';
import { Spinner } from '@shared/ui/Spinner';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { FORGOT_PASSWORD_URL, PRIVACY_URL, TERMS_URL } from './lib/links';
import { GoogleSignInButton } from './ui/GoogleSignInButton';
import { LoginHeader } from './ui/LoginHeader';
import { PasswordField } from './ui/PasswordField';

const authLinkCls =
    'cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-strong-border underline-offset-3 hover:text-primary focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-50';

interface LoginProps {
    onLogin?: () => void;
}

export const Login = ({ onLogin }: LoginProps) => {
    const { t } = useTranslation();
    const {
        email,
        setEmail,
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        loading,
        displayError,
        handleSubmit,
        handleGoogleOAuth,
        handlePasswordReset,
        screen,
        setScreen,
        agreedToTerms,
        setAgreedToTerms,
    } = useLogin(onLogin);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const isSignUp = screen === 'sign-up';
    const isInbox = screen === 'check-inbox';
    const errorMessage = displayError
        ? t(displayError === 'generic' && isSignUp ? 'auth.errors.genericSignUp' : `auth.errors.${displayError}`)
        : null;
    const passwordError = displayError === 'weak_password' ? errorMessage : null;
    const confirmError = displayError === 'password_mismatch' ? errorMessage : null;
    const formError = passwordError || confirmError ? null : errorMessage;

    useEffect(() => {
        const previous = document.title;
        return () => {
            document.title = previous;
        };
    }, []);

    useEffect(() => {
        const heading = isInbox ? t('auth.checkInboxTitle') : isSignUp ? t('auth.signUpTitle') : t('auth.signInTitle');
        document.title = `${heading} — First Crack`;
    }, [isInbox, isSignUp, t]);

    useEffect(() => {
        if (!displayError) return;
        const fieldId =
            displayError === 'password_mismatch'
                ? 'auth-confirm-password'
                : displayError === 'weak_password'
                  ? 'auth-password'
                  : displayError === 'invalid_credentials' ||
                      displayError === 'email_not_confirmed' ||
                      displayError === 'user_already_registered'
                    ? 'auth-email'
                    : null;
        if (fieldId) document.getElementById(fieldId)?.focus();
    }, [displayError]);

    return (
        <div className="h-dvh overflow-y-auto bg-shell-bg px-2 pb-2">
            <div className="flex min-h-full flex-col rounded-2xl border border-border bg-main-bg shadow-xs">
                <LoginHeader />
                <main className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-8" aria-labelledby="auth-title">
                    <div className="mx-auto w-full max-w-[340px]">
                        <div className="mb-8 text-center">
                            <h1
                                id="auth-title"
                                className="text-center font-(--font-display) text-[32px] font-normal leading-tight tracking-[-0.02em] text-primary"
                            >
                                {isInbox
                                    ? t('auth.checkInboxTitle')
                                    : isSignUp
                                      ? t('auth.signUpTitle')
                                      : t('auth.signInTitle')}
                            </h1>
                        </div>

                        {isInbox ? (
                            <>
                                <p className="mb-6 rounded-xl border border-border bg-surface-elevated px-3 py-3 text-sm leading-relaxed text-secondary">
                                    {t('auth.checkInbox')}
                                </p>
                                <PillButton className="h-[42px] w-full" onClick={() => setScreen('sign-in')}>
                                    {t('auth.signIn')}
                                    <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
                                </PillButton>
                            </>
                        ) : (
                            <>
                                <GoogleSignInButton onClick={() => void handleGoogleOAuth()} disabled={loading} />
                                <div className="my-[22px] flex items-center gap-3.5 text-xs text-muted">
                                    <div className="h-px flex-1 bg-border" />
                                    <span>{t('auth.orContinueWithEmail')}</span>
                                    <div className="h-px flex-1 bg-border" />
                                </div>

                                <form onSubmit={handleSubmit} aria-busy={loading}>
                                    <div className="space-y-[17px]">
                                        <div>
                                            <label htmlFor="auth-email" className={`${labelCls} text-sm`}>
                                                {t('auth.email')}
                                            </label>
                                            <input
                                                id="auth-email"
                                                name="email"
                                                type="email"
                                                value={email}
                                                onChange={(event) => setEmail(event.target.value)}
                                                placeholder={t('auth.emailPlaceholder')}
                                                autoComplete="email"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                required
                                                className={`${loginInputCls} h-[42px]`}
                                            />
                                        </div>
                                        <PasswordField
                                            id="auth-password"
                                            label={t('auth.password')}
                                            value={password}
                                            onChange={setPassword}
                                            visible={showPassword}
                                            onToggleVisibility={() => setShowPassword((visible) => !visible)}
                                            showLabel={t('auth.showPassword')}
                                            hideLabel={t('auth.hidePassword')}
                                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                                            minLength={isSignUp ? 8 : undefined}
                                            disabled={false}
                                            invalid={displayError === 'weak_password'}
                                            hint={isSignUp ? t('auth.newPasswordPlaceholder') : undefined}
                                            hintId="auth-password-hint"
                                            error={passwordError}
                                            errorId="auth-password-error"
                                            labelAction={
                                                !isSignUp && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handlePasswordReset(FORGOT_PASSWORD_URL)}
                                                        disabled={loading}
                                                        className={`${authLinkCls} text-xs text-muted`}
                                                    >
                                                        {t('auth.forgotPassword')}
                                                    </button>
                                                )
                                            }
                                        />
                                        {isSignUp && (
                                            <>
                                                <PasswordField
                                                    id="auth-confirm-password"
                                                    label={t('auth.confirmPassword')}
                                                    value={confirmPassword}
                                                    onChange={setConfirmPassword}
                                                    visible={showConfirmPassword}
                                                    onToggleVisibility={() =>
                                                        setShowConfirmPassword((visible) => !visible)
                                                    }
                                                    showLabel={t('auth.showConfirmPassword')}
                                                    hideLabel={t('auth.hideConfirmPassword')}
                                                    autoComplete="new-password"
                                                    disabled={false}
                                                    invalid={displayError === 'password_mismatch'}
                                                    error={confirmError}
                                                    errorId="auth-confirm-error"
                                                />
                                                <div className="flex items-start gap-2 text-xs leading-relaxed text-secondary">
                                                    <input
                                                        id="auth-terms"
                                                        name="terms"
                                                        type="checkbox"
                                                        checked={agreedToTerms}
                                                        onChange={(event) => setAgreedToTerms(event.target.checked)}
                                                        required
                                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-action focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-secondary"
                                                    />
                                                    <label htmlFor="auth-terms" className="cursor-pointer">
                                                        <Trans
                                                            i18nKey="auth.agreeToTerms"
                                                            components={{
                                                                terms: (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void openUrl(TERMS_URL)}
                                                                        className={authLinkCls}
                                                                    />
                                                                ),
                                                                privacy: (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void openUrl(PRIVACY_URL)}
                                                                        className={authLinkCls}
                                                                    />
                                                                ),
                                                            }}
                                                        />
                                                    </label>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {formError && (
                                        <div
                                            id="auth-form-error"
                                            role="alert"
                                            className="mt-4 rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-xs leading-relaxed text-secondary"
                                        >
                                            {formError}
                                        </div>
                                    )}

                                    <PillButton
                                        type="submit"
                                        aria-disabled={loading || undefined}
                                        className="mt-6 h-[42px] w-full"
                                    >
                                        {loading ? (
                                            <>
                                                <span aria-hidden="true">
                                                    <Spinner />
                                                </span>
                                                {isSignUp ? t('auth.creatingAccount') : t('auth.signingIn')}
                                            </>
                                        ) : (
                                            <>
                                                {isSignUp ? t('auth.createAccount') : t('auth.signIn')}
                                                <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
                                            </>
                                        )}
                                    </PillButton>
                                </form>

                                <p className="mt-6 text-center text-xs leading-relaxed text-muted">
                                    {isSignUp ? t('auth.alreadyHaveAccount') : t('auth.noAccount')}{' '}
                                    <button
                                        type="button"
                                        onClick={() => setScreen(isSignUp ? 'sign-in' : 'sign-up')}
                                        disabled={loading}
                                        className={`${authLinkCls} ml-1 font-[550] text-primary`}
                                    >
                                        {isSignUp ? t('auth.signIn') : t('auth.signUp')}
                                    </button>
                                </p>
                            </>
                        )}
                    </div>
                </main>
                <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 pb-6 text-xs text-muted sm:px-8">
                    <span>{t('auth.copyright')}</span>
                    <button type="button" className={authLinkCls} onClick={() => void openUrl(TERMS_URL)}>
                        {t('auth.terms')}
                    </button>
                    <button type="button" className={authLinkCls} onClick={() => void openUrl(PRIVACY_URL)}>
                        {t('auth.privacy')}
                    </button>
                </footer>
            </div>
        </div>
    );
};

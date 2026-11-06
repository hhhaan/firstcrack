import { useLogin } from '@features/auth';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { PillButton } from '@shared/ui/PillButton';
import { Spinner } from '@shared/ui/Spinner';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowRight } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { FORGOT_PASSWORD_URL, PRIVACY_URL, TERMS_URL } from './lib/links';
import { GoogleSignInButton } from './ui/GoogleSignInButton';
import { LoginHeader } from './ui/LoginHeader';
import { PasswordField } from './ui/PasswordField';

const authLinkCls =
    'cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-strong-border underline-offset-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-strong-border disabled:cursor-not-allowed disabled:opacity-50';

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
    } = useLogin(onLogin);
    const errorMessage = displayError ? t(`auth.errors.${displayError}`) : null;
    const isSignUp = screen === 'sign-up';
    const isInbox = screen === 'check-inbox';
    const togglePasswordVisibility = () => setShowPassword((visible) => !visible);

    return (
        <div className="h-dvh overflow-y-auto bg-shell-bg p-2">
            <div className="flex min-h-full flex-col rounded-2xl border border-border bg-main-bg px-6 pt-4 pb-6 shadow-xs sm:px-8">
                <LoginHeader />
                <main className="flex flex-1 flex-col justify-center py-10" aria-labelledby="auth-title">
                    <div className="mx-auto w-full max-w-[340px]">
                        <div className="mb-8 text-center">
                            <h1
                                id="auth-title"
                                className="text-center font-(--font-display) text-[32px] font-normal leading-tight tracking-[-0.7px] text-primary"
                            >
                                {isInbox
                                    ? t('auth.checkInboxTitle')
                                    : isSignUp
                                      ? t('auth.signUpTitle')
                                      : t('auth.signInTitle')}
                            </h1>
                            {!isSignUp && !isInbox && (
                                <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{t('auth.signInLead')}</p>
                            )}
                        </div>

                        {isInbox ? (
                            <>
                                <p
                                    role="status"
                                    className="mb-6 rounded-xl border border-border bg-surface-elevated px-3 py-3 text-[13px] leading-relaxed text-secondary"
                                >
                                    {t('auth.checkInbox')}
                                </p>
                                <PillButton
                                    className="h-[42px] w-full text-[13px]"
                                    onClick={() => setScreen('sign-in')}
                                >
                                    {t('auth.signIn')}
                                    <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
                                </PillButton>
                            </>
                        ) : (
                            <>
                                <GoogleSignInButton onClick={() => void handleGoogleOAuth()} disabled={loading} />
                                <div className="my-[22px] flex items-center gap-3.5 text-[11px] text-muted">
                                    <div className="h-px flex-1 bg-border" />
                                    <span>{t('auth.orContinueWithEmail')}</span>
                                    <div className="h-px flex-1 bg-border" />
                                </div>

                                <form onSubmit={handleSubmit} aria-busy={loading}>
                                    <div className="space-y-[17px]">
                                        <div>
                                            <label htmlFor="auth-email" className={`${labelCls} text-[13px]`}>
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
                                                disabled={loading}
                                                className={`${inputCls} h-[42px] text-[13px]`}
                                            />
                                        </div>
                                        <PasswordField
                                            id="auth-password"
                                            label={t('auth.password')}
                                            placeholder={t(
                                                isSignUp ? 'auth.newPasswordPlaceholder' : 'auth.passwordPlaceholder',
                                            )}
                                            value={password}
                                            onChange={setPassword}
                                            visible={showPassword}
                                            onToggleVisibility={togglePasswordVisibility}
                                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                                            minLength={isSignUp ? 8 : undefined}
                                            disabled={loading}
                                            labelAction={
                                                !isSignUp && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void openUrl(FORGOT_PASSWORD_URL)}
                                                        className={`${authLinkCls} text-[11px] text-muted`}
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
                                                    placeholder={t('auth.confirmPasswordPlaceholder')}
                                                    value={confirmPassword}
                                                    onChange={setConfirmPassword}
                                                    visible={showPassword}
                                                    onToggleVisibility={togglePasswordVisibility}
                                                    autoComplete="new-password"
                                                    disabled={loading}
                                                />
                                                <div className="flex items-start gap-2 text-[11px] leading-relaxed text-secondary">
                                                    <input
                                                        id="auth-terms"
                                                        name="terms"
                                                        type="checkbox"
                                                        checked={agreedToTerms}
                                                        onChange={(event) => setAgreedToTerms(event.target.checked)}
                                                        required
                                                        disabled={loading}
                                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border"
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

                                    {errorMessage && (
                                        <div
                                            role="alert"
                                            className="mt-4 rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-xs leading-relaxed text-secondary"
                                        >
                                            {errorMessage}
                                        </div>
                                    )}

                                    <PillButton
                                        type="submit"
                                        disabled={loading}
                                        className="mt-6 h-[42px] w-full text-[13px]"
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
                <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] text-muted">
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

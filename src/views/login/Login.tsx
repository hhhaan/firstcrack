import { useLogin } from '@features/auth';
import { Spinner } from '@shared/ui/Spinner';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const BUSINESS_URL = 'https://firstcrackiscoming.com';
const FORGOT_PASSWORD_URL = `${BUSINESS_URL}/forgot-password`;

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
        showPassword,
        setShowPassword,
        loading,
        displayError,
        handleSubmit,
        handleGoogleOAuth,
    } = useLogin(onLogin);
    const errorMessage = displayError ? t(`auth.errors.${displayError}`) : null;

    return (
        <div className="flex h-screen overflow-hidden">
            <div className="relative flex w-[480px] shrink-0 flex-col justify-between overflow-hidden bg-[#171717] px-[52px] py-12">
                <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                        backgroundImage: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
                        backgroundSize: '48px 48px',
                    }}
                />
                <div className="pointer-events-none absolute -bottom-[120px] -left-20 size-[400px] rounded-full bg-[radial-gradient(circle,rgba(78,50,23,0.35)_0%,transparent_70%)]" />

                <div
                    className="relative flex cursor-pointer select-none items-center gap-3"
                    onClick={async () => {
                        if ((window as Window & { __TAURI__?: unknown }).__TAURI__) {
                            const { message } = await import('@tauri-apps/plugin-dialog');
                            await message('First Crack no Football Club');
                        } else {
                            alert('First Crack no Football Club');
                        }
                    }}
                >
                    <span className="font-(--font-display) text-[18px] font-light tracking-[-0.2px] text-white/90">
                        First Crack
                    </span>
                </div>

                <div className="relative">
                    <h2 className="mb-5 font-(--font-display) text-[38px] font-light leading-[1.12] tracking-[-0.8px] text-white/[0.95]">
                        {t('auth.login.brandLine1')}
                        <br />
                        {t('auth.login.brandLine2')}
                    </h2>
                    <p className="mb-10 max-w-80 text-[15px] leading-[1.6] tracking-[0.15px] text-white/45">
                        {t('auth.login.brandSub')}
                    </p>
                </div>

                <div className="relative" />
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto bg-main-bg px-10 py-12">
                <div className="w-full max-w-[380px]">
                    <div className="mb-9">
                        <h1 className="mb-2 font-(--font-display) text-[30px] font-light leading-[1.13] tracking-[-0.4px] text-primary">
                            {t('auth.login.title')}
                        </h1>
                        <p className="text-sm leading-normal tracking-[0.14px] text-secondary">
                            {t('auth.login.welcome')}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            void handleGoogleOAuth();
                        }}
                        className="mb-5 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border-none bg-(--bg-warm) py-[11px] text-sm font-medium tracking-[0.14px] text-primary shadow-[0_4px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.04)] transition-[box-shadow,opacity] duration-150 hover:shadow-[0_6px_20px_rgba(0,0,0,0.1),0_3px_6px_rgba(0,0,0,0.05)]"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        {t('auth.login.continueGoogle')}
                    </button>

                    <div className="mb-5 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border-subtle" />
                        <span className="text-xs tracking-[0.3px] text-muted">{t('auth.login.or')}</span>
                        <div className="h-px flex-1 bg-border-subtle" />
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="mb-3.5">
                            <label
                                htmlFor="login-email"
                                className="mb-1.5 block text-[13px] font-medium tracking-[0.14px] text-secondary"
                            >
                                {t('auth.login.workEmail')}
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('auth.login.emailPlaceholder')}
                                required
                                className="w-full rounded-[10px] border-none bg-surface px-3.5 py-2.5 font-(--font-body) text-sm tracking-[0.14px] text-primary shadow-(--shadow-inset) outline-none transition-shadow focus:shadow-[rgba(0,0,0,0.075)_0_0_0_0.5px_inset,rgba(147,197,253,0.5)_0_0_0_3px]"
                            />
                        </div>

                        <div className="mb-6">
                            <div className="mb-1.5 flex items-center justify-between">
                                <label
                                    htmlFor="login-password"
                                    className="text-[13px] font-medium tracking-[0.14px] text-secondary"
                                >
                                    {t('auth.login.password')}
                                </label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void openUrl(FORGOT_PASSWORD_URL);
                                    }}
                                    className="cursor-pointer border-none bg-transparent p-0 font-(--font-body) text-xs tracking-[0.14px] text-muted"
                                >
                                    {t('auth.login.forgotPassword')}
                                </button>
                            </div>
                            <div className="relative">
                                <input
                                    id="login-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="w-full rounded-[10px] border-none bg-surface py-2.5 pr-10 pl-3.5 font-(--font-body) text-sm tracking-[0.14px] text-primary shadow-(--shadow-inset) outline-none transition-shadow focus:shadow-[rgba(0,0,0,0.075)_0_0_0_0.5px_inset,rgba(147,197,253,0.5)_0_0_0_3px]"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((s) => !s)}
                                    aria-label={
                                        showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')
                                    }
                                    className="absolute top-1/2 right-3 flex -translate-y-1/2 cursor-pointer items-center border-none bg-transparent p-0"
                                >
                                    {showPassword ? (
                                        <EyeOff size={15} strokeWidth={1.5} className="text-muted" />
                                    ) : (
                                        <Eye size={15} strokeWidth={1.5} className="text-muted" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {errorMessage && (
                            <div
                                role="alert"
                                className="mb-3.5 rounded-[10px] bg-[rgba(239,68,68,0.08)] px-3.5 py-2.5 text-[13px] leading-normal tracking-[0.14px] text-[#dc2626]"
                            >
                                {errorMessage}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className={`mb-5 flex w-full items-center justify-center gap-2 rounded-full border-none py-3 text-sm font-medium tracking-[0.14px] text-white shadow-(--shadow-card) transition-[background,opacity] duration-200 ${loading ? 'cursor-not-allowed bg-primary/60' : 'cursor-pointer bg-primary'}`}
                        >
                            {loading ? (
                                <>
                                    <Spinner />
                                    {t('auth.login.signingIn')}
                                </>
                            ) : (
                                <>
                                    {t('auth.login.submit')}
                                    <ArrowRight size={14} strokeWidth={2} />
                                </>
                            )}
                        </button>
                    </form>

                    <p className="text-center text-xs leading-normal tracking-[0.14px] text-muted">
                        {t('auth.login.noAccount')}{' '}
                        <button
                            type="button"
                            onClick={async () => {
                                await openUrl(BUSINESS_URL);
                            }}
                            className="cursor-pointer border-none bg-transparent p-0 font-(--font-body) text-xs font-medium tracking-[0.14px] text-muted underline decoration-border-subtle underline-offset-2"
                        >
                            {t('auth.login.startTrial')}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

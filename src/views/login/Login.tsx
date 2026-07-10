import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { Spinner } from '@shared/ui/Spinner';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

const OAUTH_REDIRECT = import.meta.env.PUBLIC_TAURI_REDIRECT ?? 'firstcrack://auth/callback';
const BUSINESS_URL = 'https://firstcrackiscoming.com';

interface LoginProps {
    onLogin?: () => void;
}

const testimonials = [
    {
        quote: 'First Crack cut our batch logging time in half. The temperature curves alone are worth it.',
        author: 'Mia Tanaka',
        role: 'Head Roaster, Silo Coffee',
    },
    {
        quote: 'Finally a roastery tool built for specialty. The profile library is exactly what we needed.',
        author: 'David Osei',
        role: 'Owner, Kintu Roasters',
    },
    {
        quote: 'The live ROR tracking changed how we approach development time. Incredibly accurate.',
        author: 'Sarah Moreau',
        role: 'Q Grader, Bloom Roastery',
    },
];

export const Login = ({ onLogin }: LoginProps) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
    const startOAuth = useAuthStore((s) => s.startOAuth);
    const cancelOAuth = useAuthStore((s) => s.cancelOAuth);
    const oauthError = useAuthStore((s) => s.oauthError);
    const [testimonial] = useState(() => testimonials[Math.floor(Math.random() * testimonials.length)]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await signInWithEmail(email, password);
            onLogin?.();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Sign in failed. Please check your email and password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            {/* Left panel — brand */}
            <div
                style={{
                    width: 480,
                    flexShrink: 0,
                    background: '#171717',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '48px 52px',
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                {/* Subtle grid texture */}
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundImage: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
                        backgroundSize: '48px 48px',
                        pointerEvents: 'none',
                    }}
                />

                {/* Warm glow */}
                <div
                    style={{
                        position: 'absolute',
                        bottom: -120,
                        left: -80,
                        width: 400,
                        height: 400,
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(78,50,23,0.35) 0%, transparent 70%)',
                        pointerEvents: 'none',
                    }}
                />

                {/* Logo */}
                <div
                    style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        cursor: 'pointer',
                        userSelect: 'none',
                    }}
                    onClick={() => alert('First Crack no Football Club')}
                >
                    <span
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 300,
                            fontSize: 18,
                            color: 'rgba(255,255,255,0.9)',
                            letterSpacing: '-0.2px',
                        }}
                    >
                        First Crack
                    </span>
                </div>

                {/* Center content */}
                <div style={{ position: 'relative' }}>
                    <h2
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 300,
                            fontSize: 38,
                            lineHeight: 1.12,
                            color: 'rgba(255,255,255,0.95)',
                            letterSpacing: '-0.8px',
                            marginBottom: 20,
                        }}
                    >
                        Every roast,
                        <br />
                        perfectly logged.
                    </h2>
                    <p
                        style={{
                            fontSize: 15,
                            lineHeight: 1.6,
                            color: 'rgba(255,255,255,0.45)',
                            letterSpacing: '0.15px',
                            maxWidth: 320,
                            marginBottom: 40,
                        }}
                    >
                        Professional roast tracking, real-time temperature curves, and batch analytics — built for
                        specialty coffee.
                    </p>

                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 32 }}>
                        {[
                            { value: '2,400+', label: 'Roasters' },
                            { value: '1.2M', label: 'Batches logged' },
                            { value: '99.9%', label: 'Uptime' },
                        ].map(({ value, label }) => (
                            <div key={label}>
                                <div
                                    style={{
                                        fontFamily: 'var(--font-body)',
                                        fontSize: 22,
                                        fontWeight: 600,
                                        color: 'rgba(255,255,255,0.9)',
                                        letterSpacing: '-0.5px',
                                        marginBottom: 2,
                                    }}
                                >
                                    {value}
                                </div>
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: 'rgba(255,255,255,0.35)',
                                        letterSpacing: '0.3px',
                                    }}
                                >
                                    {label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Testimonial */}
                <div style={{ position: 'relative' }}>
                    <div
                        style={{
                            borderTop: '1px solid rgba(255,255,255,0.08)',
                            paddingTop: 28,
                        }}
                    >
                        <p
                            style={{
                                fontSize: 14,
                                lineHeight: 1.65,
                                color: 'rgba(255,255,255,0.6)',
                                letterSpacing: '0.15px',
                                fontStyle: 'italic',
                                marginBottom: 14,
                            }}
                        >
                            "{testimonial.quote}"
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: '50%',
                                    background: 'rgba(245,242,239,0.12)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: 'rgba(255,255,255,0.7)',
                                }}
                            >
                                {testimonial.author
                                    .split(' ')
                                    .map((n) => n[0])
                                    .join('')}
                            </div>
                            <div>
                                <div
                                    style={{
                                        fontSize: 13,
                                        fontWeight: 500,
                                        color: 'rgba(255,255,255,0.75)',
                                        letterSpacing: '0.14px',
                                    }}
                                >
                                    {testimonial.author}
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.14px' }}>
                                    {testimonial.role}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right panel — form */}
            <div
                style={{
                    flex: 1,
                    background: 'var(--color-main-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '48px 40px',
                    overflow: 'auto',
                }}
            >
                <div style={{ width: '100%', maxWidth: 380 }}>
                    {/* Header */}
                    <div style={{ marginBottom: 36 }}>
                        <h1
                            style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 300,
                                fontSize: 30,
                                lineHeight: 1.13,
                                color: 'var(--color-primary)',
                                letterSpacing: '-0.4px',
                                marginBottom: 8,
                            }}
                        >
                            Sign in
                        </h1>
                        <p
                            style={{
                                fontSize: 14,
                                color: 'var(--color-secondary)',
                                letterSpacing: '0.14px',
                                lineHeight: 1.5,
                            }}
                        >
                            Welcome back. Enter your details to continue.
                        </p>
                    </div>

                    {/* Google SSO */}
                    <button
                        type="button"
                        onClick={async () => {
                            setError(null);
                            startOAuth();
                            const { data, error } = await supabase.auth.signInWithOAuth({
                                provider: 'google',
                                options: {
                                    redirectTo: OAUTH_REDIRECT,
                                    ...(import.meta.env.DEV ? {} : { skipBrowserRedirect: true }),
                                },
                            });
                            if (error) {
                                cancelOAuth(error.message);
                                return;
                            }
                            if (!data?.url) {
                                cancelOAuth('Could not start Google sign-in.');
                                return;
                            }

                            if (import.meta.env.DEV) {
                                window.location.href = data.url;
                            } else {
                                await openUrl(data.url);
                            }
                        }}
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 10,
                            padding: '11px 0',
                            borderRadius: 9999,
                            border: 'none',
                            background: 'var(--bg-warm)',
                            color: 'var(--color-primary)',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: 'pointer',
                            letterSpacing: '0.14px',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
                            marginBottom: 20,
                            transition: 'box-shadow 0.15s, opacity 0.15s',
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1), 0 3px 6px rgba(0,0,0,0.05)')
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.boxShadow =
                                '0 4px 14px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)')
                        }
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24">
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
                        Continue with Google
                    </button>

                    {/* Divider */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            marginBottom: 20,
                        }}
                    >
                        <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
                        <span style={{ fontSize: 12, color: 'var(--color-muted)', letterSpacing: '0.3px' }}>or</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: 14 }}>
                            <label
                                style={{
                                    display: 'block',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: 'var(--color-secondary)',
                                    letterSpacing: '0.14px',
                                    marginBottom: 6,
                                }}
                            >
                                Work email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="han@allyouneed.com"
                                required
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: 10,
                                    border: 'none',
                                    background: 'var(--color-surface)',
                                    fontSize: 14,
                                    color: 'var(--color-primary)',
                                    fontFamily: 'var(--font-body)',
                                    letterSpacing: '0.14px',
                                    outline: 'none',
                                    boxShadow: 'var(--shadow-inset)',
                                    transition: 'box-shadow 0.15s',
                                }}
                                onFocus={(e) => {
                                    e.target.style.boxShadow =
                                        'rgba(0,0,0,0.075) 0px 0px 0px 0.5px inset, rgba(147,197,253,0.5) 0px 0px 0px 3px';
                                }}
                                onBlur={(e) => {
                                    e.target.style.boxShadow = 'var(--shadow-inset)';
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: 24 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: 6,
                                }}
                            >
                                <label
                                    style={{
                                        fontSize: 13,
                                        fontWeight: 500,
                                        color: 'var(--color-secondary)',
                                        letterSpacing: '0.14px',
                                    }}
                                >
                                    Password
                                </label>
                                <button
                                    type="button"
                                    onClick={() => alert('Password reset coming soon.')}
                                    style={{
                                        fontSize: 12,
                                        color: 'var(--color-muted)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        letterSpacing: '0.14px',
                                        padding: 0,
                                        fontFamily: 'var(--font-body)',
                                    }}
                                >
                                    Forgot password?
                                </button>
                            </div>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    style={{
                                        width: '100%',
                                        padding: '10px 40px 10px 14px',
                                        borderRadius: 10,
                                        border: 'none',
                                        background: 'var(--color-surface)',
                                        fontSize: 14,
                                        color: 'var(--color-primary)',
                                        fontFamily: 'var(--font-body)',
                                        letterSpacing: '0.14px',
                                        outline: 'none',
                                        boxShadow: 'var(--shadow-inset)',
                                        transition: 'box-shadow 0.15s',
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.boxShadow =
                                            'rgba(0,0,0,0.075) 0px 0px 0px 0.5px inset, rgba(147,197,253,0.5) 0px 0px 0px 3px';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.boxShadow = 'var(--shadow-inset)';
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((s) => !s)}
                                    style={{
                                        position: 'absolute',
                                        right: 12,
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                >
                                    {showPassword ? (
                                        <EyeOff size={15} strokeWidth={1.5} color="var(--color-muted)" />
                                    ) : (
                                        <Eye size={15} strokeWidth={1.5} color="var(--color-muted)" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Error message */}
                        {(error || oauthError) && (
                            <div
                                style={{
                                    marginBottom: 14,
                                    padding: '10px 14px',
                                    borderRadius: 10,
                                    background: 'rgba(239,68,68,0.08)',
                                    color: '#dc2626',
                                    fontSize: 13,
                                    letterSpacing: '0.14px',
                                    lineHeight: 1.5,
                                }}
                            >
                                {error ?? oauthError}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                padding: '12px 0',
                                borderRadius: 9999,
                                border: 'none',
                                background: loading ? 'rgba(23,23,23,0.6)' : 'var(--color-primary)',
                                color: 'white',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                letterSpacing: '0.14px',
                                boxShadow: 'var(--shadow-card)',
                                transition: 'background 0.2s, opacity 0.2s',
                                marginBottom: 20,
                            }}
                        >
                            {loading ? (
                                <>
                                    <Spinner />
                                    Signing in...
                                </>
                            ) : (
                                <>
                                    Sign in
                                    <ArrowRight size={14} strokeWidth={2} />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Sign up link */}
                    <p
                        style={{
                            textAlign: 'center',
                            fontSize: 12,
                            color: 'var(--color-muted)',
                            letterSpacing: '0.14px',
                            lineHeight: 1.5,
                        }}
                    >
                        Don't have an account?{' '}
                        <button
                            type="button"
                            onClick={async () => {
                                await openUrl(BUSINESS_URL);
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: 12,
                                fontWeight: 500,
                                color: 'var(--color-muted)',
                                cursor: 'pointer',
                                fontFamily: 'var(--font-body)',
                                letterSpacing: '0.14px',
                                textDecoration: 'underline',
                                textDecorationColor: 'var(--color-border-subtle)',
                                textUnderlineOffset: '2px',
                            }}
                        >
                            Start free trial
                        </button>
                    </p>

                    {/* Trust badges */}
                    <div
                        style={{
                            marginTop: 36,
                            paddingTop: 24,
                            borderTop: '1px solid var(--color-border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 20,
                        }}
                    >
                        {['SOC 2', 'GDPR', 'ISO 27001'].map((badge) => (
                            <div
                                key={badge}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    fontSize: 11,
                                    color: 'var(--color-muted)',
                                    letterSpacing: '0.3px',
                                }}
                            >
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                {badge}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

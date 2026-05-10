import { useEffect, useRef, useState } from 'react';
import { Camera, LogOut } from 'lucide-react';
import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { useProfile, useUpdateProfile } from '../../../entities/profile';

const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
        {children}
    </section>
);

export const AccountSettingsTab = ({ onClose }: { onClose: () => void }) => {
    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');
    const updateProfile = useUpdateProfile(user?.id ?? '');

    const [displayName, setDisplayName] = useState('');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 프로필 로드 완료 시 displayName 초기화
    useEffect(() => {
        if (profile?.display_name) setDisplayName(profile.display_name);
    }, [profile?.display_name]);

    const handleSaveProfile = async () => {
        if (!user) return;
        try {
            await updateProfile.mutateAsync({ display_name: displayName.trim() });
            setSaveStatus('saved');
        } catch {
            setSaveStatus('error');
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
    };

    return (
        <>
            <SectionCard>
                <h4 className="text-base font-semibold text-primary mb-4">Profile</h4>
                <div className="flex items-center gap-4 mb-5">
                    <div className="relative shrink-0">
                        <div className="w-16 h-16 rounded-full bg-surface-warm-solid flex items-center justify-center text-[22px] font-semibold text-primary shadow-inset select-none">
                            {(displayName || user?.email || '').charAt(0).toUpperCase()}
                        </div>
                        <button className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary border-2 border-white flex items-center justify-center cursor-pointer">
                            <Camera size={10} strokeWidth={2} color="white" />
                        </button>
                    </div>
                    <div>
                        <div className="text-[15px] font-medium text-primary">{displayName || '—'}</div>
                        <div className="text-[13px] text-muted mt-0.5">{user?.email || '—'}</div>
                        <span className="inline-block mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(220,252,231,0.8)] text-green-700 tracking-[0.12px] capitalize">
                            {profile?.plan ?? 'free'}
                        </span>
                    </div>
                </div>

                <div className="grid gap-3">
                    <div>
                        <label className="block text-[13px] font-medium text-secondary mb-1.5">Display name</label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your name"
                            className="w-full px-3.5 py-2.5 rounded-[10px] border-none bg-[rgba(255,255,255,0.88)] text-[14px] text-primary font-[inherit] shadow-inset outline-none focus:ring-2 focus:ring-blue-200/50"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-medium text-secondary mb-1.5">Email</label>
                        <input
                            type="email"
                            value={user?.email ?? ''}
                            readOnly
                            className="w-full px-3.5 py-2.5 rounded-[10px] border-none bg-[rgba(0,0,0,0.03)] text-[14px] text-muted font-[inherit] shadow-inset outline-none cursor-default select-none"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3 mt-4">
                    <button
                        onClick={handleSaveProfile}
                        disabled={updateProfile.isPending}
                        className="px-4.5 py-2 rounded-full bg-primary text-white text-[13px] font-semibold border-none cursor-pointer shadow-card disabled:opacity-50"
                    >
                        {updateProfile.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                    {saveStatus === 'saved' && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
                    {saveStatus === 'error' && (
                        <span className="text-[13px] text-red-500 font-medium">Failed to save</span>
                    )}
                </div>
            </SectionCard>

            <SectionCard>
                <h4 className="text-base font-semibold text-primary mb-1">Connected account</h4>
                <div className="flex items-center gap-3 px-3.5 py-3 rounded-[14px] bg-[rgba(255,255,255,0.88)] shadow-inset">
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
                    <span className="text-[13px] text-secondary">Google · {user?.email || '—'}</span>
                </div>
            </SectionCard>

            <SectionCard>
                <h4 className="text-base font-semibold text-primary mb-1">Session</h4>
                <p className="text-[13px] text-secondary mb-4">Sign out of your account on this device.</p>
                <button
                    onClick={() => supabase.auth.signOut().then(() => onClose())}
                    className="flex items-center gap-2 px-4.5 py-2 rounded-full bg-[rgba(254,226,226,0.8)] text-red-600 text-[13px] font-semibold border-none cursor-pointer"
                >
                    <LogOut size={14} strokeWidth={2} />
                    Sign out
                </button>
            </SectionCard>
        </>
    );
};

import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { useProfile, useUpdateProfile } from '../../../entities/profile';
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { useQueryClient } from '@tanstack/react-query';

const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <section className="bg-white border border-[#E5E7EB] rounded-xl p-5">{children}</section>
);

export const AccountSettingsTab = ({ onClose }: { onClose: () => void }) => {
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');
    const updateProfile = useUpdateProfile(user?.id ?? '');

    const [displayName, setDisplayName] = useState('');
    const [location, setLocation] = useState('');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (profile?.display_name) setDisplayName(profile.display_name);
    }, [profile?.display_name]);

    useEffect(() => {
        locationStore.get()
            .then((loc) => { if (loc) setLocation(`${loc.lat}, ${loc.lng}`); })
            .catch((e) => console.error('[settings] failed to load location:', e));
    }, []);

    useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

    const handleSaveProfile = async () => {
        if (!user) return;
        try {
            const coords = parseLocationString(location);
            await Promise.all([
                updateProfile.mutateAsync({ display_name: displayName.trim() }),
                coords ? locationStore.set(coords) : Promise.resolve(),
            ]);
            if (coords) qc.invalidateQueries({ queryKey: ['weather', 'coords'] });
            setSaveStatus('saved');
        } catch (e) {
            console.error('[AccountSettingsTab] save failed:', e);
            setSaveStatus('error');
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
    };

    return (
        <>
            <SectionCard>
                <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-4">Profile</h4>
                <div className="flex items-center gap-4 mb-5">
                    <div className="relative shrink-0">
                        <div className="w-16 h-16 rounded-full bg-[#111827] flex items-center justify-center text-2xl font-semibold text-white select-none">
                            {(displayName || user?.email || '').charAt(0).toUpperCase()}
                        </div>
                    </div>
                    <div>
                        <div className="text-[15px] font-semibold text-[#111827]">{displayName || '—'}</div>
                        <div className="text-[13px] text-[#6B7280] mt-1">{user?.email || '—'}</div>
                        <span className="inline-block mt-2 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280] capitalize">
                            {profile?.plan ?? 'free'}
                        </span>
                    </div>
                </div>

                <div className="grid gap-3">
                    <div>
                        <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Display name</label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your name"
                            className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-[14px] text-[#111827] font-normal outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Email</label>
                        <input
                            type="email"
                            value={user?.email ?? ''}
                            readOnly
                            className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-[14px] text-[#9CA3AF] font-normal outline-none cursor-default select-none"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                            Location
                            <button
                                type="button"
                                onClick={() => openUrl('https://maps.google.com')}
                                className="ml-1.5 text-[11px] font-normal text-[#6B7280] underline underline-offset-2 hover:text-[#111827] transition-colors cursor-pointer"
                            >
                                Google Maps에서 복사
                            </button>
                        </label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="36.632661, 127.464867"
                            className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-[14px] text-[#111827] font-normal outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-colors"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3 mt-4">
                    <button
                        onClick={handleSaveProfile}
                        disabled={updateProfile.isPending}
                        className="px-4.5 py-2 rounded-lg bg-[#111827] text-white text-[13px] font-semibold border hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-all"
                    >
                        {updateProfile.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                    {saveStatus === 'saved' && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
                    {saveStatus === 'error' && (
                        <span className="text-[13px] text-red-600 font-medium">Failed to save</span>
                    )}
                </div>
            </SectionCard>

            <SectionCard>
                <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-3">Connected account</h4>
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white">
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
                    <span className="text-[13px] text-[#374151]">Google · {user?.email || '—'}</span>
                </div>
            </SectionCard>

            <SectionCard>
                <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-1">Session</h4>
                <p className="text-[13px] text-[#6B7280] m-0 mb-4">Sign out of your account on this device.</p>
                <button
                    onClick={() => supabase.auth.signOut().then(() => onClose())}
                    className="flex items-center gap-2 px-4.5 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[13px] font-semibold hover:bg-red-100 active:bg-red-200 transition-all"
                >
                    <LogOut size={14} strokeWidth={2} />
                    Sign out
                </button>
            </SectionCard>
        </>
    );
};

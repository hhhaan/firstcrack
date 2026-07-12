import { useProfile, useUpdateProfile } from '@entities/profile';
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { logger } from '@shared/lib/logger';
import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { Badge } from '@shared/ui/Badge';
import { SectionCard } from '@shared/ui/SectionCard';
import { useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Link, LogOut, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow } from './SettingsOptionRow';

type AccountSettingsTabProps = {
    onClose: () => void;
};

const inputCls =
    'w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#262b31] text-[14px] text-[#111827] dark:text-[#e5e5e5] font-normal outline-none focus:border-[#111827] dark:focus:border-[#666] focus:ring-1 focus:ring-[#111827] dark:focus:ring-[#666] transition-colors placeholder:text-[#9CA3AF] dark:placeholder:text-[#666]';

const readonlyInputCls =
    'w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262b31] text-[14px] text-[#9CA3AF] dark:text-[#666] font-normal outline-none cursor-default select-none';

const primaryBtnCls =
    'px-4 py-2.5 rounded-lg bg-[#111827] dark:bg-[#e5e5e5] text-white dark:text-[#111827] text-[13px] font-semibold border hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-all cursor-pointer';

type InputFieldProps = {
    label: string;
    value: string;
    onValueChange?: (value: string) => void;
    readOnly?: boolean;
    type?: string;
    placeholder?: string;
    right?: React.ReactNode;
};

function InputField({
    label,
    value,
    onValueChange,
    readOnly = false,
    type = 'text',
    placeholder,
    right,
}: InputFieldProps) {
    return (
        <div>
            <label className="block text-[13px] font-medium text-[#374151] dark:text-[#ccc] mb-1.5">
                {label}
                {right}
            </label>
            <input
                type={type}
                value={value}
                readOnly={readOnly}
                placeholder={placeholder}
                onChange={onValueChange ? (e) => onValueChange(e.target.value) : undefined}
                className={readOnly ? readonlyInputCls : inputCls}
            />
        </div>
    );
}

function GoogleIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
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
    );
}

export function AccountSettingsTab({ onClose }: AccountSettingsTabProps) {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.account.${key}`);
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');
    const updateProfile = useUpdateProfile(user?.id ?? '');

    const [displayName, setDisplayName] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [businessRegNumber, setBusinessRegNumber] = useState('');
    const [location, setLocation] = useState('');
    const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!profile) return;
        if (profile.display_name) setDisplayName(profile.display_name);
        if (profile.business_name) setBusinessName(profile.business_name);
        if (profile.business_registration_number) setBusinessRegNumber(profile.business_registration_number);
    }, [profile]);

    useEffect(() => {
        locationStore
            .get()
            .then((loc) => {
                if (loc) setLocation(`${loc.lat}, ${loc.lng}`);
            })
            .catch((e) => logger.capture(e, { context: 'settings load location' }));
    }, []);

    useEffect(
        () => () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        },
        [],
    );

    const handleSaveProfile = async () => {
        if (!user) return;
        try {
            const coords = parseLocationString(location);
            await Promise.all([
                updateProfile.mutateAsync({
                    display_name: displayName.trim(),
                    business_name: businessName.trim() || null,
                    business_registration_number: businessRegNumber.trim() || null,
                }),
                coords ? locationStore.set(coords) : Promise.resolve(),
            ]);
            if (coords) qc.invalidateQueries({ queryKey: ['weather', 'coords'] });
            setProfileSaveStatus('saved');
        } catch (e) {
            logger.capture(e, { context: 'settings save profile' });
            setProfileSaveStatus('error');
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => setProfileSaveStatus('idle'), 2500);
    };

    const avatarInitial = (displayName || user?.email || '').charAt(0).toUpperCase();
    const empty = '—';

    return (
        <div className="grid gap-4">
            <SectionCard>
                <SectionCard.Header title={tk('profile')} />
                <SectionCard.Body className="flex flex-col gap-5">
                    <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                            <div className="w-16 h-16 rounded-full bg-[#111827] dark:bg-[#262B31] flex items-center justify-center text-2xl font-semibold text-white select-none">
                                {avatarInitial}
                            </div>
                        </div>
                        <div>
                            <div className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5]">
                                {displayName || empty}
                            </div>
                            <div className="text-[13px] text-[#6B7280] dark:text-[#999] mt-1">
                                {user?.email || empty}
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-3">
                        <InputField
                            label={tk('displayName')}
                            value={displayName}
                            onValueChange={setDisplayName}
                            placeholder={tk('displayNamePlaceholder')}
                        />
                        <InputField
                            label={tk('businessName')}
                            value={businessName}
                            onValueChange={setBusinessName}
                            placeholder={tk('businessNamePlaceholder')}
                        />
                        <InputField
                            label={tk('businessRegNumber')}
                            value={businessRegNumber}
                            onValueChange={setBusinessRegNumber}
                            placeholder={tk('businessRegNumberPlaceholder')}
                        />
                        <InputField label={tk('email')} value={user?.email ?? ''} readOnly type="email" />
                        <InputField
                            label={tk('location')}
                            value={location}
                            onValueChange={setLocation}
                            placeholder={tk('locationPlaceholder')}
                            right={
                                <button
                                    type="button"
                                    onClick={() => openUrl('https://maps.google.com')}
                                    className="ml-1.5 text-[11px] font-normal text-[#6B7280] dark:text-[#999] underline underline-offset-2 hover:text-[#111827] dark:hover:text-[#e5e5e5] transition-colors cursor-pointer"
                                >
                                    {tk('copyFromGoogleMaps')}
                                </button>
                            }
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={handleSaveProfile}
                            disabled={updateProfile.isPending}
                            className={primaryBtnCls}
                        >
                            {updateProfile.isPending ? tk('saving') : tk('saveChanges')}
                        </button>
                        {profileSaveStatus === 'saved' && (
                            <span className="text-[13px] text-green-600 dark:text-green-400 font-medium">
                                {tk('saved')}
                            </span>
                        )}
                        {profileSaveStatus === 'error' && (
                            <span className="text-[13px] text-red-600 dark:text-red-400 font-medium">
                                {tk('saveFailed')}
                            </span>
                        )}
                    </div>
                </SectionCard.Body>
            </SectionCard>

            {user && (
                <SectionCard>
                    <SectionCard.Header
                        title={tk('connectedAccount')}
                        description={tk('connectedAccountDescription')}
                    />
                    <SectionCard.Body>
                        <SettingsOptionRow className="dark:bg-[#262B31]">
                            <div className="w-8 h-8 rounded-full bg-[#111827] dark:bg-[#181d21] flex items-center justify-center text-sm font-semibold text-white shrink-0">
                                {(profile?.display_name || user.email || '').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium text-[#111827] dark:text-[#e5e5e5]">
                                    {profile?.business_name || profile?.display_name || tk('userFallback')}
                                </div>
                                <div className="text-[12px] text-[#6B7280] dark:text-[#999] truncate">{user.email}</div>
                            </div>
                            <div className="flex items-center gap-1.5 text-[12px] text-green-600 dark:text-green-400 font-medium shrink-0">
                                <GoogleIcon />
                                <Link size={13} strokeWidth={2} />
                                {tk('connected')}
                            </div>
                        </SettingsOptionRow>
                    </SectionCard.Body>
                </SectionCard>
            )}

            <SectionCard>
                <SectionCard.Header title={tk('teamWorkspace')} description={tk('teamWorkspaceDescription')} />
                <SectionCard.Body>
                    <button
                        type="button"
                        disabled
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262B31] text-[13px] font-medium text-[#9CA3AF] dark:text-[#666] cursor-not-allowed"
                    >
                        <User size={14} strokeWidth={2} />
                        {tk('inviteMembers')}
                        <Badge size="sm" tone="lavenderSoft" className="ml-auto font-semibold">
                            {tk('comingSoon')}
                        </Badge>
                    </button>
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('session')} description={tk('sessionDescription')} />
                <SectionCard.Body>
                    <button
                        type="button"
                        onClick={() => supabase.auth.signOut().then(() => onClose())}
                        className="flex items-center gap-2 px-4.5 py-2.5 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-[13px] font-semibold hover:bg-red-100 dark:hover:bg-red-500/15 active:bg-red-200 dark:active:bg-red-500/20 transition-all"
                    >
                        <LogOut size={14} strokeWidth={2} />
                        {tk('signOut')}
                    </button>
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
}

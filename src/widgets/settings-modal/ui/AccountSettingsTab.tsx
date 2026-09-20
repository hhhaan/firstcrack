import { normalizeDisplayName, useProfile, useUpdateProfile } from '@entities/profile';
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { logger } from '@shared/lib/logger';
import { weatherKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { formErrorCls } from '@shared/ui/form-styles';
import { SectionCard } from '@shared/ui/SectionCard';
import { useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AccountSettingsTabProps = {
    onClose: () => void;
};

const inputCls =
    'w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#262b31] text-[14px] text-[#111827] dark:text-[#e5e5e5] font-normal outline-none focus:border-[#111827] dark:focus:border-[#666] focus:ring-1 focus:ring-[#111827] dark:focus:ring-[#666] transition-colors placeholder:text-[#9CA3AF] dark:placeholder:text-[#666]';

const readonlyInputCls =
    'w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262b31] text-[14px] text-[#9CA3AF] dark:text-[#666] font-normal outline-none cursor-default select-none';

const primaryBtnCls =
    'px-4 py-2.5 rounded-lg bg-[#111827] dark:bg-[#e5e5e5] text-white dark:text-[#111827] text-[13px] font-semibold border hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity cursor-pointer';

type InputFieldProps = {
    label: string;
    value: string;
    onValueChange?: (value: string) => void;
    readOnly?: boolean;
    type?: string;
    placeholder?: string;
    right?: React.ReactNode;
    error?: string;
    required?: boolean;
};

function InputField({
    label,
    value,
    onValueChange,
    readOnly = false,
    type = 'text',
    placeholder,
    right,
    error,
    required,
}: InputFieldProps) {
    const errorId = useId();
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
                required={required}
                placeholder={placeholder}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={onValueChange ? (e) => onValueChange(e.target.value) : undefined}
                className={
                    readOnly ? readonlyInputCls : error ? `${inputCls} border-red-500 dark:border-red-500` : inputCls
                }
            />
            {error ? (
                <p id={errorId} className={formErrorCls}>
                    {error}
                </p>
            ) : null}
        </div>
    );
}

export function AccountSettingsTab({ onClose }: AccountSettingsTabProps) {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.account.${key}`);
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const signOut = useAuthStore((s) => s.signOut);
    const { data: profile } = useProfile(user?.id ?? '');
    const updateProfile = useUpdateProfile(user?.id ?? '');

    const [displayName, setDisplayName] = useState('');
    const [displayNameTouched, setDisplayNameTouched] = useState(false);
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

    const trimmedDisplayName = normalizeDisplayName(displayName);
    const storedDisplayName = normalizeDisplayName(profile?.display_name ?? '');
    const displayNameError =
        !trimmedDisplayName && (displayNameTouched || (profile !== undefined && !storedDisplayName))
            ? tk('displayNameRequired')
            : undefined;

    const handleSaveProfile = async () => {
        if (!user || !trimmedDisplayName) return;
        try {
            const coords = parseLocationString(location);
            await Promise.all([
                updateProfile.mutateAsync({
                    display_name: trimmedDisplayName,
                    business_name: businessName.trim() || null,
                    business_registration_number: businessRegNumber.trim() || null,
                }),
                coords ? locationStore.set(coords) : Promise.resolve(),
            ]);
            if (coords) void qc.invalidateQueries({ queryKey: weatherKeys.coords });
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
                            onValueChange={(value) => {
                                setDisplayNameTouched(true);
                                setDisplayName(value);
                            }}
                            placeholder={tk('displayNamePlaceholder')}
                            required
                            error={displayNameError}
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
                            disabled={updateProfile.isPending || !trimmedDisplayName}
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

            <SectionCard>
                <SectionCard.Header title={tk('session')} description={tk('sessionDescription')} />
                <SectionCard.Body>
                    <button
                        type="button"
                        onClick={() => {
                            void signOut().then(() => onClose());
                        }}
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

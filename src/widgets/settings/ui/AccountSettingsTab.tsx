import { normalizeDisplayName, useProfile, useUpdateProfile } from '@entities/profile';
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { logger } from '@shared/lib/logger';
import { weatherKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { formErrorCls } from '@shared/ui/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AccountSettingsTabProps = {
    onClose: () => void;
};

const pillBtnCls =
    'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent px-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

const valueCls =
    'w-full min-w-0 border-none bg-transparent p-0 text-[15px] leading-6 text-primary outline-none placeholder:text-muted';

function FieldRow({
    label,
    htmlFor,
    children,
    trailing,
}: {
    label: string;
    htmlFor: string;
    children: ReactNode;
    trailing?: ReactNode;
}) {
    return (
        <div className="grid grid-cols-1 items-center gap-1 border-b border-border-subtle py-3.5 @[36rem]:col-span-2 @[36rem]:grid-cols-subgrid @[36rem]:gap-x-10">
            <label htmlFor={htmlFor} className="text-[13px] whitespace-nowrap text-muted">
                {label}
            </label>
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">{children}</div>
                {trailing}
            </div>
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

    const empty = '—';

    return (
        <div>
            <section data-settings-section>
                <FieldRow label={tk('displayName')} htmlFor="account-display-name">
                    <input
                        id="account-display-name"
                        value={displayName}
                        required
                        placeholder={tk('displayNamePlaceholder')}
                        aria-invalid={Boolean(displayNameError)}
                        aria-describedby={displayNameError ? 'account-display-name-error' : undefined}
                        onChange={(event) => {
                            setDisplayNameTouched(true);
                            setDisplayName(event.target.value);
                        }}
                        className={valueCls}
                    />
                    {displayNameError ? (
                        <p id="account-display-name-error" className={formErrorCls}>
                            {displayNameError}
                        </p>
                    ) : null}
                </FieldRow>
                <FieldRow label={tk('businessName')} htmlFor="account-business-name">
                    <input
                        id="account-business-name"
                        value={businessName}
                        placeholder={tk('businessNamePlaceholder')}
                        onChange={(event) => setBusinessName(event.target.value)}
                        className={valueCls}
                    />
                </FieldRow>
                <FieldRow label={tk('businessRegNumber')} htmlFor="account-business-reg">
                    <input
                        id="account-business-reg"
                        value={businessRegNumber}
                        inputMode="numeric"
                        placeholder={tk('businessRegNumberPlaceholder')}
                        onChange={(event) => setBusinessRegNumber(event.target.value)}
                        className={`${valueCls} tabular-nums tracking-[0.02em]`}
                    />
                </FieldRow>
                <FieldRow label={tk('email')} htmlFor="account-email">
                    <p id="account-email" className="m-0 truncate text-[15px] leading-6 text-secondary">
                        {user?.email || empty}
                    </p>
                </FieldRow>
                <FieldRow
                    label={tk('location')}
                    htmlFor="account-location"
                    trailing={
                        <button type="button" onClick={() => openUrl('https://maps.google.com')} className={pillBtnCls}>
                            {tk('copyFromGoogleMaps')}
                        </button>
                    }
                >
                    <input
                        id="account-location"
                        value={location}
                        placeholder={tk('locationPlaceholder')}
                        onChange={(event) => setLocation(event.target.value)}
                        className={`${valueCls} tabular-nums`}
                    />
                </FieldRow>
                <div className="flex items-center justify-end gap-3 pt-4">
                    {profileSaveStatus === 'saved' && (
                        <span className="text-[13px] font-medium text-green-600 dark:text-green-400">
                            {tk('saved')}
                        </span>
                    )}
                    {profileSaveStatus === 'error' && (
                        <span className="text-[13px] font-medium text-red-600 dark:text-red-400">
                            {tk('saveFailed')}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handleSaveProfile}
                        disabled={updateProfile.isPending || !trimmedDisplayName}
                        className={pillBtnCls}
                    >
                        {updateProfile.isPending ? tk('saving') : tk('saveChanges')}
                    </button>
                </div>
            </section>

            <section data-settings-section className="mt-8 border-t border-border-subtle pt-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[13px] text-primary">{tk('session')}</div>
                        <div className="mt-0.5 text-[12px] text-muted">{tk('sessionDescription')}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void signOut().then(() => onClose());
                        }}
                        className={`${pillBtnCls} text-red-600 dark:text-red-400`}
                    >
                        {tk('signOut')}
                    </button>
                </div>
            </section>
        </div>
    );
}

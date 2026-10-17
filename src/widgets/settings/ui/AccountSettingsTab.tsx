import { normalizeDisplayName, useProfile, useUpdateProfile } from '@entities/profile';
import { cn } from '@shared/lib/cn';
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { logger } from '@shared/lib/logger';
import { weatherKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { formErrorCls, inputCls } from '@shared/ui/form-styles';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, LogOut, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsRow, SettingsSection } from './SettingsSection';

type AccountSettingsTabProps = {
    onClose: () => void;
};

const pillBtnCls =
    'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent px-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

const valueCls = cn(
    inputCls,
    'min-w-0 rounded-lg py-2 text-[13px] leading-5 placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
);

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
        <SettingsRow label={label} controlId={htmlFor}>
            <div className="flex w-full min-w-0 flex-col gap-2 @[480px]:w-80">
                {children}
                {trailing}
            </div>
        </SettingsRow>
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
    const dirtyRef = useRef({ displayName: false, businessName: false, businessRegNumber: false, location: false });
    const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!profile) return;
        if (!dirtyRef.current.displayName) setDisplayName(profile.display_name ?? '');
        if (!dirtyRef.current.businessName) setBusinessName(profile.business_name ?? '');
        if (!dirtyRef.current.businessRegNumber) setBusinessRegNumber(profile.business_registration_number ?? '');
    }, [profile]);

    useEffect(() => {
        let cancelled = false;
        locationStore
            .get()
            .then((loc) => {
                if (!cancelled && !dirtyRef.current.location && loc) setLocation(`${loc.lat}, ${loc.lng}`);
            })
            .catch((e) => logger.capture(e, { context: 'settings load location' }));
        return () => {
            cancelled = true;
        };
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
        <div className="grid gap-6">
            <SettingsSection>
                <SettingsSection.Header icon={<UserRound size={16} strokeWidth={1.8} />} title={tk('profile')} />
                <SettingsSection.Body className="divide-y divide-border-subtle p-0">
                    <FieldRow label={tk('displayName')} htmlFor="account-display-name">
                        <input
                            id="account-display-name"
                            value={displayName}
                            required
                            placeholder={tk('displayNamePlaceholder')}
                            aria-invalid={Boolean(displayNameError)}
                            aria-describedby={displayNameError ? 'account-display-name-error' : undefined}
                            onChange={(event) => {
                                dirtyRef.current.displayName = true;
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
                            onChange={(event) => {
                                dirtyRef.current.businessName = true;
                                setBusinessName(event.target.value);
                            }}
                            className={valueCls}
                        />
                    </FieldRow>
                    <FieldRow label={tk('businessRegNumber')} htmlFor="account-business-reg">
                        <input
                            id="account-business-reg"
                            value={businessRegNumber}
                            inputMode="numeric"
                            placeholder={tk('businessRegNumberPlaceholder')}
                            onChange={(event) => {
                                dirtyRef.current.businessRegNumber = true;
                                setBusinessRegNumber(event.target.value);
                            }}
                            className={`${valueCls} tabular-nums tracking-[0.02em]`}
                        />
                    </FieldRow>
                    <FieldRow label={tk('email')} htmlFor="account-email">
                        <input
                            id="account-email"
                            value={user?.email || empty}
                            readOnly
                            className={cn(valueCls, 'border-border-subtle bg-surface/50 text-secondary shadow-none')}
                        />
                    </FieldRow>
                    <FieldRow
                        label={tk('location')}
                        htmlFor="account-location"
                        trailing={
                            <SurfaceButton
                                onClick={() => openUrl('https://maps.google.com')}
                                icon={<ExternalLink size={13} aria-hidden />}
                                className="max-w-full self-start text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                {tk('copyFromGoogleMaps')}
                            </SurfaceButton>
                        }
                    >
                        <input
                            id="account-location"
                            value={location}
                            placeholder={tk('locationPlaceholder')}
                            onChange={(event) => {
                                dirtyRef.current.location = true;
                                setLocation(event.target.value);
                            }}
                            className={`${valueCls} tabular-nums`}
                        />
                    </FieldRow>
                    <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
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
                        <PillButton
                            type="button"
                            onClick={handleSaveProfile}
                            disabled={updateProfile.isPending || !trimmedDisplayName}
                            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {updateProfile.isPending ? tk('saving') : tk('saveChanges')}
                        </PillButton>
                    </div>
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection>
                <SettingsSection.Header
                    icon={<LogOut size={16} strokeWidth={1.8} />}
                    title={tk('session')}
                    description={tk('sessionDescription')}
                />
                <SettingsSection.Body>
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="m-0 truncate text-[13px] text-secondary">{user?.email || empty}</p>
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
                </SettingsSection.Body>
            </SettingsSection>
        </div>
    );
}

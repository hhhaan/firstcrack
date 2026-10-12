import { useActiveWorkspace } from '@entities/organization';
import { useProfile, useUpdateProfile } from '@entities/profile';
import {
    type RoastProfileWithSource,
    resolveSourceSession,
    roastProfileCopyInsert,
    useCreateRoastProfile,
    useDeleteRoastProfile,
    useRoastProfileCurve,
    useRoastProfiles,
    useUpdateRoastProfile,
} from '@entities/roast-profile';
import { formatTemp, useRoastSettings } from '@features/active-roast';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import { formatDuration } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import { useToastStore } from '@shared/store/toast';
import type { RoastProfile } from '@shared/types/database.types';
import type { View } from '@shared/types/view';
import { CatalogVisibilityButton, CatalogVisibilityFilter } from '@shared/ui/CatalogVisibilityControls';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { Skeleton } from '@shared/ui/Skeleton';
import { Sparkline } from '@shared/ui/Sparkline';
import { NewProfileModal } from '@widgets/new-profile-modal';
import { ProfileCompare } from '@widgets/profile-compare/ui/ProfileCompare';
import { ProfileDetail } from '@widgets/profile-detail/ui/ProfileDetail';
import { Check, GitCompare, Plus, Search, Star } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PROFILE_SKELETON_COUNT = 5;

const ProfileCardSkeleton = () => (
    <div className="rounded-lg border border-[#E5E5E5] bg-main-bg px-4 pt-4 pb-2 dark:border-[#585d61]">
        <Skeleton width="100%" height={44} borderRadius="6px" />
        <div className="mt-3 flex flex-col gap-1.5">
            <Skeleton width={132} height={13} borderRadius="4px" />
            <Skeleton width={96} height={12} borderRadius="4px" />
        </div>
    </div>
);

const ProfileListSkeleton = ({ label }: { label: string }) => (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label={label}>
        {Array.from({ length: PROFILE_SKELETON_COUNT }, (_, i) => (
            <ProfileCardSkeleton key={i} />
        ))}
    </div>
);

const ProfileDetailSkeleton = () => (
    <div aria-hidden className="min-w-0 rounded-lg bg-main-bg px-8 py-7 dark:border dark:border-[#585d61]">
        <div className="mb-5 flex items-start justify-between gap-3">
            <Skeleton width={220} height={28} borderRadius="6px" />
            <div className="flex shrink-0 gap-1.5">
                <Skeleton width={72} height={32} borderRadius="9999px" />
                <Skeleton width={32} height={32} borderRadius="8px" />
                <Skeleton width={32} height={32} borderRadius="8px" />
            </div>
        </div>
        <div className="mb-5">
            <Skeleton width={96} height={12} borderRadius="4px" />
            <div className="mt-2">
                <Skeleton width="100%" height={160} borderRadius="8px" />
            </div>
        </div>
        <div className="mb-5 grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} width="100%" height={58} borderRadius="8px" />
            ))}
        </div>
        <div className="flex gap-2.5">
            <Skeleton className="flex-1" height={40} borderRadius="9999px" />
            <Skeleton width={96} height={40} borderRadius="9999px" />
        </div>
    </div>
);

const COMPARE_COLORS = [
    'var(--color-palette-blue)',
    'var(--color-palette-indigo)',
    'var(--color-palette-yellow)',
    'var(--color-palette-teal)',
] as const;

interface ProfilesProps {
    onNavigate: (view: View) => void;
}

export const Profiles = ({ onNavigate }: ProfilesProps) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: profiles = [], isLoading, isError } = useRoastProfiles(workspaceOwnerId);
    const listFailed = isError && !isLoading && profiles.length === 0;
    const { mutateAsync: createProfile } = useCreateRoastProfile(workspaceOwnerId);
    const { mutate: deleteProfile } = useDeleteRoastProfile(workspaceOwnerId);
    const { mutateAsync: updateRoastProfile } = useUpdateRoastProfile(workspaceOwnerId);
    const { data: userProfile } = useProfile(user?.id ?? '');
    const { mutate: updateProfile } = useUpdateProfile(user?.id ?? '');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [defaultId, setDefaultId] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState(false);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [showNewModal, setShowNewModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [search, setSearch] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const { hidden, setHidden } = useCatalogVisibility(user?.id ?? '', workspaceOwnerId, 'profiles');

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (profiles.length > 0 && !selectedId) {
            setSelectedId(profiles[0].id);
        }
    }, [profiles.length, selectedId]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (userProfile !== undefined) {
            setDefaultId(userProfile?.default_roast_profile_id ?? null);
        }
    }, [userProfile?.default_roast_profile_id]);

    const sortedProfiles = useMemo(() => {
        const q = search.trim().toLowerCase();
        const filtered = q
            ? profiles.filter((p) => {
                  const haystack = [p.name, p.target_level, p.default_bean?.name, p.default_blend?.name]
                      .filter(Boolean)
                      .join(' ')
                      .toLowerCase();
                  return haystack.includes(q);
              })
            : profiles;
        return filtered
            .filter((profile) => showHidden || !hidden.has(profile.id))
            .sort((a, b) => {
                if (!defaultId) return 0;
                if (a.id === defaultId) return -1;
                if (b.id === defaultId) return 1;
                return 0;
            });
    }, [profiles, search, defaultId, hidden, showHidden]);

    const selected = sortedProfiles.find((p) => p.id === selectedId) ?? sortedProfiles[0] ?? null;
    const selectedVisibleId = selected?.id ?? null;

    const syntheticCurve = (p: RoastProfileWithSource) =>
        generateProfileCurve(p.drop_temp_celsius ?? 200, p.duration_sec ?? 720);

    const selectedTsvPath = selected ? (resolveSourceSession(selected.source_session)?.tsv_path ?? null) : null;
    const { data: selectedRealCurve = [] } = useRoastProfileCurve(selectedTsvPath);
    const selectedHasReal = selectedRealCurve.length > 0;

    const setDefault = (id: string | null) => {
        const previous = defaultId;
        setDefaultId(id);
        updateProfile(
            { default_roast_profile_id: id },
            {
                onError: (err) => {
                    setDefaultId(previous);
                    logger.capture(err instanceof Error ? err : new Error('Failed to update default profile'), {
                        profileId: id,
                    });
                },
            },
        );
    };

    const enterCompareMode = () => {
        setCompareMode(true);
        if (selectedVisibleId) setCompareIds([selectedVisibleId]);
    };

    const exitCompareMode = () => {
        setCompareMode(false);
        setCompareIds([]);
    };

    const toggleCompareId = (id: string) => {
        setCompareIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id],
        );
    };

    const handleProfileClick = (id: string, shiftKey: boolean) => {
        if (compareMode) {
            toggleCompareId(id);
            return;
        }
        if (shiftKey && id !== selectedVisibleId) {
            setCompareMode(true);
            setCompareIds([selectedVisibleId ?? id, id]);
            return;
        }
        setSelectedId(id);
    };

    const handleCreated = async (profileData: RoastProfile) => {
        const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insert } = profileData;
        void _id;
        void _createdAt;
        void _updatedAt;
        const created = await createProfile(insert);
        setSelectedId(created.id);
    };

    const handleDuplicate = async (profile: RoastProfileWithSource) => {
        try {
            const created = await createProfile(
                roastProfileCopyInsert(profile, `${profile.name} (${t('profiles.detail.duplicate')})`),
            );
            setSelectedId(created.id);
        } catch (err) {
            logger.capture(new Error('Roast profile duplication failed'), { reason: String(err) });
            useToastStore.getState().show(t('profiles.detail.duplicateFailed'));
        }
    };

    const handleDelete = (id: string) => {
        deleteProfile(id);
        if (id === defaultId) {
            setDefaultId(null);
            updateProfile({ default_roast_profile_id: null });
        }
        if (selectedVisibleId === id) setSelectedId(sortedProfiles.find((p) => p.id !== id)?.id ?? null);
    };

    const primaryId = compareMode ? (compareIds[0] ?? selectedVisibleId ?? '') : (selectedVisibleId ?? '');
    const compareProfiles = compareMode
        ? (compareIds.map((id) => profiles.find((p) => p.id === id)).filter(Boolean) as RoastProfileWithSource[])
        : [];

    const chartKey = compareMode
        ? `${compareIds.join(',')}|${compareProfiles.map((p) => resolveSourceSession(p.source_session)?.tsv_path ?? '').join(',')}`
        : `${selectedVisibleId ?? ''}|${selectedRealCurve.length}`;

    const renderDetail = (): ReactNode => {
        if (isLoading) return <ProfileDetailSkeleton />;
        if (compareMode) {
            return (
                <ProfileCompare
                    compareIds={compareIds}
                    compareProfiles={compareProfiles}
                    defaultId={defaultId}
                    primaryId={primaryId}
                    chartKey={chartKey}
                    onSetDefault={setDefault}
                />
            );
        }
        if (!selected) return null;
        return (
            <ProfileDetail
                selected={selected}
                selectedRealCurve={selectedRealCurve}
                selectedHasReal={selectedHasReal}
                defaultId={defaultId}
                chartKey={chartKey}
                onSetDefault={setDefault}
                onEdit={() => setShowEditModal(true)}
                onDuplicate={(profile) => void handleDuplicate(profile)}
                onDelete={handleDelete}
                onNavigate={onNavigate}
            />
        );
    };

    const profileList = (
        <div>
            <CatalogVisibilityFilter checked={showHidden} onChange={setShowHidden} />
            <div className="flex items-center gap-2 bg-main-bg rounded-lg px-3 py-2.25 mb-2.5 dark:border dark:border-[#585d61]">
                <Search size={14} strokeWidth={2} className="shrink-0 text-muted" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('profiles.searchPlaceholder')}
                    className="border-none bg-transparent outline-none text-[13px] text-primary font-body w-full tracking-[0.14px]"
                />
            </div>
            {isLoading ? (
                <ProfileListSkeleton label={t('common.loading')} />
            ) : (
                <div className="flex flex-col gap-2">
                    {compareMode && (
                        <p className="text-[11px] font-medium text-muted tracking-[0.4px] px-1 mb-0.5">
                            {compareIds.length === 0
                                ? t('profiles.compare.selectPrompt')
                                : compareIds.length >= 4
                                  ? t('profiles.compare.maxSelected')
                                  : t('profiles.compare.selected', { count: compareIds.length })}
                        </p>
                    )}
                    {sortedProfiles.map((profile) => {
                        const isSelected = !compareMode && selectedVisibleId === profile.id;
                        const compareIdx = compareMode ? compareIds.indexOf(profile.id) : -1;
                        const isCompareSelected = compareIdx !== -1;
                        const atCapacity = compareMode && compareIds.length >= 4 && !isCompareSelected;
                        const sparkColor = isCompareSelected
                            ? COMPARE_COLORS[compareIdx]
                            : isSelected
                              ? 'var(--color-primary)'
                              : '#b3b0aa';

                        return (
                            <div
                                key={profile.id}
                                onClick={(e) => !atCapacity && handleProfileClick(profile.id, e.shiftKey)}
                                className={`bg-main-bg rounded-lg px-4 pb-2 pt-4 transition-all duration-150 border ${atCapacity ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${isSelected || isCompareSelected ? 'border-black/8 dark:border-[#585d61]' : 'border-[#E5E5E5] dark:border-[#585d61]'}`}
                            >
                                {compareMode && (
                                    <div className="flex justify-end -mt-1 mb-1">
                                        <div
                                            className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${isCompareSelected ? 'text-white' : 'bg-surface dark:bg-surface-elevated '}`}
                                            style={
                                                isCompareSelected
                                                    ? { backgroundColor: COMPARE_COLORS[compareIdx] }
                                                    : undefined
                                            }
                                        >
                                            {isCompareSelected && <Check size={9} strokeWidth={3} />}
                                        </div>
                                    </div>
                                )}

                                <div className="mb-1 flex justify-end">
                                    <CatalogVisibilityButton
                                        hidden={hidden.has(profile.id)}
                                        name={profile.name}
                                        onToggle={() => setHidden(profile.id, !hidden.has(profile.id))}
                                    />
                                </div>
                                <Sparkline data={syntheticCurve(profile)} color={sparkColor} />

                                <div className="flex items-start justify-between mt-3">
                                    <div>
                                        <div className="flex items-center gap-1.25 mb-px">
                                            <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                                {profile.name}
                                            </span>
                                            {defaultId === profile.id && (
                                                <Star
                                                    size={11}
                                                    strokeWidth={2}
                                                    fill="currentColor"
                                                    className="text-amber-400"
                                                />
                                            )}
                                        </div>
                                        <div className="text-[12px] text-muted tracking-[0.14px]">
                                            {profile.drop_temp_celsius != null
                                                ? `${t('profiles.drop')} ${formatTemp(profile.drop_temp_celsius, unit)}`
                                                : profile.target_level}
                                            {profile.duration_sec != null &&
                                                ` · ${formatDuration(profile.duration_sec)}`}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <PageLayout>
            <PageHeader
                title={t('profiles.title')}
                subtitle={isLoading || listFailed ? undefined : t('profiles.subtitle', { count: profiles.length })}
                actions={
                    <div className="flex gap-2 items-center">
                        {profiles.length > 1 && (
                            <button
                                type="button"
                                onClick={compareMode ? exitCompareMode : enterCompareMode}
                                className={`flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none text-sm font-medium cursor-pointer tracking-[0.14px] transition hover:-translate-y-px ${
                                    compareMode
                                        ? 'bg-primary text-white '
                                        : 'bg-main-bg dark:bg-[#262b31] text-secondary dark:text-[#e5e5e5] border border-transparent dark:border-[#585d61] hover:text-primary'
                                }`}
                            >
                                <GitCompare size={14} strokeWidth={2} />
                                {compareMode ? t('profiles.compare.exit') : t('profiles.compare.enter')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowNewModal(true)}
                            className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none dark:border-white bg-primary dark:bg-[#0d0d0d] text-white text-sm font-medium cursor-pointer tracking-[0.14px] transition hover:-translate-y-px"
                        >
                            <Plus size={15} strokeWidth={2.5} />
                            {t('profiles.newProfile')}
                        </button>
                    </div>
                }
            />

            {listFailed ? (
                <div
                    role="alert"
                    className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted dark:border dark:border-[#585d61]"
                >
                    {t('profiles.loadError')}
                </div>
            ) : !isLoading && profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-24 rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
                    <p className="text-sm text-muted tracking-[0.14px]">{t('profiles.empty')}</p>
                    <PillButton onClick={() => setShowNewModal(true)}>
                        <Plus size={14} strokeWidth={2.5} />
                        {t('profiles.createFirst')}
                    </PillButton>
                </div>
            ) : (
                <MasterDetailLayout left={profileList} detail={renderDetail()} />
            )}

            {showNewModal && <NewProfileModal open onClose={() => setShowNewModal(false)} onCreated={handleCreated} />}
            {showEditModal && selected && (
                <NewProfileModal
                    open
                    onClose={() => setShowEditModal(false)}
                    onCreated={() => {}}
                    editingProfile={selected}
                    onUpdated={async (updated) => {
                        await updateRoastProfile(updated);
                        setShowEditModal(false);
                    }}
                />
            )}
        </PageLayout>
    );
};

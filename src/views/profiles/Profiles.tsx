import { useActiveWorkspace } from '@entities/organization';
import { useProfile, useUpdateProfile } from '@entities/profile';
import {
    type RoastProfileWithSource,
    resolveSourceSession,
    useCreateRoastProfile,
    useDeleteRoastProfile,
    useRoastProfileCurve,
    useRoastProfiles,
    useUpdateRoastProfile,
} from '@entities/roast-profile';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import { formatDuration } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import type { RoastProfile } from '@shared/types/database.types';
import type { View } from '@shared/types/view';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { Sparkline } from '@shared/ui/Sparkline';
import { ProfileCompare } from '@widgets/profile-compare/ui/ProfileCompare';
import { ProfileDetail } from '@widgets/profile-detail/ui/ProfileDetail';
import { Check, GitCompare, Plus, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NewProfileModal } from './NewProfileModal';

const COMPARE_COLORS = [
    'var(--color-palette-green)',
    'var(--color-palette-blue)',
    'var(--color-palette-purple)',
    'var(--color-palette-yellow)',
] as const;

interface ProfilesProps {
    onNavigate: (view: View) => void;
}

export const Profiles = ({ onNavigate }: ProfilesProps) => {
    const { t } = useTranslation();
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: profiles = [], isLoading } = useRoastProfiles(workspaceOwnerId);
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

    const sortedProfiles = [...profiles].sort((a, b) => {
        if (!defaultId) return 0;
        if (a.id === defaultId) return -1;
        if (b.id === defaultId) return 1;
        return 0;
    });

    const selected = profiles.find((p) => p.id === selectedId) ?? null;

    const syntheticCurve = (p: RoastProfileWithSource) =>
        generateProfileCurve(p.drop_temp_celsius ?? 200, p.duration_sec ?? 720);

    const selectedTsvPath = selected ? (resolveSourceSession(selected.source_session)?.tsv_path ?? null) : null;
    const { data: selectedRealCurve = [] } = useRoastProfileCurve(selectedTsvPath);
    const selectedHasReal = selectedRealCurve.length > 0;

    const setDefault = (id: string) => {
        setDefaultId(id);
        updateProfile({ default_roast_profile_id: id });
    };

    const enterCompareMode = () => {
        setCompareMode(true);
        if (selectedId) setCompareIds([selectedId]);
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
        if (shiftKey && id !== selectedId) {
            setCompareMode(true);
            setCompareIds([selectedId ?? id, id]);
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

    const handleDelete = (id: string) => {
        deleteProfile(id);
        if (id === defaultId) {
            setDefaultId(null);
            updateProfile({ default_roast_profile_id: null });
        }
        if (selectedId === id) setSelectedId(profiles.find((p) => p.id !== id)?.id ?? null);
    };

    const primaryId = compareMode ? (compareIds[0] ?? selectedId ?? '') : (selectedId ?? '');
    const compareProfiles = compareMode
        ? (compareIds.map((id) => profiles.find((p) => p.id === id)).filter(Boolean) as RoastProfileWithSource[])
        : [];

    const chartKey = compareMode
        ? `${compareIds.join(',')}|${compareProfiles.map((p) => resolveSourceSession(p.source_session)?.tsv_path ?? '').join(',')}`
        : `${selectedId ?? ''}|${selectedRealCurve.length}`;

    const profileList = (
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
                const isSelected = !compareMode && selectedId === profile.id;
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
                                        isCompareSelected ? { backgroundColor: COMPARE_COLORS[compareIdx] } : undefined
                                    }
                                >
                                    {isCompareSelected && <Check size={9} strokeWidth={3} />}
                                </div>
                            </div>
                        )}

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
                                        ? `${t('profiles.drop')} ${profile.drop_temp_celsius}°C`
                                        : profile.target_level}
                                    {profile.duration_sec != null && ` · ${formatDuration(profile.duration_sec)}`}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    if (isLoading) {
        return (
            <PageLayout>
                <div className="flex items-center justify-center h-64 text-sm text-muted dark:text-[#e5e5e5]">
                    {t('common.loading')}
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title={t('profiles.title')}
                subtitle={t('profiles.subtitle', { count: profiles.length })}
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

            {profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-24 rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
                    <p className="text-sm text-muted tracking-[0.14px]">{t('profiles.empty')}</p>
                    <PillButton onClick={() => setShowNewModal(true)}>
                        <Plus size={14} strokeWidth={2.5} />
                        {t('profiles.createFirst')}
                    </PillButton>
                </div>
            ) : (
                <MasterDetailLayout
                    left={profileList}
                    detail={
                        compareMode ? (
                            <ProfileCompare
                                compareIds={compareIds}
                                compareProfiles={compareProfiles}
                                defaultId={defaultId}
                                primaryId={primaryId}
                                chartKey={chartKey}
                                onSetDefault={setDefault}
                            />
                        ) : selected ? (
                            <ProfileDetail
                                selected={selected}
                                selectedRealCurve={selectedRealCurve}
                                selectedHasReal={selectedHasReal}
                                defaultId={defaultId}
                                chartKey={chartKey}
                                onSetDefault={setDefault}
                                onEdit={() => setShowEditModal(true)}
                                onDelete={handleDelete}
                                onNavigate={onNavigate}
                            />
                        ) : null
                    }
                />
            )}

            <NewProfileModal open={showNewModal} onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
            <NewProfileModal
                open={showEditModal}
                onClose={() => setShowEditModal(false)}
                onCreated={() => {}}
                editingProfile={selected}
                onUpdated={async (updated) => {
                    await updateRoastProfile(updated);
                    setShowEditModal(false);
                }}
            />
        </PageLayout>
    );
};

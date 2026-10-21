import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import type { RoastSourceCandidate } from '@entities/roast-profile';
import { useRoastProfiles } from '@entities/roast-profile';
import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useBatchNumber } from '@features/active-roast/model/useBatchNumber';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RoastTitleEditor } from './RoastTitleEditor';
import { TargetMenu } from './TargetMenu';

// ─── Utility ──────────────────────────────────────────────────────────────────

const joinDisplay = (parts: (string | null | undefined)[], sep = ' · ') => parts.filter(Boolean).join(sep);

type BeanOptionDisplay = (bean: {
    origin: string | null;
    region: string | null;
    farm: string | null;
    variety: string | null;
    name: string;
}) => string;

const beanOptionDisplay: BeanOptionDisplay = (b) => joinDisplay([b.origin, b.region, b.farm, b.variety]) || b.name;

// ─── Component ────────────────────────────────────────────────────────────────
export const RoastHeader = ({
    phase: _phase,
    targetProfileId,
    selectedBeanId: currentBeanId,
    selectedBlendId: currentBlendId = null,
    onBlendChange,
    sourceCandidates = [],
    fallbackBeanName: currentBeanName,
    onTargetProfileChange,
    onBeanChange,
    onOpenRoastSettings,
    historyReferenceName = null,
    historyReferenceFailed = false,
    onChooseHistoryReference,
    onClearHistoryReference,
}: {
    phase: string;
    targetProfileId: string | null;
    selectedBeanId: string | null;
    selectedBlendId?: string | null;
    onBlendChange?: (id: string | null, name?: string | null) => void;
    sourceCandidates?: RoastSourceCandidate[];
    fallbackBeanName?: string | null;
    onTargetProfileChange: (id: string | null) => void;
    onBeanChange: (id: string | null, name?: string | null) => void;
    onOpenRoastSettings?: () => void;
    historyReferenceName?: string | null;
    historyReferenceFailed?: boolean;
    onChooseHistoryReference?: () => void;
    onClearHistoryReference?: () => void;
}) => {
    // ─── Store state ─────────────────────────────────────────────────────────
    const { t } = useTranslation();
    useBatchNumber();
    const review = useRoastingStore(selectReviewSnapshot);
    const selectedBeanId = review ? review.selection.beanId : currentBeanId;
    const selectedBlendId = review ? review.selection.blendId : currentBlendId;
    const fallbackBeanName = review ? review.selection.beanName : currentBeanName;
    const runningTitle = useRoastingStore((state) => state.activeSelection?.identity?.title);
    const batchTitle = review?.selection.identity?.title ?? runningTitle;
    const runningSessionId = useRoastingStore((state) => (state.phase === 'roasting' ? state.sessionId : null));
    const editingSessionId = review?.sessionId ?? runningSessionId;
    const charged = useRoastingStore((s) => isChargedPhase(s.phase));
    const sessionOwnerId = useRoastingStore((state) => state.sessionOwnerId);
    const preparedOwnerId = useRoastingStore((state) => state.prepared.workspaceOwnerId);
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const sidecarError = useRoastingStore((s) => s.sidecarError);
    const reconnecting = useRoastingStore((s) => s.reconnecting);
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const canSelectSource =
        !review && isWorkspaceReady && !!workspaceOwnerId && (!charged || sessionOwnerId === workspaceOwnerId);
    const { data: blends = [] } = useBlends(workspaceOwnerId);
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const { data: dbProfiles = [] } = useRoastProfiles(workspaceOwnerId);
    const beanVisibility = useCatalogVisibility(user?.id ?? '', workspaceOwnerId, 'beans');
    const profileVisibility = useCatalogVisibility(user?.id ?? '', workspaceOwnerId, 'profiles');
    const visibleBeans = beans.filter((bean) => bean.id === selectedBeanId || !beanVisibility.hidden.has(bean.id));
    const { data: userProfile } = useProfile(user?.id ?? '');

    const handleProfileChange = (id: string | null) => {
        if (id === targetProfileId) {
            if (historyReferenceName) onClearHistoryReference?.();
            return;
        }
        onTargetProfileChange(id);
    };

    const handleBeanChange = (id: string | null) => {
        const bean = beans.find((bean) => bean.id === id);
        const name = bean
            ? joinDisplay([bean.origin, bean.region], ' ') || bean.name
            : (sourceCandidates.find((source) => source.beanId && source.beanId === id)?.name ?? null);
        onBeanChange(id, name);
        // 원두 기본값은 기기별 취향이라 localStorage에만 저장 (프로파일과 달리 DB 동기화 불필요)
        if (id) localStorage.setItem(DEFAULT_BEAN_KEY, id);
        else localStorage.removeItem(DEFAULT_BEAN_KEY);
    };

    const selectedBlend = blends.find((b) => b.id === selectedBlendId);
    const selectedBean = beans.find((b) => b.id === selectedBeanId);
    const beanTitle = selectedBlend
        ? selectedBlend.name
        : selectedBean
          ? joinDisplay([selectedBean.origin, selectedBean.region], ' ') || selectedBean.name
          : (fallbackBeanName ?? 'No Bean Selected');
    const sourceDisplayName = selectedBlend || selectedBean ? beanTitle : (fallbackBeanName ?? null);
    useEffect(() => {
        if (!review && preparedOwnerId === workspaceOwnerId)
            useRoastingStore
                .getState()
                .setSourceDisplayName(
                    { beanId: selectedBeanId, blendId: selectedBlendId, beanName: sourceDisplayName },
                    workspaceOwnerId,
                );
    }, [selectedBeanId, selectedBlendId, sourceDisplayName, workspaceOwnerId, preparedOwnerId, review]);
    const beanSecondary = selectedBean
        ? joinDisplay([selectedBean.farm, selectedBean.variety, selectedBean.process]) ||
          (selectedBean.name !== beanTitle ? selectedBean.name : '')
        : '';
    const defaultProfileId = userProfile?.default_roast_profile_id;
    const sortedProfiles = dbProfiles
        .filter((profile) => profile.id === targetProfileId || !profileVisibility.hidden.has(profile.id))
        .sort((a, b) => {
            if (!defaultProfileId) return 0;
            if (a.id === defaultProfileId) return -1;
            if (b.id === defaultProfileId) return 1;
            return 0;
        });
    void onOpenRoastSettings;

    return (
        <div className="flex items-end justify-between">
            <div>
                {reconnecting && (
                    <p role="status" aria-live="assertive" className="text-xs text-amber-400 mb-1.5 max-w-xs">
                        {t('activeRoast.header.reconnecting')}
                    </p>
                )}
                {!sidecarConnected && sidecarError && (
                    <p className="text-xs text-red-400 mb-1.5 max-w-xs">{sidecarError}</p>
                )}

                <div className="inline-flex items-center gap-2 mb-1 min-w-0">
                    {editingSessionId ? (
                        <RoastTitleEditor
                            key={editingSessionId}
                            sessionId={editingSessionId}
                            title={batchTitle || beanTitle}
                        />
                    ) : (
                        <span className="font-(--font-display) text-[28px] leading-[1.13] text-primary tracking-[-0.4px]">
                            {batchTitle || beanTitle}
                        </span>
                    )}

                    <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded focus-within:outline-2 focus-within:outline-(--color-primary)">
                        <select
                            aria-label={t('activeRoast.summary.bean')}
                            value={selectedBlendId ? `blend:${selectedBlendId}` : (selectedBeanId ?? '')}
                            onChange={(e) => {
                                if (!canSelectSource) return;
                                const value = e.target.value;
                                if (value.startsWith('blend:')) {
                                    const id = value.slice(6);
                                    onBlendChange?.(id, blends.find((b) => b.id === id)?.name ?? null);
                                    localStorage.removeItem(DEFAULT_BEAN_KEY);
                                } else handleBeanChange(value || null);
                            }}
                            disabled={!canSelectSource}
                            className="absolute inset-0 h-full w-full opacity-0 appearance-none bg-transparent border-none outline-none text-[14px] cursor-pointer disabled:cursor-default"
                        >
                            <option value="">No Bean Selected</option>
                            {sourceCandidates.length > 1 && (
                                <optgroup label={t('activeRoast.header.profileSources')}>
                                    {sourceCandidates.map((source) => (
                                        <option
                                            key={source.blendId ? `blend:${source.blendId}` : source.beanId}
                                            value={source.blendId ? `blend:${source.blendId}` : (source.beanId ?? '')}
                                        >
                                            {source.name}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            <optgroup label={t('newProfileModal.singleOrigin')}>
                                {visibleBeans.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {beanOptionDisplay(b)}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label={t('newProfileModal.blend')}>
                                {blends.map((b) => (
                                    <option key={b.id} value={`blend:${b.id}`}>
                                        {b.name}
                                    </option>
                                ))}
                            </optgroup>
                        </select>

                        <ChevronDown size={18} className="pointer-events-none text-muted" />
                    </div>
                </div>

                {/* ─── Bean secondary info: farm · variety · process ───── */}

                {/* ─── Target profile selector ───────────────────────────── */}
                <div className="flex flex-wrap items-center gap-1">
                    {beanSecondary && (
                        <p className="text-[13px] text-muted tracking-[-0.1px] mb-0.5">{beanSecondary} / </p>
                    )}

                    <span className="text-[13px] text-muted tracking-[0.14px]">{t('activeRoast.header.target')}</span>
                    <TargetMenu
                        profiles={sortedProfiles.map((profile) => ({ id: profile.id, name: profile.name }))}
                        targetProfileId={targetProfileId}
                        historyReferenceName={historyReferenceName}
                        onProfileChange={handleProfileChange}
                        onChooseHistory={onChooseHistoryReference}
                    />
                    {historyReferenceFailed && (
                        <span role="alert" className="text-[13px] text-red-400">
                            {t('activeRoast.reference.failed')}
                        </span>
                    )}
                </div>
            </div>

            {/* ─── Right side: settings (hidden for now) ───────────────── */}
            {/*
            <div className="flex items-start gap-3">
                {onOpenRoastSettings && (
                    <button
                        type="button"
                        data-tour="active-roast-settings"
                        onClick={onOpenRoastSettings}
                        aria-label="Open roast settings"
                        title="Roast settings"
                        className="w-8.5 h-8.5 rounded-md border border-transparent bg-main-bg dark:bg-surface-elevated text-secondary dark:text-primary flex items-center justify-center cursor-pointer shrink-0 mt-1.5 hover:bg-surface-hover transition"
                    >
                        <Settings2 size={15} strokeWidth={1.9} />
                    </button>
                )}
            </div>
            */}
        </div>
    );
};

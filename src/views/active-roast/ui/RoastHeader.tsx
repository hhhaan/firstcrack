import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import type { RoastSourceCandidate } from '@entities/roast-profile';
import { useRoastProfiles } from '@entities/roast-profile';
import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useBatchNumber } from '@features/active-roast/model/useBatchNumber';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@shared/ui/select/Select';
import { useTranslation } from 'react-i18next';
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
    selectedBeanId,
    selectedBlendId = null,
    onBlendChange,
    sourceCandidates = [],
    fallbackBeanName,
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
    onBeanChange: (id: string | null) => void;
    onOpenRoastSettings?: () => void;
    historyReferenceName?: string | null;
    historyReferenceFailed?: boolean;
    onChooseHistoryReference?: () => void;
    onClearHistoryReference?: () => void;
}) => {
    // ─── Store state ─────────────────────────────────────────────────────────
    const { t } = useTranslation();
    const batchNumber = useBatchNumber();
    const charged = useRoastingStore((s) => isChargedPhase(s.phase));
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const sidecarError = useRoastingStore((s) => s.sidecarError);
    const reconnecting = useRoastingStore((s) => s.reconnecting);
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId } = useActiveWorkspace();
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
        onBeanChange(id);
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
    const beanSecondary = selectedBean
        ? joinDisplay([selectedBean.farm, selectedBean.variety, selectedBean.process]) ||
          (selectedBean.name !== beanTitle ? selectedBean.name : '')
        : '';
    const defaultProfileId = userProfile?.default_roast_profile_id;
    const hasTarget = historyReferenceName != null || dbProfiles.some((profile) => profile.id === targetProfileId);
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

                <div className="mb-1 min-w-0">
                    <Select
                        value={selectedBlendId ? `blend:${selectedBlendId}` : (selectedBeanId ?? 'none')}
                        onValueChange={(value) => {
                            if (value.startsWith('blend:')) {
                                const id = value.slice(6);
                                onBlendChange?.(id, blends.find((b) => b.id === id)?.name ?? null);
                                localStorage.removeItem(DEFAULT_BEAN_KEY);
                            } else handleBeanChange(value === 'none' ? null : value);
                        }}
                        disabled={charged}
                    >
                        <SelectTrigger
                            aria-label={t('activeRoast.summary.bean')}
                            className="h-auto max-w-full gap-2 rounded-none border-none bg-transparent p-0 font-(--font-display) text-[28px] font-normal leading-[1.13] tracking-[-0.4px] shadow-none disabled:cursor-default disabled:opacity-100 [&>svg]:size-4.5 disabled:[&>svg]:hidden"
                        >
                            <SelectValue>{beanTitle}</SelectValue>
                        </SelectTrigger>
                        <SelectContent
                            position="popper"
                            align="start"
                            collisionPadding={8}
                            className="max-h-[min(14rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-1rem)]"
                        >
                            <SelectItem value="none">No Bean Selected</SelectItem>
                            {sourceCandidates.length > 1 && (
                                <SelectGroup>
                                    <SelectLabel>{t('activeRoast.header.profileSources')}</SelectLabel>
                                    {sourceCandidates.map((source) => (
                                        <SelectItem
                                            key={source.blendId ? `blend:${source.blendId}` : source.beanId}
                                            value={
                                                source.blendId ? `blend:${source.blendId}` : (source.beanId ?? 'none')
                                            }
                                        >
                                            {source.name}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            )}
                            <SelectGroup>
                                <SelectLabel>{t('newProfileModal.singleOrigin')}</SelectLabel>
                                {visibleBeans
                                    .filter(
                                        (bean) =>
                                            sourceCandidates.length <= 1 ||
                                            !sourceCandidates.some((source) => source.beanId === bean.id),
                                    )
                                    .map((bean) => (
                                        <SelectItem key={bean.id} value={bean.id}>
                                            {beanOptionDisplay(bean)}
                                        </SelectItem>
                                    ))}
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>{t('newProfileModal.blend')}</SelectLabel>
                                {blends
                                    .filter(
                                        (blend) =>
                                            sourceCandidates.length <= 1 ||
                                            !sourceCandidates.some((source) => source.blendId === blend.id),
                                    )
                                    .map((blend) => (
                                        <SelectItem key={blend.id} value={`blend:${blend.id}`}>
                                            {blend.name}
                                        </SelectItem>
                                    ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
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
                    {hasTarget && batchNumber != null && (
                        <span className="text-[13px] text-muted" title={t('activeRoast.header.batchNumberHint')}>
                            {t('activeRoast.header.batchNumber', { number: batchNumber })}
                        </span>
                    )}
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

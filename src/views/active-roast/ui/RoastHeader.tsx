import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import { useRoastProfiles } from '@entities/roast-profile';
import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useAuthStore } from '@shared/store/auth';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ─── Utility ──────────────────────────────────────────────────────────────────

const joinDisplay = (parts: (string | null | undefined)[], sep = ' · ') => parts.filter(Boolean).join(sep);

const HISTORY_PICK = '__fc_history_pick__';
const HISTORY_ACTIVE = '__fc_history_active__';
const HISTORY_CLEAR = '__fc_history_clear__';

/** 화살표 아이콘이 있는 hidden select overlay. Target/profile 선택에 공통 사용 */
const OverlaySelect = <T extends string>({
    value,
    onChange,
    onIntercept,
    disabled,
    options,
    placeholder,
    ariaLabel,
}: {
    value: T | null;
    onChange: (val: T | null) => void;
    /** true면 선택값을 바꾸지 않는다. 히스토리 배경처럼 같은 메뉴의 동작. */
    onIntercept?: (val: T) => boolean;
    disabled: boolean;
    options: { value: T; label: string }[];
    placeholder: string;
    ariaLabel?: string;
}) => (
    <div className="relative inline-flex items-center">
        <div className="flex items-center gap-1">
            <span className="text-[13px] font-medium tracking-[0.14px] pointer-events-none">
                {options.find((o) => o.value === value)?.label ?? placeholder}
            </span>
            {!disabled && <ChevronDown size={12} className="text-muted flex-shrink-0" />}
        </div>
        <select
            aria-label={ariaLabel}
            value={value ?? ''}
            onChange={(e) => {
                const v = e.target.value;
                if (v && onIntercept?.(v as T)) {
                    e.target.value = value ?? '';
                    return;
                }
                onChange(v === '' ? null : (v as T));
            }}
            disabled={disabled}
            className={`absolute inset-0 w-full opacity-0 appearance-none bg-transparent border-none outline-none text-[14px] ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
        >
            <option value="">{placeholder}</option>
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    </div>
);

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
    fallbackBeanName?: string | null;
    onTargetProfileChange: (id: string | null) => void;
    onBeanChange: (id: string | null) => void;
    onOpenRoastSettings?: () => void;
    /** 히스토리 로스트를 배경으로 쓰는 동안 Target에 보이는 이름 */
    historyReferenceName?: string | null;
    historyReferenceFailed?: boolean;
    onChooseHistoryReference?: () => void;
    onClearHistoryReference?: () => void;
}) => {
    // ─── Store state ─────────────────────────────────────────────────────────
    const { t } = useTranslation();
    const charged = useRoastingStore((s) => isChargedPhase(s.phase));
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const sidecarError = useRoastingStore((s) => s.sidecarError);
    const reconnecting = useRoastingStore((s) => s.reconnecting);
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const { data: dbProfiles = [] } = useRoastProfiles(workspaceOwnerId);
    const { data: userProfile } = useProfile(user?.id ?? '');

    const handleProfileChange = (id: string | null) => {
        if (id === targetProfileId) {
            if (historyReferenceName) onClearHistoryReference?.();
            return;
        }
        onTargetProfileChange(id);
    };

    const handleTargetAction = (id: string) => {
        if (id === HISTORY_PICK) {
            onChooseHistoryReference?.();
            return true;
        }
        if (id === HISTORY_CLEAR || id === HISTORY_ACTIVE) {
            if (id === HISTORY_CLEAR) onClearHistoryReference?.();
            return true;
        }
        return false;
    };

    const handleBeanChange = (id: string | null) => {
        onBeanChange(id);
        // 원두 기본값은 기기별 취향이라 localStorage에만 저장 (프로파일과 달리 DB 동기화 불필요)
        if (id) localStorage.setItem(DEFAULT_BEAN_KEY, id);
        else localStorage.removeItem(DEFAULT_BEAN_KEY);
    };

    const selectedBean = beans.find((b) => b.id === selectedBeanId);
    const beanTitle = selectedBean
        ? joinDisplay([selectedBean.origin, selectedBean.region], ' ') || selectedBean.name
        : (fallbackBeanName ?? 'No Bean Selected');
    const beanSecondary = selectedBean
        ? joinDisplay([selectedBean.farm, selectedBean.variety, selectedBean.process]) ||
          (selectedBean.name !== beanTitle ? selectedBean.name : '')
        : '';
    const defaultProfileId = userProfile?.default_roast_profile_id;
    const sortedProfiles = [...dbProfiles].sort((a, b) => {
        if (!defaultProfileId) return 0;
        if (a.id === defaultProfileId) return -1;
        if (b.id === defaultProfileId) return 1;
        return 0;
    });
    const profileOptions = [
        ...(historyReferenceName ? [{ value: HISTORY_ACTIVE, label: historyReferenceName }] : []),
        ...sortedProfiles.map((p) => ({ value: p.id, label: p.name })),
        ...(historyReferenceName ? [{ value: HISTORY_CLEAR, label: t('activeRoast.reference.clear') }] : []),
        ...(onChooseHistoryReference ? [{ value: HISTORY_PICK, label: t('activeRoast.reference.choose') }] : []),
    ];

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

                <div className="relative inline-flex items-center mb-1 min-w-0">
                    <span className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] pointer-events-none pr-7">
                        {beanTitle}
                    </span>

                    <select
                        value={selectedBeanId ?? ''}
                        onChange={(e) => handleBeanChange(e.target.value || null)}
                        disabled={charged}
                        className={`absolute inset-0 w-full opacity-0 appearance-none bg-transparent border-none outline-none text-[14px] ${charged ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                        <option value="">No Bean Selected</option>
                        {beans.map((b) => (
                            <option key={b.id} value={b.id}>
                                {beanOptionDisplay(b)}
                            </option>
                        ))}
                    </select>

                    {!charged && (
                        <ChevronDown
                            size={18}
                            className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-muted"
                        />
                    )}
                </div>

                {/* ─── Bean secondary info: farm · variety · process ───── */}

                {/* ─── Target profile selector ───────────────────────────── */}
                <div className="flex items-center gap-1">
                    {beanSecondary && (
                        <p className="text-[13px] text-muted tracking-[-0.1px] mb-0.5">{beanSecondary} / </p>
                    )}

                    <span className="text-[13px] text-muted tracking-[0.14px]">Target:</span>
                    <OverlaySelect
                        value={historyReferenceName ? HISTORY_ACTIVE : targetProfileId}
                        onChange={handleProfileChange}
                        onIntercept={handleTargetAction}
                        disabled={false}
                        options={profileOptions}
                        placeholder="No Target"
                        ariaLabel={t('activeRoast.header.target')}
                    />
                    {historyReferenceFailed && (
                        <span role="alert" className="text-[13px] text-red-400">
                            {t('activeRoast.reference.failed')}
                        </span>
                    )}
                </div>
            </div>

            {/* ─── Right side: settings ─────────────────────────────────── */}
            <div className="flex items-start gap-3">
                {onOpenRoastSettings && (
                    <button
                        type="button"
                        data-tour="active-roast-settings"
                        onClick={onOpenRoastSettings}
                        aria-label="Open roast settings"
                        title="Roast settings"
                        className="w-8.5 h-8.5 rounded-md border border-transparent bg-main-bg dark:bg-[#262b31] text-secondary dark:text-[#e5e5e5] flex items-center justify-center cursor-pointer shrink-0 mt-1.5 hover:-translate-y-px transition"
                    >
                        <Settings2 size={15} strokeWidth={1.9} />
                    </button>
                )}
            </div>
        </div>
    );
};

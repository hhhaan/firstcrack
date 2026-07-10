import { useBeans } from '@entities/bean/queries';
import { useProfile, useUpdateProfile } from '@entities/profile';
import { useRoastProfiles } from '@entities/roast-profile';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAuthStore } from '@shared/store/auth';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

// ─── Utility ──────────────────────────────────────────────────────────────────

const joinDisplay = (parts: (string | null | undefined)[], sep = ' · ') => parts.filter(Boolean).join(sep);

/** 화살표 아이콘이 있는 hidden select overlay. Target/profile 선택에 공통 사용 */
const OverlaySelect = <T extends string>({
    value,
    onChange,
    disabled,
    options,
    placeholder,
}: {
    value: T | null;
    onChange: (val: T | null) => void;
    disabled: boolean;
    options: { value: T; label: string }[];
    placeholder: string;
}) => (
    <div className="relative inline-flex items-center">
        <div className="flex items-center gap-1">
            <span className="text-[13px] font-medium tracking-[0.14px] pointer-events-none">
                {options.find((o) => o.value === value)?.label ?? placeholder}
            </span>
            {!disabled && <ChevronDown size={12} className="text-muted flex-shrink-0" />}
        </div>
        <select
            value={value ?? ''}
            onChange={(e) => {
                const v = e.target.value;
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
}: {
    phase: string;
    targetProfileId: string | null;
    selectedBeanId: string | null;
    fallbackBeanName?: string | null;
    onTargetProfileChange: (id: string | null) => void;
    onBeanChange: (id: string | null) => void;
    onOpenRoastSettings?: () => void;
}) => {
    // ─── Store state ─────────────────────────────────────────────────────────
    const charged = useRoastingStore((s) => s.charged);
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const sidecarError = useRoastingStore((s) => s.sidecarError);
    const user = useAuthStore((s) => s.user);
    const { data: beans = [] } = useBeans(user?.id ?? '');
    const { data: dbProfiles = [] } = useRoastProfiles(user?.id ?? '');
    const { data: userProfile } = useProfile(user?.id ?? '');
    const { mutate: updateProfile } = useUpdateProfile(user?.id ?? '');
    // 드롭다운을 빠르게 바꿀 때 매번 DB 쓰기가 발생하는 걸 막기 위한 디바운스 타이머.
    // 300ms 안에 다시 바뀌면 이전 요청은 취소되고 마지막 값만 저장됨.
    const profileSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current);
        },
        [],
    );

    const handleProfileChange = (id: string | null) => {
        // 같은 값이면 DB 쓰기 스킵 (no-op guard)
        if (id === targetProfileId) return;
        onTargetProfileChange(id);
        // UI는 즉시 반응, DB 저장은 300ms 디바운스 → 빠른 변경 시 마지막 값만 기록
        if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current);
        profileSaveTimer.current = setTimeout(() => {
            updateProfile({ default_roast_profile_id: id ?? null });
        }, 300);
    };

    const handleBeanChange = (id: string | null) => {
        onBeanChange(id);
        // 원두 기본값은 기기별 취향이라 localStorage에만 저장 (프로파일과 달리 DB 동기화 불필요)
        if (id) localStorage.setItem('fc_default_bean_id', id);
        else localStorage.removeItem('fc_default_bean_id');
    };

    const selectedBean = beans.find((b) => b.id === selectedBeanId);
    const beanSecondary = joinDisplay([selectedBean?.farm, selectedBean?.variety, selectedBean?.process]);
    const defaultProfileId = userProfile?.default_roast_profile_id;
    const sortedProfiles = [...dbProfiles].sort((a, b) => {
        if (!defaultProfileId) return 0;
        if (a.id === defaultProfileId) return -1;
        if (b.id === defaultProfileId) return 1;
        return 0;
    });
    const profileOptions = sortedProfiles.map((p) => ({ value: p.id, label: p.name }));

    return (
        <div className="flex items-end justify-between">
            <div>
                {!sidecarConnected && sidecarError && (
                    <p className="text-xs text-red-400 mb-1.5 max-w-xs">{sidecarError}</p>
                )}

                <div className="relative inline-flex items-center mb-1 min-w-0">
                    <span className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] pointer-events-none pr-7">
                        {selectedBean
                            ? joinDisplay([selectedBean.origin, selectedBean.region], ' ')
                            : (fallbackBeanName ?? 'No Bean Selected')}
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
                        value={targetProfileId}
                        onChange={handleProfileChange}
                        disabled={charged}
                        options={profileOptions}
                        placeholder="No Target"
                    />
                </div>
            </div>

            {/* ─── Right side: settings ─────────────────────────────────── */}
            <div className="flex items-start gap-3">
                {onOpenRoastSettings && (
                    <button
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

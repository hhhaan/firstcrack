import { normalizeYMRange } from '@shared/lib/sessionFilter';
import { ChevronDown, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { YearMonthRangeFields } from './YearMonthRangeFields';

export type DatePreset = 'all' | 'this-month' | 'last-month' | '3-months' | '6-months' | 'this-year' | 'custom';

export const DATE_PRESETS: { value: DatePreset }[] = [
    { value: 'all' },
    { value: 'this-month' },
    { value: 'last-month' },
    { value: '3-months' },
    { value: '6-months' },
    { value: 'this-year' },
    { value: 'custom' },
];

export const getPresetYMRange = (preset: DatePreset): { fromYM: string; toYM: string } | null => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const fmt = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;
    if (preset === 'this-month') return { fromYM: fmt(y, m), toYM: fmt(y, m) };
    if (preset === 'last-month') {
        const d = new Date(y, m - 1, 1);
        return { fromYM: fmt(d.getFullYear(), d.getMonth()), toYM: fmt(d.getFullYear(), d.getMonth()) };
    }
    if (preset === '3-months') {
        const d = new Date(y, m - 2, 1);
        return { fromYM: fmt(d.getFullYear(), d.getMonth()), toYM: fmt(y, m) };
    }
    if (preset === '6-months') {
        const d = new Date(y, m - 5, 1);
        return { fromYM: fmt(d.getFullYear(), d.getMonth()), toYM: fmt(y, m) };
    }
    if (preset === 'this-year') return { fromYM: fmt(y, 0), toYM: fmt(y, m) };
    return null;
};

interface DateRangeFilterProps {
    preset: DatePreset;
    fromYM: string;
    toYM: string;
    monthOptions: string[];
    onPresetChange: (p: DatePreset) => void;
    onFromYM: (v: string) => void;
    onToYM: (v: string) => void;
}

export const DateRangeFilter = ({
    preset,
    fromYM,
    toYM,
    monthOptions,
    onPresetChange,
    onFromYM,
    onToYM,
}: DateRangeFilterProps): ReactNode => {
    const { t } = useTranslation();
    const months = t('months', { returnObjects: true }) as string[];
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isActive = preset !== 'all';

    const initFrom = fromYM || (monthOptions[0] ?? '');
    const initTo = toYM || (monthOptions[monthOptions.length - 1] ?? '');
    const [draftFrom, setDraftFrom] = useState(initFrom);
    const [draftTo, setDraftTo] = useState(initTo);

    const resetDraft = useCallback(() => {
        setDraftFrom(fromYM || (monthOptions[0] ?? ''));
        setDraftTo(toYM || (monthOptions[monthOptions.length - 1] ?? ''));
    }, [fromYM, toYM, monthOptions]);

    const closePanel = useCallback(() => {
        resetDraft();
        setOpen(false);
    }, [resetDraft]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Element;
            const inPanel = ref.current?.contains(target);
            const inPortal = !!target?.closest('[data-radix-popper-content-wrapper]');
            if (!inPanel && !inPortal) closePanel();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, closePanel]);

    const fmtLabel = (ym: string) => {
        if (!ym) return '—';
        const [y, m] = ym.split('-');
        const monthName = months[parseInt(m, 10) - 1] || '';
        return `${monthName} ${y}`;
    };

    const triggerLabel = (() => {
        if (preset === 'custom' && (fromYM || toYM)) return `${fmtLabel(fromYM)} – ${fmtLabel(toYM)}`;
        const presetLabel = DATE_PRESETS.find((p) => p.value === preset)?.value ?? '';
        return presetLabel ? t(`history.datePresets.${presetLabel}`) : t('history.datePresets.period');
    })();

    const isCompleteYM = (v: string) => /^\d{4}-\d{2}$/.test(v);
    const canApply = isCompleteYM(draftFrom) && isCompleteYM(draftTo);

    const handlePresetClick = (p: DatePreset) => {
        if (p === 'custom') {
            resetDraft();
            onPresetChange(p);
            return;
        }
        onPresetChange(p);
        closePanel();
    };

    const handleApply = () => {
        if (!canApply) return;
        const { fromYM: f, toYM: to } = normalizeYMRange(draftFrom, draftTo);
        onFromYM(f);
        onToYM(to);
        setDraftFrom(f);
        setDraftTo(to);
        setOpen(false);
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => (open ? closePanel() : setOpen(true))}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-[13px] font-medium tracking-[0.14px] transition ${
                    isActive
                        ? 'bg-surface-warm-solid text-primary'
                        : 'bg-surface dark:bg-surface-elevated text-secondary hover:-translate-y-px hover:text-primary'
                }`}
            >
                {triggerLabel}
                {isActive ? (
                    <X
                        size={11}
                        strokeWidth={2.5}
                        className="text-muted hover:text-primary"
                        onClick={(e) => {
                            e.stopPropagation();
                            onPresetChange('all');
                            closePanel();
                        }}
                    />
                ) : (
                    <ChevronDown size={11} strokeWidth={2} className="text-muted" />
                )}
            </button>

            {open && (
                <div className="absolute border border-border-subtle dark:border-[#585d61] top-full left-0 z-50 mt-2 flex rounded-lg bg-main-bg overflow-hidden shadow-lg">
                    {/* 프리셋 목록 */}
                    <div className="flex shrink-0 flex-col gap-0.5 py-2 px-2 w-36">
                        {DATE_PRESETS.map((p) => (
                            <button
                                type="button"
                                key={p.value}
                                onClick={() => handlePresetClick(p.value)}
                                className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface cursor-pointer border-none bg-transparent ${
                                    preset === p.value ? 'font-semibold text-primary' : 'text-secondary'
                                }`}
                            >
                                {t(`history.datePresets.${p.value}`)}
                            </button>
                        ))}
                    </div>

                    {/* 커스텀 범위 — draft 상태로 관리, Apply 버튼으로만 반영 */}
                    {preset === 'custom' && (
                        <div className="flex flex-col justify-center gap-3 border-l border-border-subtle dark:border-[#585d61] px-5 py-4 self-stretch">
                            <YearMonthRangeFields
                                fromYM={draftFrom}
                                toYM={draftTo}
                                monthOptions={monthOptions}
                                onFromYM={setDraftFrom}
                                onToYM={setDraftTo}
                            />
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={handleApply}
                                    disabled={!canApply}
                                    className="mt-1 ml-auto rounded-lg border border-[#111] dark:border-[#585d61] bg-[#111] px-4 py-1.5 text-[13px] font-medium text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {t('history.customRange.apply')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

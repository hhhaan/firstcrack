import type { RoastSessionFilterMeta } from '@entities/roast';
import { ymInRange } from '@shared/lib/sessionFilter';
import { modalFooterChrome } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { DATE_PRESETS, type DatePreset, getPresetYMRange } from '@widgets/date-range-filter';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ExportDateRange = { fromYM: string; toYM: string };

interface ExportCsvModalProps {
    open: boolean;
    onClose: () => void;
    monthOptions: string[];
    sessionsMeta: RoastSessionFilterMeta[];
    onConfirm: (range: ExportDateRange) => void;
}

const resolveRange = (preset: DatePreset, fromYM: string, toYM: string): ExportDateRange => {
    if (preset === 'all') return { fromYM: '', toYM: '' };
    if (preset === 'custom') {
        let f = fromYM;
        let t = toYM;
        if (f && t && f > t) [f, t] = [t, f];
        return { fromYM: f, toYM: t };
    }
    const range = getPresetYMRange(preset);
    return { fromYM: range?.fromYM ?? '', toYM: range?.toYM ?? '' };
};

export const ExportCsvModal = ({ open, onClose, monthOptions, sessionsMeta, onConfirm }: ExportCsvModalProps) => {
    const { t } = useTranslation();
    const months = t('months', { returnObjects: true }) as string[];

    const [preset, setPreset] = useState<DatePreset>('all');
    const [fromYM, setFromYM] = useState('');
    const [toYM, setToYM] = useState('');

    const initFrom = monthOptions[0] ?? '';
    const initTo = monthOptions[monthOptions.length - 1] ?? '';

    useEffect(() => {
        if (!open) return;
        setPreset('all');
        setFromYM(initFrom);
        setToYM(initTo);
    }, [open, initFrom, initTo]);

    const years = useMemo(
        () => [...new Set(monthOptions.map((ym) => ym.split('-')[0]))].sort((a, b) => Number(b) - Number(a)),
        [monthOptions],
    );

    const range = useMemo(() => resolveRange(preset, fromYM, toYM), [preset, fromYM, toYM]);

    const exportCount = useMemo(
        () => sessionsMeta.filter((s) => ymInRange(s.roasted_at, range.fromYM, range.toYM)).length,
        [sessionsMeta, range.fromYM, range.toYM],
    );

    const customIncomplete = preset === 'custom' && (!fromYM || !toYM);
    const canExport = !customIncomplete && exportCount > 0;

    const handlePreset = (p: DatePreset) => {
        setPreset(p);
        if (p === 'custom') {
            setFromYM((prev) => prev || initFrom);
            setToYM((prev) => prev || initTo);
        }
    };

    const handleConfirm = () => {
        if (!canExport) return;
        onConfirm(range);
    };

    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="export-csv-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.formSm}
            data-testid="export-csv-modal"
        >
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="px-7 pt-6 pb-2">
                    <ModalHeader
                        title={t('history.exportModal.title')}
                        titleId="export-csv-modal-title"
                        onClose={onClose}
                        closeLabel={t('history.exportCancelLabel')}
                        titleClassName="font-(--font-display) text-xl text-primary tracking-[-0.02em] m-0"
                    />
                </div>

                <div className="flex flex-1 flex-col overflow-y-auto px-7 pb-2">
                    <p className="mb-5 text-sm leading-[1.6] text-secondary">{t('history.exportModal.description')}</p>

                    <div
                        className="mb-4 flex flex-col gap-0.5"
                        role="listbox"
                        aria-label={t('history.datePresets.period')}
                    >
                        {DATE_PRESETS.map((p) => (
                            <button
                                type="button"
                                key={p.value}
                                role="option"
                                aria-selected={preset === p.value}
                                onClick={() => handlePreset(p.value)}
                                className={`w-full cursor-pointer rounded-md border-none bg-transparent px-2.5 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface ${
                                    preset === p.value
                                        ? 'bg-surface-warm-solid font-semibold text-primary'
                                        : 'text-secondary'
                                }`}
                            >
                                {t(`history.datePresets.${p.value}`)}
                            </button>
                        ))}
                    </div>

                    {preset === 'custom' && (
                        <div className="mb-4 flex flex-col gap-3 border-t border-border-subtle pt-4 dark:border-[#585d61]">
                            {(
                                [
                                    { label: t('history.customRange.start'), val: fromYM, set: setFromYM },
                                    { label: t('history.customRange.end'), val: toYM, set: setToYM },
                                ] as const
                            ).map(({ label, val, set }) => {
                                const yr = val ? val.split('-')[0] : '';
                                const mo = val ? val.split('-')[1] : '';
                                return (
                                    <div key={label} className="flex items-center gap-2">
                                        <span className="w-7 shrink-0 text-[11px] font-medium tracking-[0.5px] text-muted uppercase">
                                            {label}
                                        </span>
                                        <Select value={yr} onValueChange={(v) => set(mo ? `${v}-${mo}` : v)}>
                                            <SelectTrigger className="w-24 border border-border-subtle dark:border-[#585d61]">
                                                <SelectValue placeholder={t('history.customRange.year')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {years.map((y) => (
                                                    <SelectItem key={y} value={y}>
                                                        {y}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Select value={mo} onValueChange={(v) => set(yr ? `${yr}-${v}` : v)}>
                                            <SelectTrigger className="w-20 border border-border-subtle dark:border-[#585d61]">
                                                <SelectValue placeholder={t('history.customRange.month')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {months.map((name, i) => (
                                                    <SelectItem key={name} value={String(i + 1).padStart(2, '0')}>
                                                        {name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <p className="mb-4 text-[13px] tracking-[0.14px] text-muted">
                        {exportCount === 0
                            ? t('history.exportNoSessions')
                            : t('history.exportModal.count', { count: exportCount })}
                    </p>
                </div>

                <div className={`${modalFooterChrome} flex gap-2.5 px-7`}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 cursor-pointer rounded-full border border-border bg-surface px-4 py-2.5 text-[13px] font-medium tracking-[0.14px] text-secondary transition-colors hover:bg-surface-elevated dark:bg-surface-elevated dark:text-[#e5e5e5]"
                    >
                        {t('history.exportCancelLabel')}
                    </button>
                    <button
                        type="button"
                        disabled={!canExport}
                        onClick={handleConfirm}
                        className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-transparent bg-primary px-4 py-2.5 text-[13px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 dark:border-white dark:bg-[#0d0d0d]"
                    >
                        <Download size={14} strokeWidth={2} />
                        {t('history.exportOkLabel')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

import type { EditScope } from '@features/schedule';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { ArrowRight, Layers, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Edit scope for recurring batches (owned by features/schedule, re-exported here).
 * - single:      Edit only this occurrence (exception insert)
 * - from_this:   Edit this and all future occurrences (split rule)
 * - all:         Edit all occurrences (update entire rule)
 */
export type { EditScope };

interface RecurringEditScopeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (scope: EditScope) => void;
    /** Human-readable description of the batch (e.g., "Brazil Cerrado / 25kg") */
    batchLabel: string;
    /** The recurrence pattern description (e.g., "매주 화요일") */
    recurrenceLabel: string;
    /** True if this batch is the first occurrence */
    isFirstInstance?: boolean;
}

export const RecurringEditScopeModal = ({
    open,
    onClose,
    onConfirm,
    batchLabel,
    recurrenceLabel,
    isFirstInstance = false,
}: RecurringEditScopeModalProps) => {
    const { t } = useTranslation();
    if (!open) return null;

    const SCOPE_OPTIONS: {
        scope: EditScope;
        icon: React.ReactNode;
        title: string;
        description: string;
    }[] = [
        {
            scope: 'single',
            icon: <Pencil size={16} strokeWidth={1.5} />,
            title: t('schedule.recurringEditScope.single.title'),
            description: t('schedule.recurringEditScope.single.description'),
        },
        {
            scope: 'from_this',
            icon: <ArrowRight size={16} strokeWidth={1.5} />,
            title: t('schedule.recurringEditScope.fromThis.title'),
            description: t('schedule.recurringEditScope.fromThis.description'),
        },
        {
            scope: 'all',
            icon: <Layers size={16} strokeWidth={1.5} />,
            title: t('schedule.recurringEditScope.all.title'),
            description: t('schedule.recurringEditScope.all.description'),
        },
    ];

    // If this is the first instance, single and from_this are equivalent — simplify options
    const options = isFirstInstance ? SCOPE_OPTIONS.filter((o) => o.scope !== 'single') : SCOPE_OPTIONS;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="recurring-edit-scope-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-palette-blue/12 dark:bg-surface-elevated text-palette-blue dark:text-primary flex items-center justify-center shrink-0">
                    <Layers size={18} strokeWidth={1.5} />
                </div>
                <div>
                    <h2
                        id="recurring-edit-scope-title"
                        className="text-[18px] font-semibold text-primary tracking-[-0.3px] leading-tight"
                    >
                        {t('schedule.recurringEditScope.title')}
                    </h2>
                    <p className="text-[12px] text-muted mt-0.5 leading-snug">{batchLabel}</p>
                </div>
            </div>
            <p className="text-[12px] text-secondary bg-surface dark:bg-surface-elevated rounded-xl px-3 py-2 mb-5">
                {t('schedule.recurringEditScope.recurringBatch', { recurrence: recurrenceLabel })}
            </p>

            {/* Scope options */}
            <div className="flex flex-col gap-2 mb-4">
                {options.map(({ scope, icon, title, description }) => (
                    <div
                        key={scope}
                        className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-surface dark:bg-surface-elevated hover:bg-surface-raised cursor-pointer transition-colors border border-transparent dark:border-border hover:border-border"
                        onClick={() => onConfirm(scope)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onConfirm(scope);
                        }}
                    >
                        <div className="w-8 h-8 rounded-lg bg-main-bg text-muted flex items-center justify-center shrink-0 mt-0.5">
                            {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-primary">{title}</div>
                            <div className="text-[11px] text-muted mt-0.5 leading-snug">{description}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Cancel */}
            <div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2.5 rounded-xl border border-border bg-surface dark:bg-surface-elevated text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors shadow-(--shadow-inset)"
                >
                    {t('common.cancel')}
                </button>
            </div>
        </ModalShell>
    );
};

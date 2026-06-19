import { useTranslation } from 'react-i18next';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Trash2 } from 'lucide-react';
import type { EditScope } from './RecurringEditScopeModal';

interface RecurringDeleteScopeModalProps {
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

export const RecurringDeleteScopeModal = ({
    open,
    onClose,
    onConfirm,
    batchLabel,
    recurrenceLabel,
    isFirstInstance = false,
}: RecurringDeleteScopeModalProps) => {
    const { t } = useTranslation();
    if (!open) return null;

    const SCOPE_OPTIONS: {
        scope: EditScope;
        title: string;
        description: string;
    }[] = [
        {
            scope: 'single',
            title: t('schedule.recurringDeleteScope.single.title'),
            description: t('schedule.recurringDeleteScope.single.description'),
        },
        {
            scope: 'from_this',
            title: t('schedule.recurringDeleteScope.fromThis.title'),
            description: t('schedule.recurringDeleteScope.fromThis.description'),
        },
        {
            scope: 'all',
            title: t('schedule.recurringDeleteScope.all.title'),
            description: t('schedule.recurringDeleteScope.all.description'),
        },
    ];

    const options = isFirstInstance ? SCOPE_OPTIONS.filter((o) => o.scope !== 'single') : SCOPE_OPTIONS;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="recurring-delete-scope-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg dark:bg-[#181d21] dark:[&_*]:!text-white rounded-[16px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px] border border-transparent dark:border-[#585d61]"
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 flex items-center justify-center shrink-0">
                    <Trash2 size={18} />
                </div>
                <div>
                    <h2
                        id="recurring-delete-scope-title"
                        className="text-[18px] font-semibold text-primary tracking-[-0.3px] leading-tight"
                    >
                        {t('schedule.recurringDeleteScope.title')}
                    </h2>
                    <p className="text-[12px] text-muted mt-0.5 leading-snug">{batchLabel}</p>
                </div>
            </div>
            <p className="text-[12px] text-secondary dark:text-white bg-surface dark:bg-surface-elevated rounded-xl px-3 py-2 mb-5">
                {t('schedule.recurringDeleteScope.recurringBatch', { recurrence: recurrenceLabel })}
            </p>

            {/* Scope options */}
            <div className="flex flex-col gap-2 mb-4">
                {options.map(({ scope, title, description }) => (
                    <div
                        key={scope}
                        className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-surface dark:bg-surface-elevated hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors border border-transparent dark:border-[#585d61] hover:border-red-200 dark:hover:border-red-500/30"
                        onClick={() => onConfirm(scope)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onConfirm(scope);
                        }}
                    >
                        <div className="w-8 h-8 rounded-lg bg-main-bg dark:bg-[#1a1e23] text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                            <Trash2 size={14} />
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
                    onClick={onClose}
                    className="w-full py-2.5 rounded-xl border border-border dark:border-[#585d61] bg-surface dark:bg-surface-elevated text-secondary dark:text-white text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors shadow-(--shadow-inset)"
                >
                    {t('common.cancel')}
                </button>
            </div>
        </ModalShell>
    );
};

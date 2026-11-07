import { cn } from '@shared/lib/cn';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditScope } from './RecurringEditScopeModal';

interface RecurringDeleteScopeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (scope: EditScope) => void;
    /** Human-readable description of the batch (e.g., "Brazil Cerrado / 25kg") */
    batchLabel: string;
    /** The recurrence pattern description (e.g., "매주 화요일") */
    recurrenceLabel: string;
}

export const RecurringDeleteScopeModal = (props: RecurringDeleteScopeModalProps) =>
    props.open ? <RecurringDeleteScopeDialog {...props} /> : null;

const RecurringDeleteScopeDialog = ({
    onClose,
    onConfirm,
    batchLabel,
    recurrenceLabel,
}: RecurringDeleteScopeModalProps) => {
    const { t } = useTranslation();
    const scopeGroup = useId();
    const [selectedScope, setSelectedScope] = useState<EditScope>('single');

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

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="recurring-delete-scope-title"
            overlayClassName="z-[10000]"
            contentClassName={cn(modalPanel.sm, 'max-h-[calc(100dvh-48px)] overflow-y-auto p-5')}
        >
            <ModalHeader
                title={t('schedule.recurringDeleteScope.title')}
                titleId="recurring-delete-scope-title"
                onClose={onClose}
                closeLabel={t('common.close')}
                className="items-start"
                titleClassName="m-0 text-xl font-semibold leading-7 tracking-tight text-primary"
                subtitle={<p className="mt-1 break-words text-xs leading-5 text-muted">{batchLabel}</p>}
                closeClassName="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-muted transition-colors hover:bg-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            <p className="mb-4 mt-3 text-xs leading-5 text-secondary">
                {t('schedule.recurringDeleteScope.recurringBatch', { recurrence: recurrenceLabel })}
            </p>

            <fieldset className="m-0 min-w-0 border-none p-0">
                <legend className="sr-only">{t('schedule.recurringDeleteScope.title')}</legend>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {SCOPE_OPTIONS.map(({ scope, title, description }) => (
                        <label
                            key={scope}
                            className={cn(
                                'flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-surface-elevated',
                                selectedScope === scope && 'bg-surface-elevated',
                            )}
                        >
                            <input
                                type="radio"
                                name={scopeGroup}
                                value={scope}
                                checked={selectedScope === scope}
                                onChange={() => setSelectedScope(scope)}
                                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            />
                            <span className="min-w-0">
                                <span className="block text-[13px] font-medium leading-5 text-primary">{title}</span>
                                <span className="mt-1 block text-xs leading-5 text-muted">{description}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="mt-5 flex justify-end gap-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="h-8 min-w-18 cursor-pointer rounded-lg border border-border bg-main-bg px-4 text-sm text-primary transition-colors duration-100 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    {t('common.cancel')}
                </button>
                <button
                    type="button"
                    onClick={() => onConfirm(selectedScope)}
                    className="h-8 min-w-18 cursor-pointer rounded-lg border-none bg-(--color-phase-danger-bg) px-4 text-sm text-(--color-phase-danger) transition-colors duration-100 hover:bg-(--color-phase-danger)/15 active:bg-(--color-phase-danger)/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    {t('common.delete')}
                </button>
            </div>
        </ModalShell>
    );
};

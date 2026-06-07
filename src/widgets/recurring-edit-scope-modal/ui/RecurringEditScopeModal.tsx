import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Pencil, Trash2, ArrowRight, Layers } from 'lucide-react';

/**
 * Edit scope for recurring batches.
 * - single:      Edit/delete only this occurrence (exception insert)
 * - from_this:   Edit/delete this and all future occurrences (split rule)
 * - all:         Edit/delete all occurrences (update/cancel entire rule)
 */
export type EditScope = 'single' | 'from_this' | 'all';

interface RecurringEditScopeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (scope: EditScope, action: 'edit' | 'delete') => void;
    /** Human-readable description of the batch (e.g., "Brazil Cerrado / 25kg") */
    batchLabel: string;
    /** The recurrence pattern description (e.g., "매주 화요일") */
    recurrenceLabel: string;
    /** True if this batch is the first occurrence */
    isFirstInstance?: boolean;
}

const SCOPE_OPTIONS: {
    scope: EditScope;
    icon: React.ReactNode;
    title: string;
    description: string;
}[] = [
    {
        scope: 'single',
        icon: <Pencil size={16} />,
        title: '이 배치만',
        description: '선택한 날짜의 배치만 수정됩니다. 나머지 일정은 유지됩니다.',
    },
    {
        scope: 'from_this',
        icon: <ArrowRight size={16} />,
        title: '이 배치부터 이후 전체',
        description: '선택한 날짜부터 이후의 모든 반복 일정이 변경됩니다.',
    },
    {
        scope: 'all',
        icon: <Layers size={16} />,
        title: '전체 반복 일정',
        description: '모든 반복 일정이 변경됩니다. 과거 기록은 유지됩니다.',
    },
];

export const RecurringEditScopeModal = ({
    open,
    onClose,
    onConfirm,
    batchLabel,
    recurrenceLabel,
    isFirstInstance = false,
}: RecurringEditScopeModalProps) => {
    if (!open) return null;

    // If this is the first instance, single and from_this are equivalent — simplify options
    const options = isFirstInstance
        ? SCOPE_OPTIONS.filter((o) => o.scope !== 'single')
        : SCOPE_OPTIONS;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="recurring-edit-scope-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg rounded-[20px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px]"
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-[rgba(219,234,254,0.9)] text-[#2563eb] flex items-center justify-center shrink-0">
                    <Layers size={18} />
                </div>
                <div>
                    <h2
                        id="recurring-edit-scope-title"
                        className="text-[18px] font-semibold text-primary tracking-[-0.3px] leading-tight"
                    >
                        반복 일정 변경
                    </h2>
                    <p className="text-[12px] text-muted mt-0.5 leading-snug">
                        {batchLabel}
                    </p>
                </div>
            </div>
            <p className="text-[12px] text-secondary bg-surface rounded-xl px-3 py-2 mb-5">
                <span className="font-medium text-primary">{recurrenceLabel}</span> 반복 중인 배치입니다.
            </p>

            {/* Scope options */}
            <div className="flex flex-col gap-2 mb-6">
                {options.map(({ scope, icon, title, description }) => (
                    <div
                        key={scope}
                        className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-surface hover:bg-surface-raised cursor-pointer transition-colors border border-transparent hover:border-border"
                        onClick={() => onConfirm(scope, 'edit')}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(scope, 'edit'); }}
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

            {/* Delete action */}
            <div className="border-t border-border pt-4">
                <button
                    onClick={() => onConfirm('single', 'delete')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-none bg-transparent text-red-500 text-[12px] font-medium cursor-pointer hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={13} strokeWidth={2} />
                    이 배치 삭제
                </button>
                <button
                    onClick={() => onConfirm('from_this', 'delete')}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border-none bg-transparent text-red-400 text-[11px] font-medium cursor-pointer hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={12} strokeWidth={1.5} />
                    이후 전체 삭제
                </button>
                <button
                    onClick={() => onConfirm('all', 'delete')}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border-none bg-transparent text-red-400 text-[11px] font-medium cursor-pointer hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={12} strokeWidth={1.5} />
                    전체 반복 삭제
                </button>
            </div>

            {/* Cancel */}
            <div className="mt-3">
                <button
                    onClick={onClose}
                    className="w-full py-2.5 rounded-xl border border-border bg-surface text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors shadow-(--shadow-inset)"
                >
                    취소
                </button>
            </div>
        </ModalShell>
    );
};
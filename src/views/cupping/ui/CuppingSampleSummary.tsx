import {
    type CuppingSampleWithMeta,
    formatBeanCuppingMeta,
    useDeleteCuppingSample,
    useReorderCuppingSamples,
} from '@entities/cupping';
import { formatDateShort } from '@shared/lib/format';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingScoreList } from './CuppingScoreList';
import { CuppingSampleListSkeleton } from './CuppingSkeleton';

type CuppingSampleSummaryProps = {
    userId: string;
    eventId: string;
    samples: CuppingSampleWithMeta[];
    isLoading: boolean;
    /** Ended session: view scores only (no add/reorder/delete). */
    readOnly?: boolean;
    formSnapshot?: unknown;
    onAddClick: () => void;
    onEditClick: (sample: CuppingSampleWithMeta) => void;
};

function moveIndex(ids: string[], index: number, dir: 'up' | 'down'): string[] | null {
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= ids.length) return null;
    const next = [...ids];
    const tmp = next[index];
    next[index] = next[to];
    next[to] = tmp;
    return next;
}

export const CuppingSampleSummary = ({
    userId,
    eventId,
    samples,
    isLoading,
    readOnly = false,
    formSnapshot,
    onAddClick,
    onEditClick,
}: CuppingSampleSummaryProps) => {
    const { t } = useTranslation();
    const deleteSample = useDeleteCuppingSample(userId, eventId);
    const reorderSamples = useReorderCuppingSamples(eventId);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    if (isLoading) {
        return <CuppingSampleListSkeleton />;
    }

    if (samples.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-border">
                <p className="max-w-md text-[13px] leading-relaxed text-muted tracking-[0.14px]">
                    {readOnly ? t('cupping.noSamplesEnded') : t('cupping.noSamples')}
                </p>
                {!readOnly ? (
                    <SurfaceButton onClick={onAddClick} icon={<Plus size={14} strokeWidth={2} />} className="px-4 py-2">
                        {t('cupping.addSamples')}
                    </SurfaceButton>
                ) : null}
            </div>
        );
    }

    const handleMove = (index: number, dir: 'up' | 'down') => {
        const next = moveIndex(
            samples.map((s) => s.id),
            index,
            dir,
        );
        if (!next) return;
        void reorderSamples.mutateAsync(next);
    };

    const toggleExpanded = (id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    };

    const onRowKeyDown = (e: KeyboardEvent, id: string) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded(id);
        }
    };

    return (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-border">
            <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                    <tr className="border-b border-border-subtle dark:border-border">
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">#</th>
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('cupping.colLabel')}
                        </th>
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('cupping.colBean')}
                        </th>
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('cupping.colRoast')}
                        </th>
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('cupping.colScores')}
                        </th>
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('cupping.colAvg')}
                        </th>
                        {!readOnly ? (
                            <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                {t('cupping.colActions')}
                            </th>
                        ) : null}
                    </tr>
                </thead>
                <tbody>
                    {samples.map((s, i) => {
                        const bean = s.roast_sessions?.beans ?? null;
                        const beanMeta = formatBeanCuppingMeta(bean);
                        const open = expandedId === s.id;
                        const colSpan = readOnly ? 6 : 7;
                        return (
                            <Fragment key={s.id}>
                                <tr
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={open}
                                    onClick={() => toggleExpanded(s.id)}
                                    onKeyDown={(e) => onRowKeyDown(e, s.id)}
                                    className="cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-surface/50 dark:border-border"
                                >
                                    <td className="px-4 py-3 font-mono text-[12px] text-muted">{i + 1}</td>
                                    <td className="px-4 py-3 text-[13px] font-medium text-primary">{s.label}</td>
                                    <td className="px-4 py-3">
                                        {bean ? (
                                            <div>
                                                <div className="text-[13px] font-medium text-primary">{bean.name}</div>
                                                {beanMeta ? (
                                                    <div className="mt-0.5 text-[11px] leading-snug text-muted">
                                                        {beanMeta}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <span className="text-[12px] text-muted">{t('cupping.noRoastLink')}</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-[12px] text-secondary">
                                        {s.roast_sessions
                                            ? formatDateShort(s.roast_sessions.roasted_at)
                                            : t('cupping.noRoastLink')}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">{s.score_count}</td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {s.avg_score != null ? s.avg_score.toFixed(2) : '—'}
                                    </td>
                                    {!readOnly ? (
                                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-1">
                                                {(
                                                    [
                                                        {
                                                            dir: 'up' as const,
                                                            Icon: ChevronUp,
                                                            label: t('cupping.moveUp'),
                                                        },
                                                        {
                                                            dir: 'down' as const,
                                                            Icon: ChevronDown,
                                                            label: t('cupping.moveDown'),
                                                        },
                                                    ] as const
                                                ).map(({ dir, Icon, label }) => (
                                                    <button
                                                        key={dir}
                                                        type="button"
                                                        onClick={() => handleMove(i, dir)}
                                                        disabled={
                                                            reorderSamples.isPending ||
                                                            (dir === 'up' ? i === 0 : i === samples.length - 1)
                                                        }
                                                        title={label}
                                                        aria-label={label}
                                                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-surface text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 dark:bg-surface-elevated"
                                                    >
                                                        <Icon size={13} strokeWidth={2} />
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => onEditClick(s)}
                                                    className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-primary"
                                                    aria-label={t('common.edit')}
                                                >
                                                    <Pencil size={13} strokeWidth={1.75} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        if (await confirm(t('cupping.deleteSampleConfirm'))) {
                                                            void deleteSample.mutateAsync(s.id);
                                                        }
                                                    }}
                                                    className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                                                    aria-label={t('common.delete')}
                                                >
                                                    <Trash2 size={13} strokeWidth={1.75} />
                                                </button>
                                            </div>
                                        </td>
                                    ) : null}
                                </tr>
                                {open ? (
                                    <tr className="border-b border-border-subtle bg-surface/30 dark:border-border dark:bg-[#1c1f22]">
                                        <td colSpan={colSpan} className="p-0">
                                            <div className="border-t border-border-subtle dark:border-border">
                                                <div className="px-4 pt-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                                    {t('cupping.scoreDetail')}
                                                </div>
                                                <CuppingScoreList sampleId={s.id} formSnapshot={formSnapshot} />
                                            </div>
                                        </td>
                                    </tr>
                                ) : null}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

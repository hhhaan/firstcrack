import { type CuppingSampleWithMeta, formatBeanCuppingMeta, useDeleteCuppingSample } from '@entities/cupping';
import { formatDateShort } from '@shared/lib/format';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CuppingSampleListSkeleton } from './CuppingSkeleton';

type CuppingSampleSummaryProps = {
    userId: string;
    eventId: string;
    samples: CuppingSampleWithMeta[];
    isLoading: boolean;
    onAddClick: () => void;
};

export const CuppingSampleSummary = ({
    userId,
    eventId,
    samples,
    isLoading,
    onAddClick,
}: CuppingSampleSummaryProps) => {
    const { t } = useTranslation();
    const deleteSample = useDeleteCuppingSample(userId, eventId);

    if (isLoading) {
        return <CuppingSampleListSkeleton />;
    }

    if (samples.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-[#585d61]">
                <p className="max-w-md text-[13px] leading-relaxed text-muted tracking-[0.14px]">
                    {t('cupping.noSamples')}
                </p>
                <SurfaceButton onClick={onAddClick} icon={<Plus size={14} strokeWidth={2} />} className="px-4 py-2">
                    {t('cupping.addSamples')}
                </SurfaceButton>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
            <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                    <tr className="border-b border-border-subtle dark:border-[#585d61]">
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
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('cupping.colActions')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {samples.map((s: CuppingSampleWithMeta, i: number) => {
                        const bean = s.roast_sessions?.beans ?? null;
                        const beanMeta = formatBeanCuppingMeta(bean);
                        return (
                            <tr
                                key={s.id}
                                className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61]"
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
                                <td className="px-4 py-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (window.confirm(t('cupping.deleteSampleConfirm'))) {
                                                void deleteSample.mutateAsync(s.id);
                                            }
                                        }}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
                                        aria-label={t('common.delete')}
                                    >
                                        <Trash2 size={13} strokeWidth={1.75} />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

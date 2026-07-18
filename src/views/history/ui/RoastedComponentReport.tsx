import { useBeans } from '@entities/bean/queries';
import { beanStockEventApi } from '@entities/bean-stock-event';
import { useActiveWorkspace } from '@entities/organization';
import { roastedStockEventApi } from '@entities/roasted-stock-event';
import { FEATURE, useFeature } from '@shared/lib/features';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildRoastedComponentReport } from '../lib/buildRoastedComponentReport';

type RangeDays = 30 | 90;

export const RoastedComponentReport = () => {
    const { t } = useTranslation();
    const can = useFeature(FEATURE.roastedInventory);
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const [range, setRange] = useState<RangeDays>(30);
    const { data: beans = [] } = useBeans(userId);

    const sinceIso = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() - range);
        return d.toISOString();
    }, [range]);

    const { data: rows = [], isLoading } = useQuery({
        queryKey: ['roasted-component-report', userId, range],
        queryFn: async () => {
            const [green, roasted] = await Promise.all([
                beanStockEventApi.listByUserSince(userId, sinceIso),
                roastedStockEventApi.listByUser(userId, 1000),
            ]);
            const sinceMs = new Date(sinceIso).getTime();
            const roastedInRange = roasted.filter((e) => new Date(e.created_at).getTime() >= sinceMs);
            const names = Object.fromEntries(beans.map((b) => [b.id, b.name]));
            return buildRoastedComponentReport(green, roastedInRange, names);
        },
        enabled: !!userId && can,
    });

    if (!can) return null;

    return (
        <div className="mt-8 rounded-xl border border-border-subtle p-4 dark:border-[#585d61]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-primary">{t('history.componentReport.title')}</h3>
                <div className="flex gap-1">
                    {([30, 90] as const).map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setRange(d)}
                            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                                range === d ? 'bg-primary text-white' : 'bg-surface text-secondary hover:text-primary'
                            }`}
                        >
                            {t(d === 30 ? 'history.componentReport.range30' : 'history.componentReport.range90')}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="py-6 text-center text-[13px] text-muted">…</div>
            ) : rows.length === 0 ? (
                <div className="py-6 text-center text-[13px] text-muted">—</div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-[13px]">
                            <thead>
                                <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wide text-muted">
                                    <th className="py-2 pr-3 font-semibold">{t('history.componentReport.colBean')}</th>
                                    <th className="py-2 pr-3 font-semibold">{t('history.componentReport.colGreen')}</th>
                                    <th className="py-2 pr-3 font-semibold">
                                        {t('history.componentReport.colRoasted')}
                                    </th>
                                    <th className="py-2 font-semibold">{t('history.componentReport.colLoss')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.beanId} className="border-b border-border-subtle/60 last:border-0">
                                        <td className="py-2 pr-3 font-medium text-primary">{r.beanName}</td>
                                        <td className="py-2 pr-3 font-mono text-secondary">
                                            {(r.greenUsedG / 1000).toFixed(2)}
                                        </td>
                                        <td className="py-2 pr-3 font-mono text-secondary">
                                            {(r.roastedInG / 1000).toFixed(2)}
                                            {r.hasEstimate ? '*' : ''}
                                        </td>
                                        <td className="py-2 font-mono text-secondary">
                                            {r.lossPct == null ? '—' : `${r.lossPct}%`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {rows.some((r) => r.hasEstimate) && (
                        <p className="mt-2 text-[11px] text-muted">{t('history.componentReport.estimateFootnote')}</p>
                    )}
                </>
            )}
        </div>
    );
};

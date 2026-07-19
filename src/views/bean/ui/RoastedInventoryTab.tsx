import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastedStock } from '@entities/roasted-stock-event';
import { Badge } from '@shared/ui/Badge';
import { TableSkeleton } from '@shared/ui/TableSkeleton';
import { Coffee, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const fmtKg = (grams: number) => `${(grams / 1000).toFixed(2)} kg`;

const skeletonCols = [
    { width: '40%', bar: '65%' },
    { width: '16%', bar: 48, height: 18, borderRadius: '9999px' },
    { width: '20%', bar: '50%' },
    { width: '24%', bar: 72, height: 18, borderRadius: '9999px' },
];

export const RoastedInventoryTab = () => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: stock = {}, isLoading } = useRoastedStock(userId);
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);
    const [search, setSearch] = useState('');

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return Object.entries(stock)
            .map(([key, s]) => {
                const [kind, id] = key.split(':');
                const name =
                    kind === 'bean'
                        ? (beans.find((b) => b.id === id)?.name ?? t('inventory.roasted.unknownBean'))
                        : (blends.find((b) => b.id === id)?.name ?? t('inventory.roasted.unknownBlend'));
                return {
                    key,
                    kind: kind === 'blend' ? ('blend' as const) : ('bean' as const),
                    name,
                    grams: s.grams,
                    hasEstimate: s.hasEstimate,
                };
            })
            .filter((r) => !q || r.name.toLowerCase().includes(q))
            .sort((a, b) => b.grams - a.grams);
    }, [stock, beans, blends, search, t]);

    const totalGrams = useMemo(() => rows.reduce((sum, r) => sum + r.grams, 0), [rows]);
    const hasAnyStock = Object.keys(stock).length > 0;

    if (isLoading) {
        return (
            <div className="space-y-3">
                <div className="h-10 w-full max-w-xs animate-pulse rounded-lg bg-surface" />
                <TableSkeleton cols={skeletonCols} rows={5} minWidth="520px" />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-main-bg px-3 py-[9px] dark:border dark:border-[#585d61] sm:max-w-xs">
                    <Search size={14} strokeWidth={2} className="shrink-0 text-muted" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('inventory.roasted.searchPlaceholder')}
                        className="w-full border-none bg-transparent font-body text-[13px] tracking-[0.14px] text-primary outline-none"
                    />
                </div>
                {hasAnyStock && (
                    <span className="font-mono text-[12px] text-muted">
                        {t('inventory.roasted.total', { kg: (totalGrams / 1000).toFixed(2) })}
                    </span>
                )}
            </div>

            {!hasAnyStock ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-[#585d61]">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                        <Coffee size={20} strokeWidth={1.5} />
                    </div>
                    <p className="max-w-sm text-[13px] leading-relaxed tracking-[0.14px] text-muted">
                        {t('inventory.roasted.empty')}
                    </p>
                </div>
            ) : rows.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-muted">{t('inventory.roasted.noMatch')}</div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                    <table className="w-full min-w-[520px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                {(['name', 'type', 'stock', 'status'] as const).map((c) => (
                                    <th
                                        key={c}
                                        className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted"
                                    >
                                        {t(`inventory.roasted.col.${c}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr
                                    key={r.key}
                                    className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61] dark:hover:bg-surface-elevated/40"
                                >
                                    <td className="px-4 py-3.5 text-[13px] font-medium tracking-[0.14px] text-primary">
                                        {r.name}
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <Badge tone={r.kind === 'blend' ? 'lavenderSoft' : 'soft'} size="sm">
                                            {r.kind === 'blend'
                                                ? t('inventory.roasted.blendBadge')
                                                : t('inventory.roasted.singleBadge')}
                                        </Badge>
                                    </td>
                                    <td
                                        className={`px-4 py-3.5 font-mono text-[13px] font-medium ${
                                            r.grams < 0 ? 'text-red-500' : 'text-primary'
                                        }`}
                                    >
                                        {fmtKg(r.grams)}
                                    </td>
                                    <td className="px-4 py-3.5">
                                        {r.hasEstimate ? (
                                            <Badge tone="warn" size="sm">
                                                {t('inventory.roasted.estimateBadge')}
                                            </Badge>
                                        ) : (
                                            <span className="text-[12px] text-muted">—</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

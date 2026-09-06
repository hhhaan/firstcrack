import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastedStock, useRoastedStockEvents } from '@entities/roasted-stock-event';
import { AdjustStockModal } from '@features/adjust-stock';
import { gramsToKg, localeForDate } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { TableSkeleton } from '@shared/ui/TableSkeleton';
import { Coffee, Search, SlidersHorizontal } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const fmtKg = (grams: number) => `${gramsToKg(grams)} kg`;

const skeletonCols = [
    { width: '36%', bar: '65%' },
    { width: '14%', bar: 48, height: 18, borderRadius: '9999px' },
    { width: '16%', bar: '50%' },
    { width: '18%', bar: 72, height: 18, borderRadius: '9999px' },
    { width: '16%', bar: 48 },
];

const ghostBtn =
    'inline-flex items-center justify-center gap-1 rounded-full border border-border-subtle bg-transparent px-2.5 py-1 text-[12px] font-medium tracking-[0.14px] text-secondary transition-colors hover:bg-surface hover:text-primary dark:border-[#585d61] dark:hover:bg-surface-elevated cursor-pointer';

export const RoastedInventoryTab = () => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: stock = {}, isLoading } = useRoastedStock(userId);
    const { data: events = [] } = useRoastedStockEvents(userId);
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);
    const [search, setSearch] = useState('');
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [adjustTarget, setAdjustTarget] = useState<{
        name: string;
        beanId: string | null;
        blendId: string | null;
        grams: number;
        kind: 'bean' | 'blend';
    } | null>(null);

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
                    id,
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
                {!isLoading && hasAnyStock && (
                    <span className="font-mono text-[12px] text-muted">
                        {t('inventory.roasted.total', { kg: gramsToKg(totalGrams) })}
                    </span>
                )}
            </div>

            {isLoading ? (
                <TableSkeleton cols={skeletonCols} rows={5} minWidth="560px" />
            ) : !hasAnyStock ? (
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
                    <table className="w-full min-w-[560px] border-collapse text-left">
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
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const history = events.filter((e) =>
                                    r.kind === 'bean' ? e.bean_id === r.id : e.blend_id === r.id,
                                );
                                return (
                                    <Fragment key={r.key}>
                                        <tr className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61] dark:hover:bg-surface-elevated/40">
                                            <td className="px-4 py-3.5 text-[13px] font-medium tracking-[0.14px] text-primary">
                                                <button
                                                    type="button"
                                                    className="text-left hover:underline"
                                                    onClick={() => setExpandedKey((k) => (k === r.key ? null : r.key))}
                                                >
                                                    {r.name}
                                                </button>
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
                                            <td className="px-4 py-3.5 text-right">
                                                <button
                                                    type="button"
                                                    className={ghostBtn}
                                                    onClick={() =>
                                                        setAdjustTarget({
                                                            name: r.name,
                                                            beanId: r.kind === 'bean' ? r.id : null,
                                                            blendId: r.kind === 'blend' ? r.id : null,
                                                            grams: r.grams,
                                                            kind: r.kind,
                                                        })
                                                    }
                                                >
                                                    <SlidersHorizontal size={13} strokeWidth={1.75} />
                                                    {t('inventory.roasted.adjust')}
                                                </button>
                                            </td>
                                        </tr>
                                        {expandedKey === r.key && (
                                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                                <td
                                                    colSpan={5}
                                                    className="bg-surface/40 px-4 py-3 dark:bg-surface-elevated/20"
                                                >
                                                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                                        {t('inventory.event.history')}
                                                    </p>
                                                    {history.length === 0 ? (
                                                        <p className="text-[12px] text-muted">—</p>
                                                    ) : (
                                                        <ul className="max-h-28 space-y-1.5 overflow-y-auto">
                                                            {history.slice(0, 20).map((ev) => (
                                                                <li
                                                                    key={ev.id}
                                                                    className="flex gap-2 font-mono text-[12px] text-secondary"
                                                                >
                                                                    <span
                                                                        className={
                                                                            ev.delta_grams > 0
                                                                                ? 'text-palette-green'
                                                                                : 'text-palette-purple'
                                                                        }
                                                                    >
                                                                        {ev.delta_grams > 0 ? '+' : ''}
                                                                        {ev.delta_grams}g
                                                                    </span>
                                                                    <span>
                                                                        {t(`inventory.event.${ev.event_type}`, {
                                                                            defaultValue: ev.event_type,
                                                                        })}
                                                                    </span>
                                                                    {ev.note ? (
                                                                        <span className="text-muted">— {ev.note}</span>
                                                                    ) : null}
                                                                    <span className="ml-auto text-muted">
                                                                        {new Date(ev.created_at).toLocaleDateString(
                                                                            localeForDate(),
                                                                        )}
                                                                    </span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {adjustTarget && (
                <AdjustStockModal
                    kind="roasted"
                    open
                    onClose={() => setAdjustTarget(null)}
                    name={adjustTarget.name}
                    beanId={adjustTarget.beanId}
                    blendId={adjustTarget.blendId}
                    currentGrams={adjustTarget.grams}
                    kindLabel={
                        adjustTarget.kind === 'blend'
                            ? t('inventory.roasted.blendBadge')
                            : t('inventory.roasted.singleBadge')
                    }
                />
            )}
        </div>
    );
};

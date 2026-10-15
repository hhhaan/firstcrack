import { useBeans } from '@entities/bean';
import { useRoastingRequirements } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastProfiles } from '@entities/roast-profile';
import { cn } from '@shared/lib/cn';
import { Skeleton } from '@shared/ui/Skeleton';
import { ChevronRight, Flame } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AggregatedBeanRequirement, aggregateBeanRequirements } from '../lib/aggregateBeanRequirements';

const formatKg = (grams: number) => `${(grams / 1000).toFixed(2)} kg`;

/** Display-only aggregation: what to roast to cover unfulfilled paid orders. */
export const RoastingRequirementsCard = () => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: req, isLoading } = useRoastingRequirements(userId);
    const { data: beans = [] } = useBeans(userId);
    const { data: roastProfiles = [] } = useRoastProfiles(userId);
    const [expandedBeans, setExpandedBeans] = useState<Set<string>>(() => new Set());

    const beanName = useMemo(() => {
        const map = new Map(beans.map((b) => [b.id, b.name]));
        return (id: string) => map.get(id) ?? id.slice(0, 8);
    }, [beans]);

    const profileName = useMemo(() => {
        const map = new Map(roastProfiles.map((p) => [p.id, p.name]));
        return (id: string | null) =>
            id ? (map.get(id) ?? id.slice(0, 8)) : t('orders.requirements.profileUnassigned');
    }, [roastProfiles, t]);

    const beanRows = useMemo(() => aggregateBeanRequirements(req?.beans ?? []), [req?.beans]);

    const toggleBreakdown = (beanId: string) => {
        setExpandedBeans((prev) => {
            const next = new Set(prev);
            if (next.has(beanId)) next.delete(beanId);
            else next.add(beanId);
            return next;
        });
    };

    const renderProfileLines = (row: AggregatedBeanRequirement) =>
        row.profiles.map((profile, index) => (
            <li key={`${profile.roast_profile_id ?? 'none'}-${index}`} className="font-mono text-[12px] text-muted">
                {t('orders.requirements.profileAmount', {
                    name: profileName(profile.roast_profile_id),
                    amount: (profile.green_grams_needed / 1000).toFixed(2),
                })}
            </li>
        ));

    return (
        <div className="rounded-xl border border-border-subtle bg-main-bg p-5 dark:border-[#585d61]">
            <div className="mb-4 flex items-center gap-2">
                <Flame size={16} className="text-primary" />
                <h3 className="text-sm font-semibold text-primary">{t('orders.requirements.title')}</h3>
            </div>

            {isLoading ? (
                <div className="space-y-3" role="status" aria-busy="true">
                    {Array.from({ length: 3 }, (_, i) => (
                        <div key={i} className="flex items-center justify-between gap-4">
                            <Skeleton width="30%" height={14} borderRadius="4px" />
                            <Skeleton width={64} height={14} borderRadius="4px" />
                            <Skeleton width={64} height={14} borderRadius="4px" />
                        </div>
                    ))}
                </div>
            ) : beanRows.length === 0 ? (
                <p className="text-[13px] text-muted">{t('orders.requirements.empty')}</p>
            ) : (
                <table className="w-full border-collapse text-left">
                    <thead>
                        <tr className="border-b border-border-subtle dark:border-[#585d61]">
                            <th className="pb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                {t('orders.requirements.bean')}
                            </th>
                            <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                {t('orders.requirements.green')}
                            </th>
                            <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                {t('orders.requirements.available')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {beanRows.map((b) => {
                            const short = b.green_grams_needed > b.green_available;
                            const multiProfile = b.profiles.length > 1;
                            const expanded = expandedBeans.has(b.bean_id);
                            const breakdownId = `roasting-req-breakdown-${b.bean_id}`;
                            const name = beanName(b.bean_id);

                            return (
                                <Fragment key={b.bean_id}>
                                    <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                        <td className="py-2.5 text-[13px] font-medium text-primary">
                                            <div className="flex items-start gap-1.5">
                                                {multiProfile ? (
                                                    <button
                                                        type="button"
                                                        className="mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                                                        aria-expanded={expanded}
                                                        aria-controls={breakdownId}
                                                        aria-label={
                                                            expanded
                                                                ? t('orders.requirements.collapseBreakdown', {
                                                                      bean: name,
                                                                  })
                                                                : t('orders.requirements.expandBreakdown', {
                                                                      bean: name,
                                                                  })
                                                        }
                                                        onClick={() => toggleBreakdown(b.bean_id)}
                                                    >
                                                        <ChevronRight
                                                            size={14}
                                                            className={cn(
                                                                'transition-transform',
                                                                expanded && 'rotate-90',
                                                            )}
                                                            aria-hidden
                                                        />
                                                    </button>
                                                ) : (
                                                    <span className="w-6 shrink-0" aria-hidden />
                                                )}
                                                <div className="min-w-0">
                                                    <div>{name}</div>
                                                    {!multiProfile && b.profiles.length === 1 && (
                                                        <ul className="mt-1 list-none space-y-0.5 pl-0">
                                                            {renderProfileLines(b)}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-2.5 text-right font-mono text-[13px] text-secondary">
                                            {formatKg(b.green_grams_needed)}
                                        </td>
                                        <td
                                            className={`py-2.5 text-right font-mono text-[13px] ${short ? 'text-red-500' : 'text-secondary'}`}
                                        >
                                            {formatKg(b.green_available)}
                                        </td>
                                    </tr>
                                    {multiProfile && expanded && (
                                        <tr className="border-b border-border-subtle last:border-0 dark:border-[#585d61]">
                                            <td colSpan={3} className="pb-2.5 pl-9 pt-0">
                                                <ul
                                                    id={breakdownId}
                                                    className="list-none space-y-0.5 border-l border-border-subtle pl-3 dark:border-[#585d61]"
                                                >
                                                    {renderProfileLines(b)}
                                                </ul>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
};

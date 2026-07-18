import { useBeans } from '@entities/bean';
import { useRoastingRequirements } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { Skeleton } from '@shared/ui/Skeleton';
import { Flame } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Display-only aggregation: what to roast to cover unfulfilled paid orders. */
export const RoastingRequirementsCard = () => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: req, isLoading } = useRoastingRequirements(userId);
    const { data: beans = [] } = useBeans(userId);

    const beanName = useMemo(() => {
        const map = new Map(beans.map((b) => [b.id, b.name]));
        return (id: string) => map.get(id) ?? id.slice(0, 8);
    }, [beans]);

    const beanRows = (req?.beans ?? []).filter((b) => b.green_grams_needed > 0);

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
                            return (
                                <tr
                                    key={`${b.bean_id}-${b.roast_profile_id ?? 'none'}`}
                                    className="border-b border-border-subtle last:border-0 dark:border-[#585d61]"
                                >
                                    <td className="py-2.5 text-[13px] font-medium text-primary">
                                        {beanName(b.bean_id)}
                                    </td>
                                    <td className="py-2.5 text-right font-mono text-[13px] text-secondary">
                                        {(b.green_grams_needed / 1000).toFixed(2)} kg
                                    </td>
                                    <td
                                        className={`py-2.5 text-right font-mono text-[13px] ${short ? 'text-red-500' : 'text-secondary'}`}
                                    >
                                        {(b.green_available / 1000).toFixed(2)} kg
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
};

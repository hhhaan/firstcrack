import { type InventoryAlert, useDismissInventoryAlert, useInventoryAlerts } from '@entities/inventory-alert';
import { alertBg, alertColor } from '@views/dashboard/lib/constants';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface InventoryAlertBannerProps {
    userId: string;
}

const reasonLabelKey = (reason: InventoryAlert['reason']) => {
    if (reason === 'out') return 'dashboard.outOfStock';
    if (reason === 'schedule') return 'dashboard.scheduleStockAlert';
    return 'dashboard.lowStock';
};

export const InventoryAlertBanner = ({ userId }: InventoryAlertBannerProps) => {
    const { t } = useTranslation();
    const { data: alerts = [] } = useInventoryAlerts(userId);
    const dismiss = useDismissInventoryAlert(userId);

    const top = alerts
        .slice()
        .sort((a, b) => {
            const rank: Record<InventoryAlert['reason'], number> = { out: 0, schedule: 1, low: 2 };
            return rank[a.reason] - rank[b.reason] || a.effective_grams - b.effective_grams;
        })
        .slice(0, 3);

    if (!top.length) return null;

    return (
        <div className="shrink-0 border-b border-divider dark:border-[#585d61] bg-main-bg px-4 py-2 space-y-1.5">
            {top.map((item) => {
                const color = alertColor[item.reason] ?? '#FFFF54';
                const bg = alertBg[item.reason] ?? 'rgba(255,255,84,0.2)';
                const name = item.beans?.name ?? t('dashboard.inventoryAlerts');
                return (
                    <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 dark:border dark:border-[#585d61]"
                        style={{ background: bg }}
                    >
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-primary truncate">{name}</div>
                            <div className="text-xs text-muted">
                                {t(reasonLabelKey(item.reason))}
                                {' · '}
                                {t('dashboard.kgRemaining', {
                                    kg: (item.effective_grams / 1000).toFixed(2),
                                })}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => dismiss.mutate(item.id)}
                            className="shrink-0 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                            aria-label={t('common.dismiss')}
                        >
                            <X size={14} style={{ color }} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

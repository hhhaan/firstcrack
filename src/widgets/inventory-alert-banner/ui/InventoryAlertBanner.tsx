import { type InventoryAlert, useDismissInventoryAlert, useInventoryAlerts } from '@entities/inventory-alert';
import { useDismissedAlerts } from '@shared/store/dismissedAlerts';
import { alertColor } from '@views/dashboard/lib/constants';
import { X } from 'lucide-react';
import type { View } from '@shared/types/view';
import { useTranslation } from 'react-i18next';

interface InventoryAlertBannerProps {
    userId: string;
    onNavigate: (view: View) => void;
}

const reasonLabelKey = (reason: InventoryAlert['reason']) => {
    if (reason === 'out') return 'dashboard.outOfStock';
    if (reason === 'schedule') return 'dashboard.scheduleStockAlert';
    return 'dashboard.lowStock';
};

export const InventoryAlertBanner = ({ userId, onNavigate }: InventoryAlertBannerProps) => {
    const { t } = useTranslation();
    const { data: alerts = [] } = useInventoryAlerts(userId);
    const dismiss = useDismissInventoryAlert(userId);
    const dismissed = useDismissedAlerts();

    const top = alerts
        .filter((a) => !dismissed.has(a.id))
        .sort((a, b) => {
            const rank: Record<InventoryAlert['reason'], number> = { out: 0, schedule: 1, low: 2 };
            return rank[a.reason] - rank[b.reason] || a.effective_grams - b.effective_grams;
        })
        .slice(0, 3);

    if (!top.length) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] min-w-[280px] max-w-[360px] space-y-1.5">
            {top.map((item) => {
                const color = alertColor[item.reason] ?? '#FFFF54';
                const name = item.beans?.name ?? t('dashboard.inventoryAlerts');
                return (
                    <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 border shadow-lg"
                        style={{ background: `color-mix(in srgb, ${color} 15%, var(--color-surface))`, borderColor: color }}
                    >
                        <button
                            type="button"
                            onClick={() => { dismissed.add(item.id); onNavigate('beans'); dismiss.mutate(item.id); }}
                            className="flex-1 min-w-0 text-left cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                        >
                            <div className="text-[13px] font-medium text-primary truncate leading-snug">{name}</div>
                            <div className="text-xs text-muted leading-snug mt-0.5">
                                {t(reasonLabelKey(item.reason))}
                                {' · '}
                                {t('dashboard.kgRemaining', {
                                    kg: (item.effective_grams / 1000).toFixed(2),
                                })}
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => { dismissed.add(item.id); dismiss.mutate(item.id); }}
                            className="shrink-0 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
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

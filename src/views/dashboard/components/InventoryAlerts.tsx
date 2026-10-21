import type { DashboardInventoryAlert } from '@features/dashboard-summary';
import { Badge } from '@shared/ui/Badge';
import { useTranslation } from 'react-i18next';
import { alertBg, alertColor, alertReasonLabels } from '../lib/constants';

interface InventoryAlertsProps {
    data: DashboardInventoryAlert[];
    loading: boolean;
}

export const InventoryAlerts = ({ data, loading }: InventoryAlertsProps) => {
    const { t } = useTranslation();

    return (
        <section className="min-w-0 p-6 lg:p-8">
            <h2 className="text-[15px] font-medium text-primary tracking-[0.15px] mb-3.5">
                {t('dashboard.inventoryAlerts')}
            </h2>
            {loading ? (
                <p className="text-[13px] text-muted py-2">{t('dashboard.loading')}</p>
            ) : data.length === 0 ? (
                <p className="text-[13px] text-muted py-2">{t('dashboard.allStockOk')}</p>
            ) : (
                data.map((item, i) => {
                    const color =
                        item.reason === 'schedule'
                            ? 'var(--color-palette-green)'
                            : (alertColor[item.reason] ?? 'var(--color-palette-yellow)');
                    const bg =
                        item.reason === 'schedule'
                            ? 'color-mix(in srgb, var(--color-palette-green) 12%, transparent)'
                            : (alertBg[item.reason] ??
                              'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)');
                    const status = t(alertReasonLabels[item.reason]);
                    return (
                        <div
                            key={item.id}
                            className={`flex items-center gap-3 py-2.5 ${i < data.length - 1 ? 'border-b border-divider' : ''}`}
                        >
                            <div className="flex-1">
                                <div className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                    {item.name}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">
                                    {t('dashboard.kgRemaining', {
                                        kg: (item.effectiveGrams / 1000).toFixed(2),
                                    })}
                                    {item.effectiveGrams < 0 && (
                                        <span className="block text-palette-green mt-0.5">
                                            {t('dashboard.scheduleReservedShortfall', {
                                                kg: (Math.abs(item.effectiveGrams) / 1000).toFixed(2),
                                            })}
                                        </span>
                                    )}
                                    {item.reason === 'schedule' && item.effectiveGrams >= 0 && (
                                        <span className="block text-palette-green mt-0.5">
                                            {t('dashboard.upcomingStockShort')}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <Badge color={color} bg={bg}>
                                {status}
                            </Badge>
                        </div>
                    );
                })
            )}
        </section>
    );
};

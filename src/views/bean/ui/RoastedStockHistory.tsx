import { ROASTED_HISTORY_LIMIT, type RoastedStockLot, useRoastedStockEvents } from '@entities/roasted-stock-event';
import { useTranslation } from 'react-i18next';

export function RoastedStockHistory({ userId, lot }: { userId: string; lot: RoastedStockLot }) {
    const { t } = useTranslation();
    const { data: events = [], isLoading } = useRoastedStockEvents(userId, lot);
    return (
        <>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                {t('inventory.event.history')}
            </p>
            {isLoading ? (
                <p className="text-[12px] text-muted">{t('common.loading')}</p>
            ) : events.length === 0 ? (
                <p className="text-[12px] text-muted">—</p>
            ) : (
                <ul className="max-h-28 space-y-1.5 overflow-y-auto">
                    {events.slice(0, ROASTED_HISTORY_LIMIT).map((ev) => (
                        <li key={ev.id} className="flex gap-2 font-mono text-[12px] text-secondary">
                            <span className={ev.delta_grams > 0 ? 'text-palette-green' : 'text-palette-purple'}>
                                {ev.delta_grams > 0 ? '+' : ''}
                                {ev.delta_grams}g
                            </span>
                            <span>{t(`inventory.event.${ev.event_type}`, { defaultValue: ev.event_type })}</span>
                            {ev.note ? <span className="text-muted">— {ev.note}</span> : null}
                            <span className="ml-auto text-muted">{new Date(ev.created_at).toLocaleDateString()}</span>
                        </li>
                    ))}
                </ul>
            )}
            {events.length > ROASTED_HISTORY_LIMIT && (
                <p className="mt-2 text-[12px] text-muted">
                    {t('inventory.event.recentLimit', { count: ROASTED_HISTORY_LIMIT })}
                </p>
            )}
        </>
    );
}

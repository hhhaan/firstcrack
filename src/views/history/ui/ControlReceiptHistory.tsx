import { unresolvedReceiptAttempts } from '@features/active-roast/lib/control-receipts';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatSignedElapsed } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';

export const ControlReceiptHistory = ({ events }: { events: unknown }) => {
    const { t } = useTranslation();
    const seen = new Set<string>();
    const receipts = parseStoredRoastEvents(events).filter((event) => {
        if (!event.control_receipt || seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
    });
    if (!receipts.length) return null;
    const unresolved = unresolvedReceiptAttempts(
        receipts.map((event) => ({
            event: 'Control',
            time: '',
            temp: '',
            note: '',
            controlReceipt: event.control_receipt,
        })),
    );
    return (
        <section
            data-testid="history-control-receipts"
            className="rounded-xl border border-border-subtle bg-main-bg p-5"
        >
            <h2 className="m-0 mb-4 text-[13px] font-semibold text-primary">{t('history.receipts.title')}</h2>
            {unresolved > 0 && (
                <p role="status" className="text-[13px] text-secondary">
                    {t('history.receipts.unresolved', { count: unresolved })}
                </p>
            )}
            <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
                {receipts.map((event) => {
                    const metadata = event.control_receipt;
                    if (!metadata) return null;
                    const receipt = metadata.kind === 'receipt' ? metadata.receipt : null;
                    return (
                        <li key={event.id} className="border-t border-border-subtle py-2 text-[12px] text-secondary">
                            {receipt ? (
                                <>
                                    <span className="font-mono">
                                        {formatSignedElapsed(receipt.elapsed_sec)} · #{receipt.sequence}
                                    </span>
                                    {' · '}
                                    {t(`history.receipts.${receipt.event}`)}
                                    {' · '}
                                    {t('history.receipts.requested')}: {receipt.requested_heat_set}
                                    {receipt.acknowledged_heat_set !== null && (
                                        <>
                                            {' '}
                                            · {t('history.receipts.applied')}: {receipt.acknowledged_heat_set}
                                        </>
                                    )}
                                    {' · '}
                                    {t('history.receipts.evidence')}: {receipt.evidence}
                                    {receipt.reason && <> · {receipt.reason}</>}
                                </>
                            ) : metadata.kind === 'gap' ? (
                                t('history.receipts.gap', { from: metadata.from, through: metadata.through })
                            ) : (
                                t('history.receipts.unavailable')
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

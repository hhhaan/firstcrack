import { logger } from '@shared/lib/logger';

export type PendingRoastCharge = { owner: string; id: string; chargedAt: string };
const key = 'fc_pending_roast_charges_v1';
export const pendingChargeEvent = 'fc-pending-roast-charge';
// Memory fallback preserves recording if device storage is temporarily unavailable.
const memory = new Map<string, PendingRoastCharge>();
const identity = (item: PendingRoastCharge) => `${item.owner}:${item.id}`;

export function listPendingRoastCharges(): PendingRoastCharge[] {
    const records = new Map<string, PendingRoastCharge>();
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (Array.isArray(stored)) {
            for (const item of stored) {
                if (
                    item &&
                    typeof item.owner === 'string' &&
                    typeof item.id === 'string' &&
                    typeof item.chargedAt === 'string' &&
                    Number.isFinite(Date.parse(item.chargedAt))
                ) {
                    records.set(identity(item), item);
                }
            }
        }
    } catch (error) {
        logger.capture(error, { feature: 'roast-charge-outbox' });
    }
    for (const [id, item] of memory) records.set(id, item);
    return [...records.values()];
}

export function enqueueRoastCharge(item: PendingRoastCharge) {
    // The first Charge time is immutable across duplicate events/retries.
    const records = listPendingRoastCharges();
    if (!records.some((record) => identity(record) === identity(item))) records.push(item);
    for (const record of records) memory.set(identity(record), record);
    try {
        localStorage.setItem(key, JSON.stringify(records));
    } catch (error) {
        logger.capture(error, { feature: 'roast-charge-outbox' });
    }
    window.dispatchEvent(new Event(pendingChargeEvent));
}

export function acknowledgeRoastCharge(item: PendingRoastCharge) {
    const records = listPendingRoastCharges().filter((record) => identity(record) !== identity(item));
    memory.delete(identity(item));
    try {
        localStorage.setItem(key, JSON.stringify(records));
    } catch (error) {
        // A retained durable entry is safe: the server deduplicates by session UUID.
        logger.capture(error, { feature: 'roast-charge-outbox' });
    }
}

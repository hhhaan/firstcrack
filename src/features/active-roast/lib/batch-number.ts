import { z } from 'zod';

const counterSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const ledgerSchema = z.object({
    counters: z.record(counterSchema),
    sessions: z.record(
        z
            .object({
                number: counterSchema,
                scope: z.string(),
                totalNumber: counterSchema.optional(),
                totalScope: z.string().optional(),
                profileNumbers: z.record(counterSchema).optional(),
            })
            .refine((session) => session.totalNumber === undefined || session.totalScope !== undefined),
    ),
});
export type BatchNumberLedger = z.infer<typeof ledgerSchema>;
export const emptyBatchNumberLedger = (): BatchNumberLedger => ({ counters: {}, sessions: {} });
export function parseBatchNumberLedger(value: unknown): BatchNumberLedger {
    const result = ledgerSchema.safeParse(value);
    return result.success ? result.data : emptyBatchNumberLedger();
}
/** Either storage target can be newer after a partial write failure. Never decrease a counter. */
export function mergeBatchNumberLedgers(stored: unknown, fallback: unknown): BatchNumberLedger {
    const durable = parseBatchNumberLedger(stored);
    const local = parseBatchNumberLedger(fallback);
    const counters = { ...local.counters };
    for (const [scope, number] of Object.entries(durable.counters))
        counters[scope] = Math.max(counters[scope] ?? 0, number);
    const sessions: BatchNumberLedger['sessions'] = {};
    for (const ledger of [local, durable])
        for (const [id, entry] of Object.entries(ledger.sessions)) {
            const previous = Object.keys(sessions).includes(id) ? sessions[id] : undefined;
            const profileNumbers = {
                ...previous?.profileNumbers,
                ...entry.profileNumbers,
                [entry.scope]: entry.number,
            };
            sessions[id] = { ...previous, ...entry, profileNumbers };
            for (const [scope, number] of Object.entries(profileNumbers))
                counters[scope] = Math.max(counters[scope] ?? 0, number);
            if (entry.totalScope && entry.totalNumber != null)
                counters[entry.totalScope] = Math.max(counters[entry.totalScope] ?? 0, entry.totalNumber);
        }
    return { counters, sessions };
}
/** Reserve once per selected profile; the overall number belongs to the physical roast. */
export function allocateBatchNumber(
    ledger: BatchNumberLedger,
    ownerId: string,
    profileId: string | null,
    sessionId: string,
): { ledger: BatchNumberLedger; number: number; totalNumber: number | null } {
    const id = JSON.stringify([ownerId, sessionId]);
    const existing = Object.keys(ledger.sessions).includes(id) ? ledger.sessions[id] : undefined;
    const scope = JSON.stringify([ownerId, profileId]);
    const profileNumbers = {
        ...existing?.profileNumbers,
        ...(existing && { [existing.scope]: existing.number }),
    };
    const number = profileNumbers[scope] ?? (ledger.counters[scope] ?? 0) + 1;
    const totalScope = JSON.stringify([ownerId, null, 'total']);
    const legacyTotal = Object.entries(ledger.counters).reduce((total, [key, value]) => {
        try {
            const keyParts: unknown = JSON.parse(key);
            return Array.isArray(keyParts) && keyParts.length === 2 && keyParts[0] === ownerId ? total + value : total;
        } catch {
            return total;
        }
    }, 0);
    const totalCounter = ledger.counters[totalScope] ?? legacyTotal;
    const totalNumber = existing ? (existing.totalNumber ?? null) : totalCounter + 1;
    if (!Number.isSafeInteger(number) || (totalNumber !== null && !Number.isSafeInteger(totalNumber)))
        throw new Error('Batch counter exhausted');
    const sessions = {
        ...ledger.sessions,
        [id]: {
            ...existing,
            scope,
            number,
            profileNumbers: { ...profileNumbers, [scope]: number },
            ...(totalNumber !== null && { totalScope, totalNumber }),
        },
    };
    // Only the running/latest canceled batch can be restored; counters remain durable.
    const recent = Object.fromEntries(Object.entries(sessions).slice(-256));
    return {
        number,
        totalNumber,
        ledger: {
            counters: {
                ...ledger.counters,
                [scope]: Math.max(ledger.counters[scope] ?? 0, number),
                ...((totalCounter > 0 || totalNumber !== null) && {
                    [totalScope]: Math.max(totalCounter, totalNumber ?? 0),
                }),
            },
            sessions: recent,
        },
    };
}

export interface BatchNumberLedger {
    counters: Record<string, number>;
    sessions: Record<string, { number: number; scope: string }>;
}
export const emptyBatchNumberLedger = (): BatchNumberLedger => ({ counters: {}, sessions: {} });
export function parseBatchNumberLedger(value: unknown): BatchNumberLedger {
    if (!value || typeof value !== 'object') return emptyBatchNumberLedger();
    const ledger = value as BatchNumberLedger;
    if (
        !ledger.counters ||
        !ledger.sessions ||
        typeof ledger.counters !== 'object' ||
        typeof ledger.sessions !== 'object'
    )
        return emptyBatchNumberLedger();
    if (
        Object.values(ledger.counters).some((n) => !Number.isSafeInteger(n) || n < 1) ||
        Object.values(ledger.sessions).some(
            (s) => !s || !Number.isSafeInteger(s.number) || s.number < 1 || typeof s.scope !== 'string',
        )
    )
        return emptyBatchNumberLedger();
    return ledger;
}
/** Profile at Charge owns the number. A later reference edit cannot reassign it. */
export function allocateBatchNumber(
    ledger: BatchNumberLedger,
    ownerId: string,
    profileId: string | null,
    sessionId: string,
): { ledger: BatchNumberLedger; number: number } {
    const id = JSON.stringify([ownerId, sessionId]);
    const existing = ledger.sessions[id];
    if (existing) return { ledger, number: existing.number };
    const scope = JSON.stringify([ownerId, profileId]);
    const number = (ledger.counters[scope] ?? 0) + 1;
    const sessions = { ...ledger.sessions, [id]: { scope, number } };
    // Only the running/latest canceled batch can be restored; counters remain durable.
    const recent = Object.fromEntries(Object.entries(sessions).slice(-256));
    return { number, ledger: { counters: { ...ledger.counters, [scope]: number }, sessions: recent } };
}

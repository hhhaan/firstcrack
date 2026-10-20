export interface BatchNumberLedger {
    counters: Record<string, number>;
    sessions: Record<string, { number: number; scope: string }>;
}
export const emptyBatchNumberLedger = (): BatchNumberLedger => ({ counters: {}, sessions: {} });
export function parseBatchNumberLedger(value: unknown): BatchNumberLedger {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyBatchNumberLedger();
    const ledger = value as BatchNumberLedger;
    if (
        !ledger.counters ||
        !ledger.sessions ||
        typeof ledger.counters !== 'object' ||
        typeof ledger.sessions !== 'object' ||
        Array.isArray(ledger.counters) ||
        Array.isArray(ledger.sessions)
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
/** Either storage target can be newer after a partial write failure. Never decrease a counter. */
export function mergeBatchNumberLedgers(stored: unknown, fallback: unknown): BatchNumberLedger {
    const durable = parseBatchNumberLedger(stored);
    const local = parseBatchNumberLedger(fallback);
    const counters = { ...local.counters };
    for (const [scope, number] of Object.entries(durable.counters))
        counters[scope] = Math.max(counters[scope] ?? 0, number);
    for (const { scope, number } of [...Object.values(local.sessions), ...Object.values(durable.sessions)])
        counters[scope] = Math.max(counters[scope] ?? 0, number);
    return { counters, sessions: { ...local.sessions, ...durable.sessions } };
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

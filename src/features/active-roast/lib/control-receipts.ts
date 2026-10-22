import { formatSignedElapsed } from '@shared/lib/format';
import type { LogEntry, RoastControlReceipt } from '@shared/types/roast';
import { z } from 'zod';

const sample = z.object({ sensor_clock: z.string(), acquired_at: z.number().finite() });
const receiptSchema = z.object({
    session_id: z.string(),
    charge_id: z.string(),
    sequence: z.number().int().positive(),
    attempt_sequence: z.number().int().positive(),
    run_id: z.string().nullable(),
    generation: z.number().int().nonnegative(),
    connection_epoch: z.number().int().nonnegative(),
    sensor_clock: z.string(),
    origin: z.enum(['manual', 'replay', 'pid', 'safety']),
    purpose: z.enum(['regulate', 'terminal', 'manual', 'replay']),
    event: z.enum(['attempt', 'transmitted', 'completed', 'rejected', 'uncertain', 'reconciliation']),
    observed_at: z.number().finite(),
    elapsed_sec: z.number().finite(),
    sample: sample.nullable(),
    raw_bt_c: z.number().finite().nullable(),
    control_pv_c: z.number().finite().nullable(),
    target_bt_c: z.number().finite().nullable(),
    requested_heat_set: z.number().finite(),
    permitted_heat_set: z.number().finite(),
    acknowledged_heat_set: z.number().finite().nullable(),
    evidence: z.enum(['none', 'virtual_applied', 'transport_sent', 'register_written', 'register_readback']),
    outcome: z.enum(['pending', 'succeeded', 'rejected', 'uncertain', 'failed']),
    reconciles_sequence: z.number().int().positive().nullable(),
    reason: z.string().nullable(),
});
export const controlReceiptMetadataSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('receipt'), receipt: receiptSchema }),
    z.object({
        kind: z.literal('gap'),
        session_id: z.string(),
        charge_id: z.string(),
        from: z.number().int(),
        through: z.number().int(),
    }),
    z.object({
        kind: z.literal('unavailable'),
        session_id: z.string(),
        charge_id: z.string(),
        after: z.number().int(),
    }),
]);
export const parseControlReceipt = (raw: unknown): RoastControlReceipt | undefined => {
    const result = controlReceiptMetadataSchema.safeParse(raw);
    return result.success ? result.data : undefined;
};

export const receiptLogEntry = (metadata: RoastControlReceipt): LogEntry => {
    if (metadata.kind !== 'receipt')
        return {
            id: `control:${metadata.session_id}:${metadata.charge_id}:${metadata.kind}:${metadata.kind === 'gap' ? metadata.from : metadata.after}`,
            event: 'Control',
            time: '0:00',
            timeSec: 0,
            temp: '—',
            tempC: null,
            note: '',
            controlReceipt: metadata,
        };
    const receipt = metadata.receipt;
    // Transmission is the single applied marker; reconciliation never duplicates that command.
    const applied = receipt.event === 'transmitted' && receipt.acknowledged_heat_set !== null;
    return {
        id: `control:${receipt.session_id}:${receipt.charge_id}:${receipt.sequence}`,
        event: 'Control',
        time: formatSignedElapsed(receipt.elapsed_sec),
        timeSec: receipt.elapsed_sec,
        temp: '—',
        tempC: receipt.raw_bt_c,
        note: '',
        controlReceipt: metadata,
        ...(applied ? { appliedControl: { heater: receipt.acknowledged_heat_set ?? undefined } } : {}),
    };
};

export const mergeReceiptLogs = (entries: LogEntry[], receipts: readonly LogEntry[]): LogEntry[] => {
    const ids = new Set(entries.map((entry) => entry.id));
    const added = receipts.filter((entry) => {
        if (ids.has(entry.id)) return false;
        ids.add(entry.id);
        return true;
    });
    return added.length ? [...entries, ...added] : entries;
};

export const unresolvedReceiptAttempts = (entries: readonly LogEntry[]): number => {
    const attempts = new Map<string, string>();
    for (const entry of entries) {
        const metadata = entry.controlReceipt;
        if (metadata?.kind !== 'receipt') continue;
        const receipt = metadata.receipt;
        attempts.set(
            `${receipt.session_id}:${receipt.charge_id}:${receipt.attempt_sequence}`,
            receipt.event === 'transmitted' ? 'pending' : receipt.outcome,
        );
    }
    return [...attempts.values()].filter((outcome) => outcome === 'pending' || outcome === 'uncertain').length;
};

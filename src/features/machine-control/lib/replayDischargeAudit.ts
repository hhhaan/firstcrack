import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import type { Json } from '@shared/types/database.types';
import type { DoorProbeResult } from '@shared/types/sidecar';
import { BaseDirectory, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { z } from 'zod';
import type { ReplayPlan } from './replay';

export interface DischargeObservation {
    rawBt: number;
    elapsed: number;
    deviceTimestamp: number;
    receivedAtMs: number;
    judgedAtMs: number;
    ageMs: number;
    quality: 'valid';
}

export interface DischargeDwellEvidence {
    firstDeviceTimestamp: number;
    lastDeviceTimestamp: number;
    firstReceivedAtMs: number;
    lastReceivedAtMs: number;
    count: number;
    minRawBt: number;
    maxRawBt: number;
    maxDeviceGapMs: number;
    maxReceiptGapMs: number;
    /** First and most recent qualifying observations; count includes any omitted middle samples. */
    samples: DischargeObservation[];
}

type AuditIdentity = {
    schemaVersion: 2;
    ownerId: string;
    actorId: string;
    sessionId: string;
    commandId: string;
    recordedAtMs: number;
};

export type ReplayDischargeAudit = AuditIdentity &
    (
        | {
              kind: 'intent';
              appVersion: string;
              connectionEpoch: number;
              roaster: string | null;
              temperatureUnit: 'celsius';
              afterTurningPoint: true;
              stepIndex: number;
              requested: { action: 'discharge_open'; command: 5; targetBt: number; t: number; trigger: 'bt' };
              plan: ReplayPlan;
              policy: { requiredDwellMs: 1000; pollIntervalMs: number; maxObservationGapMs: number };
              observation: DischargeObservation;
              dwell: DischargeDwellEvidence;
              physicalDoorState: 'unknown';
          }
        | {
              kind: 'result';
              outcome: 'sent' | 'failed' | 'unconfirmed' | 'cancelled_before_dispatch';
              dispatchedAtMs: number | null;
              dispatchObservation: DischargeObservation | null;
              response: DoorProbeResult | null;
              error:
                  | { kind: 'sidecar'; status: number | 'network' | 'timeout' }
                  | { kind: 'abort' | 'timeout' | 'unknown' }
                  | null;
              aborted: boolean;
              physicalDoorState: 'unknown';
          }
    );

// Separate from roast TSV: Drop, undo and successful upload must never rewrite or delete this file.
const AUDIT_FILE = 'replay-discharge-audit.jsonl';
export const replayDischargeAuditEvent = 'fc-replay-discharge-audit';
let queue = Promise.resolve();
const jsonValue: z.ZodType<Json> = z.lazy(() =>
    z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]),
);
const identitySchema = z.object({
    schemaVersion: z.literal(2),
    ownerId: z.string().uuid(),
    actorId: z.string().uuid(),
    sessionId: z.string().uuid(),
    commandId: z.string().uuid(),
    kind: z.enum(['intent', 'result']),
});
export type PendingDischargeAudit = z.infer<typeof identitySchema> & { payload: Json };
const receiptSchema = identitySchema.extend({
    kind: z.literal('server_ack'),
    eventKind: z.enum(['intent', 'result']),
    serverReceivedAt: z.string().datetime({ offset: true }),
});
const key = (record: Pick<PendingDischargeAudit, 'ownerId' | 'actorId' | 'commandId' | 'kind'>) =>
    `${record.ownerId}:${record.actorId}:${record.commandId}:${record.kind}`;
let pending: Map<string, PendingDischargeAudit> | null = null;

const parsePending = (input: unknown): PendingDischargeAudit | null => {
    const identity = identitySchema.safeParse(input);
    if (!identity.success) return null;
    const payload = z.record(jsonValue).parse(input);
    delete payload.ownerId;
    delete payload.actorId;
    // Session row ids are local UI bookkeeping, not incident evidence.
    if (payload.plan && typeof payload.plan === 'object' && !Array.isArray(payload.plan)) {
        const events = payload.plan.events;
        if (Array.isArray(events)) {
            for (const event of events) {
                if (event && typeof event === 'object' && !Array.isArray(event)) delete event.id;
            }
        }
    }
    return { ...identity.data, payload };
};

/** Read history once per app lifetime; retries only walk the unsynchronized map. */
const loadPending = async (): Promise<Map<string, PendingDischargeAudit>> => {
    if (pending) return pending;
    await mkdir('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
    await writeTextFile(AUDIT_FILE, '', { baseDir: BaseDirectory.AppLocalData, append: true });
    const contents = await readTextFile(AUDIT_FILE, { baseDir: BaseDirectory.AppLocalData });
    const records = new Map<string, PendingDischargeAudit>();
    const acknowledged = new Set<string>();
    for (const line of contents.split('\n')) {
        if (!line.trim()) continue;
        try {
            const input: unknown = JSON.parse(line);
            const receipt = receiptSchema.safeParse(input);
            if (receipt.success) {
                acknowledged.add(key({ ...receipt.data, kind: receipt.data.eventKind }));
                continue;
            }
            const record = parsePending(input);
            if (record && !records.has(key(record))) records.set(key(record), record);
        } catch {
            // Keep truncated/legacy evidence on disk; never invent ownership for unbound v1 rows.
        }
    }
    for (const id of acknowledged) records.delete(id);
    pending = records;
    return records;
};

const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.then(
        () => {},
        () => {},
    );
    return next;
};

/** Append only, including after a previous failure. No physical action or audit append is retried. */
export const appendReplayDischargeAudit = (record: ReplayDischargeAudit): Promise<void> => {
    // Snapshot before queueing: live dwell samples may continue changing while disk IO is pending.
    // A failed append or crash may leave a truncated last line; isolate every subsequent complete record.
    const line = `\n${JSON.stringify(record)}\n`;
    const next = serialize(async () => {
        await mkdir('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
        await writeTextFile(AUDIT_FILE, line, { baseDir: BaseDirectory.AppLocalData, append: true });
        if (pending) {
            const item = parsePending(JSON.parse(line));
            if (item && !pending.has(key(item))) pending.set(key(item), item);
        }
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(replayDischargeAuditEvent));
    });
    return next;
};

export const listPendingDischargeAudits = (): Promise<PendingDischargeAudit[]> =>
    serialize(async () => [...(await loadPending()).values()]);

/** Crash before this append is harmless: the server must confirm the identical event again. */
export const acknowledgeDischargeAudit = (record: PendingDischargeAudit, serverReceivedAt: string): Promise<void> =>
    serialize(async () => {
        const receipt = receiptSchema.parse({
            ...record,
            payload: undefined,
            kind: 'server_ack',
            eventKind: record.kind,
            serverReceivedAt,
        });
        await writeTextFile(AUDIT_FILE, `\n${JSON.stringify(receipt)}\n`, {
            baseDir: BaseDirectory.AppLocalData,
            append: true,
        });
        pending?.delete(key(record));
    });

/** Only persistence failures are captured here; command failures are already reported by the sidecar. */
export const reportReplayDischargeAuditFailure = (error: unknown): void => {
    try {
        logger.capture(error, { tags: { feature: 'machine-control' } });
    } catch {
        // Reporting must not prevent physical-command cleanup.
    }
    try {
        useToastStore.getState().show(i18n.t('machines.replayDischargeAuditFailed'), 'error');
    } catch {
        // The command remains consumed even if the notification surface is unavailable.
    }
};

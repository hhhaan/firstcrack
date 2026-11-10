import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import type { DoorProbeResult } from '@shared/types/sidecar';
import { BaseDirectory, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
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
    schemaVersion: 1;
    commandId: string;
    recordedAtMs: number;
};

export type ReplayDischargeAudit = AuditIdentity &
    (
        | {
              kind: 'intent';
              appVersion: string;
              sessionId: string;
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
let queue = Promise.resolve();

/** Append only, including after a previous failure. No physical action or audit append is retried. */
export const appendReplayDischargeAudit = (record: ReplayDischargeAudit): Promise<void> => {
    // Snapshot before queueing: live dwell samples may continue changing while disk IO is pending.
    // A failed append or crash may leave a truncated last line; isolate every subsequent complete record.
    const line = `\n${JSON.stringify(record)}\n`;
    const next = queue.then(async () => {
        await mkdir('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
        await writeTextFile(AUDIT_FILE, line, { baseDir: BaseDirectory.AppLocalData, append: true });
    });
    queue = next.catch(() => {});
    return next;
};

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

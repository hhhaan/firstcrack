import { z } from 'zod';

export const MONITOR_REQUEST = 'roast-monitor-request';
export const MONITOR_SNAPSHOT = 'roast-monitor-snapshot';
export const MONITOR_TIMEOUT_MS = 4000;

export const monitorRequestSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('sync') }),
    z.object({ type: z.literal('show-main') }),
    z.object({ type: z.literal('drop'), sessionId: z.string().min(1) }),
]);

export const monitorSnapshotSchema = z.object({
    sessionId: z.string().nullable(),
    bt: z.string(),
    et: z.string(),
    ror: z.string(),
    rorUnit: z.string(),
    time: z.string(),
    phase: z.string(),
    phaseColor: z.string(),
    development: z.string(),
    dtr: z.string(),
    bbpTime: z.string().nullable(),
    connected: z.boolean(),
    stale: z.boolean(),
    canDrop: z.boolean(),
    dropTime: z.string().nullable(),
    language: z.string(),
});

export type MonitorRequest = z.infer<typeof monitorRequestSchema>;
export type MonitorSnapshot = z.infer<typeof monitorSnapshotSchema>;

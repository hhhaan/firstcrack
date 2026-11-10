import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import { BaseDirectory, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppLocalData: 14 },
    mkdir: vi.fn(async () => {}),
    writeTextFile: vi.fn(async () => {}),
    readTextFile: vi.fn(async () => ''),
}));
vi.mock('@shared/i18n', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show }) } }));
const { show } = vi.hoisted(() => ({ show: vi.fn() }));

import {
    appendReplayDischargeAudit,
    type ReplayDischargeAudit,
    reportReplayDischargeAuditFailure,
} from './replayDischargeAudit';

const result = (commandId: string): ReplayDischargeAudit => ({
    kind: 'result',
    schemaVersion: 2,
    ownerId: '10000000-0000-4000-8000-000000000001',
    actorId: '10000000-0000-4000-8000-000000000002',
    sessionId: '10000000-0000-4000-8000-000000000003',
    commandId,
    recordedAtMs: 12_000,
    outcome: 'cancelled_before_dispatch',
    dispatchedAtMs: null,
    dispatchObservation: null,
    response: null,
    error: null,
    aborted: true,
    physicalDoorState: 'unknown',
});

beforeEach(() => {
    vi.mocked(mkdir).mockReset().mockResolvedValue();
    vi.mocked(writeTextFile).mockReset().mockResolvedValue();
    vi.mocked(readTextFile).mockReset().mockResolvedValue('');
    vi.mocked(logger.capture).mockReset();
    show.mockReset();
});

describe('durable discharge audit', () => {
    const command = '10000000-0000-4000-8000-000000000010';
    const secondCommand = '10000000-0000-4000-8000-000000000011';
    const receiptTime = '2026-11-10T06:00:00+00:00';

    const disk = (initial = '') => {
        let contents = initial;
        vi.mocked(writeTextFile).mockImplementation(async (_path, text) => {
            contents += text;
        });
        vi.mocked(readTextFile).mockImplementation(async () => contents);
        return () => contents;
    };

    it('recovers only bound v2 records, isolates truncated lines and reads history once', async () => {
        disk(
            `${JSON.stringify({ ...result(command), schemaVersion: 1, ownerId: undefined, actorId: undefined })}\n{"partial":\n${JSON.stringify(result(secondCommand))}\n`,
        );
        vi.resetModules();
        const audit = await import('./replayDischargeAudit');
        expect(await audit.listPendingDischargeAudits()).toEqual([
            expect.objectContaining({
                commandId: secondCommand,
                payload: expect.objectContaining({ schemaVersion: 2 }),
            }),
        ]);
        await audit.listPendingDischargeAudits();
        expect(readTextFile).toHaveBeenCalledOnce();
    });

    it('retains a server-accepted event when the durable ACK fails, including after restart', async () => {
        const contents = disk(JSON.stringify(result(command)));
        vi.resetModules();
        const audit = await import('./replayDischargeAudit');
        const [record] = await audit.listPendingDischargeAudits();
        vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('disk full'));
        await expect(audit.acknowledgeDischargeAudit(record, receiptTime)).rejects.toThrow('disk full');
        expect(await audit.listPendingDischargeAudits()).toHaveLength(1);
        vi.resetModules();
        const restarted = await import('./replayDischargeAudit');
        expect(await restarted.listPendingDischargeAudits()).toHaveLength(1);
        await restarted.acknowledgeDischargeAudit(record, receiptTime);
        expect(contents()).toContain('server_ack');
        vi.resetModules();
        expect(await (await import('./replayDischargeAudit')).listPendingDischargeAudits()).toEqual([]);
    });

    it('adds new durable entries after catch-up without rereading history and excludes envelope identities from server payload', async () => {
        disk();
        vi.resetModules();
        const audit = await import('./replayDischargeAudit');
        await audit.listPendingDischargeAudits();
        await audit.appendReplayDischargeAudit(result(command));
        const [record] = await audit.listPendingDischargeAudits();
        expect(record).toMatchObject({ ownerId: result(command).ownerId, actorId: result(command).actorId });
        expect(record.payload).not.toHaveProperty('ownerId');
        expect(record.payload).not.toHaveProperty('actorId');
        expect(readTextFile).toHaveBeenCalledOnce();
        await audit.acknowledgeDischargeAudit(record, receiptTime);
        expect(await audit.listPendingDischargeAudits()).toEqual([]);
    });
    it('serializes appends, snapshots records at enqueue time and never truncates existing data', async () => {
        let finish!: () => void;
        let stored = '{"older":true}\n';
        vi.mocked(writeTextFile)
            .mockImplementationOnce(async (_path, contents) => {
                await new Promise<void>((resolve) => {
                    finish = resolve;
                });
                stored += contents;
            })
            .mockImplementation(async (_path, contents) => {
                stored += contents;
            });
        const first = appendReplayDischargeAudit(result('first'));
        const nextRecord = result('second');
        const second = appendReplayDischargeAudit(nextRecord);
        nextRecord.commandId = 'mutated-after-enqueue';
        await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
        finish();
        await Promise.all([first, second]);
        expect(mkdir).toHaveBeenCalledWith('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
        expect(writeTextFile).toHaveBeenCalledTimes(2);
        for (const [path, , options] of vi.mocked(writeTextFile).mock.calls) {
            expect(path).toBe('replay-discharge-audit.jsonl');
            expect(options).toEqual({ baseDir: BaseDirectory.AppLocalData, append: true });
        }
        const records: unknown[] = stored
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        expect(records).toEqual([{ older: true }, result('first'), result('second')]);
    });

    it('preserves existing records across a fresh module lifetime', async () => {
        let stored = `${JSON.stringify(result('prior-process'))}\n`;
        vi.mocked(writeTextFile).mockImplementation(async (_path, contents) => {
            stored += contents;
        });
        vi.resetModules();
        const restarted = await import('./replayDischargeAudit');
        await restarted.appendReplayDischargeAudit(result('new-process'));
        expect(
            stored
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
        ).toEqual([result('prior-process'), result('new-process')]);
    });

    it('isolates a failed partial append and lets a later complete record survive independently', async () => {
        let stored = '';
        vi.mocked(writeTextFile)
            .mockImplementationOnce(async (_path, contents) => {
                stored += contents.slice(0, 20);
                throw new Error('partial disk write');
            })
            .mockImplementation(async (_path, contents) => {
                stored += contents;
            });
        await expect(appendReplayDischargeAudit(result('partial'))).rejects.toThrow('partial disk write');
        await appendReplayDischargeAudit(result('complete'));
        const lines = stored.split('\n').filter(Boolean);
        expect(() => JSON.parse(lines[0])).toThrow();
        expect(JSON.parse(lines[1])).toEqual(result('complete'));
        expect(writeTextFile).toHaveBeenCalledTimes(2);
    });

    it('rejects unavailable storage before appending and can serve the next independent attempt', async () => {
        vi.mocked(mkdir).mockRejectedValueOnce(new Error('storage unavailable'));
        await expect(appendReplayDischargeAudit(result('unavailable'))).rejects.toThrow('storage unavailable');
        expect(writeTextFile).not.toHaveBeenCalled();
        await appendReplayDischargeAudit(result('later'));
        expect(writeTextFile).toHaveBeenCalledOnce();
    });

    it('reports the persistence error once with an explicit notification', () => {
        const error = new Error('audit storage failed');
        reportReplayDischargeAuditFailure(error);
        expect(logger.capture).toHaveBeenCalledExactlyOnceWith(error, { tags: { feature: 'machine-control' } });
        expect(useToastStore.getState().show).toHaveBeenCalledExactlyOnceWith(
            'machines.replayDischargeAuditFailed',
            'error',
        );
    });

    it('does not throw if error reporting or the notification surface fails', () => {
        vi.mocked(logger.capture).mockImplementationOnce(() => {
            throw new Error('report failed');
        });
        show.mockImplementationOnce(() => {
            throw new Error('toast failed');
        });
        expect(() => reportReplayDischargeAuditFailure(new Error('disk failed'))).not.toThrow();
        expect(show).toHaveBeenCalledOnce();
    });
});

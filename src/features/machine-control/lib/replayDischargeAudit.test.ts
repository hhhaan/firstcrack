import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import { BaseDirectory, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppLocalData: 14 },
    mkdir: vi.fn(async () => {}),
    writeTextFile: vi.fn(async () => {}),
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
    schemaVersion: 1,
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
    vi.mocked(logger.capture).mockReset();
    show.mockReset();
});

describe('durable discharge audit', () => {
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

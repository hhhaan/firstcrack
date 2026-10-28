import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTsv } from './tsv';
import {
    _resetTsvWriterForTests,
    bbpTsvPath,
    deleteBbpTsv,
    deleteSessionTsv,
    enqueueTsvRow,
    flushTsv,
    formatRoastTsvRow,
    formatTsvRows,
    initSessionTsv,
    replaceSessionTsv,
    sessionTsvPath,
    TSV_HEADER,
    writeBbpTsv,
} from './tsv-writer';

const loggerCapture = vi.hoisted(() => vi.fn());
const processing = {
    algorithm_version: 'ema-least-squares-v1',
    temperature_unit: 'C',
    ror_unit: 'C/min',
    timestamp_clock: 'sidecar-monotonic-seconds',
    display_ema_alpha: 0.16,
    ror_ema_alpha: 0.2,
    ror_window_sec: 30,
    ror_warmup_reads: 3,
} as const;
vi.mock('@shared/lib/logger', () => ({ logger: { capture: loggerCapture } }));

describe('tsv-writer', () => {
    it('orders slow BBP writes, deletion and the next wait while allowing another archive to proceed', async () => {
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const operations: string[] = [];
        _resetTsvWriterForTests({
            write: async (_path, content) => {
                if (content === 'old wait') await gate;
                operations.push(content);
            },
            remove: async () => {
                operations.push('delete old wait');
            },
        });
        const first = writeBbpTsv('inprogress', 'old wait');
        const deletion = deleteBbpTsv('inprogress');
        const next = writeBbpTsv('inprogress', 'new wait');
        await writeBbpTsv('session-a', 'archive A');
        expect(operations).toEqual(['archive A']);
        release();
        await Promise.all([first, deletion, next]);
        expect(operations).toEqual(['archive A', 'old wait', 'delete old wait', 'new wait']);
    });

    it('allows a BBP file write to retry after the previous write fails', async () => {
        const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
        _resetTsvWriterForTests({ write });
        await expect(writeBbpTsv('a', 'first')).rejects.toThrow('disk full');
        await writeBbpTsv('a', 'retry');
        expect(write).toHaveBeenLastCalledWith('bbp_a.tsv', 'retry', { append: false });
    });
    const writes: { path: string; contents: string; append: boolean }[] = [];
    const removed: string[] = [];
    let writeDelayMs = 0;

    beforeEach(() => {
        writes.length = 0;
        removed.length = 0;
        writeDelayMs = 0;
        loggerCapture.mockClear();
        _resetTsvWriterForTests({
            write: async (path, contents, options) => {
                if (writeDelayMs > 0) {
                    await new Promise((r) => setTimeout(r, writeDelayMs));
                }
                writes.push({ path, contents, append: options.append ?? false });
            },
            remove: async (path) => {
                removed.push(path);
            },
        });
    });

    it('replaceSessionTsv overwrites lookback rows with the Drop clip', async () => {
        await initSessionTsv('s1');
        enqueueTsvRow(
            's1',
            formatRoastTsvRow({ time: 600, bt: 205, et: 210, heater: 50, fan: 40, drum: 60, heaterSet: 50, ror_et: 4 }),
        );
        enqueueTsvRow('s1', formatRoastTsvRow({ time: 612, bt: 150, et: 210, heater: 50, fan: 40, drum: 60 }));
        await flushTsv('s1');
        await replaceSessionTsv(
            's1',
            formatRoastTsvRow({ time: 600, bt: 205, et: 210, heater: 50, fan: 40, drum: 60, heaterSet: 50, ror_et: 4 }),
        );
        const file = writes
            .filter((w) => w.path === 'session_s1.tsv')
            .reduce((acc, w) => (w.append ? acc + w.contents : w.contents), '');
        expect(file).toBe(
            `${TSV_HEADER}${formatRoastTsvRow({ time: 600, bt: 205, et: 210, heater: 50, fan: 40, drum: 60, heaterSet: 50, ror_et: 4 })}`,
        );
        expect(file).not.toContain('612');
        expect(file.split('\n')[1].split('\t')[10]).toBe('4');
    });

    it('keeps processing changes through buffered writes and Drop replacement', async () => {
        const point = { time: 1, bt: 200, et: 210, heater: null, fan: 0, drum: 0, processing };
        const changed = { ...processing, ror_window_sec: 45 };
        writeDelayMs = 5;
        const init = initSessionTsv('meta');
        enqueueTsvRow('meta', formatRoastTsvRow(point), processing);
        enqueueTsvRow('meta', formatRoastTsvRow({ ...point, time: 2 }), processing);
        enqueueTsvRow('meta', formatRoastTsvRow({ ...point, time: 3 }), changed);
        enqueueTsvRow('meta', formatRoastTsvRow({ ...point, time: 4 }));
        await init;
        await flushTsv('meta');
        const contents = () =>
            writes
                .filter((w) => w.path === sessionTsvPath('meta'))
                .reduce((text, w) => (w.append ? text + w.contents : w.contents), '');
        expect(contents().match(/# processing\t/g)).toHaveLength(3);
        expect(parseTsv(contents()).map((p) => p.processing?.ror_window_sec)).toEqual([30, 30, 45, undefined]);
        await replaceSessionTsv('meta', formatTsvRows([point], formatRoastTsvRow));
        enqueueTsvRow('meta', formatRoastTsvRow({ ...point, time: 2 }), processing);
        enqueueTsvRow('meta', formatRoastTsvRow({ ...point, time: 3 }), changed);
        await flushTsv('meta');
        expect(contents().match(/# processing\t/g)).toHaveLength(2);
        expect(parseTsv(contents()).map((p) => p.processing?.ror_window_sec)).toEqual([30, 30, 45]);
    });

    it('sessionTsvPath formats filename', () => {
        expect(sessionTsvPath('abc')).toBe('session_abc.tsv');
    });

    it('init writes header without append', async () => {
        await initSessionTsv('s1');
        expect(writes).toEqual([{ path: 'session_s1.tsv', contents: TSV_HEADER, append: false }]);
    });

    it('serializes concurrent enqueues in order', async () => {
        writeDelayMs = 5;
        await initSessionTsv('s1');
        enqueueTsvRow('s1', '1\ta\n');
        enqueueTsvRow('s1', '2\tb\n');
        enqueueTsvRow('s1', '3\tc\n');
        await flushTsv('s1');

        const rows = writes.filter((w) => w.append).map((w) => w.contents);
        expect(rows).toEqual(['1\ta\n', '2\tb\n', '3\tc\n']);
    });

    it('flush waits for all enqueued rows', async () => {
        writeDelayMs = 10;
        await initSessionTsv('s1');
        enqueueTsvRow('s1', 'row\n');
        const pending = flushTsv('s1');
        expect(writes.filter((w) => w.append)).toHaveLength(0);
        await pending;
        expect(writes.filter((w) => w.append)).toHaveLength(1);
    });

    it('buffers rows enqueued before init, then writes after header', async () => {
        enqueueTsvRow('s1', 'early\n');
        await flushTsv('s1');
        // still only buffered — no disk write until init
        expect(writes).toHaveLength(0);

        await initSessionTsv('s1');
        await flushTsv('s1');
        expect(writes[0]).toEqual({ path: 'session_s1.tsv', contents: TSV_HEADER, append: false });
        expect(writes.filter((w) => w.append).map((w) => w.contents)).toEqual(['early\n']);
    });

    it('writes rows queued during delayed init after the header in order', async () => {
        writeDelayMs = 10;
        const init = initSessionTsv('s1');
        enqueueTsvRow('s1', 'first\n');
        enqueueTsvRow('s1', 'second\n');

        await init;
        await flushTsv('s1');

        expect(writes.map((w) => w.contents)).toEqual([TSV_HEADER, 'first\n', 'second\n']);
    });

    it('retries failed init on the next row and preserves pending rows', async () => {
        let failHeader = true;
        _resetTsvWriterForTests({
            write: async (path, contents, options) => {
                if (contents === TSV_HEADER && failHeader) {
                    failHeader = false;
                    throw new Error('disk unavailable');
                }
                writes.push({ path, contents, append: options.append ?? false });
            },
        });

        const init = initSessionTsv('s1');
        enqueueTsvRow('s1', 'first\n');
        await expect(init).rejects.toThrow('disk unavailable');
        enqueueTsvRow('s1', 'second\n');
        await flushTsv('s1');

        expect(writes.map((w) => w.contents)).toEqual([TSV_HEADER, 'first\n', 'second\n']);
    });

    it('flush retries failed init and persists the pending curve', async () => {
        let failHeader = true;
        _resetTsvWriterForTests({
            write: async (path, contents, options) => {
                if (contents === TSV_HEADER && failHeader) {
                    failHeader = false;
                    throw new Error('disk unavailable');
                }
                writes.push({ path, contents, append: options.append ?? false });
            },
        });

        const init = initSessionTsv('s1');
        enqueueTsvRow('s1', 'first\n');
        await expect(init).rejects.toThrow('disk unavailable');
        await flushTsv('s1');

        expect(writes.map((w) => w.contents)).toEqual([TSV_HEADER, 'first\n']);
    });

    it('flush retries init and rejects when the TSV still cannot be created', async () => {
        _resetTsvWriterForTests({
            write: async () => {
                throw new Error('disk unavailable');
            },
        });

        const init = initSessionTsv('s1');
        enqueueTsvRow('s1', 'first\n');
        await expect(init).rejects.toThrow('disk unavailable');
        await expect(flushTsv('s1')).rejects.toThrow('disk unavailable');
    });

    it('retries after a falsy init rejection', async () => {
        let failHeader = true;
        _resetTsvWriterForTests({
            write: async (path, contents, options) => {
                if (contents === TSV_HEADER && failHeader) {
                    failHeader = false;
                    throw undefined;
                }
                writes.push({ path, contents, append: options.append ?? false });
            },
        });

        const init = initSessionTsv('s1');
        enqueueTsvRow('s1', 'first\n');
        await expect(init).rejects.toThrow();
        enqueueTsvRow('s1', 'second\n');
        await flushTsv('s1');

        expect(writes.map((w) => w.contents)).toEqual([TSV_HEADER, 'first\n', 'second\n']);
    });

    it('reports a persistent init failure only once across retries', async () => {
        _resetTsvWriterForTests({
            write: async () => {
                throw new Error('disk unavailable');
            },
        });

        const init = initSessionTsv('s1');
        enqueueTsvRow('s1', 'first\n');
        await expect(init).rejects.toThrow('disk unavailable');
        enqueueTsvRow('s1', 'second\n');
        await expect(flushTsv('s1')).rejects.toThrow('disk unavailable');

        expect(loggerCapture).toHaveBeenCalledOnce();
    });

    it('second init is a no-op when already ready', async () => {
        await initSessionTsv('s1');
        enqueueTsvRow('s1', 'row\n');
        await flushTsv('s1');
        const countAfterFirst = writes.length;

        await initSessionTsv('s1');
        await flushTsv('s1');
        expect(writes).toHaveLength(countAfterFirst);
        expect(writes.filter((w) => !w.append)).toHaveLength(1);
    });

    it('coalesces concurrent inits into a single header write', async () => {
        writeDelayMs = 10;
        const a = initSessionTsv('s1');
        const b = initSessionTsv('s1');
        await Promise.all([a, b]);
        expect(writes.filter((w) => !w.append)).toHaveLength(1);
    });

    it('delete flushes then removes file', async () => {
        writeDelayMs = 5;
        await initSessionTsv('s1');
        enqueueTsvRow('s1', 'x\n');
        await deleteSessionTsv('s1');
        expect(writes.some((w) => w.append && w.contents === 'x\n')).toBe(true);
        expect(removed).toEqual(['session_s1.tsv']);
    });

    it('retains append errors across flushes without replaying failed rows', async () => {
        let n = 0;
        _resetTsvWriterForTests({
            write: async (path, contents, options) => {
                n += 1;
                if (n === 2) throw new Error('disk full');
                writes.push({ path, contents, append: options.append ?? false });
            },
            remove: async (path) => {
                removed.push(path);
            },
        });

        await initSessionTsv('s1');
        enqueueTsvRow('s1', 'a\n');
        enqueueTsvRow('s1', 'b\n');
        await expect(flushTsv('s1')).rejects.toThrow('disk full');
        await expect(flushTsv()).rejects.toThrow('disk full');
        await expect(initSessionTsv('s1')).rejects.toThrow('disk full');
        await expect(deleteSessionTsv('s1')).rejects.toThrow('disk full');
        expect(removed).toEqual([]);
        expect(writes.filter((w) => w.append).map((w) => w.contents)).toEqual(['b\n']);
    });

    it('does not rewrite the header or replay partial buffered appends', async () => {
        const write = vi.fn(async (_path: string, contents: string) => {
            if (contents === 'partial\n') throw new Error('partial append');
        });
        _resetTsvWriterForTests({ write });
        enqueueTsvRow('s1', 'partial');
        enqueueTsvRow('s1', 'following');
        await flushTsv('s1');
        await expect(initSessionTsv('s1')).rejects.toThrow('partial append');
        await expect(initSessionTsv('s1')).rejects.toThrow('partial append');
        await expect(flushTsv('s1')).rejects.toThrow('partial append');
        expect(write.mock.calls.map(([, contents]) => contents)).toEqual([TSV_HEADER, 'partial\n', 'following\n']);
    });

    it('appends newline if missing', async () => {
        await initSessionTsv('s1');
        enqueueTsvRow('s1', '1\t2');
        await flushTsv('s1');
        expect(writes[writes.length - 1]?.contents).toBe('1\t2\n');
    });

    it('bbpTsvPath formats filename', () => {
        expect(bbpTsvPath('abc')).toBe('bbp_abc.tsv');
    });

    it('writeBbpTsv writes full content without append', async () => {
        await writeBbpTsv('abc', 'time\tbt\n1.0\t200\n');
        expect(writes).toEqual([{ path: 'bbp_abc.tsv', contents: 'time\tbt\n1.0\t200\n', append: false }]);
    });

    it('deleteBbpTsv swallows and reports real remove failures', async () => {
        _resetTsvWriterForTests({
            remove: async () => {
                throw new Error('failed to remove path: x with error: Access is denied. (os error 5)');
            },
        });
        await expect(deleteBbpTsv('abc')).resolves.toBeUndefined();
        expect(loggerCapture).toHaveBeenCalledOnce();
    });

    it.each([
        'failed to get metadata of path: x with error: 지정된 파일을 찾을 수 없습니다. (os error 2)',
        'failed to get metadata of path: x with error: The system cannot find the path specified. (os error 3)',
    ])('missing-file deletes are idempotent and not captured: %s', async (message) => {
        // Tauri plugin errors reject with a plain string, not an Error.
        _resetTsvWriterForTests({ remove: () => Promise.reject(message) });
        await expect(deleteBbpTsv('inprogress')).resolves.toBeUndefined();
        await expect(deleteSessionTsv('s1')).resolves.toBeUndefined();
        expect(loggerCapture).not.toHaveBeenCalled();
    });

    it('deleteBbpTsv removes the bbp file', async () => {
        await deleteBbpTsv('abc');
        expect(removed).toEqual(['bbp_abc.tsv']);
    });
});

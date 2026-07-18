import { beforeEach, describe, expect, it } from 'vitest';
import {
    _resetTsvWriterForTests,
    bbpTsvPath,
    deleteBbpTsv,
    deleteSessionTsv,
    enqueueTsvRow,
    flushTsv,
    initSessionTsv,
    sessionTsvPath,
    TSV_HEADER,
    writeBbpTsv,
} from './tsv-writer';

describe('tsv-writer', () => {
    const writes: { path: string; contents: string; append: boolean }[] = [];
    const removed: string[] = [];
    let writeDelayMs = 0;

    beforeEach(() => {
        writes.length = 0;
        removed.length = 0;
        writeDelayMs = 0;
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

    it('isolates write errors without rejecting flush', async () => {
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
        await expect(flushTsv('s1')).resolves.toBeUndefined();
        expect(writes.filter((w) => w.append).map((w) => w.contents)).toEqual(['b\n']);
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

    it('deleteBbpTsv swallows remove failure', async () => {
        _resetTsvWriterForTests({
            remove: async () => {
                throw new Error('ENOENT');
            },
        });
        await expect(deleteBbpTsv('abc')).resolves.toBeUndefined();
    });

    it('deleteBbpTsv removes the bbp file', async () => {
        await deleteBbpTsv('abc');
        expect(removed).toEqual(['bbp_abc.tsv']);
    });
});

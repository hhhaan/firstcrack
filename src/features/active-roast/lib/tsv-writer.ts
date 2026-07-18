import { logger } from '@shared/lib/logger';
import { BaseDirectory, remove, writeTextFile } from '@tauri-apps/plugin-fs';

export const TSV_HEADER = 'time\tbt\tet\tror\theater\tfan\tdrum\n';

export type TsvWriteFn = (path: string, contents: string, options: { append?: boolean }) => Promise<void>;
export type TsvRemoveFn = (path: string) => Promise<void>;

const defaultWrite: TsvWriteFn = async (path, contents, options) => {
    await writeTextFile(path, contents, {
        baseDir: BaseDirectory.AppLocalData,
        append: options.append ?? false,
    });
};

const defaultRemove: TsvRemoveFn = async (path) => {
    await remove(path, { baseDir: BaseDirectory.AppLocalData });
};

export const sessionTsvPath = (sessionId: string): string => `session_${sessionId}.tsv`;

interface SessionQueue {
    chain: Promise<void>;
    ready: boolean;
    /** Header write scheduled or completed — prevents StrictMode double-init wipe */
    initScheduled: boolean;
    /** Rows enqueued before header is ready */
    pending: string[];
}

const sessions = new Map<string, SessionQueue>();
let writeImpl: TsvWriteFn = defaultWrite;
let removeImpl: TsvRemoveFn = defaultRemove;

const getQueue = (sessionId: string): SessionQueue => {
    let q = sessions.get(sessionId);
    if (!q) {
        q = { chain: Promise.resolve(), ready: false, initScheduled: false, pending: [] };
        sessions.set(sessionId, q);
    }
    return q;
};

const captureIo = (err: unknown, context: string, sessionId: string) => {
    logger.capture(err instanceof Error ? err : new Error(String(err)), {
        context,
        sessionId,
    });
};

const enqueue = (sessionId: string, task: () => Promise<void>): void => {
    const q = getQueue(sessionId);
    q.chain = q.chain.then(task).catch((err) => {
        captureIo(err, 'tsv-writer', sessionId);
    });
};

/** Test-only: inject FS deps and clear queues. */
export const _resetTsvWriterForTests = (opts?: { write?: TsvWriteFn; remove?: TsvRemoveFn }) => {
    sessions.clear();
    writeImpl = opts?.write ?? defaultWrite;
    removeImpl = opts?.remove ?? defaultRemove;
};

export const initSessionTsv = async (sessionId: string): Promise<void> => {
    const q = getQueue(sessionId);
    if (q.ready) return;

    if (!q.initScheduled) {
        q.initScheduled = true;
        const path = sessionTsvPath(sessionId);
        enqueue(sessionId, async () => {
            try {
                await writeImpl(path, TSV_HEADER, { append: false });
                q.ready = true;
                for (const line of q.pending) {
                    await writeImpl(path, line, { append: true });
                }
                q.pending.length = 0;
            } catch (err) {
                q.initScheduled = false;
                q.ready = false;
                captureIo(err, 'tsv-writer init', sessionId);
            }
        });
    }

    await q.chain;
};

export const enqueueTsvRow = (sessionId: string, row: string): void => {
    const line = row.endsWith('\n') ? row : `${row}\n`;
    const path = sessionTsvPath(sessionId);

    enqueue(sessionId, async () => {
        const q = getQueue(sessionId);
        if (!q.ready) {
            q.pending.push(line);
            return;
        }
        await writeImpl(path, line, { append: true });
    });
};

export const flushTsv = async (sessionId?: string): Promise<void> => {
    if (sessionId) {
        const q = sessions.get(sessionId);
        if (q) await q.chain;
        return;
    }
    await Promise.all([...sessions.values()].map((q) => q.chain));
};

// ── BBP (between-batch) TSV — 세션 큐 불필요한 단발 기록 ──────────────

export const bbpTsvPath = (sessionId: string): string => `bbp_${sessionId}.tsv`;

export const writeBbpTsv = async (sessionId: string, content: string): Promise<void> => {
    await writeImpl(bbpTsvPath(sessionId), content, { append: false });
};

export const deleteBbpTsv = async (sessionId: string): Promise<void> => {
    try {
        await removeImpl(bbpTsvPath(sessionId));
    } catch (err) {
        captureIo(err, 'bbp-tsv delete', sessionId);
    }
};

/** Delete local TSV only after successful sync (caller responsibility). */
export const deleteSessionTsv = async (sessionId: string): Promise<void> => {
    await flushTsv(sessionId);
    try {
        await removeImpl(sessionTsvPath(sessionId));
    } catch (err) {
        captureIo(err, 'tsv-writer delete', sessionId);
    }
    sessions.delete(sessionId);
};

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _resetTsvWriterForTests, enqueueTsvRow, flushTsv, TSV_HEADER } from '@shared/lib/tsv-writer';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BatchSelection } from './batchSelection';
import {
    bindLiveRoastDraft,
    clearLiveRoastDraft,
    flushLiveRoastDraftWrite,
    hydrateLiveRoastDraft,
    LIVE_ROAST_DRAFT_KEY,
    readLiveRoastDraft,
    unbindLiveRoastDraftForTests,
} from './liveRoastDraft';
import { useRoastingStore } from './status';

const batch: BatchSelection = {
    selectedBeanId: 'bean-1',
    targetProfileId: 'profile-1',
    handoffBeanName: 'Ethiopia',
    planBatchHandoff: null,
};

const curve: LiveRoastPoint[] = [
    {
        time: 4.2,
        label: '0:04',
        bt: 190,
        et: 210,
        ror: 8,
        ror_et: 4,
        heater: 60,
        fan: 40,
        drum: 50,
    },
];

const log: LogEntry[] = [{ time: '0:04', event: 'Yellow', temp: '190', note: 'color' }];

const wipeMemory = () => {
    unbindLiveRoastDraftForTests();
    useRoastingStore.getState().clear();
    useRoastingStore.setState({
        phase: 'idle',
        sessionId: null,
        sessionOwnerId: null,
        roastStartMs: 0,
        elapsed: 0,
        logEntries: [],
        livePoints: [],
        fcDualUnwind: false,
        heatHoldAfterDrop: false,
        awaitingNextCharge: false,
        currentBatch: null,
        prepared: {
            selectedBeanId: null,
            targetProfileId: null,
            handoffBeanName: null,
            planBatchHandoff: null,
        },
        machineSnapshot: null,
        initializedTsvSessions: new Set(),
        sidecarConnected: false,
    });
};

describe('in-progress roast reload journal', () => {
    const writes: { path: string; contents: string; append: boolean }[] = [];

    beforeEach(() => {
        writes.length = 0;
        sessionStorage.clear();
        unbindLiveRoastDraftForTests();
        clearLiveRoastDraft();
        wipeMemory();
        _resetTsvWriterForTests({
            write: async (path, contents, options) => {
                writes.push({ path, contents, append: options.append ?? false });
            },
            remove: async () => undefined,
        });
    });

    afterEach(() => {
        unbindLiveRoastDraftForTests();
        clearLiveRoastDraft();
        wipeMemory();
        _resetTsvWriterForTests();
    });

    it('rehydrates id, log, curve, and Charge origin after a same-tab reload without rewriting the TSV', async () => {
        const roastStartMs = Date.now() - 5_000;
        bindLiveRoastDraft();
        useRoastingStore.setState({
            phase: 'roasting',
            sessionId: 'rehydrate-1',
            sessionOwnerId: 'owner-1',
            roastStartMs,
            elapsed: 4,
            logEntries: log,
            livePoints: curve,
            currentBatch: batch,
            heatHoldAfterDrop: false,
        });
        flushLiveRoastDraftWrite();
        // New document: subscriber is gone, memory is empty, the tab journal remains.
        wipeMemory();

        expect(readLiveRoastDraft()?.sessionId).toBe('rehydrate-1');
        expect(hydrateLiveRoastDraft()).toBe(true);

        const state = useRoastingStore.getState();
        expect(state.phase).toBe('roasting');
        expect(state.sessionId).toBe('rehydrate-1');
        expect(state.sessionOwnerId).toBe('owner-1');
        expect(state.roastStartMs).toBe(roastStartMs);
        expect(state.elapsed).toBeGreaterThanOrEqual(5);
        expect(state.logEntries).toEqual(log);
        expect(state.livePoints).toEqual(curve);
        expect(state.currentBatch).toEqual(batch);
        expect(state.initializedTsvSessions.has('rehydrate-1')).toBe(true);

        // A second mount in the same document must not mint another session or curve.
        expect(hydrateLiveRoastDraft()).toBe(false);
        expect(useRoastingStore.getState().sessionId).toBe('rehydrate-1');
        expect(useRoastingStore.getState().livePoints).toEqual(curve);

        enqueueTsvRow('rehydrate-1', '9\t1\n');
        await flushTsv('rehydrate-1');
        expect(writes.some((row) => row.contents === TSV_HEADER && row.append === false)).toBe(false);
        expect(writes).toEqual([{ path: 'session_rehydrate-1.tsv', contents: '9\t1\n', append: true }]);
    });

    it('flushes the journal on pagehide so a refresh keeps the latest curve', () => {
        const roastStartMs = Date.now() - 1_000;
        bindLiveRoastDraft();
        useRoastingStore.setState({
            phase: 'roasting',
            sessionId: 'rehydrate-2',
            roastStartMs,
            logEntries: log,
            livePoints: curve,
        });
        window.dispatchEvent(new Event('pagehide'));
        expect(readLiveRoastDraft()).toMatchObject({
            sessionId: 'rehydrate-2',
            roastStartMs,
            logEntries: log,
            livePoints: curve,
        });
    });

    it('clears the journal on Drop so refresh does not resurrect that batch', () => {
        const roastStartMs = Date.now() - 21_000;
        bindLiveRoastDraft();
        useRoastingStore.setState({
            phase: 'roasting',
            sessionId: 'batch-a',
            sessionOwnerId: null,
            roastStartMs,
            elapsed: 21,
            logEntries: log,
            livePoints: curve,
        });
        flushLiveRoastDraftWrite();
        const state = useRoastingStore.getState();
        expect(
            state.drop({
                sessionId: 'batch-a',
                sessionOwnerId: null,
                roastStartMs,
                elapsed: 21,
                logEntries: log,
                livePoints: curve,
            }),
        ).toBe(true);
        expect(readLiveRoastDraft()).toBeNull();
        wipeMemory();
        expect(hydrateLiveRoastDraft()).toBe(false);
        expect(useRoastingStore.getState().sessionId).toBeNull();
    });

    it('ignores a corrupt journal', () => {
        sessionStorage.setItem(LIVE_ROAST_DRAFT_KEY, '{');
        expect(readLiveRoastDraft()).toBeNull();
        expect(sessionStorage.getItem(LIVE_ROAST_DRAFT_KEY)).toBeNull();
        expect(hydrateLiveRoastDraft()).toBe(false);
    });

    it('boots the journal before the app renders', () => {
        const src = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
        const bindAt = src.indexOf('bindLiveRoastDraft()');
        const hydrateAt = src.indexOf('hydrateLiveRoastDraft()');
        const renderAt = src.indexOf('root.render');
        expect(bindAt).toBeGreaterThan(-1);
        expect(hydrateAt).toBeGreaterThan(bindAt);
        expect(renderAt).toBeGreaterThan(hydrateAt);
    });
});

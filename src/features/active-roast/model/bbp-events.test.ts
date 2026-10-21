// @vitest-environment jsdom
import { parseTsv } from '@shared/lib/tsv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bbpEventsToLog, bbpLogMarkers } from '../lib/bbp-log';
import { manualControlData } from '../lib/manual-control';
import { hydrateLiveBbp, useBbpStore } from './bbp';

const sample = { bt: 190, et: 200, heater: null, fan: 0, drum: 0 };
const storage = () => {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
};
describe('BBP event archive', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', storage());
        vi.stubGlobal('sessionStorage', storage());
        useBbpStore.getState().abort();
        useBbpStore.setState({ events: [], finalized: null, finalizedEvents: [], finalizedPoints: [] });
    });
    it('restores same-tab inputs and archives time, temperature and zero controls with the next Charge', () => {
        const store = useBbpStore.getState();
        store.begin(1000);
        store.append(sample, 1000);
        store.append(sample, 11000);
        expect(store.recordEvent({ t: 5, event: 'Note', tempC: 185, note: 'preheat', gas: '0', airflow: '40' })).toBe(
            true,
        );
        useBbpStore.setState({ active: false, recording: false, liveGeneration: '', points: [], events: [] });
        expect(hydrateLiveBbp()).toBe(true);
        const result = useBbpStore.getState().finalize(11000, 'next');
        const events = parseTsv(result?.tsv ?? '')[0]?.bbpEvents ?? [];
        expect(events[0]).toMatchObject({ t: 5, tempC: 185, gas: '0', airflow: '40' });
        const log = bbpEventsToLog(events, 10, 'C', true);
        expect(log[0]).toMatchObject({ timeSec: -5, time: '-0:05', tempC: 185 });
        expect(manualControlData(log, 0, 20)?.heater).toEqual([0, 0]);
        expect(bbpLogMarkers(log)[0].logId).toBeUndefined();
        store.begin(12000);
        expect(useBbpStore.getState().events).toEqual([]);
        expect(useBbpStore.getState().finalized?.sessionId).toBe('next');
    });
    it('carries an older setting across the FIFO boundary without inventing a new operation marker', () => {
        const store = useBbpStore.getState();
        store.begin(1000);
        store.append(sample, 1000);
        store.recordEvent({ t: 5, event: 'Note', tempC: 185, note: '', gas: '70' });
        store.append(sample, 201000);
        store.append(sample, 1101000);
        const result = store.finalize(1101000, 'next');
        const events = parseTsv(result?.tsv ?? '')[0]?.bbpEvents ?? [];
        expect(events[0]).toMatchObject({ carried: true, gas: '70', t: 0 });
        const log = bbpEventsToLog(events, 900, 'C', true);
        expect(bbpLogMarkers(log)).toEqual([]);
        expect(manualControlData(log, 0, 20)?.heater).toEqual([70, 70]);
    });
    it('keeps valid samples when event metadata is malformed', () => {
        expect(parseTsv('time\tbt\n# bbp_events\tnot-json\n0\t190\n')[0]).toMatchObject({ t: 0, bt: 190 });
    });
});

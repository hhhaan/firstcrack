// @vitest-environment jsdom

import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playAlertSound } from '../lib/alertSound';
import { useRoastingStore } from './status';
import { useRoastAlerts } from './useRoastAlerts';

vi.mock('../lib/alertSound', () => ({ playAlertSound: vi.fn(), primeAlertAudio: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof useRoastAlerts>[0];
const tp: LogEntry = { id: 'tp', event: 'TP', time: '1:00', timeSec: 60, temp: '100°C', note: '' };
const off = { afterChargeMin: null, beforeFcMin: null, beforeDropMin: null, afterDropMin: null };
const defaults: Props = {
    enabled: true,
    soundEnabled: true,
    soundKind: 'pulse',
    rorCrashCPerMin: 0,
    btMaxC: 250,
    afterTurningPoint: false,
    logEntries: [],
    timeAlerts: off,
    referenceFcStartSec: 480,
    referenceDropSec: 600,
};

describe('roast alert lifecycle', () => {
    let root: Root;
    let alerts: ReturnType<typeof useRoastAlerts>;
    const Probe = (props: Props) => {
        alerts = useRoastAlerts(props);
        return null;
    };
    const render = (patch: Partial<Props> = {}) => {
        act(() => root.render(createElement(Probe, { ...defaults, ...patch })));
    };
    beforeEach(() => {
        vi.clearAllMocks();
        useRoastingStore.setState({
            phase: 'roasting',
            sessionId: 'batch-1',
            completed: null,
            elapsed: 60,
            liveData: null,
        });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => act(() => root.unmount()));

    it.each(['automatic', 'manual'])('notifies once for %s TP and ignores duplicate/moved marks', (kind) => {
        render();
        const patch = kind === 'automatic' ? { afterTurningPoint: true } : { logEntries: [tp] };
        render(patch);
        expect(alerts).toEqual([]);
        expect(playAlertSound).toHaveBeenCalledWith('pulse');
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        render({ ...patch, logEntries: [{ ...tp, timeSec: 61 }] });
        render();
        render(patch);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });

    it.each(['enabled', 'soundEnabled'] as const)('respects %s and does not replay TP when re-enabled', (setting) => {
        render({ [setting]: false });
        render({ [setting]: false, afterTurningPoint: true });
        render({ afterTurningPoint: true });
        expect(alerts).toEqual([]);
        expect(playAlertSound).not.toHaveBeenCalled();
    });

    it('uses the selected alarm tone for TP', () => {
        render({ soundKind: 'chime' });
        render({ soundKind: 'chime', afterTurningPoint: true });
        expect(playAlertSound).toHaveBeenCalledExactlyOnceWith('chime');
    });

    it('does not sound TP first detected after Drop', () => {
        render();
        const drop: LogEntry = { ...tp, id: 'drop', event: 'Drop', timeSec: 100 };
        render({ logEntries: [drop] });
        render({ logEntries: [tp, drop] });
        render({ logEntries: [tp] });
        expect(playAlertSound).not.toHaveBeenCalled();
    });

    it('plays once when TP and a time alarm trigger together', () => {
        render();
        render({ afterTurningPoint: true, timeAlerts: { ...off, afterChargeMin: 1 } });
        expect(alerts).toEqual(['after-charge']);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });

    it('does not mistake lagging negative RoR at TP for a crash, but detects a later crash', () => {
        const updateRor = (ror: number) =>
            act(() =>
                useRoastingStore.setState({
                    liveData: { bt: 100, et: 120, ror, ror_et: 1, heater: 70, fan: 40, drum: 50 },
                }),
            );
        updateRor(-2);
        render({ soundEnabled: false });
        render({ soundEnabled: false, afterTurningPoint: true });
        expect(alerts).toEqual([]);
        expect(playAlertSound).not.toHaveBeenCalled();
        render({ afterTurningPoint: true });
        updateRor(5);
        updateRor(-1);
        expect(alerts).toEqual(['ror-crash']);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });

    it('does not replay the TP sound after Drop cancellation; a new batch can notify', () => {
        render();
        render({ logEntries: [tp] });
        render({ logEntries: [tp, { ...tp, id: 'drop', event: 'Drop', timeSec: 100 }] });
        render({ logEntries: [tp] });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        act(() => useRoastingStore.setState({ sessionId: 'batch-2' }));
        render();
        render({ logEntries: [tp] });
        expect(playAlertSound).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['afterChargeMin', 1, 60, 'after-charge'],
        ['beforeFcMin', 1, 420, 'before-fc'],
        ['beforeDropMin', 1, 540, 'before-drop'],
        ['afterDropMin', 1, 660, 'after-drop'],
    ] as const)('keeps %s working without TP and sounds once', (key, value, elapsed, expected) => {
        act(() => useRoastingStore.setState({ elapsed: elapsed - 1 }));
        const patch: Partial<Props> = {
            timeAlerts: { ...off, [key]: value },
            logEntries: key === 'afterDropMin' ? [{ ...tp, id: 'drop', event: 'Drop', timeSec: 600 }] : [],
        };
        render(patch);
        expect(playAlertSound).not.toHaveBeenCalled();
        act(() => useRoastingStore.setState({ elapsed }));
        expect(alerts).toEqual([expected]);
        render(patch);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });
});

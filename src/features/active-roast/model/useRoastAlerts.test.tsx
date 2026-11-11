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
    tpEnabled: true,
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

    it.each(['enabled', 'soundEnabled', 'tpEnabled'] as const)(
        'respects %s and does not replay TP when re-enabled',
        (setting) => {
            render({ [setting]: false });
            render({ [setting]: false, afterTurningPoint: true });
            render({ afterTurningPoint: true });
            expect(alerts).toEqual([]);
            expect(playAlertSound).not.toHaveBeenCalled();
        },
    );

    it('keeps time alarms audible with TP disabled, including when both occur together', () => {
        render({ tpEnabled: false });
        render({ tpEnabled: false, afterTurningPoint: true });
        expect(playAlertSound).not.toHaveBeenCalled();
        render({ tpEnabled: false, afterTurningPoint: true, timeAlerts: { ...off, afterChargeMin: 1 } });
        expect(alerts).toEqual(['after-charge']);
        expect(playAlertSound).toHaveBeenCalledExactlyOnceWith('pulse');
    });

    it('uses the latest global mute when TP and a time alarm arrive in the same render', () => {
        render();
        const patch = { afterTurningPoint: true, timeAlerts: { ...off, afterChargeMin: 1 } };
        render({ ...patch, soundEnabled: false });
        expect(alerts).toEqual(['after-charge']);
        expect(playAlertSound).not.toHaveBeenCalled();
        render(patch);
        expect(playAlertSound).not.toHaveBeenCalled();
    });

    it('still evaluates a later RoR crash when TP sound is disabled', () => {
        act(() =>
            useRoastingStore.setState({
                liveData: { bt: 100, et: 120, ror: 5, ror_et: 1, heater: 70, fan: 40, drum: 50 },
            }),
        );
        render({ tpEnabled: false, afterTurningPoint: true });
        expect(playAlertSound).not.toHaveBeenCalled();
        act(() =>
            useRoastingStore.setState({
                liveData: { bt: 100, et: 120, ror: -1, ror_et: 1, heater: 70, fan: 40, drum: 50 },
            }),
        );
        expect(alerts).toEqual(['ror-crash']);
        expect(playAlertSound).toHaveBeenCalledExactlyOnceWith('pulse');
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
    ] as const)('keeps %s working with TP disabled and sounds once', (key, value, elapsed, expected) => {
        act(() => useRoastingStore.setState({ elapsed: elapsed - 1 }));
        const patch: Partial<Props> = {
            tpEnabled: false,
            timeAlerts: { ...off, [key]: value },
            logEntries: key === 'afterDropMin' ? [tp, { ...tp, id: 'drop', event: 'Drop', timeSec: 600 }] : [tp],
        };
        render(patch);
        expect(playAlertSound).not.toHaveBeenCalled();
        act(() => useRoastingStore.setState({ elapsed }));
        expect(alerts).toEqual([expected]);
        render(patch);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });
});

describe('after-drop during the BBP wait (#1130)', () => {
    let root: Root;
    let alerts: ReturnType<typeof useRoastAlerts>;
    const Probe = (props: Props) => {
        alerts = useRoastAlerts(props);
        return null;
    };
    const render = (patch: Partial<Props> = {}) => {
        act(() => root.render(createElement(Probe, { ...defaults, ...patch, logEntries: patch.logEntries ?? [] })));
    };
    const chargeAndDrop = (onset?: { timeSec: number; bt: number }) => {
        const origin = Date.now() - 600_000;
        useRoastingStore.getState().startCharge(origin, 'owner', { bt: 180, unit: 'C' });
        return useRoastingStore.getState().drop({
            rawBT: 200,
            unit: 'C',
            replayActive: false,
            ...(onset ? { onset } : {}),
        });
    };
    const waitConfig = { ...off, afterDropMin: 1 as number | null };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        useRoastingStore.getState().reset();
        useRoastingStore.setState({ sidecarConnected: true, phase: 'standby', completed: null, sessionId: null });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
    });

    it.each([
        ['manual Drop', undefined],
        ['temperature detection', { timeSec: 600, bt: 201 }],
        ['machine drop command', { timeSec: 600, bt: 202 }],
    ] as const)('fires once at the offset after %s, while the roast clock is stopped', (_path, onset) => {
        render({ timeAlerts: waitConfig });
        act(() => {
            chargeAndDrop(onset);
        });
        expect(useRoastingStore.getState().phase).not.toBe('roasting');
        expect(useRoastingStore.getState().elapsed).toBe(0);
        expect(playAlertSound).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(59_999);
        });
        expect(playAlertSound).not.toHaveBeenCalled();
        expect(alerts).toEqual([]);
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(alerts).toEqual(['after-drop']);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        act(() => {
            vi.advanceTimersByTime(5 * 60_000);
        });
        render({ timeAlerts: waitConfig });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        expect(alerts).toEqual(['after-drop']);
    });

    it('does not fire when after-drop is OFF', () => {
        render({ timeAlerts: off });
        act(() => {
            chargeAndDrop();
        });
        act(() => {
            vi.advanceTimersByTime(10 * 60_000);
        });
        expect(alerts).toEqual([]);
        expect(playAlertSound).not.toHaveBeenCalled();
    });

    it('keeps charge, FC, drop-before and threshold alarms quiet after Drop', () => {
        render({
            tpEnabled: false,
            afterTurningPoint: true,
            timeAlerts: { afterChargeMin: 1, beforeFcMin: 1, beforeDropMin: 1, afterDropMin: 1 },
        });
        act(() => {
            useRoastingStore.getState().startCharge(Date.now(), 'owner', { bt: 180, unit: 'C' });
            useRoastingStore.setState({
                liveData: { bt: 100, et: 120, ror: 5, ror_et: 1, heater: 70, fan: 40, drum: 50 },
            });
        });
        expect(playAlertSound).not.toHaveBeenCalled();
        act(() => {
            useRoastingStore.getState().drop({ rawBT: 200, unit: 'C', replayActive: false });
            useRoastingStore.setState({
                elapsed: 9_999,
                liveData: { bt: 260, et: 210, ror: -5, ror_et: 1, heater: 0, fan: 40, drum: 50 },
            });
        });
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(alerts).toEqual(['after-drop']);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });

    it('is not cancelled by roast end or by opening and closing the completion summary', () => {
        render({ timeAlerts: waitConfig });
        let sessionId: string | null = null;
        act(() => {
            const dropped = chargeAndDrop();
            sessionId = dropped?.sessionId ?? null;
            const summary = dropped?.summary;
            if (summary) useRoastingStore.getState().captureSummary(summary, 'owner', 200);
            useRoastingStore.getState().endRoast();
            useRoastingStore.getState().discardSummary('owner', sessionId);
        });
        expect(useRoastingStore.getState().phase).toBe('ended');
        expect(useRoastingStore.getState().completed?.summary).toBeNull();
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(alerts).toEqual(['after-drop']);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        act(() => {
            useRoastingStore.getState().saveSucceeded('owner', sessionId);
        });
        expect(alerts).toEqual(['after-drop']);
        expect(playAlertSound).toHaveBeenCalledTimes(1);
    });

    it('ends the previous alarm on the next Charge and does not leak into that batch', () => {
        render({ timeAlerts: waitConfig });
        act(() => {
            chargeAndDrop();
        });
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        act(() => {
            useRoastingStore.getState().startCharge(Date.now(), 'owner', { bt: 170, unit: 'C' });
        });
        expect(alerts).toEqual([]);
        act(() => {
            vi.advanceTimersByTime(10 * 60_000);
        });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        expect(alerts).toEqual([]);
        act(() => {
            // The roast clock is what Drop records. Advance it to "now" so this batch's
            // offset is not already due from the ten minutes spent roasting.
            useRoastingStore.getState().tick();
            useRoastingStore.getState().drop({ rawBT: 205, unit: 'C', replayActive: false });
        });
        act(() => {
            vi.advanceTimersByTime(59_999);
        });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(playAlertSound).toHaveBeenCalledTimes(2);
        expect(alerts).toEqual(['after-drop']);
    });

    it('discards the clock on Drop cancel, then arms a new one from the next Drop', () => {
        render({ timeAlerts: waitConfig });
        act(() => {
            chargeAndDrop();
        });
        act(() => {
            vi.advanceTimersByTime(30_000);
        });
        act(() => {
            expect(useRoastingStore.getState().cancelDrop()).not.toBeNull();
        });
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(playAlertSound).not.toHaveBeenCalled();
        expect(alerts).toEqual([]);
        act(() => {
            useRoastingStore.getState().drop({ rawBT: 198, unit: 'C', replayActive: false });
        });
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        expect(alerts).toEqual(['after-drop']);
    });

    it('ends the alarm on restart and does not revive it from a leftover wait', () => {
        render({ timeAlerts: waitConfig });
        act(() => {
            chargeAndDrop();
        });
        act(() => {
            vi.advanceTimersByTime(30_000);
        });
        act(() => {
            useRoastingStore.getState().reset();
        });
        act(() => {
            vi.advanceTimersByTime(10 * 60_000);
        });
        expect(playAlertSound).not.toHaveBeenCalled();
        expect(alerts).toEqual([]);
        act(() => {
            useRoastingStore.setState({ sidecarConnected: true, phase: 'standby' });
            chargeAndDrop();
        });
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(playAlertSound).toHaveBeenCalledTimes(1);
        expect(alerts).toEqual(['after-drop']);
    });

    it('does not invent an after-drop alarm for End without a Drop', () => {
        render({ timeAlerts: waitConfig });
        act(() => {
            useRoastingStore.getState().startCharge(Date.now() - 600_000, 'owner', { bt: 180, unit: 'C' });
            useRoastingStore.getState().abortRoast(190, 'C');
        });
        act(() => {
            vi.advanceTimersByTime(10 * 60_000);
        });
        expect(alerts).toEqual([]);
        expect(playAlertSound).not.toHaveBeenCalled();
    });
});

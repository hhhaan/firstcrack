// @vitest-environment jsdom

import { reduceSensorObservation, sensorObservationTick } from '@features/active-roast/lib/sensorObservation';
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoastSummaryLiveStatus } from './RoastSummaryLiveStatus';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the BBP clock running with live readings and hides stale values on disconnect', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    useBbpStore.setState({ active: true, recording: true, startMs: now - 60_000, points: [] });
    useRoastingStore.setState({
        sidecarConnected: true,
        reconnecting: false,
        observation: reduceSensorObservation(null, sensorObservationTick(now, { bt: null, deviceTimestamp: 1 })),
        displayObservation: reduceSensorObservation(null, sensorObservationTick(now, { bt: 180, deviceTimestamp: 1 })),
        liveData: { bt: 180, et: 200, ror: 0, ror_et: 0, heater: 0, fan: 0, drum: 0 },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        act(() => root.render(createElement(RoastSummaryLiveStatus)));
        expect(host.textContent).toContain('1:00');
        expect(host.textContent).toContain('180.0°C');
        expect(useRoastingStore.getState().observation?.quality).toBe('null');
        act(() => {
            vi.advanceTimersByTime(2_000);
            useRoastingStore.setState({
                liveData: { bt: 181, et: null, ror: 0, ror_et: 0, heater: 0, fan: 0, drum: 0 },
            });
        });
        expect(host.textContent).toContain('1:02');
        expect(host.textContent).toContain('181.0°C');
        expect(host.textContent).not.toContain('200.0°C');
        act(() => vi.advanceTimersByTime(2_000));
        expect(host.textContent).toContain('liveUnavailable');
        expect(host.textContent).not.toContain('181.0°C');
        const fresh = reduceSensorObservation(null, sensorObservationTick(Date.now(), { bt: 181, deviceTimestamp: 2 }));
        act(() => useRoastingStore.getState().updateDisplayObservation(fresh));
        expect(host.textContent).toContain('181.0°C');
        act(() =>
            useRoastingStore
                .getState()
                .updateDisplayObservation(
                    reduceSensorObservation(
                        fresh,
                        sensorObservationTick(Date.now(), { bt: 181, deviceTimestamp: 3, stale: true }),
                    ),
                ),
        );
        expect(host.textContent).not.toContain('181.0°C');
        act(() => useRoastingStore.getState().updateDisplayObservation(fresh));
        act(() => useRoastingStore.setState({ sidecarConnected: false }));
        expect(host.textContent).toContain('liveUnavailable');
        expect(host.textContent).not.toContain('181.0°C');
        act(() => useBbpStore.setState({ active: false, recording: false }));
        expect(host.textContent).toBe('');
    } finally {
        act(() => root.unmount());
        host.remove();
        useBbpStore.setState({ active: false, recording: false, startMs: 0, points: [] });
        useRoastingStore.getState().reset();
        vi.useRealTimers();
    }
});

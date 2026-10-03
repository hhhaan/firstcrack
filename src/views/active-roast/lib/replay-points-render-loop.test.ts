// @vitest-environment jsdom
import { useReplayControl } from '@features/machine-control/model/useReplayControl';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { replayPointsForProfile } from './active-roast-screen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FC-1T: ActiveRoast derives replay points inline each render. With no target profile and an
// applied batch heater plan, a fresh `[]` made Replay's render-phase sync setState every render.
it('applying batch heater events with no target profile does not loop renders', async () => {
    const root = createRoot(document.createElement('div'));
    let replay!: ReturnType<typeof useReplayControl>;
    const Probe = () => {
        replay = useReplayControl({
            referencePoints: replayPointsForProfile(null, false, []),
            referenceMachineMismatch: false,
            referenceDropTime: null,
            profileHeaterEvents: null,
            liveBt: 180,
            elapsed: 0,
            roasting: false,
            confirmedTurningPoint: null,
            heaterWritable: true,
            pidEngaged: false,
            roastFinished: false,
            sidecarConnected: true,
            heaterUnacknowledged: false,
            dropBehavior: 'hold',
            heaterFeedback: null,
            heaterPending: false,
            reconnecting: false,
            observationQuality: 'valid',
            writeHeater: async (value) => value,
            cancelUnsentHeater: vi.fn(),
        });
        return null;
    };
    await act(async () => root.render(createElement(Probe)));

    await act(async () => replay.applyBatchEvents([{ t: 0, bt: 180, heater: 80, trigger: 'time' }]));

    expect(replay.source).toBe('batch');
    expect(replay.plan?.events).toHaveLength(1);
    act(() => root.unmount());
});

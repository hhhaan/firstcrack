// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBbpStore } from './bbp';
import { useBbpTimer } from './useBbpTimer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderTimer = async () => {
    const root = createRoot(document.createElement('div'));
    let latest: string | null = null;
    const Probe = () => {
        latest = useBbpTimer();
        return null;
    };
    await act(async () => {
        root.render(createElement(Probe));
    });
    return {
        get: () => latest,
        unmount: () => act(() => root.unmount()),
    };
};

describe('useBbpTimer', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        useBbpStore.setState({ active: false, recording: false, startMs: 0, points: [] });
    });

    it('hides the timer during chart-only preheat', async () => {
        const now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        useBbpStore.setState({ active: true, recording: false, startMs: now - 144_000, points: [] });
        const timer = await renderTimer();
        try {
            expect(timer.get()).toBeNull();
        } finally {
            await timer.unmount();
        }
    });

    it('counts a recorded Charge wait', async () => {
        const now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        useBbpStore.setState({ active: true, recording: true, startMs: now - 144_000, points: [] });
        const timer = await renderTimer();
        try {
            expect(timer.get()).toBe('2:24');
        } finally {
            await timer.unmount();
        }
    });
});

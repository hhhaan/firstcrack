// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TemperatureUnit } from './settings';
import { useRoastLog } from './useRoastLog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderHook = async (unit: TemperatureUnit, rawBT: number | null, elapsed: number) => {
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useRoastLog>;
    const Probe = (props: { unit: TemperatureUnit; rawBT: number | null; elapsed: number }) => {
        latest = useRoastLog(props.unit, props.rawBT, props.elapsed);
        return null;
    };
    const render = (nextElapsed: number, nextRawBT = rawBT) =>
        act(() => root.render(createElement(Probe, { unit, rawBT: nextRawBT, elapsed: nextElapsed })));
    await render(elapsed);
    return { get: () => latest, render, unmount: () => act(() => root.unmount()) };
};

describe('useRoastLog markEvent', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps existing current-time callers and explicitly inserts a sorted historical Note', async () => {
        const randomUUID = vi.fn().mockReturnValueOnce('current-id').mockReturnValueOnce('note-id');
        vi.stubGlobal('crypto', { randomUUID });
        const hook = await renderHook('C', 180, 20);

        act(() => hook.get().markEvent('Yellow', 'Auto-marked'));
        await hook.render(40, 200);
        act(() => hook.get().markEvent('Note', '  check aroma  ', undefined, { timeSec: 5.6, tempC: 155 }));

        expect(hook.get().logEntries).toEqual([
            {
                id: 'note-id',
                time: '0:06',
                timeSec: 6,
                event: 'Note',
                temp: '155.0°C',
                tempC: 155,
                note: 'check aroma',
            },
            {
                id: 'current-id',
                time: '0:20',
                timeSec: 20,
                event: 'Yellow',
                temp: '180.0°C',
                tempC: 180,
                note: 'Auto-marked',
            },
        ]);
        expect(randomUUID).toHaveBeenCalledTimes(2);
        hook.unmount();
    });

    it('rejects blank Notes and keeps missing historical BT null', async () => {
        vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('note-id') });
        const hook = await renderHook('F', 200, 30);

        act(() => hook.get().markEvent('Note', '   ', undefined, { timeSec: 10, tempC: 150 }));
        act(() => hook.get().markEvent('Note', 'no curve', undefined, { timeSec: -4, tempC: null }));

        expect(hook.get().logEntries).toEqual([
            {
                id: 'note-id',
                time: '0:00',
                timeSec: 0,
                event: 'Note',
                temp: '',
                tempC: null,
                note: 'no curve',
            },
        ]);
        hook.unmount();
    });

    it('rejects invalid explicit historical values', async () => {
        vi.stubGlobal('crypto', { randomUUID: vi.fn() });
        const hook = await renderHook('C', 180, 30);

        act(() => hook.get().markEvent('Note', 'bad time', undefined, { timeSec: Number.NaN, tempC: 150 }));
        act(() => hook.get().markEvent('Note', 'bad temp', undefined, { timeSec: 10, tempC: Number.NaN }));

        expect(hook.get().logEntries).toEqual([]);
        expect(crypto.randomUUID).not.toHaveBeenCalled();
        hook.unmount();
    });
});

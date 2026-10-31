// @vitest-environment jsdom

import type { TemperatureReading } from '@shared/types/sidecar';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadFeedback } from './ReadFeedback';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ sidecarConnected: true, liveData: null as TemperatureReading | null }));
vi.mock('@features/active-roast/model/status', () => ({
    useRoastingStore: (select: (value: typeof state) => unknown) => select(state),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
    state.sidecarConnected = true;
    state.liveData = {
        bt: 190,
        et: 210,
        ror: 0,
        heater: 0,
        fan: 1234.56,
        drum: 31.25,
        timestamp: 1,
        processing: { read_units: { heater: '%', fan: 'Pa', drum: 'Hz' } },
    } as TemperatureReading;
});
afterEach(() => {
    act(() => root.unmount());
});
const render = () => act(() => root.render(createElement(ReadFeedback)));
it('shows zero heat and unclipped physical feedback without writable controls', () => {
    render();
    expect(container.textContent).toContain('0 %');
    expect(container.textContent).toContain('1234.56 Pa');
    expect(container.textContent).toContain('31.25 Hz');
    expect(container.querySelector('button, input')).toBeNull();
});
it('does not present disconnected or absent channels as measured zero', () => {
    state.sidecarConnected = false;
    render();
    expect(container.textContent).toBe('');
    state.sidecarConnected = true;
    if (!state.liveData?.processing) throw new Error('Missing fixture');
    state.liveData.processing.read_units = { fan: 'Pa' };
    render();
    expect(container.querySelectorAll('dd')).toHaveLength(1);
    expect(container.textContent).toContain('1234.56 Pa');
    state.liveData.processing.read_units = {};
    render();
    expect(container.textContent).toBe('');
});
it('marks stale measured values unavailable rather than showing cached values', () => {
    if (!state.liveData) throw new Error('Missing fixture');
    state.liveData.stale = true;
    render();
    expect([...container.querySelectorAll('dd')].map((node) => node.textContent)).toEqual(['—', '—', '—']);
});

it('shows read-only extra sensors without control feedback metadata', () => {
    if (!state.liveData) throw new Error('Missing fixture');
    state.liveData.processing = undefined;
    state.liveData.extra_readings = [
        { id: 'inlet-2', label: 'Inlet 2', unit: '°C', value: 187.5 },
        { id: 'pressure', label: 'Pressure', unit: 'Pa', value: null },
    ];
    render();
    expect(container.textContent).toContain('Inlet 2');
    expect(container.textContent).toContain('187.5 °C');
    expect([...container.querySelectorAll('dd')].map((node) => node.textContent)).toEqual(['187.5 °C', '—']);
    expect(container.querySelector('button, input')).toBeNull();
});

it('explains the Loring auto bit instead of showing auto_status', () => {
    if (!state.liveData) throw new Error('Missing fixture');
    state.liveData.processing = undefined;
    state.liveData.extra_readings = [{ id: 'auto_status', label: 'auto_status', unit: '', value: 1 }];
    render();
    expect(container.textContent).toContain('machines.loringAuto.hint');
    expect(container.textContent).toContain('machines.loringAuto.on');
    expect(container.textContent).not.toContain('auto_status');
});

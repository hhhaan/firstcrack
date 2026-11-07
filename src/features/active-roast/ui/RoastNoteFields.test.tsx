// @vitest-environment jsdom
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_MANUAL_CONTROLS } from '../lib/manual-controls';
import { emptyNoteValues, RoastNoteFields } from './RoastNoteFields';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const originalSettings = getRoastSettings();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    updateRoastSettings({ manualControls: [...DEFAULT_MANUAL_CONTROLS], manualControlsByMachine: {} });
    host = document.createElement('div');
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    updateRoastSettings(originalSettings);
});

const props = {
    values: emptyNoteValues(),
    onChange: vi.fn(),
    prefix: 'note',
    commentId: 'comment',
};

it('shows builtin units without arbitrary numeric examples or range limits', () => {
    act(() => root.render(createElement(RoastNoteFields, props)));
    for (const [id, unit] of [
        ['gas', '%'],
        ['airflow', '%'],
        ['drum', 'RPM'],
    ]) {
        const input = host.querySelector<HTMLInputElement>(`#note-${id}`);
        expect(input?.placeholder).toBe('');
        expect(input?.inputMode).toBe('text');
        expect(input?.parentElement?.textContent).toBe(unit);
    }
});

it('uses the machine feedback unit and keeps custom control bounds', () => {
    updateRoastSettings({
        manualControlsByMachine: {
            current: [
                ...DEFAULT_MANUAL_CONTROLS,
                { id: 'v_damper01', label: 'Damper', unit: 'mm', min: 0, max: 70, enabled: true },
            ],
        },
    });
    act(() =>
        root.render(
            createElement(RoastNoteFields, {
                ...props,
                machineId: 'current',
                readUnits: { heater: 'Hz', fan: 'Pa', drum: 'Hz' },
            }),
        ),
    );
    expect(host.querySelector('#note-gas')?.parentElement?.textContent).toBe('Hz');
    expect(host.querySelector('#note-airflow')?.parentElement?.textContent).toBe('Pa');
    expect(host.querySelector('#note-drum')?.parentElement?.textContent).toBe('Hz');
    expect(host.querySelector('#note-v_damper01')?.parentElement?.textContent).toBe('mm0–70');
});

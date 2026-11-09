// @vitest-environment jsdom
import { initRoasterFormParams, ROASTER_REGISTRY } from '@entities/machine';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PhidgetSettingsSection } from './PhidgetSettingsSection';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('shows applicable TC/RTD/address fields and explicitly disables ET with its switch', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const setParam = vi.fn();
    const render = async (params: Record<string, string>) =>
        act(async () => root.render(createElement(PhidgetSettingsSection, { params, setParam })));
    try {
        await render(initRoasterFormParams(ROASTER_REGISTRY.phidget_1048));
        expect(container.querySelectorAll('fieldset')).toHaveLength(2);
        expect(container.textContent).toContain('addMachine.phidgetThermocouple');
        expect(container.textContent).not.toContain('addMachine.phidgetRtd');
        expect(container.textContent).not.toContain('addMachine.phidgetHubPort');
        const toggle = container.querySelector<HTMLInputElement>('input[role="switch"]');
        expect(toggle?.checked).toBe(true);
        await act(async () => toggle?.click());
        expect(setParam).toHaveBeenCalledWith('channel_et', '');

        await render(initRoasterFormParams(ROASTER_REGISTRY.phidget_tmp1202));
        expect(container.querySelectorAll('fieldset')).toHaveLength(1);
        expect(container.textContent).toContain('addMachine.phidgetRtd');
        expect(container.textContent).toContain('addMachine.phidgetWires');
        expect(container.textContent).toContain('addMachine.phidgetHubPort');
        expect(container.textContent).not.toContain('addMachine.phidgetThermocouple');
        expect(container.querySelectorAll('[role="combobox"]')[1]?.getAttribute('data-value')).toBe('0');
    } finally {
        await act(async () => root.unmount());
    }
});

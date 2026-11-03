// @vitest-environment jsdom

import type { DoorProbeAction, DoorProbeResult } from '@shared/types/sidecar';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineActuatorDock } from './MachineActuatorDock';

const mocks = vi.hoisted(() => ({ doorProbe: vi.fn(), entitled: true }));

vi.mock('@shared/lib/features', () => ({
    FEATURE: { machineControl: 'machineControl' },
    useFeature: () => mocks.entitled,
}));

vi.mock('@shared/lib/sidecar', () => ({
    isSidecarHttpError: (error: unknown) => error instanceof Error && error.name === 'SidecarHttpError',
    sidecar: { doorProbe: mocks.doorProbe },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = (action: DoorProbeAction = 'fill_open'): DoorProbeResult => ({
    action,
    wrote: 5,
    command_before: null,
    command_after: null,
    command_held: null,
    discharge_open_before: null,
    discharge_open_after: null,
});

const roots: Root[] = [];
const renderDock = (roaster: string | null = 'giesen_w45a_w60a', disabled = false) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (nextRoaster = roaster, nextDisabled = disabled) => {
        act(() => root.render(createElement(MachineActuatorDock, { roaster: nextRoaster, disabled: nextDisabled })));
    };
    render();
    return { host, render };
};

const button = (host: HTMLElement, device: string, action: string) => {
    const group = host.querySelector(`[role="group"][aria-label="machines.actuators.${device}"]`);
    const found = [...(group?.querySelectorAll('button') ?? [])].find(
        (item) => item.textContent === `machines.actuators.${action}`,
    );
    if (!found) throw new Error(`${device} ${action}`);
    return found;
};

describe('MachineActuatorDock', () => {
    beforeEach(() => {
        mocks.doorProbe.mockReset().mockResolvedValue(report());
        mocks.entitled = true;
    });

    afterEach(() => {
        for (const root of roots.splice(0)) act(() => root.unmount());
        document.body.innerHTML = '';
    });

    it.each([null, 'giesen_w6a', 'giesen_w140a'])('stays off unsupported roaster %s', (roaster) => {
        expect(renderDock(roaster).host.textContent).toBe('');
    });

    it('requires machine-control entitlement outside the sidebar', () => {
        mocks.entitled = false;
        expect(renderDock().host.textContent).toBe('');
        expect(mocks.doorProbe).not.toHaveBeenCalled();
    });

    it.each(['giesen_w45a_w60a', 'virtual'])('exposes four independent equipment groups on %s', (roaster) => {
        const { host } = renderDock(roaster);
        expect(host.querySelectorAll('[role="group"]')).toHaveLength(4);
        expect(host.querySelectorAll('button')).toHaveLength(8);
        expect(host.querySelector('[role="switch"], [aria-pressed]')).toBeNull();
        expect(mocks.doorProbe).not.toHaveBeenCalled();
    });

    it.each([
        ['fill', 'open', 'fill_open'],
        ['fill', 'close', 'fill_close'],
        ['discharge', 'open', 'discharge_open'],
        ['discharge', 'close', 'discharge_close'],
        ['cooling', 'on', 'cooling_on'],
        ['cooling', 'off', 'cooling_off'],
        ['stirrer', 'on', 'stirrer_on'],
        ['stirrer', 'off', 'stirrer_off'],
    ] as const)('sends only the explicit %s %s command', async (device, action, command) => {
        const { host } = renderDock();
        const target = button(host, device, action);
        expect(target.getAttribute('aria-label')).toContain(`machines.actuators.${device}`);
        await act(async () => target.click());
        expect(mocks.doorProbe).toHaveBeenCalledExactlyOnceWith(command);
        expect(host.textContent).toContain('machines.actuators.sent');
        expect(target.hasAttribute('aria-pressed')).toBe(false);
    });

    it('blocks all controls when reviewing or disconnected, then allows them after unlock', async () => {
        const { host, render } = renderDock('virtual', true);
        expect([...host.querySelectorAll('button')].every((item) => item.disabled)).toBe(true);
        await act(async () => button(host, 'fill', 'open').click());
        expect(mocks.doorProbe).not.toHaveBeenCalled();
        render('virtual', false);
        await act(async () => button(host, 'fill', 'open').click());
        expect(mocks.doorProbe).toHaveBeenCalledExactlyOnceWith('fill_open');
    });

    it('serializes commands, including two clicks before the pending render', async () => {
        let finish!: (value: DoorProbeResult) => void;
        mocks.doorProbe.mockReturnValue(
            new Promise<DoorProbeResult>((resolve) => {
                finish = resolve;
            }),
        );
        const { host } = renderDock();
        act(() => {
            button(host, 'fill', 'open').click();
            button(host, 'discharge', 'open').click();
        });
        expect(mocks.doorProbe).toHaveBeenCalledExactlyOnceWith('fill_open');
        expect(host.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).toBe('machines.actuators.fill');
        expect(host.textContent).toContain('machines.actuators.sending');
        expect([...host.querySelectorAll('button')].every((item) => item.disabled)).toBe(true);
        await act(async () => finish(report()));
        expect(host.querySelector('[aria-busy="true"]')).toBeNull();
        expect([...host.querySelectorAll('button')].every((item) => !item.disabled)).toBe(true);
    });

    it('shows a failed command in its equipment group and permits an explicit retry', async () => {
        const failure = new Error('Machine connection lost');
        failure.name = 'SidecarHttpError';
        mocks.doorProbe.mockRejectedValueOnce(failure);
        const { host } = renderDock();
        await act(async () => button(host, 'stirrer', 'on').click());
        const group = host.querySelector('[aria-label="machines.actuators.stirrer"]');
        expect(group?.querySelector('[role="status"]')?.textContent).toContain(failure.message);
        expect(host.textContent).not.toContain('machines.actuators.sent');
        await act(async () => button(host, 'stirrer', 'on').click());
        expect(group?.textContent).not.toContain(failure.message);
        expect(group?.textContent).toContain('machines.actuators.sent');
        expect(mocks.doorProbe).toHaveBeenCalledTimes(2);
    });

    it('uses a translated fallback for unexpected failures', async () => {
        mocks.doorProbe.mockRejectedValueOnce(new Error('internal details'));
        const { host } = renderDock();
        await act(async () => button(host, 'cooling', 'off').click());
        expect(host.textContent).toContain('machines.actuators.failed');
        expect(host.textContent).not.toContain('internal details');
    });

    it('clears command receipts when the connected roaster changes', async () => {
        const { host, render } = renderDock();
        await act(async () => button(host, 'fill', 'open').click());
        expect(host.textContent).toContain('machines.actuators.sent');
        render('virtual');
        expect(host.textContent).not.toContain('machines.actuators.sent');
    });
});

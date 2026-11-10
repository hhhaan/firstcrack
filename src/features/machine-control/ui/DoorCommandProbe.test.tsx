// @vitest-environment jsdom

import type { DoorProbeResult } from '@shared/types/sidecar';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoorCommandProbe } from './DoorCommandProbe';

const doorProbe = vi.hoisted(() => vi.fn());
vi.mock('@shared/lib/sidecar', () => ({
    isSidecarHttpError: (error: unknown) => error instanceof Error && error.name === 'SidecarHttpError',
    sidecar: { doorProbe },
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    }),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const report = (): DoorProbeResult => ({
    action: 'fill_open',
    wrote: 1,
    command_before: null,
    command_after: null,
    command_held: null,
    discharge_open_before: null,
    discharge_open_after: null,
});
const buttonNamed = (name: string) => {
    const button = [...document.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === name || button.textContent === name,
    );
    if (!button) throw new Error(name);
    return button;
};
const renderProbe = (roaster: string | null = 'giesen_w45a_w60a') => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (disabled = false, hidden = false, hopperCommandsAllowed = true) =>
        act(() => root.render(createElement(DoorCommandProbe, { roaster, disabled, hidden, hopperCommandsAllowed })));
    render();
    const open = async () => {
        await act(async () => buttonNamed('machines.doorProbe.title').click());
    };
    return { host, render, open };
};
const command = (label: string) => buttonNamed(`machines.doorProbe.${label}`);

describe('DoorCommandProbe equipment popover', () => {
    beforeEach(() => {
        doorProbe.mockReset().mockResolvedValue(report());
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        );
    });
    afterEach(() => {
        for (const root of roots.splice(0)) act(() => root.unmount());
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
    });
    it.each([null, 'giesen_w6a'])('hides unsupported roaster %s', (roaster) => {
        expect(renderProbe(roaster).host.textContent).toBe('');
    });
    it.each(['virtual', 'giesen_w45a_w60a'])(
        'opens eight explicit actions on %s without sending commands',
        async (roaster) => {
            const { open } = renderProbe(roaster);
            expect(document.querySelector('[role="dialog"]')).toBeNull();
            await open();
            const dialog = document.querySelector('[role="dialog"]');
            expect(dialog?.querySelectorAll('button')).toHaveLength(8);
            expect(dialog?.textContent).toContain('machines.doorProbe.doors');
            expect(dialog?.textContent).toContain('machines.doorProbe.cooling');
            expect(dialog?.querySelector('[aria-pressed="true"], [role="switch"]')).toBeNull();
            expect(doorProbe).not.toHaveBeenCalled();
        },
    );
    it.each([
        ['fillOpen', 'fill_open'],
        ['fillClose', 'fill_close'],
        ['dischargeOpen', 'discharge_open'],
        ['dischargeClose', 'discharge_close'],
        ['coolingOn', 'cooling_on'],
        ['coolingOff', 'cooling_off'],
        ['stirrerOn', 'stirrer_on'],
        ['stirrerOff', 'stirrer_off'],
    ])('sends only %s and reports delivery without claiming machine state', async (label, action) => {
        const { open } = renderProbe();
        await open();
        await act(async () => command(label).click());
        expect(doorProbe).toHaveBeenCalledExactlyOnceWith(action);
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('machines.doorProbe.sent');
        expect(command(label).getAttribute('aria-pressed')).toBe('true');
        expect(document.body.textContent).not.toContain('DB2');
    });
    it('serializes same-frame clicks and locks all commands until completion', async () => {
        let finish!: (value: DoorProbeResult) => void;
        doorProbe.mockReturnValue(
            new Promise<DoorProbeResult>((resolve) => {
                finish = resolve;
            }),
        );
        const { open } = renderProbe();
        await open();
        act(() => {
            command('fillOpen').click();
            command('dischargeOpen').click();
        });
        expect(doorProbe).toHaveBeenCalledExactlyOnceWith('fill_open');
        expect(document.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).toBe(
            'machines.doorProbe.fill',
        );
        expect(
            [...document.querySelectorAll('[role="dialog"] button')].every(
                (button) => (button as HTMLButtonElement).disabled,
            ),
        ).toBe(true);
        await act(async () => finish(report()));
        expect(document.querySelector('[aria-busy="true"]')).toBeNull();
        expect(command('dischargeOpen').disabled).toBe(false);
    });
    it('keeps the read-only lock when it changes while the popup is open', async () => {
        const { open, render } = renderProbe();
        await open();
        render(true);
        await act(async () => command('fillOpen').click());
        expect(doorProbe).not.toHaveBeenCalled();
        render(false);
        await act(async () => command('fillOpen').click());
        expect(doorProbe).toHaveBeenCalledExactlyOnceWith('fill_open');
    });
    it('locks both hopper actions when Charge starts with the popup open, keeping other equipment usable', async () => {
        const { open, render } = renderProbe();
        await open();
        render(false, false, false);
        for (const label of ['fillOpen', 'fillClose']) {
            expect(command(label).disabled).toBe(true);
            await act(async () => command(label).click());
        }
        expect(doorProbe).not.toHaveBeenCalled();
        for (const label of ['dischargeOpen', 'dischargeClose', 'coolingOn', 'coolingOff', 'stirrerOn', 'stirrerOff']) {
            expect(command(label).disabled).toBe(false);
        }
        await act(async () => command('dischargeOpen').click());
        expect(doorProbe).toHaveBeenCalledExactlyOnceWith('discharge_open');
        render(false, false, true);
        for (const label of ['fillOpen', 'fillClose']) expect(command(label).disabled).toBe(false);
    });
    it('shows the sidecar error in the affected device, then allows explicit retry', async () => {
        const error = new Error('Machine connection lost');
        error.name = 'SidecarHttpError';
        doorProbe.mockRejectedValueOnce(error);
        const { open } = renderProbe();
        await open();
        await act(async () => command('stirrerOn').click());
        const group = document.querySelector('section[aria-label="machines.doorProbe.stirrer"]');
        expect(group?.querySelector('[role="status"]')?.textContent).toContain(error.message);
        expect(group?.textContent).not.toContain('machines.doorProbe.sent');
        await act(async () => command('stirrerOn').click());
        expect(group?.textContent).not.toContain(error.message);
        expect(group?.textContent).toContain('machines.doorProbe.sent');
    });
    it('moves the selected command only after successful delivery and preserves it on failure', async () => {
        const { open } = renderProbe();
        await open();
        await act(async () => command('fillOpen').click());
        expect(command('fillOpen').getAttribute('aria-pressed')).toBe('true');
        expect(command('fillClose').getAttribute('aria-pressed')).toBe('false');
        doorProbe.mockRejectedValueOnce(new Error('failed'));
        await act(async () => command('fillClose').click());
        expect(command('fillOpen').getAttribute('aria-pressed')).toBe('true');
        expect(command('fillClose').getAttribute('aria-pressed')).toBe('false');
        let finish!: (value: DoorProbeResult) => void;
        doorProbe.mockReturnValueOnce(
            new Promise<DoorProbeResult>((resolve) => {
                finish = resolve;
            }),
        );
        act(() => command('fillClose').click());
        expect(command('fillOpen').getAttribute('aria-pressed')).toBe('true');
        expect(command('fillClose').getAttribute('aria-pressed')).toBe('false');
        await act(async () => finish(report()));
        expect(command('fillOpen').getAttribute('aria-pressed')).toBe('false');
        expect(command('fillClose').getAttribute('aria-pressed')).toBe('true');
    });
    it('uses a translated fallback for unexpected errors', async () => {
        doorProbe.mockRejectedValueOnce(new Error('private details'));
        const { open } = renderProbe();
        await open();
        await act(async () => command('coolingOn').click());
        expect(document.body.textContent).toContain('machines.doorProbe.failed');
        expect(document.body.textContent).not.toContain('private details');
    });
    it('dismisses on Escape and restores focus and command receipts when reopened', async () => {
        const { open } = renderProbe();
        await open();
        await act(async () => command('fillOpen').click());
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await vi.waitFor(() => expect(document.activeElement).toBe(buttonNamed('machines.doorProbe.title')));
        await open();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('machines.doorProbe.sent');
        expect(doorProbe).toHaveBeenCalledTimes(1);
    });
    it('removes the portaled popup when the enclosing machine panel is folded', async () => {
        const { open, render } = renderProbe();
        await open();
        render(false, true);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(doorProbe).not.toHaveBeenCalled();
    });
});

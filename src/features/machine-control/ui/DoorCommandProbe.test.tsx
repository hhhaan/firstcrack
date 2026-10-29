// @vitest-environment jsdom

import type { DoorProbeResult } from '@shared/types/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DoorCommandProbe } from './DoorCommandProbe';

const doorProbe = vi.hoisted(() => vi.fn());
const captureDoorProbe = vi.hoisted(() => vi.fn());
const captureDoorProbeFailure = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/sidecar', () => ({
    isSidecarHttpError: (error: unknown) => error instanceof Error && error.name === 'SidecarHttpError',
    sidecar: { doorProbe },
}));

vi.mock('@shared/lib/sentry', () => ({
    captureDoorProbe,
    captureDoorProbeFailure,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = (overrides: Partial<DoorProbeResult> = {}): DoorProbeResult => ({
    action: 'discharge_open',
    wrote: 5,
    command_before: 0,
    command_after: null,
    command_held: null,
    discharge_open_before: null,
    discharge_open_after: null,
    ...overrides,
});

const renderProbe = (roaster: string | null) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
        root.render(createElement(DoorCommandProbe, { roaster, disabled: false }));
    });
    return host;
};

describe('DoorCommandProbe', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        doorProbe.mockReset();
        captureDoorProbe.mockReset();
        captureDoorProbeFailure.mockReset();
    });

    it('stays off other roasters', () => {
        const host = renderProbe('giesen_w6a');
        expect(host.textContent).toBe('');
    });

    it('shows the same test buttons on the virtual machine', () => {
        const host = renderProbe('virtual');
        expect(host.querySelectorAll('button')).toHaveLength(10);
        expect(host.textContent).toContain('machines.doorProbe.dischargeOpen');
    });

    it('closes and reopens the command buttons', () => {
        const host = renderProbe('giesen_w45a_w60a');
        const toggle = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.title',
        );
        if (!toggle) throw new Error('machines.doorProbe.title');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        act(() => {
            toggle.click();
        });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(host.textContent).not.toContain('machines.doorProbe.fillOpen');
        act(() => {
            toggle.click();
        });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(host.textContent).toContain('machines.doorProbe.fillOpen');
    });

    it('shows test buttons that are not tied to Charge or Drop', () => {
        const host = renderProbe('giesen_w45a_w60a');
        const labels = [...host.querySelectorAll('button')].map((button) => button.textContent);
        expect(labels).toEqual([
            'machines.doorProbe.title',
            'machines.doorProbe.read',
            'machines.doorProbe.fillOpen',
            'machines.doorProbe.fillClose',
            'machines.doorProbe.dischargeOpen',
            'machines.doorProbe.dischargeClose',
            'machines.doorProbe.coolingOn',
            'machines.doorProbe.coolingOff',
            'machines.doorProbe.stirrerOn',
            'machines.doorProbe.stirrerOff',
        ]);
    });

    it('shows the command cell and status bit without calling that door motion', async () => {
        doorProbe.mockResolvedValue(report());
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.dischargeOpen',
        );
        await act(async () => {
            button?.click();
        });
        expect(doorProbe).toHaveBeenCalledWith('discharge_open');
        expect(captureDoorProbe).toHaveBeenCalledWith(report());
        expect(host.textContent).not.toContain('DB2.30');
        expect(host.textContent).not.toContain('machines.doorProbe.wroteHeld');
        expect(host.textContent).not.toContain('machines.doorProbe.notPosition');
    });

    it('records a lost value without showing it', async () => {
        doorProbe.mockResolvedValue(report({ command_after: 0, command_held: false }));
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.dischargeOpen',
        );
        await act(async () => {
            button?.click();
        });
        expect(host.textContent).not.toContain('machines.doorProbe.wroteLost');
        expect(captureDoorProbe).toHaveBeenCalledWith(
            expect.objectContaining({ command_held: false, command_after: 0 }),
        );
    });

    it('records cooling without showing the bit text', async () => {
        doorProbe.mockResolvedValue(
            report({
                action: 'cooling_on',
                wrote: 8,
                command_before: 5,
                command_after: 0,
                command_held: true,
                cool_fan_before: false,
                cool_fan_after: true,
                cool_fan_held: true,
            }),
        );
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.coolingOn',
        );
        await act(async () => {
            button?.click();
        });
        expect(doorProbe).toHaveBeenCalledWith('cooling_on');
        expect(captureDoorProbe).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'cooling_on', cool_fan_held: true }),
        );
        expect(host.textContent).not.toContain('machines.doorProbe.coolHeld');
        expect(host.textContent).not.toContain('DB3.0.0');
    });

    it('shows the stirrer bit for a stirrer command', async () => {
        doorProbe.mockResolvedValue(
            report({
                action: 'stirrer_on',
                wrote: 7,
                command_before: 0,
                command_after: 0,
                command_held: true,
                stirrer_before: false,
                stirrer_after: true,
                stirrer_held: true,
            }),
        );
        const host = renderProbe('virtual');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.stirrerOn',
        );
        await act(async () => {
            button?.click();
        });
        expect(doorProbe).toHaveBeenCalledWith('stirrer_on');
        expect(captureDoorProbe).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'stirrer_on', stirrer_held: true }),
        );
        expect(host.textContent).not.toContain('machines.doorProbe.stirrerHeld');
        expect(host.textContent).not.toContain('DB2.83.1');
    });

    const buttonNamed = (host: HTMLElement, label: string) => {
        const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
        if (!button) throw new Error(label);
        return button;
    };

    const hang = () => {
        let finish!: (value: DoorProbeResult | PromiseLike<DoorProbeResult>) => void;
        const pending = new Promise<DoorProbeResult>((resolve) => {
            finish = resolve;
        });
        doorProbe.mockReturnValue(pending);
        return finish;
    };

    it('shows a loading bar while a command is being confirmed', async () => {
        const finish = hang();
        const host = renderProbe('giesen_w45a_w60a');
        const open = buttonNamed(host, 'machines.doorProbe.fillOpen');
        await act(async () => {
            open.click();
        });
        expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
        expect(host.getAttribute('aria-busy') ?? host.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
        expect(open.getAttribute('aria-pressed')).toBe('true');
        expect(buttonNamed(host, 'machines.doorProbe.fillClose').getAttribute('aria-pressed')).toBe('false');
        await act(async () => {
            finish(report({ action: 'fill_open' }));
        });
        expect(host.querySelector('[role="progressbar"]')).toBeNull();
        expect(open.getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps the last successful side of a pair pressed', async () => {
        doorProbe.mockResolvedValue(report({ action: 'cooling_on' }));
        const host = renderProbe('giesen_w45a_w60a');
        await act(async () => {
            buttonNamed(host, 'machines.doorProbe.coolingOn').click();
        });
        doorProbe.mockResolvedValue(report({ action: 'cooling_off' }));
        await act(async () => {
            buttonNamed(host, 'machines.doorProbe.coolingOff').click();
        });
        expect(buttonNamed(host, 'machines.doorProbe.coolingOff').getAttribute('aria-pressed')).toBe('true');
        expect(buttonNamed(host, 'machines.doorProbe.coolingOn').getAttribute('aria-pressed')).toBe('false');
        expect(buttonNamed(host, 'machines.doorProbe.read').hasAttribute('aria-pressed')).toBe(false);
    });

    it('does not move the pressed side when the command fails', async () => {
        doorProbe.mockResolvedValue(report({ action: 'stirrer_on' }));
        const host = renderProbe('virtual');
        await act(async () => {
            buttonNamed(host, 'machines.doorProbe.stirrerOn').click();
        });
        const failure = new Error('문 명령 확인에 실패했습니다.');
        failure.name = 'SidecarHttpError';
        doorProbe.mockRejectedValue(failure);
        await act(async () => {
            buttonNamed(host, 'machines.doorProbe.stirrerOff').click();
        });
        expect(buttonNamed(host, 'machines.doorProbe.stirrerOn').getAttribute('aria-pressed')).toBe('true');
        expect(buttonNamed(host, 'machines.doorProbe.stirrerOff').getAttribute('aria-pressed')).toBe('false');
    });

    it('reports a failed probe with the button that was pressed', async () => {
        const failure = new Error('문 명령 확인에 실패했습니다.');
        failure.name = 'SidecarHttpError';
        doorProbe.mockRejectedValue(failure);
        const host = renderProbe('giesen_w45a_w60a');
        const button = [...host.querySelectorAll('button')].find(
            (item) => item.textContent === 'machines.doorProbe.fillOpen',
        );
        await act(async () => {
            button?.click();
        });
        expect(captureDoorProbeFailure).toHaveBeenCalledWith('fill_open', '문 명령 확인에 실패했습니다.', undefined);
        expect(captureDoorProbe).not.toHaveBeenCalled();
    });
});

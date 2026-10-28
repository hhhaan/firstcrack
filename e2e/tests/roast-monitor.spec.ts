import { expect, test } from '@playwright/test';
import type { MonitorSnapshot } from '../../src/features/active-roast/lib/roast-monitor';
import { tauriInitScript } from '../fixtures/tauri-stub';

declare global {
    interface Window {
        __monitorTest__: { disconnect: () => void; dropCount: () => number };
    }
}

const snapshot: MonitorSnapshot = {
    sessionId: 'batch-monitor',
    bt: '198.4°C',
    et: '215.8°C',
    ror: '6.2',
    rorUnit: '°C/min',
    time: '8:42',
    phase: 'Development',
    phaseColor: 'var(--color-phase-development)',
    development: '1:24',
    dtr: '16.1%',
    bbpTime: null,
    connected: true,
    stale: false,
    canDrop: true,
    dropTime: null,
    language: 'ko',
};

test('mini monitor renders at minimum width, records once and locks on heartbeat loss', async ({ page }) => {
    await page.setViewportSize({ width: 224, height: 224 });
    await page.addInitScript(tauriInitScript);
    await page.addInitScript((initial) => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const listeners = new Map<string, number>();
        let current = initial;
        let connected = true;
        let drops = 0;
        window.__monitorTest__ = {
            disconnect: () => {
                connected = false;
            },
            dropCount: () => drops,
        };
        Object.assign(window, {
            __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
        });
        window.__TAURI_INTERNALS__.invoke = async (command, args) => {
            if (
                command === 'plugin:event|listen' &&
                typeof args?.event === 'string' &&
                typeof args.handler === 'number'
            ) {
                listeners.set(args.event, args.handler);
                return args.handler;
            }
            if (command === 'plugin:event|unlisten') {
                if (typeof args?.event === 'string' && listeners.get(args.event) === args.eventId)
                    listeners.delete(args.event);
                return;
            }
            if (command === 'plugin:event|emit_to' && connected) {
                const message = args?.payload;
                if (message && typeof message === 'object' && 'type' in message && message.type === 'drop') {
                    drops += 1;
                    current = { ...current, canDrop: false, dropTime: '8:42' };
                }
                const callback = Reflect.get(window, `_${listeners.get('roast-monitor-snapshot')}`);
                if (typeof callback === 'function')
                    callback({ event: 'roast-monitor-snapshot', id: 1, payload: current });
                return;
            }
            return invoke(command, args);
        };
    }, snapshot);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/roast-monitor.html');
    await expect(page.getByTestId('monitor-bt')).toHaveText('198.4°C');
    await expect(page.getByTestId('monitor-et')).toHaveText('215.8°C');
    await expect(page.getByTestId('monitor-drop')).toBeEnabled();
    await expect(page.getByRole('button', { name: '메인으로' })).toBeInViewport();
    await expect(page.getByText('항상 위')).toHaveCount(0);
    await expect(page.getByText('실시간', { exact: true })).toHaveCount(0);
    await expect(page.getByText('시점만 기록하며', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/roast-monitor-live.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(224);
    expect(await page.locator('main').evaluate((main) => main.scrollHeight <= main.clientHeight)).toBe(true);
    await page.getByTestId('monitor-drop').click();
    await expect(page.getByTestId('monitor-drop')).toBeDisabled();
    await expect(page.getByTestId('monitor-drop')).toContainText('배출 기록됨');
    await expect(page.getByTestId('monitor-drop')).toHaveCSS('background-color', 'oklch(0.6 0.18 155 / 0.16)');
    expect(await page.evaluate(() => window.__monitorTest__.dropCount())).toBe(1);
    await page.screenshot({ path: 'artifacts/roast-monitor-dropped.png' });
    await page.evaluate(() => window.__monitorTest__.disconnect());
    await expect(page.getByTestId('monitor-bt')).toHaveText('—', { timeout: 7000 });
    await expect(page.getByTestId('monitor-et')).toHaveText('—');
    await expect(page.getByTestId('monitor-drop')).toBeDisabled();
    await page.screenshot({ path: 'artifacts/roast-monitor-offline.png' });
    expect(errors).toEqual([]);
});

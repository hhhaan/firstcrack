import { test, expect, type FsdFixture } from '../fixtures/fsd-app';
import { readFileSync } from 'node:fs';
const en = JSON.parse(readFileSync(new URL('../../src/shared/i18n/locales/en.json', import.meta.url), 'utf8'));

const selectReference = async (fsd: FsdFixture, name = 'Recorded thermal reference') => {
    await fsd.page.getByRole('button', { name: 'Target:', exact: true }).click();
    await fsd.page.getByRole('button', { name, exact: true }).click();
};

const chargeThermal = async (fsd: FsdFixture) => {
    const { page } = fsd;
    await page.getByTestId('nav-roast').click();
    await selectReference(fsd);
    await page.getByRole('combobox', { name: 'Green Bean', exact: true }).selectOption(fsd.db.beans[0].id);
    await page.getByTestId('roast-ready').click();
    await fsd.inject('initial_bt');
    await page.getByTestId('roast-charge').click();
    await expect.poll(async () => (await fsd.state()).status.charge?.state).toBe('open');
    await expect.poll(async () => {
        const s = (await fsd.state()).status;
        return s.server_time - s.charge.acquired_at;
    }, { timeout: 30_000, intervals: [500] }).toBeGreaterThanOrEqual(22);
    await page.getByRole('button', { name: 'Heater 100%', exact: true }).click();
    await expect.poll(async () => (await fsd.state()).status.curve_eligibility.eligible, { timeout: 20_000 }).toBe(true);
};

const prepare = async (fsd: FsdFixture) => {
    await chargeThermal(fsd);
    const { page } = fsd;
    const start = page.getByRole('region', { name: 'FSD' }).getByRole('button', { name: /Start FSD/ });
    await expect(start).toBeEnabled({ timeout: 20_000 });
    return start;
};

const expectReceiptPollingStopped = async (fsd: FsdFixture, chargeId: string) => {
    const path = `/pid/receipts?charge_id=${encodeURIComponent(chargeId)}&`;
    await expect.poll(async () => (await fsd.state()).requests.some((request: any) =>
        request.path.startsWith(path) && request.response?.sealed === true)).toBe(true);
    const count = fsd.traffic.filter(request => request.path.startsWith(path)).length;
    await fsd.page.waitForTimeout(2500);
    expect(fsd.traffic.filter(request => request.path.startsWith(path))).toHaveLength(count);
};

test('FSD entry explains unavailable references without a control write', async ({ fsd }, info) => {
    const { page } = fsd;
    await page.getByTestId('nav-roast').click();
    await expect(page.getByRole('region', { name: 'FSD' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'FSD' });
    for (const [name, reason] of [['Synthetic reference', 'synthetic_source'], ['Legacy reference', 'legacy_source'], ['Missing download', 'download_failed']] as const) {
        await selectReference(fsd, name);
        await expect(panel.getByRole('button', { name: /Start FSD/ })).toBeDisabled();
        await expect(panel).toContainText(en.fsd.reasons[reason]);
    }
    await page.screenshot({ path: info.outputPath('fsd-unavailable.png'), fullPage: true });
    expect(fsd.traffic.filter(r => r.path === '/pid/on')).toEqual([]);
});

test('manual and Replay regression uses the same real UI on parent and head', async ({ fsd }, info) => {
    const { page } = fsd;
    fsd.profiles[0].heater_events = [{ t: 35, bt: 150, heater: 45, trigger: 'time' }, { t: 80, bt: 170, heater: 35, trigger: 'time' }];
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await page.getByTestId('nav-roast').click();
    await page.getByRole('button', { name: 'Heater 40%', exact: true }).click();
    await expect.poll(async () => (await fsd.state()).writes.filter((r: any) => r.phase === 'applied').slice(-1)[0]?.state.heater).toBe(40);
    await page.getByRole('button', { name: 'Heater 0%', exact: true }).click();
    await chargeThermal(fsd);
    const replay = page.getByRole('checkbox', { name: 'Replay profile heat', exact: true });
    await expect(replay).toBeEnabled();
    await replay.check();
    await expect.poll(async () => (await fsd.state()).writes.filter((r: any) => r.phase === 'applied').slice(-1)[0]?.state.heater, { timeout: 15_000 }).toBe(45);
    await expect(replay).toBeChecked();
    await page.screenshot({ path: info.outputPath('ui-regression.png'), fullPage: true });
    await replay.uncheck();
    await page.getByRole('button', { name: 'Heater 25%', exact: true }).click();
    await expect.poll(async () => (await fsd.state()).writes.filter((r: any) => r.phase === 'applied').slice(-1)[0]?.state.heater).toBe(25);
    if (process.env.FSD_APP_REPO) await expect(page.getByRole('region', { name: 'FSD' })).toHaveCount(0);
    else await expect(page.getByRole('region', { name: 'FSD' })).toBeVisible();
});

test('real recorded thermal reference starts correction and permits acknowledged takeover', async ({ fsd }, info) => {
    const { page } = fsd;
    const start = await prepare(fsd);
    fsd.delayReceipts = true;
    await start.click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    const panel = page.getByRole('region', { name: 'FSD' });
    await expect(panel.getByRole('button', { name: 'Stop · Manual Gas', exact: true })).toBeVisible();
    await expect.poll(async () => (await fsd.state()).writes.filter((r: any) => r.phase === 'applied' && r.requested.heater !== undefined).length).toBeGreaterThan(5);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('fsd-start.png'), fullPage: true });
    fsd.delayReceipts = false;
    await panel.getByRole('button', { name: 'Stop · Manual Gas', exact: true }).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
    await page.getByRole('button', { name: 'Heater 40%', exact: true }).click();
    await expect.poll(async () => (await fsd.state()).writes.filter((r: any) => r.phase === 'applied').slice(-1)[0]?.state.heater).toBe(40);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('manual-takeover.png'), fullPage: true });
    await page.getByRole('button', { name: 'Fan plus', exact: true }).click();
    await page.getByRole('button', { name: 'Drum plus', exact: true }).click();
    await expect.poll(async () => (await fsd.state()).writes.filter((r: any) => r.phase === 'applied').slice(-1)[0]?.state.drum).toBeGreaterThan(0);
    await page.getByTestId('roast-end').click();
    await page.getByTestId('end-roast-confirm').click();
    await page.getByTestId('roast-summary-weight').fill('1');
    await page.getByTestId('roast-summary-save').click();
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 20_000 });
    expect(fsd.db.sessions).toHaveLength(1);
    const events = fsd.db.sessions[0].events as any[];
    const receipts = events.filter(event => event.control_receipt?.kind === 'receipt');
    expect(receipts.length).toBeGreaterThan(10);
    expect(new Set(receipts.map(event => `${event.control_receipt.receipt.charge_id}:${event.control_receipt.receipt.sequence}`)).size).toBe(receipts.length);
    await page.getByTestId('nav-history').click();
    await page.getByTestId('history-open-row').first().click();
    await expect(page.getByTestId('history-control-receipts')).toBeVisible();
    await expect(page.getByTestId('history-control-receipts').getByRole('listitem')).toHaveCount(receipts.length);
    await page.getByTestId('history-control-receipts').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('saved-command-history.png'), fullPage: true });
    const repeated = (await fsd.state()).requests.filter((r: any) => r.path.startsWith('/pid/receipts') && r.response?.receipts?.length).slice(-1)[0].response;
    let replayed = false;
    await info.attach('repeated-final-receipt', { body: JSON.stringify(repeated), contentType: 'application/json' });
    await page.route('http://127.0.0.1:9999/pid/receipts?**', async route => {
        replayed = true;
        const after = Number(new URL(route.request().url()).searchParams.get('after'));
        return route.fulfill({ json: { ...repeated, receipts: repeated.receipts.filter((r: any) => r.sequence <= after),
            next_after: after, next_sequence: after + 1, has_more: false, gap: null } });
    }, { times: 1 });
    await expect.poll(() => replayed).toBe(true);
    expect((fsd.db.sessions[0].events as any[]).filter(event => event.control_receipt?.kind === 'receipt')).toHaveLength(receipts.length);
    await expect(page.getByTestId('history-control-receipts').getByRole('listitem')).toHaveCount(receipts.length);
    await page.getByTestId('nav-roast').click();
    await page.getByTestId('return-to-charge-wait').click();
    const ready = page.getByTestId('roast-ready');
    if (await ready.isVisible()) await ready.click();
    await page.getByTestId('roast-charge').click();
    await expectReceiptPollingStopped(fsd, receipts[0].control_receipt.receipt.charge_id);
});

test('collapse preserves control; navigation stops and remount never resumes', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    await page.getByRole('button', { name: 'Collapse machine control' }).click();
    await expect(page.getByRole('button', { name: 'Expand machine control' })).toBeVisible();
    await page.waitForTimeout(4000);
    expect((await fsd.state()).status.curve.phase).toBe('active');
    await page.screenshot({ path: info.outputPath('collapsed-fsd.png'), fullPage: true });
    await page.getByTestId('nav-dashboard').click();
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
    const starts = fsd.traffic.filter(r => r.path === '/pid/on').length;
    await page.getByTestId('nav-roast').click();
    await page.evaluate(() => window.__FC_E2E__?.remountRoast?.());
    await page.waitForTimeout(3500);
    expect(fsd.traffic.filter(r => r.path === '/pid/on')).toHaveLength(starts);
    expect((await fsd.state()).status.curve.phase).toBe('terminal');
    await page.screenshot({ path: info.outputPath('view-lifetime.png'), fullPage: true });
});

test('actual view error releases renewal while the shell collector survives', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    await page.evaluate(() => window.__FC_E2E__?.failRoastView?.());
    await expect(page.getByText('FSD view fixture failure', { exact: true })).toBeVisible();
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
    const end = fsd.traffic.filter(r => r.path === '/pid/off').slice(-1)[0].ack;
    await page.waitForTimeout(3500);
    expect(fsd.traffic.filter(r => r.path === '/pid/renew' && r.at > end)).toEqual([]);
    expect(fsd.traffic.some(r => r.path.startsWith('/pid/receipts') && r.at > end)).toBe(true);
    await page.screenshot({ path: info.outputPath('view-fault.png'), fullPage: true });
    await page.evaluate(() => window.__FC_E2E__?.remountRoast?.());
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(page.getByRole('region', { name: 'FSD' })).toBeVisible();
    expect((await fsd.state()).status.curve.phase).toBe('terminal');
});

test('reference change stops the frozen generation before another source can start', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    const digest = (await fsd.state()).status.curve.reference_digest;
    await selectReference(fsd, 'Other machine reference');
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
    expect((await fsd.state()).status.curve.reference_digest).toBe(digest);
    const panel = page.getByRole('region', { name: 'FSD' });
    await expect(panel).toContainText(en.fsd.reasons.machine_mismatch);
    await expect(panel.getByRole('button', { name: /Start FSD/ })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('reference-workspace.png'), fullPage: true });
});

test('failed minimum remains visible and Gas stays locked until acknowledged retry', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    await fsd.inject('fail_minimum');
    const stop = page.getByRole('region', { name: 'FSD' }).getByRole('button', { name: 'Stop · Manual Gas', exact: true });
    await stop.click();
    await expect(page.getByRole('region', { name: 'FSD' }).getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Heater 40%', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('failed-stop.png'), fullPage: true });
    await expect(stop).toBeEnabled();
    await stop.click();
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
    await expect(page.getByRole('button', { name: 'Heater 40%', exact: true })).toBeEnabled();
});

test('workspace departure terminates the captured generation', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    const run = (await fsd.state()).status.curve.authority.run_id;
    await page.getByRole('button', { name: 'Workspace selector', exact: true }).click();
    await page.getByRole('button', { name: /Other virtual workspace/ }).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
    await page.waitForTimeout(3500);
    expect((await fsd.state()).status.curve.authority.run_id).toBe(run);
    expect((await fsd.state()).status.curve.phase).toBe('terminal');
    await page.screenshot({ path: info.outputPath('workspace-departure.png'), fullPage: true });
});

test('keyboard start and takeover display Fahrenheit while reference remains Celsius', async ({ fsd }, info) => {
    const { page } = fsd;
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await settings.getByRole('navigation').getByRole('button', { name: 'Roasting', exact: true }).click();
    await settings.getByRole('radio', { name: '°F', exact: true }).check();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    const start = await prepare(fsd);
    await start.focus();
    await start.press('Enter');
    const panel = page.getByRole('region', { name: 'FSD' });
    await expect(panel).toContainText('°F');
    const request = fsd.traffic.find(r => r.path === '/pid/on')?.body as any;
    expect(request.reference.temperature_unit).toBe('C');
    expect(request.reference.points[0].bt_c).toBe(fsd.reference.points[0].bt_c);
    await page.screenshot({ path: info.outputPath('keyboard-units.png'), fullPage: true });
    const stop = panel.getByRole('button', { name: 'Stop · Manual Gas', exact: true });
    await stop.focus();
    await stop.press('Space');
    await expect.poll(async () => (await fsd.state()).status.curve?.terminal_outcome).toBe('completed');
});

test('FSD excludes Replay and fixed PID while independent channels remain writable', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    await expect(page.getByRole('checkbox', { name: 'Replay profile heat', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Heater 40%', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Fan plus', exact: true }).click();
    await page.getByRole('button', { name: 'Drum plus', exact: true }).click();
    expect(fsd.traffic.filter(r => r.path === '/pid/on')).toHaveLength(1);
    expect(fsd.traffic.filter(r => r.path === '/pid/sv')).toHaveLength(0);
    await page.screenshot({ path: info.outputPath('ui-owner-conflict.png'), fullPage: true });
});

test('Drop cancellation and next Charge cannot resume a retired FSD generation', async ({ fsd }, info) => {
    const { page } = fsd;
    await (await prepare(fsd)).click();
    await expect.poll(async () => (await fsd.state()).status.curve?.phase).toBe('active');
    const charge = (await fsd.state()).status.charge.charge_id;
    const sessionId = (await fsd.state()).status.charge.session_id;
    await page.getByRole('button', { name: /Mark Drop/ }).click();
    await expect.poll(async () => (await fsd.state()).status.charge?.state).toBe('closed');
    const starts = fsd.traffic.filter(r => r.path === '/pid/on').length;
    await page.screenshot({ path: info.outputPath('batch-boundaries.png'), fullPage: true });
    const cancel = page.getByTestId('roast-summary-cancel-drop');
    await expect(cancel).toBeVisible();
    await cancel.click();
    await page.waitForTimeout(3500);
    expect(fsd.traffic.filter(r => r.path === '/pid/on')).toHaveLength(starts);
    expect((await fsd.state()).status.curve.phase).toBe('terminal');
    await page.getByTestId('roast-end').click();
    await page.getByTestId('end-roast-confirm').click();
    // Discard the reviewed batch through its real summary flow before a new Charge.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: en.activeRoast.summary.discard, exact: true }).click();
    await expect(page.getByTestId('roast-summary-save')).toBeHidden();
    const ready = page.getByTestId('roast-ready');
    if (await ready.isVisible()) await ready.click();
    await page.getByTestId('roast-charge').click();
    await expect.poll(async () => (await fsd.state()).status.charge?.charge_id).not.toBe(charge);
    expect(fsd.traffic.filter(r => r.path === '/pid/on')).toHaveLength(starts);
    await expectReceiptPollingStopped(fsd, charge);
    await page.getByTestId('roast-end').click();
    await page.getByTestId('end-roast-confirm').click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: en.activeRoast.summary.discard, exact: true }).click();
    await expect.poll(() => page.evaluate(async session => {
        const path = '/src/features/active-roast/model/controlReceiptCollector.ts';
        const { useControlReceiptStore } = await import(path);
        return session in useControlReceiptStore.getState().collections;
    }, sessionId)).toBe(false);
});

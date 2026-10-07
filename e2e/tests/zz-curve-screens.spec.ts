import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { createBeanViaUi, expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

const OUT = '/opt/cursor/artifacts/screenshots';
const REF_KEY = `profiles/${E2E_USER.id}/reference.tsv`;
const HIST_KEY = `profiles/${E2E_USER.id}/history.tsv`;

const refBt = (t: number) => (t < 60 ? 200 - (105 * t) / 60 : 95 + 110 * (1 - Math.exp(-(t - 60) / 330)) * 1.2);
const tsv = (shift: number) => {
    const rows = ['time\tbt\tet\tror\theater\tfan\tdrum'];
    for (let t = 0; t <= 600; t += 5) {
        const bt = refBt(t) + shift;
        const ror = t < 65 ? null : (refBt(t) - refBt(t - 5)) * 12;
        rows.push(
            [t, bt.toFixed(1), (225 + 5 * Math.sin(t / 60)).toFixed(1), ror?.toFixed(1) ?? '', t < 300 ? 80 : 55, 30 + Math.floor(t / 120) * 10, 55].join('\t'),
        );
    }
    return `${rows.join('\n')}\n`;
};

const openRoastSettings = async (page: Page) => {
    await page.getByTestId('app-sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await settings.getByRole('navigation').getByRole('button', { name: 'Roasting', exact: true }).click();
    const section = settings
        .locator('[data-settings-section]')
        .filter({ has: page.getByRole('heading', { name: 'Curve Styles', exact: true }) });
    await section.scrollIntoViewIfNeeded();
    return { settings, section };
};

const shot = async (page: Page, target: import('@playwright/test').Locator, name: string) => {
    const box = await target.boundingBox();
    if (!box) throw new Error(`no box for ${name}`);
    await page.screenshot({
        path: `${OUT}/${name}`,
        clip: { x: box.x, y: Math.max(0, box.y - 28), width: box.width, height: box.height + 28 },
    });
};

const closeSettings = async (page: Page) =>
    page.getByTestId('settings-page').getByRole('button', { name: 'Close settings', exact: true }).click();

const chooseLine = async (page: Page, label: string, option: string) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
};

test('curve style screenshots', async ({ authedPage: page, db }) => {
    test.skip(!process.env.FC_CURVE_SCREENS, 'opt-in artifact screenshots: FC_CURVE_SCREENS=1');
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    db.tsvFiles.set(REF_KEY, tsv(0));
    db.tsvFiles.set(HIST_KEY, tsv(3));
    const profile = {
        id: 'reference-a',
        user_id: E2E_USER.id,
        name: 'Ethiopia Ref',
        duration_sec: 600,
        drop_temp_celsius: 205,
        source_session_id: 'src-1',
        source_session: { id: 'src-1', tsv_path: REF_KEY, bbp_tsv_path: null, bbp_seconds: null, heater_events: null },
        default_bean: null,
        default_blend: null,
    };
    await page.route('**/rest/v1/roast_profiles?**', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify([profile]) }),
    );
    db.seedCompletedSession({
        tsv_path: HIST_KEY,
        duration_seconds: 600,
        profile_id: 'reference-a',
        beans: { name: 'Curve History Bean', origin: 'Ethiopia', region: null, variety: null, process: null, farm: null },
        events: [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 196 },
            { id: 'd', type: 'Drop', time_sec: 590, temp_c: 205 },
        ],
    } as never);
    await createBeanViaUi(page, 'Curve Lot', '10');
    const bean = db.beans.find((row) => row.name === 'Curve Lot');
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();

    // Settings defaults
    let { section } = await openRoastSettings(page);
    await section.screenshot({ path: `${OUT}/01-settings-defaults.png` });
    await closeSettings(page);

    // Active roast, default styles
    await goNav(page, 'roast');
    await page.locator('select:visible').filter({ has: page.locator(`option[value="${bean?.id}"]`) }).selectOption(bean?.id ?? '');
    await page.locator('select:visible').filter({ has: page.locator('option[value="reference-a"]') }).selectOption('reference-a');
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession));
    await page.evaluate(() => window.__FC_E2E__?.forceChargedSession());
    await page.evaluate(async () => {
        const m = await import('/src/features/active-roast/model/status.ts' as string);
        const bt = (t: number) =>
            (t < 60 ? 200 - (102 * t) / 60 : 98 + 110 * (1 - Math.exp(-(t - 60) / 330)) * 1.2) + 0.6 * Math.sin(t / 45);
        const points = [];
        for (let t = 0; t <= 420; t++) {
            const ror = t < 66 ? null : (bt(t) - bt(t - 30)) * 2;
            points.push({
                time: t,
                label: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
                bt: bt(t),
                et: 228 + 4 * Math.sin(t / 50),
                ror,
                ror_et: 3 + Math.sin(t / 40),
                heater: t < 240 ? 80 : 60,
                fan: 30 + Math.floor(t / 120) * 10,
                drum: 55,
                heaterSet: t < 240 ? 80 : 60,
            });
        }
        m.useRoastingStore.getState().setLivePoints(points);
        m.useRoastingStore.setState({ elapsed: 420, roastStartMs: Date.now() - 420_000 });
    });
    await page.waitForTimeout(3000);
    const chart = page.locator('[data-tour="active-roast-chart"]').first();
    const roastArea = chart.locator('xpath=ancestor::*[@aria-label][1]/..');
    await shot(page, roastArea, '02-active-default.png');

    // Change BT color + background RoR solid and thicker
    ({ section } = await openRoastSettings(page));
    await section.getByLabel('BT Color', { exact: true }).fill('#e53935');
    await chooseLine(page, 'BT RoR background line', 'Solid');
    const bgWidth = section.getByRole('spinbutton', { name: 'BT RoR background width', exact: true });
    await bgWidth.fill('3');
    await bgWidth.press('Enter');
    await section.screenshot({ path: `${OUT}/03-settings-changed.png` });
    await closeSettings(page);
    await goNav(page, 'roast');
    await page.waitForTimeout(3000);
    await shot(page, roastArea, '04-active-custom.png');
    const box = await chart.boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.4);
        await page.waitForTimeout(500);
        await shot(page, roastArea, '05-active-custom-tooltip.png');
        await page.mouse.move(0, 0);
    }

    // Dark tokens (app theme is pinned to light; force the class the CSS keys off)
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(2500);
    await shot(page, roastArea, '06-active-custom-dark.png');
    await page.setViewportSize({ width: 900, height: 640 });
    await page.waitForTimeout(2500);
    await shot(page, roastArea, '07-active-custom-dark-small.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    // History with the same styles
    await page.evaluate(() => window.__FC_E2E__?.clearBatch?.());
    await goNav(page, 'history');
    await page.getByText('Curve History Bean').first().click();
    const historyChart = page.locator('section[aria-label]').filter({ has: page.locator('[data-tour="active-roast-chart"]') });
    await expect(historyChart).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await historyChart.screenshot({ path: `${OUT}/08-history-custom.png` });

    const pdfJpeg = await page.evaluate(async () => {
        const { composeHistoryPdfJpeg } = await import('/src/features/export-history-pdf/lib/compose.ts');
        const { historyPdfLegend } = await import('/src/views/history/lib/historyPdfLegend.ts');
        const canvas = document.querySelector('[data-tour="active-roast-chart"] canvas') as HTMLCanvasElement | null;
        if (!canvas) throw new Error('history chart canvas missing');
        const { jpeg } = await composeHistoryPdfJpeg({
            title: 'Roast profile',
            header: {
                bean: 'Curve History Bean',
                date: '—',
                duration: '—',
                charge: '—',
                drop: '—',
                labels: {
                    bean: 'Bean',
                    date: 'Date',
                    duration: 'Duration',
                    charge: 'Charge',
                    drop: 'Drop',
                },
            },
            chartDataUrl: canvas.toDataURL('image/png'),
            legend: historyPdfLegend({
                unit: 'F',
                hasTarget: true,
                hasControls: true,
                t: (key) => (key === 'settings.tabs.roast.showTargetCurve' ? 'Target curve' : key),
            }),
        });
        return Array.from(jpeg);
    });
    fs.writeFileSync(`${OUT}/13-pdf-legend.jpeg`, Buffer.from(pdfJpeg));
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await goNav(page, 'beans');
    await goNav(page, 'history');
    await page.getByText('Curve History Bean').first().click();
    await expect(historyChart).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await historyChart.screenshot({ path: `${OUT}/09-history-custom-dark.png` });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    // Reset to defaults
    ({ section } = await openRoastSettings(page));
    await section.getByRole('button', { name: 'Restore defaults', exact: true }).click();
    await section.screenshot({ path: `${OUT}/10-settings-after-reset.png` });
    await closeSettings(page);
    await goNav(page, 'history');
    await page.getByText('Curve History Bean').first().click();
    await expect(historyChart).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await historyChart.screenshot({ path: `${OUT}/11-history-after-reset.png` });
    await goNav(page, 'roast');
    await page.waitForTimeout(1500);
    await shot(page, roastArea, '12-active-after-reset.png');
});

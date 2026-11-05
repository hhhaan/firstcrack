import type { Page } from '@playwright/test';
import { expect, goNav, pickRoastSource, roastSourceTrigger, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

const curvePath = `profiles/${E2E_USER.id}/voc-1105.tsv`;
const curve = [
    'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et',
    '0\t190\t210\t-3\t70\t40\t50\t70\t210\t190\t-2',
    '60\t95\t160\t2\t70\t40\t50\t70\t160\t95\t1',
    '300\t170\t200\t5\t50\t40\t50\t50\t200\t170\t4',
    '301\t171\t201\t5\t50\t40\t50\t50\t201\t171\t4',
    '600\t200\t220\t4\t30\t40\t50\t30\t220\t200\t3',
    '720\t210\t230\t3\t20\t40\t50\t20\t230\t210\t2',
].join('\n');

const profile = (id: string, name: string, beanId: string | null = null) => ({
    id,
    user_id: E2E_USER.id,
    name,
    sources: beanId ? [{ bean_id: beanId, blend_id: null }] : [],
    default_bean_id: beanId,
    default_blend_id: null,
    source_session_id: 'voc-reference',
    source_session: { tsv_path: curvePath, duration_seconds: 720 },
    duration_sec: 720,
    drop_temp_celsius: 210,
    created_at: '2026-11-05T00:00:00Z',
});

async function installProfiles(page: Page, profiles: ReturnType<typeof profile>[]) {
    await page.route('**/rest/v1/roast_profiles*', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: profiles });
    });
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
}

async function setDisplay(page: Page) {
    await page.evaluate(async () => {
        const path = '/src/features/active-roast/model/settings.ts';
        const { updateRoastSettings } = await import(path);
        updateRoastSettings({
            temperatureUnit: 'C',
            tempMinC: 130,
            tempMaxC: 240,
            rorYMin: 0,
            rorYMax: 15,
            showET: false,
            showRoRChart: true,
            showRoRET: true,
            showControlChart: false,
            showTargetCurve: false,
            autoChargeEnabled: false,
            autoDropEnabled: false,
        });
    });
}

type ChartSnapshot = {
    x: { min: number; max: number }[];
    y: { min: number; max: number }[];
    series: { name: string; data: [number, number | null][] }[];
};

async function readChart(page: Page): Promise<ChartSnapshot | null> {
    const source = await (await page.request.get('/src/features/active-roast/ui/RoastTempChart.tsx')).text();
    const modulePath = source.match(/from\s+["']([^"']*\/echarts\.js[^"']*)["']/)?.[1];
    if (!modulePath) throw new Error('ECharts module not found');
    return page.evaluate(async (modulePath) => {
        const echarts = await import(modulePath);
        const element = [...document.querySelectorAll('[_echarts_instance_]')].find((node) => node.checkVisibility());
        const chart = element ? echarts.getInstanceByDom(element) : null;
        if (!chart) return null;
        const option = chart.getOption();
        return {
            x: option.xAxis.map((axis: { min: number; max: number }) => ({ min: axis.min, max: axis.max })),
            y: option.yAxis.map((axis: { min: number; max: number }) => ({ min: axis.min, max: axis.max })),
            series: option.series.map((s: { name: string; data?: [number, number | null][] }) => ({
                name: s.name,
                data: s.data ?? [],
            })),
        };
    }, modulePath);
}

test('explicit Target changes restore its registered source while manual overrides survive remounts', async ({
    authedPage: page,
    db,
}) => {
    const a = db.seedBean({ name: 'VOC manual A', origin: 'VOC manual A' });
    const b = db.seedBean({ name: 'VOC registered B', origin: 'VOC registered B' });
    const c = db.seedBean({ name: 'VOC override C', origin: 'VOC override C' });
    db.tsvFiles.set(curvePath, curve);
    db.seedCompletedSession({ id: 'voc-reference', profile_id: 'profile-b', bean_id: a.id, tsv_path: curvePath });
    await installProfiles(page, [
        profile('profile-b', 'VOC Profile B', b.id),
        profile('profile-a', 'VOC Profile A', a.id),
    ]);
    await goNav(page, 'roast');
    await pickRoastSource(page, a.name);
    const target = page.getByRole('button', { name: 'Target:' });
    await target.click();
    await page.getByRole('button', { name: 'VOC Profile B', exact: true }).click();
    await expect(roastSourceTrigger(page)).toHaveAttribute('data-value', b.id);
    await pickRoastSource(page, c.name);
    await goNav(page, 'history');
    await goNav(page, 'roast');
    await expect(roastSourceTrigger(page)).toHaveAttribute('data-value', c.id);
    await expect(target).toContainText('VOC Profile B');
    await target.click();
    await page.getByRole('button', { name: 'VOC Profile A', exact: true }).click();
    await expect(roastSourceTrigger(page)).toHaveAttribute('data-value', a.id);
});

test('history and profile preview share display settings and retain stored ET RoR', async ({
    authedPage: page,
    db,
}) => {
    db.tsvFiles.set(curvePath, curve);
    db.seedCompletedSession({
        id: 'voc-reference',
        profile_id: 'profile-b',
        tsv_path: curvePath,
        duration_seconds: 720,
        beans: { name: 'VOC saved roast', origin: null, region: null, variety: null, process: null, farm: null },
    });
    await installProfiles(page, [profile('profile-b', 'VOC Profile B')]);
    await setDisplay(page);
    await goNav(page, 'history');
    await page.getByText('VOC saved roast').first().click();
    await expect
        .poll(async () => (await readChart(page))?.y.slice(0, 2))
        .toEqual([
            { min: 130, max: 240 },
            { min: 0, max: 15 },
        ]);
    let history = await readChart(page);
    expect(history?.series.map((s) => s.name)).not.toContain('ET Actual');
    expect(history?.series.find((s) => s.name === 'BT Actual')?.data).toContainEqual([60, 95]);
    expect(history?.series.find((s) => s.name === 'ET RoR')?.data).toContainEqual([300, 4]);
    await page.screenshot({ path: '/tmp/voc-1105-history.png', fullPage: true });
    await page.evaluate(async () => {
        const path = '/src/features/active-roast/model/settings.ts';
        const { updateRoastSettings } = await import(path);
        updateRoastSettings({ rorYMin: -5, rorYMax: 20, showET: true });
    });
    await expect.poll(async () => (await readChart(page))?.y[1]).toEqual({ min: -5, max: 20 });
    history = await readChart(page);
    await goNav(page, 'profiles');
    await expect(page.getByTestId('profile-saved-curve')).toBeVisible();
    await expect
        .poll(async () => (await readChart(page))?.series.find((s) => s.name === 'BT Actual')?.data)
        .toEqual(history?.series.find((s) => s.name === 'BT Actual')?.data);
    const preview = await readChart(page);
    expect(preview?.series.map((s) => s.name)).toEqual(
        expect.arrayContaining(['BT Actual', 'ET Actual', 'RoR', 'ET RoR']),
    );
    expect(preview?.y.slice(0, 2)).toEqual(history?.y.slice(0, 2));
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: '/tmp/voc-1105-profile.png', fullPage: true });
});

test('BBP keeps a fixed fifteen-minute window and preserves the full reference roast', async ({
    authedPage: page,
    db,
}) => {
    db.tsvFiles.set(curvePath, curve);
    db.seedCompletedSession({
        id: 'voc-reference',
        profile_id: 'profile-b',
        tsv_path: curvePath,
        duration_seconds: 720,
    });
    await installProfiles(page, [profile('profile-b', 'VOC Profile B')]);
    await goNav(page, 'roast');
    await page.getByRole('button', { name: 'Target:' }).click();
    await page.getByRole('button', { name: 'VOC Profile B', exact: true }).click();
    for (const elapsed of [180, 600, 900, 1200]) {
        await page.evaluate(async (elapsed) => {
            const base = '/src/features/active-roast/model/';
            const { useBbpStore } = await import(`${base}bbp.ts`);
            const { useRoastingStore } = await import(`${base}status.ts`);
            const { updateRoastSettings } = await import(`${base}settings.ts`);
            updateRoastSettings({
                bbpEnabled: true,
                showTargetCurve: true,
                showControlChart: true,
                autoChargeEnabled: false,
                autoDropEnabled: false,
            });
            useRoastingStore.setState({ phase: 'standby', awaitingNextCharge: true });
            const origin = Math.max(0, elapsed - 900);
            useBbpStore.getState().begin(
                Date.now() - elapsed * 1000,
                [origin, elapsed].map((t) => ({ t, bt: 190, et: 210, heater: 50, fan: 40, drum: 55 })),
            );
        }, elapsed);
        await expect.poll(async () => (await readChart(page))?.x[0]).toEqual({ min: 0, max: 900 });
        const seam = Math.min(elapsed, 900);
        await expect
            .poll(async () =>
                (await readChart(page))?.series
                    .find((s) => s.name === 'BT Target')
                    ?.data.some(([t]) => t === seam + 720),
            )
            .toBe(true);
        const chart = await readChart(page);
        expect(chart?.series.find((s) => s.name === 'BT Actual')?.data.some(([t, v]) => t === seam && v === 190)).toBe(
            true,
        );
        expect(chart?.x[1]).toEqual(chart?.x[0]);
        if (elapsed === 180) await page.screenshot({ path: '/tmp/voc-1105-bbp.png', fullPage: true });
    }
});

test('a saved BBP reference is fully visible from the start and stays fixed as live measurements grow', async ({
    authedPage: page,
    db,
}) => {
    const bbpPath = `profiles/${E2E_USER.id}/voc-1105-bbp.tsv`;
    db.tsvFiles.set(curvePath, curve);
    db.tsvFiles.set(
        bbpPath,
        [
            'time\tbt\tet\tror\theater\tfan\tdrum',
            '# bbp_charge_offset_sec\t180',
            '0\t210\t230\t\t20\t40\t50',
            '60\t205\t225\t\t30\t40\t50',
            '120\t195\t215\t\t50\t40\t50',
            '179\t190\t210\t\t70\t40\t50',
        ].join('\n'),
    );
    db.seedCompletedSession({
        id: 'voc-reference',
        profile_id: 'profile-b',
        tsv_path: curvePath,
        bbp_tsv_path: bbpPath,
        bbp_seconds: 180,
        duration_seconds: 720,
    });
    const saved = profile('profile-b', 'VOC Profile B');
    const withBbp = {
        ...saved,
        source_session: { ...saved.source_session, bbp_tsv_path: bbpPath, bbp_seconds: 180 },
    };
    await installProfiles(page, [withBbp]);
    await goNav(page, 'roast');
    await page.getByRole('button', { name: 'Target:' }).click();
    await page.getByRole('button', { name: 'VOC Profile B', exact: true }).click();
    const expectedReference = [
        [0, 210],
        [60, 205],
        [120, 195],
        [179, 190],
        [180, 190],
        [240, 95],
        [480, 170],
        [481, 171],
        [780, 200],
        [900, 210],
    ];
    for (const elapsed of [0, 60, 180, 600, 900, 1200]) {
        await page.evaluate(async (elapsed) => {
            const base = '/src/features/active-roast/model/';
            const { useBbpStore } = await import(`${base}bbp.ts`);
            const { useRoastingStore } = await import(`${base}status.ts`);
            const { updateRoastSettings } = await import(`${base}settings.ts`);
            updateRoastSettings({
                bbpEnabled: true,
                showTargetCurve: true,
                showControlChart: true,
                autoChargeEnabled: false,
                autoDropEnabled: false,
            });
            useRoastingStore.setState({ phase: 'standby', awaitingNextCharge: true });
            const origin = Math.max(0, elapsed - 900);
            useBbpStore
                .getState()
                .begin(
                    Date.now() - elapsed * 1000,
                    elapsed === 0
                        ? []
                        : [origin, elapsed].map((t) => ({ t, bt: 200, et: 220, heater: 50, fan: 40, drum: 55 })),
                );
        }, elapsed);
        await expect
            .poll(async () => (await readChart(page))?.series.find((s) => s.name === 'BT Target')?.data)
            .toEqual(expectedReference);
        const snapshot = await readChart(page);
        expect(snapshot?.x[0]).toEqual({ min: 0, max: 900 });
        if (elapsed > 0) {
            expect(snapshot?.x[1]).toEqual(snapshot?.x[0]);
            expect(snapshot?.series.find((s) => s.name === 'BT Actual')?.data).toContainEqual([
                Math.min(elapsed, 900),
                200,
            ]);
        }
        if (elapsed === 0) await page.screenshot({ path: '/tmp/voc1105-bbp-reference-initial.png', fullPage: true });
        if (elapsed === 180) await page.screenshot({ path: '/tmp/voc-1105-bbp.png', fullPage: true });
    }
});

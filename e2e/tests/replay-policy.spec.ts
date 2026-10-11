import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('profile and batch editors keep BT additions and stored TP classification', async ({
    authedPage: page,
    db,
}, testInfo) => {
    page.setDefaultTimeout(15_000);
    const tsvKey = `profiles/${E2E_USER.id}/replay-policy.tsv`;
    db.tsvFiles.set(
        tsvKey,
        [
            'time\tbt\tet\tror\theater\tfan\tdrum\theater_set',
            '0\t180\t200\t0\t80\t40\t50\t80',
            '60\t95\t120\t0\t80\t40\t50\t80',
            '120\t110\t140\t5\t60\t40\t50\t60',
            '180\t150\t170\t5\t40\t40\t50\t40',
            '600\t205\t225\t5\t40\t40\t50\t40',
        ].join('\n'),
    );
    const profile = {
        id: 'replay-policy-profile',
        user_id: E2E_USER.id,
        name: 'Replay policy reference',
        description: '',
        target_level: 'Medium',
        duration_sec: 600,
        charge_temp_celsius: 180,
        drop_temp_celsius: 205,
        fc_time_sec: 480,
        dev_time_sec: 120,
        dev_pct: 20,
        default_bean_id: null,
        default_blend_id: null,
        default_bean: null,
        default_blend: null,
        machine_id: null,
        machine_roaster_key: 'virtual',
        source_session_id: 'replay-policy-session',
        source_session: {
            tsv_path: tsvKey,
            events: [
                { type: 'TP', time_sec: 120 },
                { type: 'Drop', time_sec: 600 },
            ],
        },
        heater_events: null,
        created_at: '2026-10-11T00:00:00Z',
        updated_at: '2026-10-11T00:00:00Z',
    };
    await page.route('**/rest/v1/roast_profiles*', async (route) => {
        const patch = route.request().method() === 'PATCH';
        if (patch) Object.assign(profile, route.request().postDataJSON());
        await route.fulfill({ json: patch ? profile : [profile] });
    });
    await page.route('**/rest/v1/profiles*', (route) =>
        route.fulfill({
            json: {
                id: E2E_USER.id,
                plan: 'pro_plus',
                business_name: 'E2E Roastery',
                email: E2E_USER.email,
            },
        }),
    );
    const machineWrites: string[] = [];
    await page.route('http://127.0.0.1:9999/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/control') machineWrites.push(path);
        const body =
            path === '/status'
                ? {
                      connected: true,
                      roaster: 'virtual',
                      capabilities: ['heater', 'fan', 'drum'],
                      control: { writable: true, limits: { heater: { min: 0, max: 100, step: 1, unit: '%' } } },
                      error: null,
                  }
                : path === '/temperatures'
                  ? {
                        bt: 185,
                        et: 210,
                        ror: 0,
                        ror_et: 0,
                        heater: 80,
                        fan: 40,
                        drum: 50,
                        timestamp: Date.now() / 1000,
                        stale: false,
                        reconnecting: false,
                    }
                  : { ok: true };
        return route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
    });

    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'profiles');
    await expect(page.getByRole('heading', { name: profile.name, exact: true })).toBeVisible();
    await page.getByTitle('Edit', { exact: true }).click();
    await page.getByRole('button', { name: 'Edit heat', exact: true }).click();
    const editor = page.getByTestId('heater-events-editor');
    await expect(editor).toBeVisible();
    const rows = editor.locator('tbody tr');
    // The curve TP is 60s, but the saved mark at 120s owns the boundary.
    await expect(rows.nth(1).getByLabel('Time', { exact: true })).toHaveValue('2:00');
    await expect(rows.nth(1).getByLabel('BT', { exact: true })).toHaveCount(0);
    await expect(rows.nth(2).getByLabel('BT', { exact: true })).toHaveValue('150');
    await expect(editor.getByRole('combobox')).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Add step', exact: true })).toHaveCount(0);
    const rule = editor.locator('[aria-labelledby="heater-events-rule-title"]');
    await rule.getByLabel('BT', { exact: true }).fill('170');
    await rule.getByLabel('Heat', { exact: true }).fill('30');
    await rule.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(rows.nth(3).getByLabel('Time', { exact: true })).toHaveCount(0);
    await editor.screenshot({ path: testInfo.outputPath('profile-editor.png') });
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: 'Edit heat', exact: true }).click();
    await expect(rows.nth(3).getByLabel('BT', { exact: true })).toHaveValue('170');
    await expect(editor.getByRole('combobox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Start with this Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Edit heat', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(rows.nth(1).getByLabel('Time', { exact: true })).toHaveValue('2:00');
    await rule.getByLabel('BT', { exact: true }).fill('180');
    await rule.getByLabel('Heat', { exact: true }).fill('20');
    await rule.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.getByRole('button', { name: 'Replay this edit', exact: true }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: 'Edit heat', exact: true }).click();
    await expect(rows.nth(4).getByLabel('BT', { exact: true })).toHaveValue('180');
    await expect(rows.nth(4).getByLabel('Time', { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 1024, height: 680 });
    await expect(editor).toBeVisible();
    const box = await editor.boundingBox();
    if (!box) throw new Error('editor missing');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    expect(box.y + box.height).toBeLessThanOrEqual(680);
    await editor.screenshot({ path: testInfo.outputPath('batch-editor-narrow.png') });
    const btInput = rows.nth(4).getByLabel('BT', { exact: true });
    await btInput.focus();
    await page.keyboard.press('Tab');
    await expect(rows.nth(4).getByLabel('Heat', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    expect(machineWrites).toEqual([]);
});

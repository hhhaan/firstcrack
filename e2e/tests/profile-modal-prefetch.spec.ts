import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

const sessionLimit = (url: string) => new URL(url).searchParams.get('limit');

test('cold profiles and history do not page every session before the profile modal opens', async ({
    authedPage: page,
    db,
}) => {
    db.sessions.push({
        id: 'session-1',
        user_id: E2E_USER.id,
        weight_grams: 1000,
        output_weight_grams: null,
        status: 'completed',
        roasted_at: '2026-09-01T00:00:00Z',
        duration_seconds: 600,
        drop_temp_celsius: 200,
        roast_level: 'Medium',
        scheduled_at: null,
        notes: null,
        ambient_temp_celsius: null,
        ambient_humidity_pct: null,
        bean_id: null,
        batch_name: null,
        profile_batch_number: null,
        total_batch_number: null,
        profile_id: null,
        tsv_path: null,
        bbp_tsv_path: null,
        bbp_seconds: null,
        charge_temp_celsius: null,
        plan_batch_id: null,
        machine_id: null,
        machine_name: null,
        machine_roaster_key: null,
        machine_brand: null,
        machine_protocol: null,
        events: [],
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        beans: null,
        roast_profiles: null,
    });

    const sessionGets: string[] = [];
    const blendGets: string[] = [];
    page.on('request', (req) => {
        if (req.method() !== 'GET') return;
        const url = req.url();
        if (url.includes('/rest/v1/roast_sessions')) sessionGets.push(url);
        if (url.includes('/rest/v1/blends')) blendGets.push(url);
    });

    await goNav(page, 'profiles');
    await expect(page.getByRole('heading', { name: 'Roast Profiles' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Profile' })).toBeVisible();
    await page.waitForTimeout(300);

    // Dashboard charts may already be querying recent sessions. The closed modal's full page is limit=1000.
    expect(sessionGets.filter((url) => sessionLimit(url) === '1000')).toEqual([]);
    expect(blendGets).toEqual([]);

    await goNav(page, 'history');
    await expect(page.getByTestId('history-page')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save as profile' })).toBeVisible();
    await page.waitForTimeout(300);

    expect(sessionGets.filter((url) => sessionLimit(url) === '1000')).toEqual([]);
    expect(blendGets).toEqual([]);
    expect(sessionGets.some((url) => sessionLimit(url) === '10')).toBe(true);

    await page.getByRole('button', { name: 'Save as profile' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => sessionGets.filter((url) => sessionLimit(url) === '1000').length).toBeGreaterThan(0);
    expect(blendGets.length).toBeGreaterThan(0);
});

import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

const profile = (sourceSessionId: string) => ({
    id: 'saved-profile',
    user_id: E2E_USER.id,
    name: 'ZIPPER',
    source_session_id: sourceSessionId,
    source_session: null,
    sources: [],
    duration_sec: 600,
    drop_temp_celsius: 200,
    target_level: 'Medium',
});

const batches = [
    {
        id: 's4',
        roasted_at: '2026-10-22T01:00:00Z',
        batch_name: 'ZIPPER 4',
        bean_label: null,
        profile_batch_number: 4,
        total_batch_number: 40,
        tsv_path: 'curves/s4.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        heater_events: null,
        beans: null,
        blends: null,
    },
    {
        id: 's3',
        roasted_at: '2026-10-18T01:00:00Z',
        batch_name: 'ZIPPER 3',
        bean_label: null,
        profile_batch_number: 3,
        total_batch_number: 31,
        tsv_path: 'curves/s3.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        heater_events: null,
        beans: null,
        blends: null,
    },
];

test('a batch title does not change the profile reference', async ({ authedPage: page }) => {
    let sourceSessionId = 's3';
    const patches: string[] = [];

    await page.route('**/rest/v1/roast_profiles*', (route) => {
        const method = route.request().method();
        if (method === 'PATCH') {
            const body = route.request().postDataJSON() as { source_session_id?: string };
            if (body.source_session_id) {
                sourceSessionId = body.source_session_id;
                patches.push(body.source_session_id);
            }
            return route.fulfill({ json: profile(sourceSessionId) });
        }
        if (method === 'GET') return route.fulfill({ json: [profile(sourceSessionId)] });
        return route.fallback();
    });
    await page.route('**/rest/v1/roast_sessions*', (route) => {
        const url = route.request().url();
        if (route.request().method() !== 'GET' || !url.includes('profile_batch_number')) return route.fallback();
        return route.fulfill({ json: batches });
    });

    await goNav(page, 'profiles');
    const rows = page.getByTestId('profile-reference-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Based on');
    await expect(rows.nth(1).getByRole('button', { name: 'Set as reference' })).toHaveCount(0);

    const referenceWrite = page
        .waitForRequest((request) => request.method() === 'PATCH' && request.url().includes('/rest/v1/roast_profiles'), {
            timeout: 1_000,
        })
        .then(() => true)
        .catch(() => false);
    await rows.nth(0).getByText('ZIPPER 4').click();
    expect(await referenceWrite).toBe(false);
    expect(patches).toEqual([]);
    await expect(rows.nth(1)).toContainText('Based on');

    await rows.nth(0).getByRole('button', { name: 'Set as reference' }).click();
    await expect(rows.nth(0)).toContainText('Based on');
    await expect(rows.nth(0).getByRole('button', { name: 'Set as reference' })).toHaveCount(0);
    expect(patches).toEqual(['s4']);

    await rows.nth(1).getByRole('button', { name: 'Show details' }).click();
    await expect(page.getByTestId('nav-history')).toHaveAttribute('aria-current', 'page');
    expect(patches).toEqual(['s4']);
});

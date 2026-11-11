import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

const miniTsv = () =>
    'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock\textra_readings\n0\t150\t180\t0\t0\t0\t0\t0\t\t\t0\t\t\t\n30\t200\t210\t10\t0\t0\t0\t0\t\t\t0\t\t\t\n';

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

test('selecting a profile batch previews its curve without changing the reference', async ({ authedPage: page, db }) => {
    db.tsvFiles.set('curves/s3.tsv', miniTsv());
    db.tsvFiles.set('curves/s4.tsv', miniTsv());

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
    await expect(page.getByTestId('profile-curve-session-title')).toHaveText('ZIPPER 3');

    await rows.nth(0).getByText('ZIPPER 4').click();
    await expect(page.getByTestId('profile-curve-session-title')).toHaveText('ZIPPER 4');
    await expect(rows.nth(0)).toHaveAttribute('data-preview', 'true');
    await expect(rows.nth(1)).toContainText('Current reference');
    expect(patches).toEqual([]);

    await page.screenshot({ path: '/opt/cursor/artifacts/profile-batch-preview.png', fullPage: false });

    await rows.nth(1).getByText('ZIPPER 3').click();
    await expect(page.getByTestId('profile-curve-session-title')).toHaveText('ZIPPER 3');
});

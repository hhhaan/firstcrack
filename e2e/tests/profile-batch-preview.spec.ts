import {
    profilePreviewBatches,
    profilePreviewMiniTsv,
} from '../../src/widgets/profile-detail/lib/profile-preview-fixtures';
import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

const profile = (sourceSessionId: string) => ({
    id: 'saved-profile',
    user_id: E2E_USER.id,
    name: 'ZIPPER',
    source_session_id: sourceSessionId,
    source_session: {
        tsv_path: 'curves/s3.tsv',
        events: null,
    },
    sources: [],
    duration_sec: 600,
    drop_temp_celsius: 200,
    target_level: 'Medium',
});

test('selecting a profile batch previews its curve without changing the reference', async ({
    authedPage: page,
    db,
}) => {
    db.tsvFiles.set('curves/s3.tsv', profilePreviewMiniTsv());
    db.tsvFiles.set('curves/s4.tsv', profilePreviewMiniTsv());

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
        return route.fulfill({ json: profilePreviewBatches });
    });

    await goNav(page, 'profiles');
    const rows = page.getByTestId('profile-reference-row');
    await expect(page.getByTestId('profile-curve-session-title')).toHaveText('ZIPPER 3');

    await rows.nth(0).getByTestId('profile-reference-preview').click();
    await expect(page.getByTestId('profile-curve-session-title')).toHaveText('ZIPPER 4');
    await expect(rows.nth(0)).toHaveAttribute('data-preview', 'true');
    await expect(rows.nth(1)).toContainText('Current reference');
    expect(patches).toEqual([]);

    await page.screenshot({ path: '/opt/cursor/artifacts/profile-batch-preview.png', fullPage: false });

    await rows.nth(1).getByTestId('profile-reference-preview').click();
    await expect(page.getByTestId('profile-curve-session-title')).toHaveText('ZIPPER 3');
});

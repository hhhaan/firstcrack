import {
    profilePreviewBatches,
    profilePreviewMiniTsv,
} from '../../src/widgets/profile-detail/lib/profile-preview-fixtures';
import { expect, goNav, test } from '../fixtures/app';
import { installZipperProfileReferenceRoutes } from '../fixtures/profile-reference-routes';
import { zipperE2eProfile } from '../fixtures/zipper-profile';

test('selecting a profile batch previews its curve without changing the reference', async ({
    authedPage: page,
    db,
}) => {
    db.tsvFiles.set('curves/s3.tsv', profilePreviewMiniTsv());
    db.tsvFiles.set('curves/s4.tsv', profilePreviewMiniTsv());

    const { patches } = await installZipperProfileReferenceRoutes(page, {
        batches: profilePreviewBatches,
        initialSourceSessionId: 's3',
        profile: (sourceSessionId) =>
            zipperE2eProfile(sourceSessionId, {
                tsv_path: 'curves/s3.tsv',
                events: null,
            }),
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

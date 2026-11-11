import { profilePreviewBatches } from '../../src/widgets/profile-detail/lib/profile-preview-fixtures';
import { expect, goNav, test } from '../fixtures/app';
import { installZipperProfileReferenceRoutes } from '../fixtures/profile-reference-routes';
import { zipperE2eProfile } from '../fixtures/zipper-profile';

test('a batch title does not change the profile reference', async ({ authedPage: page }) => {
    const { patches } = await installZipperProfileReferenceRoutes(page, {
        batches: profilePreviewBatches,
        initialSourceSessionId: 's3',
        profile: (sourceSessionId) => zipperE2eProfile(sourceSessionId, null),
    });

    await goNav(page, 'profiles');
    const rows = page.getByTestId('profile-reference-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Current reference');
    await expect(rows.nth(1).getByRole('button', { name: 'Set as reference' })).toHaveCount(0);

    const referenceWrite = page
        .waitForRequest(
            (request) => request.method() === 'PATCH' && request.url().includes('/rest/v1/roast_profiles'),
            {
                timeout: 1_000,
            },
        )
        .then(() => true)
        .catch(() => false);
    await rows.nth(0).getByText('ZIPPER 4').click();
    expect(await referenceWrite).toBe(false);
    expect(patches).toEqual([]);
    await expect(rows.nth(1)).toContainText('Current reference');

    await rows.nth(0).getByRole('button', { name: 'Set as reference' }).click();
    await expect(rows.nth(0)).toContainText('Current reference');
    await expect(rows.nth(0).getByRole('button', { name: 'Set as reference' })).toHaveCount(0);
    expect(patches).toEqual(['s4']);

    await rows.nth(1).getByRole('button', { name: 'Show details' }).click();
    await expect(page.getByTestId('nav-history')).toHaveAttribute('aria-current', 'page');
    expect(patches).toEqual(['s4']);
});

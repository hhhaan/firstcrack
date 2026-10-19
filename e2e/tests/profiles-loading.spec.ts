import { expect, goNav, test } from '../fixtures/app';

test('profiles tab keeps the header and shows card skeletons, then the empty state', async ({ authedPage: page }) => {
    let releaseProfiles: (() => void) | undefined;
    const profilesGate = new Promise<void>((resolve) => {
        releaseProfiles = resolve;
    });

    await page.route('**/rest/v1/roast_profiles*', async (route) => {
        if (route.request().method() === 'GET') await profilesGate;
        await route.fallback();
    });

    try {
        await goNav(page, 'profiles');

        await expect(page.getByRole('heading', { name: 'Roast Profiles' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'New Profile' })).toBeVisible();
        const skeleton = page.getByRole('status', { name: 'Loading…' });
        await expect(skeleton).toBeVisible();
        await expect(skeleton.locator('.animate-pulse')).toHaveCount(15);
        await expect(page.getByTestId('profile-detail-skeleton').locator('.animate-pulse')).toHaveCount(14);
        await expect(page.getByPlaceholder('Search profiles...')).toBeVisible();
        await expect(page.getByText('No profiles yet')).toHaveCount(0);
    } finally {
        releaseProfiles?.();
    }

    await expect(page.getByText('No profiles yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create your first profile' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Roast Profiles' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Profile' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading…' })).toHaveCount(0);
    await expect(page.getByTestId('profile-detail-skeleton')).toHaveCount(0);
});

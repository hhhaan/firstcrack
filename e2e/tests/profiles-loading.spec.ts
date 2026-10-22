import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

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

test('profiles show cached saved numbers in cards and details', async ({ authedPage: page }, testInfo) => {
    await page.route('**/rest/v1/roast_profiles*', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
            json: ['saved-profile', 'new-profile'].map((id) => ({
                id,
                user_id: E2E_USER.id,
                name: id === 'saved-profile' ? 'Saved Profile' : 'New Profile',
                source_session: null,
                sources: [],
                duration_sec: 600,
                drop_temp_celsius: 200,
                target_level: 'Medium',
            })),
        });
    });
    let counterReads = 0;
    await page.route('**/rest/v1/rpc/get_roast_batch_counters', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        counterReads += 1;
        return route.fulfill({ json: { total: 9, 'saved-profile': 3 } });
    });
    await page.reload();
    await goNav(page, 'profiles');
    await expect(page.getByTestId('profile-batch-number')).toHaveText(['#3', '#0']);
    await expect(page.getByRole('heading', { name: 'Saved Profile #3' })).toBeVisible();
    await expect(page.getByTestId('profile-detail-batch-number')).toHaveText('#3');
    const cachedReads = counterReads;
    await page.getByTestId('profile-batch-number').nth(1).click();
    await expect(page.getByRole('heading', { name: 'New Profile #0' })).toBeVisible();
    await expect(page.getByTestId('profile-detail-batch-number')).toHaveText('#0');
    expect(counterReads).toBe(cachedReads);
    await page.screenshot({ path: testInfo.outputPath('profile-batch-numbers.png') });
});

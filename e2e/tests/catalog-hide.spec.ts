import { createBeanViaUi, expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('hidden beans can be restored without deleting the lot', async ({ authedPage: page, db }) => {
    await createBeanViaUi(page, 'Hidden bean', '5');
    const id = db.beans[0].id;
    await page.getByRole('button', { name: 'Hide Hidden bean', exact: true }).click();
    await expect(page.getByTestId(`bean-list-item-${id}`)).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'beans');
    await expect(page.getByTestId(`bean-list-item-${id}`)).toBeHidden();
    await page.getByLabel('Show hidden items').check();
    await page.getByRole('button', { name: 'Restore Hidden bean', exact: true }).click();
    await page.getByLabel('Show hidden items').uncheck();
    await expect(page.getByTestId(`bean-list-item-${id}`)).toBeVisible();
    expect(db.beans).toHaveLength(1);
});

test('hidden profiles survive reload and can be restored without deleting their records', async ({
    authedPage: page,
}) => {
    const profiles = ['Old profile', 'Current profile'].map((name, index) => ({
        id: `profile-${index}`,
        user_id: E2E_USER.id,
        name,
        target_level: 'Medium',
        duration_sec: 600,
        drop_temp_celsius: 210,
        source_session: null,
        source_session_id: null,
        default_bean: null,
        default_blend: null,
    }));
    await page.route('**/rest/v1/roast_profiles*', (route) =>
        route.fulfill({
            json: profiles,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Methods': '*',
            },
        }),
    );
    await goNav(page, 'profiles');
    await page.getByRole('button', { name: 'Hide Old profile', exact: true }).click();
    await expect(page.getByText('Old profile', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'profiles');
    await expect(page.getByText('Old profile', { exact: true })).toHaveCount(0);
    await page.getByLabel('Show hidden items').check();
    await page.getByRole('button', { name: 'Restore Old profile', exact: true }).click();
    await page.getByLabel('Show hidden items').uncheck();
    await expect(page.getByRole('button', { name: 'Hide Old profile', exact: true })).toBeVisible();
    expect(profiles).toHaveLength(2);
});

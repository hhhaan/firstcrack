import { expect, goNav, test } from '../fixtures/app';

test('history filters by profile across pages, combines search, and clears back to all records', async ({
    authedPage: page,
    db,
}) => {
    for (let i = 0; i < 11; i++) {
        db.seedCompletedSession({
            batch_name: `Espresso batch ${i + 1}`,
            profile_id: 'profile-espresso',
            roast_profiles: { name: 'Espresso', target_level: 'Medium' },
            roasted_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        });
    }
    db.seedCompletedSession({
        batch_name: 'Filter batch',
        profile_id: 'profile-filter',
        roast_profiles: { name: 'Filter', target_level: 'Light' },
        roasted_at: '2025-01-01T00:00:00Z',
    });
    db.seedCompletedSession({ batch_name: 'Unlinked batch' });
    await goNav(page, 'history');
    const history = page.getByTestId('history-page');
    const rows = history.locator('tbody tr');

    await history.getByRole('button', { name: 'Profile', exact: true }).click();
    await history.getByRole('button', { name: 'Espresso', exact: true }).click();
    await expect(rows).toHaveCount(10);
    await expect(history).toContainText('of 11');
    await history.getByRole('button', { name: '2', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Espresso batch 1');

    await history.getByRole('button', { name: 'Espresso', exact: true }).click();
    await history.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Filter batch');
    await expect(history.getByRole('button', { name: '2', exact: true })).toHaveCount(0);

    const search = history.getByPlaceholder('Search by bean, profile, or origin...');
    await search.fill('Espresso');
    await expect(history).toContainText('No sessions found');
    await search.fill('');
    await expect(rows).toContainText('Filter batch');

    await history.getByRole('button', { name: 'Filter', exact: true }).click();
    await history.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(history).toContainText('13 sessions recorded');
    await expect(history.getByText('Unlinked batch', { exact: true })).toBeVisible();
});

test('history profile filter and its reset option render in Korean', async ({ authedPage: page, db }) => {
    db.seedCompletedSession({
        batch_name: '테스트 배치',
        profile_id: 'profile-test',
        roast_profiles: { name: '테스트 프로파일', target_level: 'Medium' },
    });
    await page.addInitScript(() => localStorage.setItem('fc.language', 'ko'));
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'history');

    const history = page.getByTestId('history-page');
    await history.getByRole('button', { name: '프로파일', exact: true }).click();
    await expect(history.getByRole('button', { name: '프로파일', exact: true })).toHaveCount(2);
    await expect(history.getByRole('button', { name: '테스트 프로파일', exact: true })).toBeVisible();
    await expect(history).not.toContainText('history.allProfiles');
    await expect(history).not.toContainText('history.table.profile');
});

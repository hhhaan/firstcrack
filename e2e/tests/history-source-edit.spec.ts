import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('history summary persists a blend source and can switch back to a single bean', async ({
    authedPage: page,
    db,
}, testInfo) => {
    const bean = db.seedBean({ name: 'Single source', stockGrams: 1000 });
    const session = db.seedCompletedSession({ batch_name: 'Source correction', bean_id: bean.id, bean_label: null });
    db.blends.push({ id: 'blend-1', user_id: E2E_USER.id, name: 'House blend', blend_components: [] });
    await page.reload();
    await goNav(page, 'history');
    await page.getByText('Source correction', { exact: true }).first().click();
    const source = page.getByTestId('history-bean').getByRole('combobox');
    await source.focus();
    await expect(
        page
            .getByRole('group', { name: 'Single', exact: true })
            .getByRole('option', { name: 'Single source', exact: true }),
    ).toBeVisible();
    await expect(
        page
            .getByRole('group', { name: 'Blend', exact: true })
            .getByRole('option', { name: 'House blend', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('history-source-groups.png'), animations: 'disabled' });
    await page.getByRole('option', { name: 'House blend', exact: true }).click();
    await expect.poll(() => db.sessions.find((row) => row.id === session.id)?.blend_id).toBe('blend-1');
    expect(session.bean_id).toBeNull();
    expect(session.bean_label).toBeNull();
    expect(session.batch_name).toBe('Source correction');
    // The embedded relation must show the saved name before the full catalog arrives.
    let releaseBlends = () => {};
    const blendsReady = new Promise<void>((resolve) => {
        releaseBlends = resolve;
    });
    await page.route('**/rest/v1/blends*', async (route) => {
        await blendsReady;
        await route.fallback();
    });
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'history');
    await page.getByText('Source correction', { exact: true }).first().click();
    await expect(source).toHaveValue('House blend');
    releaseBlends();
    await expect(page.getByTestId('history-origin')).toHaveCount(0);
    await source.focus();
    await page.getByRole('option', { name: 'Single source', exact: true }).click();
    await expect.poll(() => db.sessions.find((row) => row.id === session.id)?.bean_id).toBe(bean.id);
    expect(session.blend_id).toBeNull();
});

test('Enter and blur preserve a saved blend when a bean has the same name', async ({ authedPage: page, db }) => {
    db.seedBean({ name: 'House blend', stockGrams: 1000 });
    db.blends.push({ id: 'blend-1', user_id: E2E_USER.id, name: 'House blend', blend_components: [] });
    const session = db.seedCompletedSession({ batch_name: 'Same name', blend_id: 'blend-1' });
    await page.reload();
    const writes: unknown[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/rest/v1/roast_sessions') && request.method() === 'PATCH')
            writes.push(request.postDataJSON());
    });
    await goNav(page, 'history');
    await page.getByText('Same name', { exact: true }).first().click();
    const source = page.getByTestId('history-bean').getByRole('combobox');
    await expect(source).toHaveValue('House blend');
    await expect(source).toBeEnabled();
    await source.focus();
    await expect(page.getByRole('option', { name: 'House blend', exact: true })).toHaveCount(2);
    await source.press('Enter');
    await source.press('Tab');
    // Blur commits after 120ms; wait for that path before checking for accidental writes.
    await page.waitForTimeout(250);
    expect(session.blend_id).toBe('blend-1');
    expect(session.bean_id).toBeNull();
    expect(writes).toEqual([]);
});

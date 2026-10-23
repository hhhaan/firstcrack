import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('history summary persists a blend source and can switch back to a single bean', async ({ authedPage: page, db }) => {
    const bean = db.seedBean({ name: 'Single source', stockGrams: 1000 });
    const session = db.seedCompletedSession({ batch_name: 'Source correction', bean_id: bean.id, bean_label: null });
    await page.route(/\/rest\/v1\/blends(?:\?|$)/, (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'blend-1', user_id: E2E_USER.id, name: 'House blend', blend_components: [] }]),
    }));
    await goNav(page, 'history');
    await page.getByText('Source correction', { exact: true }).first().click();
    const source = page.getByTestId('history-bean').getByRole('combobox');
    await source.focus();
    await page.getByRole('option', { name: 'House blend', exact: true }).click();
    await expect.poll(() => db.sessions.find((row) => row.id === session.id)?.blend_id).toBe('blend-1');
    expect(session.bean_id).toBeNull();
    expect(session.bean_label).toBeNull();
    expect(session.batch_name).toBe('Source correction');
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'history');
    await page.getByText('Source correction', { exact: true }).first().click();
    await expect(source).toHaveValue('House blend');
    await expect(page.getByTestId('history-origin')).toHaveCount(0);
    await source.focus();
    await page.getByRole('option', { name: 'Single source', exact: true }).click();
    await expect.poll(() => db.sessions.find((row) => row.id === session.id)?.bean_id).toBe(bean.id);
    expect(session.blend_id).toBeNull();
});

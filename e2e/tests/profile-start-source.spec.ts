import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

for (const origin of ['registered', 'historical'] as const) {
    for (const kind of ['bean', 'blend', 'multiple'] as const) {
        test(`starting a profile fills the roast header with its ${origin} source: ${kind}`, async ({
            authedPage: page,
            db,
        }) => {
            const bean = db.seedBean({ name: 'Registered Single', origin: 'Ethiopia' });
            const blend = { id: 'blend-1', name: 'Registered Blend', user_id: E2E_USER.id, blend_components: [] };
            const sources = [
                ...(kind !== 'blend' ? [{ bean_id: bean.id, blend_id: null }] : []),
                ...(kind !== 'bean' ? [{ bean_id: null, blend_id: blend.id }] : []),
            ];
            await page.route('**/rest/v1/roast_profiles*', (route) => {
                if (route.request().method() !== 'GET') return route.fallback();
                return route.fulfill({
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    json: [
                        {
                            id: 'profile-1',
                            user_id: E2E_USER.id,
                            name: 'Registered Profile',
                            sources: origin === 'registered' ? sources : [],
                            default_bean_id: null,
                            default_blend_id: null,
                            source_session: null,
                            duration_sec: 600,
                            drop_temp_celsius: 200,
                            created_at: '2026-10-20T00:00:00Z',
                        },
                    ],
                });
            });
            await page.route('**/rest/v1/blends*', (route) => {
                if (route.request().method() !== 'GET') return route.fallback();
                return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [blend] });
            });
            if (origin === 'historical') {
                await page.route('**/rest/v1/roast_sessions*', (route) => {
                    const query = new URL(route.request().url()).searchParams;
                    if (route.request().method() !== 'GET' || !query.get('select')?.includes('plan_batch:'))
                        return route.fallback();
                    return route.fulfill({
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        json: sources.map((source) => ({ ...source, plan_batch: null })),
                    });
                });
            }
            await page.reload();
            await goNav(page, 'profiles');
            const start = page.getByRole('button', { name: 'Start with this Profile' });
            await expect(start).toBeEnabled();
            await start.click();

            if (kind === 'multiple') {
                const choices = page.getByRole('dialog', { name: 'Profile sources' });
                await expect(choices.getByRole('button', { name: 'Registered Single' })).toBeVisible();
                await choices.getByRole('button', { name: 'Registered Blend' }).click();
            }

            const source = page.getByRole('combobox', { name: 'Green Bean', exact: true });
            await expect(source).toBeVisible();
            await expect(source).toHaveValue(kind === 'bean' ? bean.id : `blend:${blend.id}`);
            await expect(page.getByRole('button', { name: 'Target:' })).toHaveText('Registered Profile');
            if (kind !== 'bean')
                await expect(page.getByText('Registered Blend', { exact: true }).first()).toBeVisible();
        });
    }
}

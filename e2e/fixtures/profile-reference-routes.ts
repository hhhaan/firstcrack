import type { Page } from '@playwright/test';

type ZipperProfile = (sourceSessionId: string) => Record<string, unknown>;

export const installZipperProfileReferenceRoutes = async (
    page: Page,
    opts: {
        batches: readonly Record<string, unknown>[];
        initialSourceSessionId: string;
        profile: ZipperProfile;
    },
) => {
    let sourceSessionId = opts.initialSourceSessionId;
    const patches: string[] = [];

    await page.route('**/rest/v1/roast_profiles*', (route) => {
        const method = route.request().method();
        if (method === 'PATCH') {
            const body = route.request().postDataJSON() as { source_session_id?: string };
            if (body.source_session_id) {
                sourceSessionId = body.source_session_id;
                patches.push(body.source_session_id);
            }
            return route.fulfill({ json: opts.profile(sourceSessionId) });
        }
        if (method === 'GET') return route.fulfill({ json: [opts.profile(sourceSessionId)] });
        return route.fallback();
    });
    await page.route('**/rest/v1/roast_sessions*', (route) => {
        const url = route.request().url();
        if (route.request().method() !== 'GET' || !url.includes('profile_batch_number')) return route.fallback();
        return route.fulfill({ json: opts.batches });
    });

    return {
        get sourceSessionId() {
            return sourceSessionId;
        },
        patches,
    };
};

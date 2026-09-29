import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';
import type { MockDb } from '../fixtures/mock-db';

const TSV_KEY = `profiles/${E2E_USER.id}/history-edit.tsv`;

const tsv = () => {
    const rows = ['time\tbt\tet\tror\theater\tfan\tdrum\theater_set'];
    for (let t = 0; t <= 640; t += 10) {
        const bt = t <= 60 ? 200 - t : 140 + (t - 60) * 0.12;
        const set = t < 120 ? 70 : t < 600 ? 50 : 0;
        rows.push([t, bt.toFixed(1), (bt + 20).toFixed(1), '5', set, 40, 50, set].join('\t'));
    }
    return `${rows.join('\n')}\n`;
};

const seed = (db: MockDb) => {
    db.tsvFiles.set(TSV_KEY, tsv());
    return db.seedCompletedSession({
        tsv_path: TSV_KEY,
        duration_seconds: 640,
        drop_temp_celsius: 212,
        beans: { name: 'E2E History Bean', origin: 'Kenya', region: null, variety: null, process: null, farm: null },
        events: [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'n', type: 'Note', time_sec: 30, note: 'keep me', extra: 1 },
            { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 196 },
            { id: 'd', type: 'Drop', time_sec: 600, temp_c: 212 },
            { id: 'e', type: 'End', time_sec: 640, temp_c: 205 },
        ],
    });
};

test.describe('history record edit (#623)', () => {
    test('edit key events → validation → save → persisted, stock untouched', async ({ authedPage: page, db }) => {
        const session = seed(db);
        const stockBefore = db.stockEvents.length;
        await goNav(page, 'history');
        await page.getByText('E2E History Bean').first().click();
        await page.getByTestId('history-edit-events').click();
        const editor = page.getByTestId('record-events-editor');
        await expect(editor).toBeVisible();

        await editor.getByLabel('FC Start', { exact: false }).first().fill('10:30');
        await editor.getByRole('button', { name: /save/i }).click();
        await expect(editor.getByRole('alert')).toBeVisible();
        expect((session.events as { time_sec: number }[])[2].time_sec).toBe(480);

        await editor.getByLabel('FC Start', { exact: false }).first().fill('7:30');
        await editor.getByLabel('Drop', { exact: false }).nth(1).fill('215.4');
        await editor.getByRole('button', { name: /save/i }).click();
        await expect(editor).toBeHidden();

        const saved = db.sessions.find((s) => s.id === session.id)!;
        const events = saved.events as Record<string, unknown>[];
        expect(events[2]).toMatchObject({ type: 'FC Start', time_sec: 450, temp_c: 196 });
        expect(events[3]).toMatchObject({ type: 'Drop', time_sec: 600, temp_c: 215.4 });
        expect(events[1]).toEqual({ id: 'n', type: 'Note', time_sec: 30, note: 'keep me', extra: 1 });
        expect(saved.drop_temp_celsius).toBe(215);
        expect(db.stockEvents.length).toBe(stockBefore);

        // reload → edit survives re-entry
        await page.reload();
        await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 30_000 });
        await goNav(page, 'history');
        await page.getByText('E2E History Bean').first().click();
        await page.getByTestId('history-edit-events').click();
        await expect(
            page.getByTestId('record-events-editor').getByLabel('FC Start', { exact: false }).first(),
        ).toHaveValue('7:30');
    });

    test('concurrent change → conflict message, draft kept', async ({ authedPage: page, db }) => {
        const session = seed(db);
        await goNav(page, 'history');
        await page.getByText('E2E History Bean').first().click();
        await page.getByTestId('history-edit-events').click();
        const editor = page.getByTestId('record-events-editor');
        await editor.getByLabel('FC Start', { exact: false }).first().fill('7:40');

        // someone else saved first
        (session.events as Record<string, unknown>[])[3] = { id: 'd', type: 'Drop', time_sec: 605, temp_c: 212 };

        await editor.getByRole('button', { name: /save/i }).click();
        await expect(editor.getByRole('alert')).toContainText('changed elsewhere');
        await expect(editor.getByLabel('FC Start', { exact: false }).first()).toHaveValue('7:40');
        expect((session.events as { time_sec: number }[])[3].time_sec).toBe(605);
    });

    test('edit Heat set → persisted plan, TSV kept, no machine command', async ({ authedPage: page, db }) => {
        const session = seed(db);
        const sidecarWrites: string[] = [];
        page.on('request', (req) => {
            if (req.url().includes(':9999') && req.method() !== 'GET') sidecarWrites.push(req.url());
        });
        await goNav(page, 'history');
        await page.getByText('E2E History Bean').first().click();
        await expect(page.getByTestId('history-edit-heat')).toBeEnabled({ timeout: 15_000 });
        await page.getByTestId('history-edit-heat').click();
        const editor = page.getByTestId('heater-events-editor');
        await expect(editor).toBeVisible();
        await expect(editor.getByRole('button', { name: /add/i })).toHaveCount(0);

        const heat = editor.locator('tbody input[inputmode="decimal"]').nth(3);
        await expect(heat).toHaveValue('50');
        await heat.fill('55');
        await editor.getByRole('button', { name: /^save$/i }).click();
        await expect(editor).toBeHidden();

        const saved = db.sessions.find((s) => s.id === session.id)!;
        expect((saved.heater_events as { t: number; heater: number }[]).map((e) => [e.t, e.heater])).toEqual([
            [0, 70],
            [120, 55],
        ]);
        expect(db.tsvFiles.get(TSV_KEY)).toBe(tsv());
        expect(sidecarWrites).toEqual([]);
    });
});

import { readFile } from 'node:fs/promises';
import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('exports a completed roast as PDF', async ({ authedPage: page, db }) => {
    const key = `profiles/${E2E_USER.id}/history-pdf.tsv`;
    const rows = ['time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tet_ror'];
    for (let t = 0; t <= 640; t += 5) {
        const bt = t <= 70 ? 95 + 105 * (1 - t / 70) ** 2 : 95 + 140 * (1 - Math.exp(-(t - 70) / 300));
        const et =
            225 - 25 * Math.exp(-((t - 60) ** 2) / 4000) + 22 * (1 - Math.exp(-t / 180)) - Math.max(0, t - 450) * 0.06;
        const ror = t <= 70 ? '' : (28 * Math.exp(-(t - 70) / 300) + 0.3 * Math.sin(t / 13)).toFixed(1);
        const etRor = (
            60 *
            ((25 * Math.exp(-((t - 60) ** 2) / 4000) * (t - 60)) / 2000 +
                (22 / 180) * Math.exp(-t / 180) -
                (t > 450 ? 0.06 : 0))
        ).toFixed(1);
        const heat =
            t < 70 ? 70 : t < 190 ? 85 : t < 280 ? 70 : t < 370 ? 60 : t < 460 ? 50 : t < 530 ? 40 : t < 600 ? 30 : 0;
        rows.push(
            [t, bt.toFixed(1), et.toFixed(1), ror, heat, 40, 50, heat, et.toFixed(1), bt.toFixed(1), etRor].join('\t'),
        );
    }
    db.tsvFiles.set(key, `${rows.join('\n')}\n`);
    db.seedCompletedSession({
        tsv_path: key,
        duration_seconds: 640,
        drop_temp_celsius: 211.1,
        beans: {
            name: '에티오피아 예가체프',
            origin: 'Ethiopia',
            region: null,
            variety: null,
            process: null,
            farm: null,
        },
        events: [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 199.3 },
            { id: 'd', type: 'Drop', time_sec: 600, temp_c: 211.1 },
            { id: 'e', type: 'End', time_sec: 640, temp_c: 205 },
        ],
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    await goNav(page, 'history');
    await page.getByText('에티오피아 예가체프').first().click();
    const button = page.getByTestId('history-export-pdf');
    await expect(button).toBeEnabled({ timeout: 15_000 });
    await page.evaluate(() => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
            if (cmd === 'plugin:dialog|message') return 'Export';
            return invoke(cmd, args);
        };
    });
    errors.length = 0;
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await button.click();
    const result = await download.catch((error: Error) => {
        throw new Error(`${error.message}\nBrowser errors: ${errors.join('\n')}`);
    });
    await result.saveAs('output/pdf/roast-profile-preview.pdf');
    const pdf = (await readFile('output/pdf/roast-profile-preview.pdf')).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
    const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf);
    expect(Number(mediaBox?.[1])).toBeCloseTo(595.28, 2);
    expect(Number(mediaBox?.[2])).toBeCloseTo(841.89, 2);
    expect(errors).toEqual([]);
});

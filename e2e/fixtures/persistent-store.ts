import { expect, type Page } from '@playwright/test';

export const installPersistentStore = async (page: Page) => {
    await page.addInitScript(() => {
        const internals = window.__TAURI_INTERNALS__ as unknown as {
            invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
        const fallback = internals.invoke.bind(internals);
        const storageKey = 'e2e:tauri-store:settings.json';
        let values: Record<string, unknown> = {};
        internals.invoke = async (cmd, args = {}) => {
            if (cmd === 'plugin:store|load') {
                values = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>;
                return 1;
            }
            if (cmd === 'plugin:store|get') {
                const key = String(args.key);
                return [values[key] ?? null, Object.hasOwn(values, key)];
            }
            if (cmd === 'plugin:store|set') {
                values[String(args.key)] = args.value;
                return null;
            }
            if (cmd === 'plugin:store|delete') {
                delete values[String(args.key)];
                return null;
            }
            if (cmd === 'plugin:store|save') {
                localStorage.setItem(storageKey, JSON.stringify(values));
                return null;
            }
            return fallback(cmd, args);
        };
    });
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
};

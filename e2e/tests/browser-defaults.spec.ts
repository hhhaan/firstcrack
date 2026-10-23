import { expect, goNav, test } from '../fixtures/app';

test('blocks browser printing and default menus without swallowing app input', async ({ authedPage: page }) => {
    const probe = async (target: 'input' | 'div') =>
        page.evaluate((tag) => {
            const element = document.createElement(tag);
            document.body.append(element);
            const accepted = (key: string, modifiers: KeyboardEventInit = {}) =>
                element.dispatchEvent(
                    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
                );
            let appMenuCalled = false;
            element.addEventListener('contextmenu', () => {
                appMenuCalled = true;
            });
            const menuAllowed = element.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
            );
            const result = {
                ctrlPrint: accepted('p', { ctrlKey: true }),
                metaPrint: accepted('P', { metaKey: true }),
                plainP: accepted('p'),
                copy: accepted('c', { ctrlKey: true }),
                drop: accepted('D', { ctrlKey: true, shiftKey: true }),
                menuAllowed,
                appMenuCalled,
            };
            element.remove();
            return result;
        }, target);

    for (const view of ['dashboard', 'roast', 'history']) {
        await goNav(page, view);
        for (const target of ['input', 'div'] as const) {
            expect(await probe(target)).toEqual({
                ctrlPrint: false,
                metaPrint: false,
                plainP: true,
                copy: true,
                drop: true,
                menuAllowed: false,
                appMenuCalled: true,
            });
        }
    }
});

// Browser actions must not interrupt the document that owns live collection.
window.addEventListener(
    'keydown',
    (event) => {
        const key = event.key.toLowerCase();
        const editable =
            event.target instanceof Element &&
            event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null;
        const historyArrow =
            event.altKey &&
            ['arrowleft', 'arrowright'].includes(key) &&
            !(editable && navigator.platform.toLowerCase().includes('mac'));
        const developerTools =
            key === 'f12' ||
            (((event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey)) &&
                (['i', 'j', 'c'].includes(key) || ['KeyI', 'KeyJ', 'KeyC'].includes(event.code)));
        if (
            historyArrow ||
            developerTools ||
            ['browserback', 'browserforward'].includes(key) ||
            (event.metaKey && ['[', ']'].includes(key)) ||
            key === 'f5' ||
            key === 'browserrefresh' ||
            ((event.metaKey || (event.ctrlKey && !event.altKey)) &&
                (['p', 'r'].includes(key) || ['KeyP', 'KeyR'].includes(event.code)))
        ) {
            event.preventDefault();
        }
    },
    true,
);
const blockBrowserPointer = (event) => {
    const appContextMenu =
        event.target instanceof Element && event.target.closest('[data-app-context-menu]') !== null;
    if (event.type === 'contextmenu') event.preventDefault();
    if ([3, 4].includes(event.button) || (!appContextMenu && (event.type === 'contextmenu' || event.button === 2))) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
};
for (const type of [
    'contextmenu',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'auxclick',
    'dblclick',
]) {
    window.addEventListener(type, blockBrowserPointer, true);
}
// Native Tauri file-drop interception stays enabled; also stop browser URL/text drops.
for (const type of ['dragover', 'drop']) {
    window.addEventListener(
        type,
        (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
        },
        true,
    );
}

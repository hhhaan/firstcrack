// Browser printing and reloads can interrupt the webview that owns live collection.
window.addEventListener(
    'keydown',
    (event) => {
        const key = event.key.toLowerCase();
        if (
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
window.addEventListener('contextmenu', (event) => event.preventDefault(), true);

// Keep browser print dialogs off the webview that owns live collection.
window.addEventListener(
    'keydown',
    (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
            event.preventDefault();
        }
    },
    true,
);
window.addEventListener('contextmenu', (event) => event.preventDefault(), true);

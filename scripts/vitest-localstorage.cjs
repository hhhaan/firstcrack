// Node 26+ defines globalThis.localStorage as a getter that returns undefined
// unless --localstorage-file is set. Reading it also prints a warning.
// Vitest skips window keys that already exist on the global, so jsdom never
// installs Storage and tests throw on localStorage.clear().
// Drop the broken binding before the worker starts. Do not call the getter.
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
if (typeof descriptor?.get === 'function') {
    delete globalThis.localStorage;
}

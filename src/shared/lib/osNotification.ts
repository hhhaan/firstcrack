import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

let permissionReady: Promise<boolean> | null = null;

const ensurePermission = async (): Promise<boolean> => {
    if (permissionReady) return permissionReady;
    permissionReady = (async () => {
        if (await isPermissionGranted()) return true;
        const result = await requestPermission();
        return result === 'granted';
    })();
    return permissionReady;
};

/** Fire-and-forget native OS notification. Permission cached after first call. */
export const sendOsNotification = (title: string, body?: string): void => {
    ensurePermission().then((granted) => {
        if (granted) {
            sendNotification({ title, body });
        }
    });
};

import { logger } from '@shared/lib/logger';
import { Image } from '@tauri-apps/api/image';
import { TrayIcon } from '@tauri-apps/api/tray';
import { platform } from '@tauri-apps/plugin-os';
import { useEffect, useEffectEvent, useRef } from 'react';
import { drawMenuBarMetrics, type MenuBarReading } from '../lib/menu-bar-metrics';

const TRAY_ID = 'roast-metrics';

const isMacDesktop = (): boolean => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
    try {
        return platform() === 'macos';
    } catch {
        return false;
    }
};

const signatureOf = (reading: MenuBarReading): string =>
    `${reading.et}\n${reading.bt}\n${reading.ror}\n${reading.time}`;

/** Paints ET, BT, RoR, and Time as four menu-bar columns while the roast screen is open. */
export const useMenuBarMetrics = (reading: MenuBarReading | null): void => {
    const readCurrent = useEffectEvent(() => reading);
    const trayRef = useRef<TrayIcon | null>(null);
    const openingRef = useRef<Promise<TrayIcon | null> | null>(null);
    const mountedRef = useRef(true);
    const ticketRef = useRef(0);
    const reportedRef = useRef(false);
    const signature = reading ? signatureOf(reading) : '';

    useEffect(() => {
        if (!isMacDesktop()) return;
        const ticket = ++ticketRef.current;
        let disposed = false;

        void (async () => {
            const current = signature ? readCurrent() : null;
            try {
                if (!current) {
                    await trayRef.current?.setVisible(false);
                    return;
                }
                if (!openingRef.current) {
                    openingRef.current = TrayIcon.new({ id: TRAY_ID, showMenuOnLeftClick: false })
                        .then((tray) => {
                            if (!mountedRef.current) {
                                void tray.close();
                                return null;
                            }
                            trayRef.current = tray;
                            return tray;
                        })
                        .catch((error: unknown) => {
                            openingRef.current = null;
                            throw error;
                        });
                }
                const tray = await openingRef.current;
                if (disposed || ticket !== ticketRef.current || !tray) return;
                const bitmap = drawMenuBarMetrics(current);
                if (!bitmap || disposed || ticket !== ticketRef.current) return;
                const image = await Image.new(bitmap.rgba, bitmap.width, bitmap.height);
                if (disposed || ticket !== ticketRef.current) {
                    await image.close();
                    return;
                }
                await tray.setIconWithAsTemplate(image, true);
                await tray.setVisible(true);
                await image.close();
            } catch (error) {
                if (reportedRef.current) return;
                reportedRef.current = true;
                logger.capture(error, { feature: 'menu-bar-metrics' });
            }
        })();

        return () => {
            disposed = true;
        };
    }, [signature]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            void trayRef.current?.close();
            trayRef.current = null;
            openingRef.current = null;
        };
    }, []);
};

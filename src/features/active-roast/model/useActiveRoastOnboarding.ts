import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { useActiveRoastOnboardingStore } from './onboarding';

export const useActiveRoastOnboarding = (isActive: boolean) => {
    const { t, i18n } = useTranslation();
    const fullscreenHintSeen = useActiveRoastOnboardingStore((s) => s.fullscreenHintSeen);
    const sessionDismissed = useActiveRoastOnboardingStore((s) => s.sessionDismissed);
    const markFullscreenHintSeen = useActiveRoastOnboardingStore((s) => s.markFullscreenHintSeen);
    const dismissForSession = useActiveRoastOnboardingStore((s) => s.dismissForSession);
    const driverRef = useRef<ReturnType<typeof driver> | null>(null);
    const skipSessionDismissRef = useRef(false);
    const shouldShow = isActive && !fullscreenHintSeen && !sessionDismissed;

    useHotkeys(
        'f',
        () => {
            driverRef.current?.destroy();
        },
        { enabled: shouldShow },
    );

    useEffect(() => {
        if (!shouldShow) return;

        const target = document.querySelector('[data-tour="active-roast-chart"]');
        if (!target) return;

        const timeoutId = window.setTimeout(() => {
            const driverObj = driver({
                overlayOpacity: 0.6,
                stagePadding: 6,
                stageRadius: 8,
                popoverClass: 'fc-driver-theme',
                showButtons: ['next'],
                nextBtnText: t('activeRoast.fullscreenHint.dismiss'),
                onNextClick: (_el, _step, { driver: d }) => {
                    d.destroy();
                },
                onPopoverRender: (popover) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'driver-popover-prev-btn';
                    btn.textContent = t('activeRoast.fullscreenHint.dontShowAgain');
                    btn.setAttribute('aria-label', t('activeRoast.fullscreenHint.dontShowAgain'));
                    btn.addEventListener('click', () => {
                        markFullscreenHintSeen();
                        driverObj.destroy();
                    });
                    popover.footerButtons.prepend(btn);
                },
                onDestroyed: () => {
                    if (!skipSessionDismissRef.current) {
                        dismissForSession();
                    }
                    skipSessionDismissRef.current = false;
                    driverRef.current = null;
                },
            });
            driverRef.current = driverObj;

            driverObj.highlight({
                element: target,
                popover: {
                    side: 'bottom',
                    align: 'start',
                    title: t('activeRoast.fullscreenHint.title'),
                    description: t('activeRoast.fullscreenHint.description'),
                },
            });
        }, 600);

        return () => {
            window.clearTimeout(timeoutId);
            if (driverRef.current) {
                skipSessionDismissRef.current = true;
                driverRef.current.destroy();
            }
        };
        // i18n.language — stable across renders; re-run only on locale change
    }, [shouldShow, i18n.language, markFullscreenHintSeen, dismissForSession]);
};

import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useEffect, useRef } from 'react';
import { useActiveRoastOnboardingStore } from './onboarding';

export const useActiveRoastOnboarding = (isActive: boolean) => {
    const { fullscreenHintSeen, markFullscreenHintSeen } = useActiveRoastOnboardingStore();
    const driverRef = useRef<ReturnType<typeof driver> | null>(null);

    useEffect(() => {
        if (!isActive || fullscreenHintSeen) return;

        const target = document.querySelector('[data-tour="active-roast-chart"]');
        if (!target) return;

        const timeoutId = setTimeout(() => {
            const driverObj = driver({
                overlayOpacity: 0.6,
                stagePadding: 6,
                stageRadius: 8,
                popoverClass: 'fc-driver-theme',
                onDestroyed: () => {
                    markFullscreenHintSeen();
                    driverRef.current = null;
                },
            });
            driverRef.current = driverObj;

            driverObj.highlight({
                element: target,
                popover: {
                    side: 'bottom',
                    align: 'start',
                    title: '전체 화면 단축키',
                    description: '로스트 중에는 F 키를 눌러 차트를 전체 화면으로 볼 수 있어요. Esc로 종료합니다.',
                },
            });
        }, 600);

        return () => {
            clearTimeout(timeoutId);
            if (driverRef.current) {
                driverRef.current.destroy();
            }
        };
    }, [isActive, fullscreenHintSeen, markFullscreenHintSeen]);
};

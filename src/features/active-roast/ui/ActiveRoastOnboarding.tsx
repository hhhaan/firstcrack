import { Maximize2, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { useActiveRoastOnboardingStore } from '../model/onboarding';
import { SpotlightTour, type TargetRect } from './SpotlightTour';

const MIN_TARGET_SIZE = 24;
const SHOW_DELAY_MS = 500;
const RETRY_MS = 200;
const MAX_RETRIES = 20;

type TourStepId = 'fullscreen' | 'settings';

interface TourStepDef {
    id: TourStepId;
    selector: string;
    icon: typeof Maximize2;
    kbd?: string;
    stagePadding?: number;
    stageRadius?: number;
}

const STEPS: TourStepDef[] = [
    {
        id: 'fullscreen',
        selector: '[data-tour="active-roast-chart"]',
        icon: Maximize2,
        kbd: 'F',
        stagePadding: 6,
        stageRadius: 10,
    },
    {
        id: 'settings',
        selector: '[data-tour="active-roast-settings"]',
        icon: Settings2,
        stagePadding: 8,
        stageRadius: 8,
    },
];

function readTargetRect(selector: string): TargetRect | null {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) return null;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_TARGET_SIZE || r.height < MIN_TARGET_SIZE) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * Active Roast multi-step onboarding.
 * - Primary advances steps; last step ends session dismiss
 * - Esc / dim → hide for this app session
 * - Don't show again → persist forever
 * - F on fullscreen step → session dismiss (same as using the shortcut)
 */
export const ActiveRoastOnboarding = ({ isActive }: { isActive: boolean }) => {
    const { t } = useTranslation();
    const tourSeen = useActiveRoastOnboardingStore((s) => s.fullscreenHintSeen);
    const sessionDismissed = useActiveRoastOnboardingStore((s) => s.sessionDismissed);
    const markTourSeen = useActiveRoastOnboardingStore((s) => s.markFullscreenHintSeen);
    const dismissForSession = useActiveRoastOnboardingStore((s) => s.dismissForSession);

    const shouldShow = isActive && !tourSeen && !sessionDismissed;
    const [stepIndex, setStepIndex] = useState(0);
    const [target, setTarget] = useState<TargetRect | null>(null);

    const step = STEPS[stepIndex] ?? STEPS[0];
    const isLast = stepIndex >= STEPS.length - 1;

    const dismissSession = useCallback(() => {
        dismissForSession();
        setTarget(null);
        setStepIndex(0);
    }, [dismissForSession]);

    const dontShowAgain = useCallback(() => {
        markTourSeen();
        setTarget(null);
        setStepIndex(0);
    }, [markTourSeen]);

    const goNext = useCallback(() => {
        if (isLast) {
            dismissSession();
            return;
        }
        setStepIndex((i) => i + 1);
        setTarget(null);
    }, [isLast, dismissSession]);

    useHotkeys(
        'f',
        () => {
            if (step.id === 'fullscreen') dismissSession();
        },
        { enabled: shouldShow && !!target && step.id === 'fullscreen' },
    );

    useEffect(() => {
        if (!shouldShow) {
            setTarget(null);
            setStepIndex(0);
            return;
        }

        let cancelled = false;
        let timeoutId = 0;
        let retries = 0;
        const selector = step.selector;

        const sync = () => {
            if (cancelled) return;
            const next = readTargetRect(selector);
            if (!next) {
                if (retries++ < MAX_RETRIES) {
                    timeoutId = window.setTimeout(sync, RETRY_MS);
                } else if (stepIndex < STEPS.length - 1) {
                    // Missing target (e.g. settings button not mounted) → skip ahead
                    setStepIndex((i) => i + 1);
                } else {
                    dismissSession();
                }
                return;
            }
            setTarget(next);
        };

        const onLayout = () => {
            if (cancelled) return;
            const next = readTargetRect(selector);
            if (next) setTarget(next);
        };

        const delay = stepIndex === 0 ? SHOW_DELAY_MS : 80;
        timeoutId = window.setTimeout(sync, delay);
        window.addEventListener('resize', onLayout);
        window.addEventListener('scroll', onLayout, true);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
            window.removeEventListener('resize', onLayout);
            window.removeEventListener('scroll', onLayout, true);
        };
    }, [shouldShow, step.selector, stepIndex, dismissSession]);

    const copy = useMemo(() => {
        const id = step.id;
        return {
            title: t(`activeRoast.onboarding.steps.${id}.title`),
            description: t(`activeRoast.onboarding.steps.${id}.description`),
            dontShowAgain: t('activeRoast.onboarding.dontShowAgain'),
            primary: isLast ? t('activeRoast.onboarding.done') : t('activeRoast.onboarding.next'),
            progress: t('activeRoast.onboarding.progress', {
                current: stepIndex + 1,
                total: STEPS.length,
            }),
        };
    }, [t, step.id, isLast, stepIndex]);

    if (!shouldShow || !target) return null;

    return (
        <SpotlightTour
            target={target}
            title={copy.title}
            description={copy.description}
            primaryLabel={copy.primary}
            dontShowAgainLabel={copy.dontShowAgain}
            onPrimary={goNext}
            onDontShowAgain={dontShowAgain}
            onDismiss={dismissSession}
            icon={step.icon}
            kbd={step.kbd}
            stepIndex={stepIndex}
            stepCount={STEPS.length}
            stepProgressLabel={copy.progress}
            stagePadding={step.stagePadding}
            stageRadius={step.stageRadius}
        />
    );
};

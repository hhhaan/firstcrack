import { cn } from '@shared/lib/cn';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TargetRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SpotlightTourProps {
    target: TargetRect;
    title: string;
    description: string;
    /** Primary CTA (Next / Got it) */
    primaryLabel: string;
    /** Always-visible persist opt-out */
    dontShowAgainLabel: string;
    onPrimary: () => void;
    onDontShowAgain: () => void;
    /** Esc / dim click */
    onDismiss: () => void;
    icon?: LucideIcon;
    /** Optional keyboard chip next to title (e.g. "F") */
    kbd?: string;
    stepIndex?: number;
    stepCount?: number;
    stepProgressLabel?: string;
    stagePadding?: number;
    stageRadius?: number;
}

const CARD_WIDTH = 320;
const CARD_GAP = 14;
const VIEWPORT_PAD = 16;

function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
}

function buildCutoutPath(vw: number, vh: number, x: number, y: number, w: number, h: number, r: number): string {
    const radius = Math.min(r, w / 2, h / 2);
    return [
        `M0,0H${vw}V${vh}H0Z`,
        `M${x + radius},${y}`,
        `H${x + w - radius}`,
        `A${radius},${radius} 0 0 1 ${x + w},${y + radius}`,
        `V${y + h - radius}`,
        `A${radius},${radius} 0 0 1 ${x + w - radius},${y + h}`,
        `H${x + radius}`,
        `A${radius},${radius} 0 0 1 ${x},${y + h - radius}`,
        `V${y + radius}`,
        `A${radius},${radius} 0 0 1 ${x + radius},${y}`,
        'Z',
    ].join('');
}

/**
 * Design-system spotlight tour step (SVG cutout + floating card).
 * Multi-step orchestration lives in the parent.
 */
export const SpotlightTour = ({
    target,
    title,
    description,
    primaryLabel,
    dontShowAgainLabel,
    onPrimary,
    onDontShowAgain,
    onDismiss,
    icon: Icon,
    kbd,
    stepIndex,
    stepCount,
    stepProgressLabel,
    stagePadding = 6,
    stageRadius = 10,
}: SpotlightTourProps) => {
    const titleId = useId();
    const descId = useId();
    const cardRef = useRef<HTMLDivElement>(null);
    const [cardSize, setCardSize] = useState({ w: CARD_WIDTH, h: 160 });
    const [vw, setVw] = useState(() => window.innerWidth);
    const [vh, setVh] = useState(() => window.innerHeight);

    useEffect(() => {
        const onResize = () => {
            setVw(window.innerWidth);
            setVh(window.innerHeight);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useLayoutEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
    }, [title, description, primaryLabel, stepIndex]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onDismiss();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onDismiss]);

    useEffect(() => {
        cardRef.current?.focus({ preventScroll: true });
    }, [stepIndex]);

    const holeX = target.x - stagePadding;
    const holeY = target.y - stagePadding;
    const holeW = target.width + stagePadding * 2;
    const holeH = target.height + stagePadding * 2;

    const spaceBelow = vh - (holeY + holeH) - VIEWPORT_PAD;
    const spaceAbove = holeY - VIEWPORT_PAD;
    const spaceRight = vw - (holeX + holeW) - VIEWPORT_PAD;
    const spaceLeft = holeX - VIEWPORT_PAD;

    type Place = 'below' | 'above' | 'right' | 'left';
    let place: Place = 'below';
    if (spaceBelow >= cardSize.h + CARD_GAP) place = 'below';
    else if (spaceAbove >= cardSize.h + CARD_GAP) place = 'above';
    else if (spaceLeft >= cardSize.w + CARD_GAP) place = 'left';
    else if (spaceRight >= cardSize.w + CARD_GAP) place = 'right';
    else place = spaceBelow >= spaceAbove ? 'below' : 'above';

    let cardTop = holeY;
    let cardLeft = holeX;
    if (place === 'below') {
        cardTop = holeY + holeH + CARD_GAP;
        cardLeft = clamp(holeX, VIEWPORT_PAD, vw - cardSize.w - VIEWPORT_PAD);
    } else if (place === 'above') {
        cardTop = Math.max(VIEWPORT_PAD, holeY - CARD_GAP - cardSize.h);
        cardLeft = clamp(holeX, VIEWPORT_PAD, vw - cardSize.w - VIEWPORT_PAD);
    } else if (place === 'left') {
        cardLeft = Math.max(VIEWPORT_PAD, holeX - CARD_GAP - cardSize.w);
        cardTop = clamp(holeY, VIEWPORT_PAD, vh - cardSize.h - VIEWPORT_PAD);
    } else {
        cardLeft = Math.min(vw - cardSize.w - VIEWPORT_PAD, holeX + holeW + CARD_GAP);
        cardTop = clamp(holeY, VIEWPORT_PAD, vh - cardSize.h - VIEWPORT_PAD);
    }

    const path = buildCutoutPath(vw, vh, holeX, holeY, holeW, holeH, stageRadius);
    const showProgress = typeof stepIndex === 'number' && typeof stepCount === 'number' && stepCount > 1;

    return createPortal(
        <div className="fixed inset-0 z-[10050]" data-tour-overlay="spotlight">
            <svg className="absolute inset-0 h-full w-full" width={vw} height={vh} aria-hidden>
                <path
                    d={path}
                    fill="rgba(15, 12, 10, 0.52)"
                    fillRule="evenodd"
                    className="dark:opacity-90"
                    onClick={onDismiss}
                />
            </svg>

            <div
                aria-hidden
                className="pointer-events-none absolute ring-1 ring-white/70 dark:ring-white/25"
                style={{
                    left: holeX,
                    top: holeY,
                    width: holeW,
                    height: holeH,
                    borderRadius: stageRadius,
                    boxShadow:
                        '0 0 0 1px rgba(0,0,0,0.04), 0 8px 28px rgba(78,50,23,0.12), 0 0 0 6px rgba(255,255,255,0.06)',
                    transition: 'left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease',
                }}
            />

            <div
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descId}
                tabIndex={-1}
                className={cn(
                    'absolute outline-none',
                    'w-[320px] rounded-2xl border border-border bg-main-bg p-4',
                    'shadow-[0_8px_32px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.04)]',
                    'dark:border-[#585d61] dark:bg-[#262b31]',
                )}
                style={{
                    left: cardLeft,
                    top: cardTop,
                    transition: 'left 180ms ease, top 180ms ease',
                }}
            >
                {showProgress && (
                    <p className="mb-2.5 text-[11px] font-medium tracking-[0.14px] text-muted dark:text-white/45">
                        {stepProgressLabel ?? `${stepIndex! + 1} / ${stepCount}`}
                    </p>
                )}

                <div className="flex items-start gap-3">
                    {Icon && (
                        <div
                            className={cn(
                                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                                'bg-surface text-primary dark:bg-[#1c2126]',
                            )}
                            aria-hidden
                        >
                            <Icon className="h-4 w-4" strokeWidth={1.75} />
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h2
                                id={titleId}
                                className="text-[15px] font-semibold leading-snug tracking-[0.14px] text-primary dark:text-white"
                            >
                                {title}
                            </h2>
                            {kbd && (
                                <kbd
                                    className={cn(
                                        'inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5',
                                        'border border-border bg-surface text-[11px] font-medium text-secondary',
                                        'dark:border-[#585d61] dark:bg-[#1c2126] dark:text-white/80',
                                    )}
                                >
                                    {kbd}
                                </kbd>
                            )}
                        </div>
                        <p
                            id={descId}
                            className="mt-1.5 text-[13px] leading-relaxed tracking-[0.14px] text-secondary dark:text-white/70"
                        >
                            {description}
                        </p>
                    </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={onDontShowAgain}
                        className={cn(
                            'border-none bg-transparent p-0 text-[12px] tracking-[0.14px]',
                            'text-muted underline-offset-2 hover:text-secondary hover:underline',
                            'cursor-pointer transition-colors dark:text-white/50 dark:hover:text-white/80',
                        )}
                    >
                        {dontShowAgainLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onPrimary}
                        className={cn(
                            'flex items-center rounded-full border-none px-4 py-2',
                            'bg-primary text-[13px] font-medium tracking-[0.14px] text-white',
                            'cursor-pointer transition hover:-translate-y-px',
                            'dark:border dark:border-white dark:bg-[#0d0d0d]',
                        )}
                    >
                        {primaryLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

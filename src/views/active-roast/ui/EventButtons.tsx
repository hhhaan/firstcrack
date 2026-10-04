import type { FcDualStage } from '@features/active-roast/lib/fc-dual-mark';
import { isAppleOs } from '@shared/lib/mod-key';
import { useThemeStore } from '@shared/store/theme';
import type { LogEntry } from '@shared/types/roast';

export type EventButtonDef = {
    label: string;
    event: string | null;
    /** Key only, e.g. `1` / `D` — mod glyph rendered per OS */
    shortcutKey: string;
    pressKey: string;
    onClick: () => void;
    /** 이벤트 고유 색상 (sidebar variant에서 미등록 상태 배경/테두리로 사용) */
    color?: string;
    /** Dual-mark FC: 0 empty / 1 Start only / 2 Start+Rolling (overrides boolean registered). */
    dualStage?: FcDualStage;
    /** Extra gate on top of the panel-wide `disabled`. */
    disabled?: boolean;
};

function eventKeyshortcuts(shortcutKey: string): string {
    const doubled = shortcutKey.length === 2 && shortcutKey[0] === shortcutKey[1];
    const key = doubled ? shortcutKey[0] : shortcutKey;
    const chord = (mod: string) => (doubled ? `${mod}+${key} ${mod}+${key}` : `${mod}+${key}`);
    return `${chord('Meta')} ${chord('Control')}`;
}

export const EventButtons = ({
    buttons,
    logEntries,
    pressedButtons,
    variant,
    disabled = false,
}: {
    buttons: EventButtonDef[];
    logEntries: LogEntry[];
    pressedButtons: Set<string>;
    variant: 'sidebar' | 'main';
    /** Same gate as mark shortcuts: off during preheating/standby. */
    disabled?: boolean;
}) => {
    const isSidebar = variant === 'sidebar';
    const isDark = useThemeStore((s) => s.resolvedTheme) === 'dark';
    const apple = isAppleOs();

    const registeredEvents = new Set(logEntries.map((entry) => entry.event));

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isSidebar ? 8 : 10 }}>
            {buttons.map(
                ({ label, event, shortcutKey, pressKey, onClick, color, dualStage, disabled: buttonDisabled }) => {
                    const off = disabled || !!buttonDisabled;
                    const registered = event ? registeredEvents.has(event) : false;
                    const pressed = pressedButtons.has(pressKey);
                    const stage = dualStage;
                    // dual-mark 버튼은 stage가 곧 상태 — pressed 플래시를 섞으면 0→1에서 "완료"로 잘못 보인다
                    const fullResolved = stage != null ? stage === 2 : registered || pressed;
                    const partial = stage === 1;

                    let background: string;
                    let textColor: string;
                    let border: string;
                    let boxShadow: string;
                    let shortcutColor: string;
                    let fontWeight: number;

                    if (fullResolved) {
                        background = 'var(--color-primary)';
                        textColor = 'white';
                        border = 'none';
                        boxShadow = 'none';
                        shortcutColor = 'rgba(255,255,255,0.6)';
                        fontWeight = 600;
                    } else if (partial) {
                        // stage 1: half-marked — primary outline + light primary fill
                        background = `color-mix(in oklch, var(--color-primary) ${isDark ? 35 : 20}%, transparent)`;
                        textColor = 'var(--color-primary)';
                        border = '1px solid var(--color-primary)';
                        boxShadow = 'none';
                        shortcutColor = 'var(--color-muted)';
                        fontWeight = 600;
                    } else {
                        background =
                            isSidebar && color ? `${color}18` : isDark ? 'var(--color-surface-elevated)' : '#F2F2F2';
                        textColor = isSidebar && color ? color : 'var(--color-secondary)';
                        border = isSidebar && color ? `1px solid ${color}33` : 'none';
                        boxShadow = isSidebar && color ? `inset 0 0 0 1px ${color}55` : 'none';
                        shortcutColor = 'var(--color-muted)';
                        fontWeight = 500;
                    }

                    return (
                        <button
                            type="button"
                            key={shortcutKey}
                            onClick={onClick}
                            disabled={off}
                            aria-keyshortcuts={eventKeyshortcuts(shortcutKey)}
                            style={{
                                display: 'flex',
                                flexDirection: isSidebar ? 'column' : 'row',
                                alignItems: 'center',
                                justifyContent: isSidebar ? 'center' : 'space-between',
                                gap: isSidebar ? 2 : 0,
                                padding: isSidebar ? '8px 4px' : '9px 12px',
                                borderRadius: 6,
                                border,
                                background,
                                color: textColor,
                                fontSize: isSidebar ? 12 : 13,
                                fontWeight,
                                cursor: off ? 'default' : 'pointer',
                                opacity: off ? 0.4 : 1,
                                letterSpacing: isSidebar ? '-0.025em' : '0.14px',
                                transition: 'background 0.1s ease, color 0.1s ease, border-color 0.1s ease',
                                boxShadow,
                            }}
                            onMouseEnter={(e) => {
                                if (off) return;
                                if (isSidebar && color && !fullResolved && !partial) {
                                    e.currentTarget.style.background = `${color}30`;
                                    e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${color}88`;
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (off) return;
                                if (isSidebar && color && !fullResolved && !partial) {
                                    e.currentTarget.style.background = `${color}18`;
                                    e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${color}55`;
                                }
                            }}
                        >
                            <span
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    textAlign: 'center',
                                    lineHeight: 1.25,
                                    wordBreak: 'keep-all',
                                    textWrap: 'balance',
                                    fontSize: isSidebar ? 11 : undefined,
                                }}
                            >
                                {label}
                            </span>
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    fontSize: isSidebar ? 11 : 11,
                                    color: shortcutColor,
                                    fontFamily: 'var(--font-mono)',
                                    letterSpacing: 'normal',
                                    transition: 'color 0.15s',
                                }}
                            >
                                <span style={apple ? { fontSize: '1.3em', lineHeight: 1 } : undefined}>
                                    {apple ? '⌘' : 'Ctrl'}
                                </span>
                                <span>{apple ? shortcutKey : `+${shortcutKey}`}</span>
                            </span>
                        </button>
                    );
                },
            )}
        </div>
    );
};

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
};

export const EventButtons = ({
    buttons,
    logEntries,
    pressedButtons,
    variant,
}: {
    buttons: EventButtonDef[];
    logEntries: LogEntry[];
    pressedButtons: Set<string>;
    variant: 'sidebar' | 'main';
}) => {
    const isSidebar = variant === 'sidebar';
    const isDark = useThemeStore((s) => s.resolvedTheme) === 'dark';
    const apple = isAppleOs();

    const registeredEvents = new Set(logEntries.map((entry) => entry.event));

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isSidebar ? 8 : 10 }}>
            {buttons.map(({ label, event, shortcutKey, pressKey, onClick, color }) => {
                const registered = event ? registeredEvents.has(event) : false;
                const pressed = pressedButtons.has(pressKey);
                const resolved = registered || pressed;
                return (
                    <button
                        key={label}
                        onClick={onClick}
                        aria-keyshortcuts={`Meta+${shortcutKey} Control+${shortcutKey}`}
                        style={{
                            display: 'flex',
                            flexDirection: isSidebar ? 'column' : 'row',
                            alignItems: 'center',
                            justifyContent: isSidebar ? 'center' : 'space-between',
                            gap: isSidebar ? 2 : 0,
                            padding: isSidebar ? '10px 6px' : '9px 12px',
                            borderRadius: 6,
                            border: isSidebar && color && !resolved ? `1px solid ${color}33` : 'none',
                            background: resolved
                                ? 'var(--color-primary)'
                                : isSidebar && color
                                  ? `${color}18`
                                  : isDark
                                    ? 'var(--color-surface-elevated)'
                                    : '#F2F2F2',
                            color: resolved ? 'white' : isSidebar && color ? color : 'var(--color-secondary)',
                            fontSize: isSidebar ? 12 : 13,
                            fontWeight: resolved ? 600 : 500,
                            cursor: 'pointer',
                            letterSpacing: isSidebar ? '-0.025em' : '0.14px',
                            transition: 'background 0.1s ease, color 0.1s ease, border-color 0.1s ease',
                            boxShadow: isSidebar && !resolved && color ? `inset 0 0 0 1px ${color}55` : 'none',
                        }}
                        onMouseEnter={(e) => {
                            if (isSidebar && color && !resolved) {
                                e.currentTarget.style.background = `${color}30`;
                                e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${color}88`;
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (isSidebar && color && !resolved) {
                                e.currentTarget.style.background = `${color}18`;
                                e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${color}55`;
                            }
                        }}
                    >
                        <span>{label}</span>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 1,
                                fontSize: isSidebar ? 11 : 11,
                                color: resolved ? 'rgba(255,255,255,0.6)' : 'var(--color-muted)',
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
            })}
        </div>
    );
};

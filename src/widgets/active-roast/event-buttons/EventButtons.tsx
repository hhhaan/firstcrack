import type { LogEntry } from '@shared/types/roast';
import { useThemeStore } from '@shared/store/theme';

export type EventButtonDef = {
    label: string;
    event: string | null;
    shortcut: string;
    pressKey: string;
    onClick: () => void;
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

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isSidebar ? 8 : 10 }}>
            {buttons.map(({ label, event, shortcut, pressKey, onClick }) => {
                const registered = event ? logEntries.some((entry) => entry.event === event) : false;
                const pressed = pressedButtons.has(pressKey);
                return (
                    <button
                        key={label}
                        onClick={onClick}
                        aria-keyshortcuts={`Meta+${shortcut.replace('⌘', '')} Control+${shortcut.replace('⌘', '')}`}
                        style={{
                            display: 'flex',
                            flexDirection: isSidebar ? 'column' : 'row',
                            alignItems: 'center',
                            justifyContent: isSidebar ? 'center' : 'space-between',
                            gap: isSidebar ? 2 : 0,
                            padding: isSidebar ? '8px 4px' : '9px 12px',
                            borderRadius: 6,
                            border: 'none',
                            background:
                                registered || pressed
                                    ? 'var(--color-primary)'
                                    : isDark
                                      ? 'var(--color-surface-elevated)'
                                      : '#F2F2F2',
                            color: registered || pressed ? 'white' : 'var(--color-secondary)',
                            fontSize: isSidebar ? 11 : 13,
                            fontWeight: registered || pressed ? 600 : 500,
                            cursor: 'pointer',
                            letterSpacing: isSidebar ? 'normal' : '0.14px',
                            // boxShadow: pressed || registered ? 'none' : 'var(--shadow-inset)',
                            transition: 'background 0.1s ease, color 0.1s ease',
                        }}
                    >
                        <span>{label}</span>
                        <span
                            style={{
                                fontSize: isSidebar ? 10 : 11,
                                color: registered || pressed ? 'rgba(255,255,255,0.6)' : 'var(--color-muted)',
                                fontFamily: 'var(--font-mono)',
                                transition: 'color 0.15s',
                            }}
                        >
                            {shortcut}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

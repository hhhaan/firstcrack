import { COMPARE_LINE_DASHES } from '@shared/lib/compare-style';
import { formatDateShort } from '@shared/lib/format';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CompareSessionItem } from './CompareSessionTable';

interface CompareSessionLegendProps {
    items: CompareSessionItem[];
    onToggle: (id: string) => void;
    onFocusSession: (id: string | null) => void;
}

export const CompareSessionLegend = ({ items, onToggle, onFocusSession }: CompareSessionLegendProps) => {
    const { t } = useTranslation();
    const visibleCount = items.filter((item) => item.visible).length;

    return (
        <div
            role="group"
            className="flex flex-wrap gap-3"
            aria-label={t('history.compare.sidebarTitle', { count: items.length })}
        >
            {items.map(({ session, color, visible, hasCurve }, index) => {
                const name = sessionBeanName(session) ?? session.roast_profiles?.name ?? '—';
                return (
                    <button
                        key={session.id}
                        type="button"
                        aria-pressed={visible}
                        aria-label={`${name} · ${formatDateShort(session.roasted_at)}`}
                        aria-disabled={visible && visibleCount === 1}
                        onClick={() => {
                            onToggle(session.id);
                            onFocusSession(null);
                        }}
                        onMouseEnter={() => onFocusSession(visible ? session.id : null)}
                        onMouseLeave={() => onFocusSession(null)}
                        onFocus={() => onFocusSession(visible ? session.id : null)}
                        onBlur={() => onFocusSession(null)}
                        style={{ borderColor: visible ? color : undefined }}
                        className={`group flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            visible
                                ? 'border-border bg-main-bg text-primary hover:bg-surface-warm'
                                : 'border-border border-dashed bg-surface/40 text-secondary hover:bg-surface'
                        }`}
                    >
                        <span
                            className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md border-l-4 font-mono text-sm font-semibold text-primary"
                            style={{
                                borderColor: color,
                                backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
                            }}
                            aria-hidden="true"
                        >
                            {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">
                            <span className="block max-w-48 truncate text-sm font-semibold">{name}</span>
                            <span className="mt-0.5 block text-xs text-secondary">
                                {formatDateShort(session.roasted_at)}
                            </span>
                        </span>
                        <svg width="36" height="12" className="shrink-0" aria-hidden="true">
                            <line
                                x1="0"
                                x2="36"
                                y1="6"
                                y2="6"
                                stroke={color}
                                strokeWidth="3"
                                strokeDasharray={COMPARE_LINE_DASHES[index % COMPARE_LINE_DASHES.length].join(' ')}
                            />
                        </svg>
                        {!hasCurve && (
                            <span title={t('history.compare.noCurveData')}>
                                <AlertCircle size={13} className="text-muted" />
                            </span>
                        )}
                        {visible ? (
                            <Eye size={14} className="ml-2 shrink-0 text-muted" aria-hidden="true" />
                        ) : (
                            <EyeOff size={14} className="ml-2 shrink-0 text-muted" aria-hidden="true" />
                        )}
                    </button>
                );
            })}
        </div>
    );
};

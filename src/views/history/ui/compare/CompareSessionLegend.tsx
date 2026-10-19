import { formatDateShort } from '@shared/lib/format';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CompareSessionItem } from './CompareSessionTable';

interface CompareSessionLegendProps {
    items: CompareSessionItem[];
    onToggle: (id: string) => void;
}

export const CompareSessionLegend = ({ items, onToggle }: CompareSessionLegendProps) => {
    const { t } = useTranslation();
    const visibleCount = items.filter((item) => item.visible).length;

    return (
        <div
            role="group"
            className="flex flex-wrap gap-2"
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
                        disabled={visible && visibleCount === 1}
                        onClick={() => onToggle(session.id)}
                        className={`group flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            visible
                                ? 'border-border bg-main-bg text-primary hover:bg-surface-warm'
                                : 'border-border-subtle bg-surface/40 text-muted hover:bg-surface'
                        }`}
                    >
                        <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs"
                            style={{ color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
                            aria-hidden="true"
                        >
                            {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">
                            <span className="block max-w-48 truncate text-xs font-medium">{name}</span>
                            <span className="mt-0.5 block text-[10px] text-muted">
                                {formatDateShort(session.roasted_at)}
                            </span>
                        </span>
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

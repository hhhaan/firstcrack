import { CONTROL_COLORS } from '@features/active-roast/lib/chart-config';
import type { ControlReadoutEntry, ControlReadoutGroups } from '@features/active-roast/lib/control-readout';
import { Clock, Unplug } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

const Swatch = ({ entry }: { entry: ControlReadoutEntry }) => {
    const color = CONTROL_COLORS[entry.channel];
    if (entry.kind === 'measured') return <span className="h-0.5 w-3 shrink-0" style={{ background: color }} />;
    return (
        <span
            className="h-0 w-3 shrink-0 border-t"
            style={{ borderColor: color, borderTopStyle: entry.kind === 'set' ? 'dashed' : 'dotted' }}
        />
    );
};

const Entry = ({ entry }: { entry: ControlReadoutEntry }) => {
    const { t } = useTranslation();
    const measured = entry.kind === 'measured';
    const label = measured ? entry.label : t(`activeRoast.chart.controlReadout.${entry.kind}`);
    const value =
        entry.text === undefined ? null : (
            <span
                data-testid={`control-readout-${entry.key}`}
                className={`font-mono tabular-nums ${measured ? 'font-semibold text-foreground' : ''} ${entry.stale ? 'opacity-45' : ''}`}
            >
                {entry.text ?? '—'}
                {entry.text != null && (
                    <span className="font-normal text-muted">{entry.unit === '%' ? '%' : ` ${entry.unit}`}</span>
                )}
            </span>
        );
    return (
        <span className={`flex items-center gap-1 whitespace-nowrap ${measured ? '' : 'text-muted'}`}>
            <Swatch entry={entry} />
            <span className={measured ? 'text-muted' : ''}>{label}</span>
            {value}
        </span>
    );
};

const Group = ({
    entries,
    side,
    unit,
}: {
    entries: ControlReadoutEntry[];
    side: 'left' | 'right' | 'own';
    unit: string | null;
}) => {
    const { t } = useTranslation();
    if (entries.length === 0) return null;
    const title =
        side === 'own'
            ? t('activeRoast.chart.controlReadout.ownScale')
            : t(`activeRoast.chart.controlReadout.${side}Axis`, { unit: unit ?? '' });
    return (
        <div role="group" className="flex min-w-0 items-center gap-3" title={title} aria-label={title}>
            {entries.map((entry) => (
                <Entry key={entry.key} entry={entry} />
            ))}
        </div>
    );
};

/**
 * Always-visible current values under the control band. Left group = left axis curves,
 * right group = right axis curves, so each number sits on the side of its scale.
 */
export const ControlReadoutStrip = ({ groups, style }: { groups: ControlReadoutGroups; style: CSSProperties }) => {
    const { t } = useTranslation();
    const status =
        groups.state === 'offline' ? (
            <span className="flex items-center gap-1 whitespace-nowrap text-muted">
                <Unplug size={11} aria-hidden />
                {t('activeRoast.chart.controlReadout.offline')}
            </span>
        ) : groups.state === 'stale' ? (
            <span className="flex items-center gap-1 whitespace-nowrap text-muted">
                <Clock size={11} aria-hidden />
                {t('activeRoast.chart.controlReadout.stale')}
            </span>
        ) : null;
    return (
        <div
            data-testid="control-readout"
            data-state={groups.state}
            className="absolute flex items-center justify-between gap-3 overflow-hidden text-[11px] tracking-[0.14px]"
            style={style}
        >
            <div className="flex min-w-0 items-center gap-3">
                <Group entries={groups.left} side="left" unit={groups.leftUnit} />
                {status}
            </div>
            <div className="flex min-w-0 items-center gap-3">
                <Group entries={groups.ownScale} side="own" unit={null} />
                <Group entries={groups.right} side="right" unit={groups.rightUnit} />
            </div>
        </div>
    );
};

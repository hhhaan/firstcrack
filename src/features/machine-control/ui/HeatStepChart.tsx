import { useTranslation } from 'react-i18next';
import { formatEditTime, toDisplayBt } from '../lib/heater-events';
import { eventTrigger, type ReplayEvent, type ReplayPoint } from '../lib/replay';
import { formatReplayCondition } from '../lib/replayDisplay';

const CHART_PAD = { l: 48, r: 50, t: 20, b: 28 };
const CHART_WIDTH = 680;
const CHART_HEIGHT = 260;

export const HeatStepChart = ({
    events,
    tpTime,
    btPoints,
    unit,
    heaterUnit,
    heaterMax,
    selected,
    onSelect,
}: {
    events: ReplayEvent[];
    tpTime: number;
    btPoints: ReplayPoint[];
    unit: 'C' | 'F';
    heaterUnit: string;
    heaterMax: number;
    selected: number;
    onSelect: (index: number) => void;
}) => {
    const { t } = useTranslation();
    const width = CHART_WIDTH;
    const height = CHART_HEIGHT;
    const pad = CHART_PAD;
    const maxT = Math.max(60, ...btPoints.map((p) => p.t), ...events.map((e) => e.t), 1);
    const bts: number[] = [];
    for (const p of btPoints) {
        if (Number.isFinite(p.bt)) bts.push(p.bt);
    }
    const minBt = (bts.length ? Math.min(...bts) : 80) - 10;
    const maxBt = (bts.length ? Math.max(...bts) : 220) + 10;
    const heatMax = Math.max(heaterMax, ...events.map((e) => e.heater), 1);
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    const x = (t: number) => pad.l + (t / maxT) * innerW;
    const yBt = (bt: number) => pad.t + (1 - (bt - minBt) / (maxBt - minBt || 1)) * innerH;
    const yHeat = (h: number) => pad.t + (1 - h / heatMax) * innerH;
    const btPath = btPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)} ${yBt(p.bt)}`).join(' ');
    const heatPath =
        events.length === 0
            ? ''
            : `M${x(events[0].t)} ${yHeat(events[0].heater)}${events
                  .slice(1)
                  .map((e) => ` H${x(e.t)} V${yHeat(e.heater)}`)
                  .join('')} H${x(maxT)}`;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-secondary">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-(--color-sensor-bt)" />
                    {t('heaterEventsEditor.chartBt')} (°{unit})
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-(--color-control-heat)" />
                    {t('heaterEventsEditor.chartHeat')} ({heaterUnit})
                </span>
            </div>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="min-h-0 flex-1 w-full"
                role="group"
                aria-label={t('heaterEventsEditor.chartHeat')}
            >
                {[0, 0.5, 1].map((ratio) => (
                    <g key={ratio}>
                        <line
                            x1={pad.l}
                            x2={width - pad.r}
                            y1={yHeat(ratio * heatMax)}
                            y2={yHeat(ratio * heatMax)}
                            stroke="var(--color-chart-grid)"
                        />
                        <text
                            x={pad.l - 6}
                            y={yHeat(ratio * heatMax) + 4}
                            textAnchor="end"
                            fill="var(--color-chart-axis-label)"
                            fontSize="11"
                        >
                            {Math.round(ratio * heatMax)}
                            {heaterUnit}
                        </text>
                        <text
                            x={width - pad.r + 6}
                            y={yHeat(ratio * heatMax) + 4}
                            fill="var(--color-chart-axis-label)"
                            fontSize="11"
                        >
                            {Math.round(toDisplayBt(minBt + ratio * (maxBt - minBt), unit))}°
                        </text>
                        <text
                            x={x(ratio * maxT)}
                            y={height - 6}
                            textAnchor="middle"
                            fill="var(--color-chart-axis-label)"
                            fontSize="11"
                        >
                            {formatEditTime(ratio * maxT)}
                        </text>
                    </g>
                ))}
                {btPath && <path d={btPath} fill="none" stroke="var(--color-sensor-bt)" strokeWidth="1.6" />}
                {events.length > 0 && (
                    <path
                        d={heatPath}
                        fill="none"
                        stroke="var(--color-control-heat)"
                        strokeWidth="1.2"
                        strokeDasharray="4 3"
                    />
                )}
                {events.map((e, i) => (
                    <g
                        key={`${e.t}-${e.heater}-${i}`}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-label={`${formatReplayCondition(e, eventTrigger(e, tpTime), unit)}, ${e.heater}${heaterUnit}`}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onSelect(i);
                            }
                        }}
                        onClick={() => onSelect(i)}
                    >
                        <circle cx={x(e.t)} cy={yHeat(e.heater)} r="12" fill="transparent" />
                        <circle
                            cx={x(e.t)}
                            cy={yHeat(e.heater)}
                            r={i === selected ? 5 : 3.5}
                            fill={i === selected ? 'var(--color-control-heat)' : 'var(--color-main-bg)'}
                            stroke="var(--color-control-heat)"
                            strokeWidth="1.5"
                        />
                    </g>
                ))}
            </svg>
        </div>
    );
};

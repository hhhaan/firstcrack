// Data architecture:
// - Profile data (name, temps, curve, etc.) → server (Supabase) when ready
// - defaultProfileId → localStorage only (per-device preference, not synced)
//   If cross-device sync becomes a requirement, move to a user_preferences table.

import { Plus, Copy, Pencil, Trash2, MoreHorizontal, Lock, Star, GitCompare, Check } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { type View } from '@shared/types/view';
import { PageLayout } from '@shared/ui/PageLayout';
import uPlot from 'uplot';
import {
    roastProfiles as profiles,
    generateProfileCurve,
    DEFAULT_PROFILE_KEY,
    type RoastProfile,
} from '@shared/data/roast-profiles';

const COMPARE_COLORS = ['#171717', '#dc2626', '#0ea5e9', '#16a34a'] as const;

// Pre-computed once — profiles is a static import, curves never change
const SPARKLINE_CACHE = new Map(
    profiles.map((p) => [p.id, generateProfileCurve(p.dropVal, p.durationSec)]),
);

// Resolves 'var(--name)' CSS variable strings to their computed hex values for uPlot
const resolveColor = (color: string): string => {
    if (!color.startsWith('var(')) return color;
    const name = color.slice(4, -1).trim();
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#171717';
};

// Lightweight SVG sparkline — no axes, no tooltip
const Sparkline = ({ data, color }: { data: { bt: number }[]; color: string }) => {
    const W = 200;
    const H = 44;
    const bts = data.map((d) => d.bt);
    const min = Math.min(...bts);
    const max = Math.max(...bts);
    const range = max - min || 1;
    const pts = bts.map((v, i) => `${(i / (bts.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ');
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-11">
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
    );
};

interface SeriesData {
    curve: { t: number; bt: number }[];
    color: string; // supports 'var(--css-var)' or hex
    label: string;
}

const TABLE_ROWS: { label: string; getValue: (p: RoastProfile) => string }[] = [
    { label: 'Duration', getValue: (p) => p.duration },
    { label: 'Drop Temp', getValue: (p) => p.dropTemp },
    { label: 'Charge Temp', getValue: (p) => `${p.charge_temp}°C` },
    { label: 'Dev Time', getValue: (p) => p.devTime },
    { label: 'Dev %', getValue: (p) => p.devPct },
    { label: 'Batches', getValue: (p) => `${p.batches} runs` },
];

// Default/Set Default badge — shared between single and compare panels
const DefaultBadge = ({
    id,
    defaultId,
    onSetDefault,
}: {
    id: number;
    defaultId: number;
    onSetDefault: (id: number) => void;
}) => {
    if (defaultId === id) {
        return (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 shadow-(--shadow-inset)">
                <Star size={11} strokeWidth={2} fill="currentColor" className="text-amber-400" />
                <span className="text-[11px] font-medium text-amber-600 tracking-[0.3px]">Default</span>
            </div>
        );
    }
    return (
        <button
            onClick={() => onSetDefault(id)}
            title="Set as Default"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border-none bg-surface cursor-pointer shadow-(--shadow-inset) hover:bg-amber-50 transition-colors"
        >
            <Star size={11} strokeWidth={2} color="var(--color-muted)" />
            <span className="text-[11px] font-medium text-muted tracking-[0.3px]">Set Default</span>
        </button>
    );
};

// uPlot-based profile curve chart — supports 1-4 overlaid series
const ProfileCurveChart = ({ series }: { series: SeriesData[] }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || series.length === 0) return;

        const cs = getComputedStyle(document.documentElement);
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        // Build unified x-axis (all series use 30s intervals; align to longest)
        const maxT = Math.max(...series.map((s) => s.curve[s.curve.length - 1]?.t ?? 0));
        const xs: number[] = [];
        for (let t = 0; t <= maxT; t += 30) xs.push(t);

        // Per-series ys — null-padded for series shorter than maxT
        const ysArrays = series.map((s) => {
            const map = new Map(s.curve.map((pt) => [pt.t, pt.bt]));
            return xs.map((t) => map.get(t) ?? null);
        });

        const isMulti = series.length > 1;
        // Resolve once at init so setCursor doesn't call getComputedStyle on every mousemove
        const resolvedColors = series.map((s) => resolveColor(s.color));

        const ttEl = document.createElement('div');
        Object.assign(ttEl.style, {
            position: 'absolute',
            pointerEvents: 'none',
            display: 'none',
            background: 'white',
            borderRadius: '10px',
            padding: '10px 14px',
            boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
            fontSize: '12px',
            zIndex: '10',
            whiteSpace: 'nowrap',
        });

        const tooltipPlugin: uPlot.Plugin = {
            hooks: {
                init: [
                    (u) => {
                        u.root.style.position = 'relative';
                        u.root.appendChild(ttEl);
                    },
                ],
                setCursor: [
                    (u) => {
                        const { idx, left: cx, top: cy } = u.cursor;
                        if (idx == null || cx == null || cy == null) {
                            ttEl.style.display = 'none';
                            return;
                        }
                        const xSec = (u.data[0] as number[])[idx];
                        const m = Math.floor(xSec / 60);
                        const s = Math.round(xSec % 60);

                        let html = `<div style="font-weight:500;color:${colorMuted};margin-bottom:4px">${m}:${String(s).padStart(2, '0')}</div>`;
                        series.forEach((ser, i) => {
                            const val = (u.data[i + 1] as (number | null)[])[idx];
                            if (val == null) return;
                            html += `<div style="display:flex;align-items:center;gap:6px;${i > 0 ? 'margin-top:3px' : ''}">
                                <div style="width:8px;height:8px;border-radius:2px;background:${resolvedColors[i]}"></div>
                                <span style="color:${colorMuted}">${isMulti ? ser.label : 'Bean Temp'}:</span>
                                <span style="font-weight:600;color:#171717">${val.toFixed(1)}°C</span>
                            </div>`;
                        });

                        const tw = ttEl.offsetWidth || 160;
                        ttEl.innerHTML = html;
                        ttEl.style.display = 'block';
                        ttEl.style.left = `${cx + 12 + tw > u.width ? cx - tw - 12 : cx + 12}px`;
                        ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                    },
                ],
            },
        };

        const opts: uPlot.Options = {
            width: el.offsetWidth,
            height: 160,
            padding: [4, 12, 0, 0],
            cursor: { focus: { prox: 16 }, drag: { x: false, y: false } },
            legend: { show: false },
            axes: [
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.05)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: '11px monospace',
                    size: 24,
                    incrs: [30, 60, 120, 180, 300],
                    values: (_, vals) => vals.map((v) => `${Math.floor(v / 60)}m`),
                },
                {
                    stroke: colorMuted,
                    grid: { show: false },
                    ticks: { show: false },
                    border: { show: false },
                    font: '11px monospace',
                    size: 32,
                    values: (_, vals) => vals.map((v) => `${v}°`),
                },
            ],
            scales: { x: { time: false }, y: { range: [140, 230] } },
            series: [
                {},
                ...resolvedColors.map((c) => ({ stroke: c, width: 2, points: { show: false } })),
            ],
            plugins: [tooltipPlugin],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, ...ysArrays] as any, el);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) plotRef.current.setSize({ width: el.offsetWidth, height: 160 });
        });
        obs.observe(el);

        return () => {
            obs.disconnect();
            plotRef.current?.destroy();
            plotRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={containerRef} className="w-full" />;
};

interface ProfilesProps {
    onNavigate: (view: View) => void;
}

export const Profiles = ({ onNavigate }: ProfilesProps) => {
    const [selectedId, setSelectedId] = useState<number>(1);
    const [defaultId, setDefaultId] = useState<number>(() => {
        const stored = localStorage.getItem(DEFAULT_PROFILE_KEY);
        return stored ? Number(stored) : 1;
    });
    const [compareMode, setCompareMode] = useState(false);
    const [compareIds, setCompareIds] = useState<number[]>([]);

    const selected = profiles.find((p) => p.id === selectedId)!;

    const setDefault = (id: number) => {
        setDefaultId(id);
        localStorage.setItem(DEFAULT_PROFILE_KEY, String(id));
    };

    const enterCompareMode = () => {
        setCompareMode(true);
        setCompareIds([selectedId]);
    };

    const exitCompareMode = () => {
        setCompareMode(false);
        setCompareIds([]);
    };

    const toggleCompareId = (id: number) => {
        setCompareIds((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= 4) return prev;
            return [...prev, id];
        });
    };

    const handleProfileClick = (id: number, shiftKey: boolean) => {
        if (compareMode) {
            toggleCompareId(id);
            return;
        }
        // Shift+click auto-enters compare mode with current + clicked
        if (shiftKey && id !== selectedId) {
            setCompareMode(true);
            setCompareIds([selectedId, id]);
            return;
        }
        setSelectedId(id);
    };

    // First selected profile is the "primary" for fallback actions in compare mode
    const primaryId = compareMode ? (compareIds[0] ?? selectedId) : selectedId;

    // Only populated in compare mode — single panel uses `selected` directly
    const compareProfiles = compareMode
        ? (compareIds.map((id) => profiles.find((p) => p.id === id)).filter(Boolean) as RoastProfile[])
        : [];

    const chartSeries: SeriesData[] = compareProfiles.map((p, i) => ({
        curve: SPARKLINE_CACHE.get(p.id)!,
        color: COMPARE_COLORS[i],
        label: p.name,
    }));

    const chartKey = compareMode ? compareIds.join(',') : String(selectedId);

    return (
        <PageLayout>
            {/* Header */}
            <div className="flex items-end justify-between mb-7">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        Roast Profiles
                    </h1>
                    <p className="text-sm text-muted tracking-[0.14px]">
                        {profiles.length} profiles · {profiles.filter((p) => p.locked).length} locked
                    </p>
                </div>
                <div className="flex gap-2 items-center">
                    <button
                        onClick={compareMode ? exitCompareMode : enterCompareMode}
                        className={`flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none text-sm font-medium cursor-pointer tracking-[0.14px] transition-colors ${
                            compareMode
                                ? 'bg-primary text-white shadow-(--shadow-card)'
                                : 'bg-surface text-secondary shadow-(--shadow-inset) hover:text-primary'
                        }`}
                    >
                        <GitCompare size={14} strokeWidth={2} />
                        {compareMode ? '비교 모드 종료' : '비교하기'}
                    </button>
                    <button className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer shadow-(--shadow-card) tracking-[0.14px]">
                        <Plus size={15} strokeWidth={2.5} />
                        New Profile
                    </button>
                </div>
            </div>

            <div className="grid gap-5" style={{ gridTemplateColumns: '300px 1fr' }}>
                {/* Profile list */}
                <div className="flex flex-col gap-2">
                    {compareMode && (
                        <p className="text-[11px] font-medium text-muted tracking-[0.4px] px-1 mb-0.5">
                            {compareIds.length === 0
                                ? '비교할 프로파일을 선택하세요'
                                : compareIds.length >= 4
                                  ? '최대 4개 선택됨'
                                  : `${compareIds.length}개 선택됨 · 최대 4개`}
                        </p>
                    )}
                    {profiles.map((profile) => {
                        const isSelected = !compareMode && selectedId === profile.id;
                        const compareIdx = compareMode ? compareIds.indexOf(profile.id) : -1;
                        const isCompareSelected = compareIdx !== -1;
                        const atCapacity = compareMode && compareIds.length >= 4 && !isCompareSelected;
                        const sparkColor = isCompareSelected
                            ? COMPARE_COLORS[compareIdx]
                            : isSelected
                              ? 'var(--color-primary)'
                              : '#b3b0aa';

                        return (
                            <div
                                key={profile.id}
                                onClick={(e) => !atCapacity && handleProfileClick(profile.id, e.shiftKey)}
                                className={`bg-main-bg rounded-lg p-4 transition-all duration-150 ${atCapacity ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${isSelected || isCompareSelected ? 'border border-black/8 shadow-[rgba(0,0,0,0.4)_0px_0px_1px,rgba(0,0,0,0.06)_0px_2px_8px]' : 'border border-transparent shadow-(--shadow-ring)'}`}
                            >
                                {compareMode && (
                                    <div className="flex justify-end -mt-1 mb-1">
                                        <div
                                            className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${isCompareSelected ? 'text-white' : 'bg-surface shadow-(--shadow-inset)'}`}
                                            style={
                                                isCompareSelected
                                                    ? { backgroundColor: COMPARE_COLORS[compareIdx] }
                                                    : undefined
                                            }
                                        >
                                            {isCompareSelected && <Check size={9} strokeWidth={3} />}
                                        </div>
                                    </div>
                                )}

                                <Sparkline data={SPARKLINE_CACHE.get(profile.id)!} color={sparkColor} />

                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-1.25 mb-0.5">
                                            <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                                {profile.name}
                                            </span>
                                            {profile.locked && (
                                                <Lock size={11} strokeWidth={2} color="var(--color-muted)" />
                                            )}
                                            {defaultId === profile.id && (
                                                <Star
                                                    size={11}
                                                    strokeWidth={2}
                                                    fill="currentColor"
                                                    className="text-amber-400"
                                                />
                                            )}
                                        </div>
                                        <div className="text-[12px] text-muted tracking-[0.14px]">
                                            Drop {profile.dropTemp} · {profile.batches} batches
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Detail panel */}
                {compareMode ? (
                    compareIds.length === 0 ? (
                        <div className="bg-main-bg rounded-lg px-8 py-7 shadow-(--shadow-ring) flex flex-col items-center justify-center gap-3 min-h-[320px]">
                            <GitCompare size={32} strokeWidth={1.5} color="var(--color-muted)" />
                            <p className="text-sm text-muted tracking-[0.14px]">
                                좌측 리스트에서 프로파일을 선택하세요
                            </p>
                        </div>
                    ) : (
                        /* ── Compare mode detail panel ── */
                        <div className="bg-main-bg rounded-lg px-8 py-7 shadow-(--shadow-ring)">
                            {/* Badge row */}
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface shadow-(--shadow-inset)">
                                    <GitCompare size={11} strokeWidth={2} color="var(--color-secondary)" />
                                    <span className="text-[11px] font-medium text-secondary tracking-[0.3px]">
                                        비교 모드 · {compareIds.length}개 선택됨
                                    </span>
                                </div>
                                <div className="flex gap-1.5 items-center">
                                    <DefaultBadge id={primaryId} defaultId={defaultId} onSetDefault={setDefault} />
                                    <button
                                        disabled
                                        title="다중 선택 시 편집 불가"
                                        className="w-8 h-8 rounded-lg border-none bg-surface/50 flex items-center justify-center cursor-not-allowed opacity-35 shadow-(--shadow-inset)"
                                    >
                                        <Pencil size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                    </button>
                                    <button
                                        title="More"
                                        className="w-8 h-8 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset)"
                                    >
                                        <MoreHorizontal size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                    </button>
                                </div>
                            </div>

                            {/* Overlay chart */}
                            <div className="bg-surface rounded-lg px-4 pt-4 pb-2 mb-3 shadow-(--shadow-inset)">
                                <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                                    Curve Overlay
                                </div>
                                <ProfileCurveChart key={chartKey} series={chartSeries} />
                            </div>

                            {/* Legend chips */}
                            <div className="flex flex-wrap gap-2 mb-5">
                                {compareProfiles.map((p, i) => (
                                    <div
                                        key={p.id}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface shadow-(--shadow-inset)"
                                    >
                                        <div
                                            className="w-2 h-2 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: COMPARE_COLORS[i] }}
                                        />
                                        <span className="text-[12px] font-medium text-secondary tracking-[0.14px]">
                                            {p.name}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Comparison table */}
                            <div className="bg-surface rounded-lg shadow-(--shadow-inset) overflow-hidden mb-5">
                                <div
                                    className="grid"
                                    style={{
                                        gridTemplateColumns: `140px repeat(${compareProfiles.length}, 1fr)`,
                                    }}
                                >
                                    <div className="px-3.5 py-2.5 border-b border-black/5" />
                                    {compareProfiles.map((p, i) => (
                                        <div
                                            key={p.id}
                                            className="px-3.5 py-2.5 border-b border-black/5 border-l border-l-black/5"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <div
                                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                                    style={{ backgroundColor: COMPARE_COLORS[i] }}
                                                />
                                                <span className="text-[11px] font-semibold text-primary tracking-[0.14px] truncate">
                                                    {p.name}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    {TABLE_ROWS.flatMap(({ label, getValue }, rowIdx) => [
                                        <div
                                            key={`lbl-${label}`}
                                            className={`px-3.5 py-2.5 ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5' : ''}`}
                                        >
                                            <span className="text-[11px] font-medium text-muted tracking-[0.4px] uppercase">
                                                {label}
                                            </span>
                                        </div>,
                                        ...compareProfiles.map((p) => (
                                            <div
                                                key={`${p.id}-${label}`}
                                                className={`px-3.5 py-2.5 border-l border-l-black/5 ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5' : ''}`}
                                            >
                                                <span className="text-[12px] font-semibold text-primary font-mono tracking-[-0.2px]">
                                                    {getValue(p)}
                                                </span>
                                            </div>
                                        )),
                                    ])}
                                </div>
                            </div>
                        </div>
                    )
                ) : (
                    /* ── Single-select detail panel ── */
                    <div className="bg-main-bg rounded-lg px-8 py-7 shadow-(--shadow-ring)">
                        <div className="flex items-start justify-between mb-5">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h2 className="font-display font-light text-[26px] leading-[1.2] text-primary tracking-[-0.3px]">
                                        {selected.name}
                                    </h2>
                                    {selected.locked && (
                                        <div className="flex items-center gap-1 px-2.25 py-0.75 rounded-full bg-surface shadow-(--shadow-inset)">
                                            <Lock size={11} strokeWidth={2} color="var(--color-muted)" />
                                            <span className="text-[11px] font-medium text-muted tracking-[0.3px]">
                                                Locked
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-sm text-secondary tracking-[0.14px] leading-normal">
                                    {selected.description}
                                </p>
                            </div>
                            <div className="flex gap-1.5 items-center">
                                <DefaultBadge id={selected.id} defaultId={defaultId} onSetDefault={setDefault} />
                                {[
                                    { icon: Copy, label: 'Duplicate' },
                                    { icon: Pencil, label: 'Edit' },
                                    { icon: MoreHorizontal, label: 'More' },
                                ].map(({ icon: Icon, label }) => (
                                    <button
                                        key={label}
                                        title={label}
                                        className="w-8 h-8 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset)"
                                    >
                                        <Icon size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Temperature curve chart */}
                        <div className="bg-surface rounded-lg px-4 pt-4 pb-2 mb-5 shadow-(--shadow-inset)">
                            <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                                Profile Curve
                            </div>
                            <ProfileCurveChart
                                key={chartKey}
                                series={[
                                    {
                                        curve: SPARKLINE_CACHE.get(selectedId)!,
                                        color: 'var(--color-primary)',
                                        label: selected.name,
                                    },
                                ]}
                            />
                        </div>

                        {/* Profile parameters */}
                        <div className="grid grid-cols-3 gap-3 mb-5">
                            {[
                                { label: 'Total Duration', value: selected.duration },
                                { label: 'Drop Temperature', value: selected.dropTemp },
                                { label: 'Charge Temperature', value: `${selected.charge_temp}°C` },
                                { label: 'Development Time', value: selected.devTime },
                                { label: 'Dev/Total %', value: selected.devPct },
                                { label: 'Total Batches', value: `${selected.batches} runs` },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-surface rounded-lg px-3.5 py-3 shadow-(--shadow-inset)">
                                    <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-1">
                                        {label}
                                    </div>
                                    <div className="text-sm font-semibold text-primary font-mono tracking-[-0.2px]">
                                        {value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Used for */}
                        <div>
                            <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                                Used For
                            </div>
                            <div className="flex gap-1.5 flex-wrap mb-5">
                                {selected.usedFor.map((bean) => (
                                    <span
                                        key={bean}
                                        className="text-[12px] font-medium text-secondary bg-surface px-2.5 py-1 rounded-full tracking-[0.14px] shadow-(--shadow-inset)"
                                    >
                                        {bean}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-2.5">
                            <button
                                onClick={() => onNavigate('roast')}
                                className="flex-1 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px] shadow-(--shadow-card)"
                            >
                                Start with this Profile
                            </button>
                            <button className="flex items-center gap-1.5 px-5 py-2.5 rounded-full border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-medium cursor-pointer tracking-[0.14px] shadow-(--shadow-inset)">
                                <Trash2 size={14} strokeWidth={2} />
                                Delete
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
};

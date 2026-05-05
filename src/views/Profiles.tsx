import { Plus, Copy, Pencil, Trash2, MoreHorizontal, Lock } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { type View } from '../shared/types/view';
import uPlot from 'uplot';

// Lightweight SVG sparkline — no axes, no tooltip
const Sparkline = ({ data, color }: { data: { bt: number }[]; color: string }) => {
    const W = 200; const H = 44;
    const bts = data.map((d) => d.bt);
    const min = Math.min(...bts); const max = Math.max(...bts);
    const range = max - min || 1;
    const pts = bts
        .map((v, i) => `${(i / (bts.length - 1)) * W},${H - ((v - min) / range) * H}`)
        .join(' ');
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-11">
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
    );
};

// uPlot-based profile curve chart
const ProfileCurveChart = ({ xs, ys }: { xs: number[]; ys: number[] }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const cs = getComputedStyle(document.documentElement);
        const colorPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717';
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';
        const colorSecondary = cs.getPropertyValue('--color-secondary').trim() || '#6b7280';

        const ttEl = document.createElement('div');
        Object.assign(ttEl.style, {
            position: 'absolute', pointerEvents: 'none', display: 'none',
            background: 'white', borderRadius: '10px', padding: '10px 14px',
            boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
            fontSize: '12px', zIndex: '10', whiteSpace: 'nowrap',
        });

        const tooltipPlugin: uPlot.Plugin = {
            hooks: {
                init: [(u) => { u.root.style.position = 'relative'; u.root.appendChild(ttEl); }],
                setCursor: [(u) => {
                    const { idx, left: cx, top: cy } = u.cursor;
                    if (idx == null || cx == null || cy == null) { ttEl.style.display = 'none'; return; }
                    const xSec = (u.data[0] as number[])[idx];
                    const bt = (u.data[1] as number[])[idx];
                    const m = Math.floor(xSec / 60);
                    const s = Math.round(xSec % 60);
                    ttEl.innerHTML = `
                        <div style="font-weight:500;color:${colorMuted};margin-bottom:4px">${m}:${String(s).padStart(2,'0')}</div>
                        <div style="display:flex;align-items:center;gap:6px">
                            <div style="width:8px;height:8px;border-radius:2px;background:${colorPrimary}"></div>
                            <span style="color:${colorSecondary}">Bean Temp:</span>
                            <span style="font-weight:600;color:${colorPrimary}">${bt?.toFixed(1)}°C</span>
                        </div>`;
                    const tw = ttEl.offsetWidth || 140;
                    ttEl.style.display = 'block';
                    ttEl.style.left = `${cx + 12 + tw > u.width ? cx - tw - 12 : cx + 12}px`;
                    ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                }],
            },
        };

        const opts: uPlot.Options = {
            width: el.offsetWidth, height: 160,
            padding: [4, 12, 0, 0],
            cursor: { focus: { prox: 16 }, drag: { x: false, y: false } },
            legend: { show: false },
            axes: [
                {
                    stroke: colorMuted, grid: { stroke: 'rgba(0,0,0,0.05)', width: 1 },
                    ticks: { show: false }, border: { show: false },
                    font: '11px monospace', size: 24,
                    incrs: [30, 60, 120, 180, 300],
                    values: (_, vals) => vals.map((v) => `${Math.floor(v / 60)}m`),
                },
                {
                    stroke: colorMuted, grid: { show: false }, ticks: { show: false },
                    border: { show: false }, font: '11px monospace', size: 32,
                    values: (_, vals) => vals.map((v) => `${v}°`),
                },
            ],
            scales: { x: { time: false }, y: { range: [140, 230] } },
            series: [
                {},
                { stroke: colorPrimary, width: 2, points: { show: false } },
            ],
            plugins: [tooltipPlugin],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, ys] as any, el);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) plotRef.current.setSize({ width: el.offsetWidth, height: 160 });
        });
        obs.observe(el);
        return () => { obs.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current?.setData([xs, ys] as any);
    }, [xs, ys]);

    return <div ref={containerRef} className="w-full" />;
};

const generateProfileCurve = (dropTemp: number, duration: number) => {
    const points = [];
    for (let t = 0; t <= duration; t += 30) {
        let bt: number;
        if (t <= 90) {
            bt = 200 - (48 * t) / 90;
        } else {
            const remaining = duration - 90;
            const rise = dropTemp - 152;
            const elapsed = t - 90;
            bt = 152 + rise * Math.pow(elapsed / remaining, 0.75);
        }
        points.push({ t, bt: Math.round(bt * 10) / 10 });
    }
    return points;
};

const profiles = [
    {
        id: 1,
        name: 'Signature Light',
        description: 'High clarity light roast. Preserves origin characteristics.',
        duration: '11:30–12:30',
        dropTemp: '193–197°C',
        charge: 200,
        dropVal: 195,
        durationSec: 750,
        charge_temp: 200,
        devTime: '1:30–2:00',
        devPct: '12–15%',
        usedFor: ['Ethiopia Yirgacheffe', 'Kenya AA', 'Panama Gesha'],
        locked: false,
        batches: 34,
    },
    {
        id: 2,
        name: 'Balanced Medium',
        description: 'Approachable medium with sweetness and body balance.',
        duration: '12:30–13:30',
        dropTemp: '200–205°C',
        charge: 200,
        dropVal: 202,
        durationSec: 810,
        charge_temp: 200,
        devTime: '1:45–2:15',
        devPct: '13–16%',
        usedFor: ['Colombia Huila', 'Guatemala Antigua'],
        locked: false,
        batches: 22,
    },
    {
        id: 3,
        name: 'House Medium',
        description: 'Consistent, crowd-pleasing medium. Low variance across batches.',
        duration: '13:30–14:30',
        dropTemp: '207–212°C',
        charge: 196,
        dropVal: 210,
        durationSec: 870,
        charge_temp: 196,
        devTime: '2:00–2:30',
        devPct: '14–17%',
        usedFor: ['Brazil Cerrado', 'Guatemala Antigua'],
        locked: true,
        batches: 58,
    },
    {
        id: 4,
        name: 'Dark Roast',
        description: 'Second crack. Bold, heavy body with low acidity.',
        duration: '14:30–16:00',
        dropTemp: '217–222°C',
        charge: 193,
        dropVal: 220,
        durationSec: 930,
        charge_temp: 193,
        devTime: '2:30–3:30',
        devPct: '17–22%',
        usedFor: ['Brazil Cerrado'],
        locked: false,
        batches: 8,
    },
];

interface ProfilesProps {
    onNavigate: (view: View) => void;
}

export const Profiles = ({ onNavigate }: ProfilesProps) => {
    const [selectedId, setSelectedId] = useState<number>(1);
    const selected = profiles.find((p) => p.id === selectedId)!;
    const curveData = generateProfileCurve(selected.dropVal, selected.durationSec);
    const curveXs = curveData.map((d) => d.t);
    const curveYs = curveData.map((d) => d.bt);

    return (
        <div className="px-10 py-8 max-w-275 mx-auto">
            {/* Header */}
            <div className="flex items-end justify-between mb-7">
                <div>
                    <h1 className="font-display font-light text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1">
                        Roast Profiles
                    </h1>
                    <p className="text-sm text-muted tracking-[0.14px]">
                        {profiles.length} profiles · {profiles.filter((p) => p.locked).length} locked
                    </p>
                </div>
                <button className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer shadow-(--shadow-card) tracking-[0.14px]">
                    <Plus size={15} strokeWidth={2.5} />
                    New Profile
                </button>
            </div>

            <div className="grid gap-5" style={{ gridTemplateColumns: '300px 1fr' }}>
                {/* Profile list */}
                <div className="flex flex-col gap-2">
                    {profiles.map((profile) => {
                        const isSelected = selectedId === profile.id;
                        return (
                            <div
                                key={profile.id}
                                onClick={() => setSelectedId(profile.id)}
                                className={`bg-main-bg rounded-[14px] p-4 cursor-pointer transition-all duration-150 ${isSelected ? 'border border-black/8 shadow-[rgba(0,0,0,0.4)_0px_0px_1px,rgba(0,0,0,0.06)_0px_2px_8px]' : 'border border-transparent shadow-(--shadow-ring)'}`}
                            >
                                {/* Mini sparkline */}
                                <Sparkline
                                    data={generateProfileCurve(profile.dropVal, profile.durationSec)}
                                    color={isSelected ? 'var(--color-primary)' : '#b3b0aa'}
                                />

                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-1.25 mb-0.5">
                                            <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                                {profile.name}
                                            </span>
                                            {profile.locked && (
                                                <Lock size={11} strokeWidth={2} color="var(--color-muted)" />
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
                <div className="bg-main-bg rounded-2xl px-8 py-7 shadow-(--shadow-ring)">
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
                        <div className="flex gap-1.5">
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
                    <div className="bg-surface rounded-xl px-4 pt-4 pb-2 mb-5 shadow-(--shadow-inset)">
                        <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                            Profile Curve
                        </div>
                        <ProfileCurveChart xs={curveXs} ys={curveYs} />
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
                            <div key={label} className="bg-surface rounded-[10px] px-3.5 py-3 shadow-(--shadow-inset)">
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
            </div>
        </div>
    );
};

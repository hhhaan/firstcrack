import { Plus, Copy, Pencil, Trash2, MoreHorizontal, Star, GitCompare, Check, AlertCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { type View } from '@shared/types/view';
import { PageLayout } from '@shared/ui/PageLayout';
import uPlot from 'uplot';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import {
    useRoastProfiles,
    useCreateRoastProfile,
    useUpdateRoastProfile,
    useDeleteRoastProfile,
    useRoastProfileCurve,
    useRoastProfileCurves,
    type RoastProfileWithSource,
} from '@entities/roast-profile';
import { useProfile, useUpdateProfile } from '@entities/profile';
import { useAuthStore } from '@shared/store/auth';
import { NewProfileModal } from './NewProfileModal';
import type { RoastProfile } from '@shared/types/database.types';

const COMPARE_COLORS = ['#171717', '#dc2626', '#0ea5e9', '#16a34a'] as const;

const fmtDuration = (sec: number | null): string => {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const resolveColor = (color: string): string => {
    if (!color.startsWith('var(')) return color;
    const name = color.slice(4, -1).trim();
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#171717';
};

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
    color: string;
    label: string;
}

const TABLE_ROWS: { label: string; getValue: (p: RoastProfileWithSource) => string }[] = [
    { label: 'Duration', getValue: (p) => fmtDuration(p.duration_sec) },
    { label: 'Drop Temp', getValue: (p) => p.drop_temp_celsius != null ? `${p.drop_temp_celsius}°C` : '—' },
    { label: 'Charge Temp', getValue: (p) => p.charge_temp_celsius != null ? `${p.charge_temp_celsius}°C` : '—' },
    { label: 'Dev Time', getValue: (p) => fmtDuration(p.dev_time_sec) },
    { label: 'Dev %', getValue: (p) => p.dev_pct != null ? `${p.dev_pct.toFixed(1)}%` : '—' },
    { label: 'Target Level', getValue: (p) => p.target_level },
];

const DefaultBadge = ({
    id,
    defaultId,
    onSetDefault,
}: {
    id: string;
    defaultId: string | null;
    onSetDefault: (id: string) => void;
}) => {
    if (defaultId === id) {
        return (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 ">
                <Star size={11} strokeWidth={2} fill="currentColor" className="text-amber-400" />
                <span className="text-[11px] font-medium text-amber-600 tracking-[0.3px]">Default</span>
            </div>
        );
    }
    return (
        <button
            onClick={() => onSetDefault(id)}
            title="Set as Default"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border-none bg-surface cursor-pointer  hover:bg-amber-50 transition-colors"
        >
            <Star size={11} strokeWidth={2} color="var(--color-muted)" />
            <span className="text-[11px] font-medium text-muted tracking-[0.3px]">Set Default</span>
        </button>
    );
};

const ProfileCurveChart = ({ series }: { series: SeriesData[] }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || series.length === 0) return;

        const cs = getComputedStyle(document.documentElement);
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        const maxT = Math.max(...series.map((s) => s.curve[s.curve.length - 1]?.t ?? 0));
        const xs: number[] = [];
        for (let t = 0; t <= maxT; t += 30) xs.push(t);

        const ysArrays = series.map((s) => {
            const map = new Map(s.curve.map((pt) => [pt.t, pt.bt]));
            return xs.map((t) => map.get(t) ?? null);
        });

        const isMulti = series.length > 1;
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
                init: [(u) => { u.root.style.position = 'relative'; u.root.appendChild(ttEl); }],
                setCursor: [
                    (u) => {
                        const { idx, left: cx, top: cy } = u.cursor;
                        if (idx == null || cx == null || cy == null) { ttEl.style.display = 'none'; return; }
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
            series: [{}, ...resolvedColors.map((c) => ({ stroke: c, width: 2, points: { show: false } }))],
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
    const user = useAuthStore((s) => s.user);
    const { data: profiles = [], isLoading } = useRoastProfiles(user?.id ?? '');
    const { mutateAsync: createProfile } = useCreateRoastProfile(user?.id ?? '');
    const { mutate: deleteProfile } = useDeleteRoastProfile(user?.id ?? '');
    const { data: userProfile } = useProfile(user?.id ?? '');
    const { mutate: updateProfile } = useUpdateProfile(user?.id ?? '');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [defaultId, setDefaultId] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState(false);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [showNewModal, setShowNewModal] = useState(false);
    const [editingProfile, setEditingProfile] = useState<RoastProfileWithSource | null>(null);

    // 프로파일 목록이 처음 로드됐을 때 첫 번째 항목을 자동 선택.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => {
        if (profiles.length > 0 && !selectedId) {
            setSelectedId(profiles[0].id);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profiles.length, selectedId]);

    // DB에서 userProfile이 로드되면 defaultId를 동기화.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => {
        if (userProfile !== undefined) {
            setDefaultId(userProfile?.default_roast_profile_id ?? null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile?.default_roast_profile_id]);

    const selected = profiles.find((p) => p.id === selectedId) ?? null;

    // Sparkline은 항상 합성 곡선(R2 fetch 회피, 리스트 진입 비용 절감).
    const syntheticCurve = (p: RoastProfileWithSource) =>
        generateProfileCurve(p.drop_temp_celsius ?? 200, p.duration_sec ?? 720);

    // 단일 상세: selected의 source_session.tsv_path가 있을 때만 R2에서 실측 fetch.
    const selectedTsvPath = selected?.source_session?.tsv_path ?? null;
    const { data: selectedRealCurve = [] } = useRoastProfileCurve(selectedTsvPath);
    const selectedHasReal = selectedRealCurve.length > 0;

    const setDefault = (id: string) => {
        setDefaultId(id);
        updateProfile({ default_roast_profile_id: id });
    };

    const enterCompareMode = () => {
        setCompareMode(true);
        if (selectedId) setCompareIds([selectedId]);
    };

    const exitCompareMode = () => {
        setCompareMode(false);
        setCompareIds([]);
    };

    const toggleCompareId = (id: string) => {
        setCompareIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id],
        );
    };

    const handleProfileClick = (id: string, shiftKey: boolean) => {
        if (compareMode) { toggleCompareId(id); return; }
        if (shiftKey && id !== selectedId) {
            setCompareMode(true);
            setCompareIds([selectedId ?? id, id]);
            return;
        }
        setSelectedId(id);
    };

    const handleCreated = async (profileData: RoastProfile) => {
        const { id: _ignoreId, created_at: _ignoreCa, updated_at: _ignoreUa, ...insert } = profileData;
        const created = await createProfile(insert);
        setSelectedId(created.id);
    };

    const handleDelete = (id: string) => {
        deleteProfile(id);
        if (id === defaultId) {
            setDefaultId(null);
            updateProfile({ default_roast_profile_id: null });
        }
        if (selectedId === id) setSelectedId(profiles.find((p) => p.id !== id)?.id ?? null);
    };

    const primaryId = compareMode ? (compareIds[0] ?? selectedId ?? '') : selectedId ?? '';
    const compareProfiles = compareMode
        ? (compareIds.map((id) => profiles.find((p) => p.id === id)).filter(Boolean) as RoastProfileWithSource[])
        : [];

    // 비교 모드: 각 프로파일의 실측 곡선을 독립적으로 fetch.
    const compareCurveQueries = useRoastProfileCurves(
        compareProfiles.map((p) => p.source_session?.tsv_path),
        compareProfiles.map((p) => p.id),
    );

    const chartSeries: SeriesData[] = compareProfiles.map((p, i) => {
        const real = compareCurveQueries[i]?.data ?? [];
        const curve = real.length > 0
            ? real.map((pt) => ({ t: pt.t, bt: pt.bt }))
            : syntheticCurve(p);
        return { curve, color: COMPARE_COLORS[i], label: p.name };
    });

    // chartKey에 데이터 길이를 포함 — 비동기 fetch 완료 시 ProfileCurveChart remount.
    const chartKey = compareMode
        ? `${compareIds.join(',')}|${compareCurveQueries.map((q) => q.data?.length ?? 0).join(',')}`
        : `${selectedId ?? ''}|${selectedRealCurve.length}`;

    if (isLoading) {
        return (
            <PageLayout>
                <div className="flex items-center justify-center h-64 text-sm text-muted">Loading…</div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <div className="flex items-end justify-between mb-7">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        Roast Profiles
                    </h1>
                    <p className="text-sm text-muted tracking-[0.14px]">
                        {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="flex gap-2 items-center">
                    {profiles.length > 1 && (
                        <button
                            onClick={compareMode ? exitCompareMode : enterCompareMode}
                            className={`flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none text-sm font-medium cursor-pointer tracking-[0.14px] transition-colors ${
                                compareMode
                                    ? 'bg-primary text-white '
                                    : 'bg-surface text-secondary  hover:text-primary'
                            }`}
                        >
                            <GitCompare size={14} strokeWidth={2} />
                            {compareMode ? '비교 모드 종료' : '비교하기'}
                        </button>
                    )}
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer  tracking-[0.14px]"
                    >
                        <Plus size={15} strokeWidth={2.5} />
                        New Profile
                    </button>
                </div>
            </div>

            {profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-24 rounded-lg bg-main-bg">
                    <p className="text-sm text-muted tracking-[0.14px]">아직 프로파일이 없습니다.</p>
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer  tracking-[0.14px]"
                    >
                        <Plus size={14} strokeWidth={2.5} />
                        첫 프로파일 만들기
                    </button>
                </div>
            ) : (
                <div className="grid gap-5" style={{ gridTemplateColumns: '350px 1fr' }}>
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
                                    className={`bg-main-bg rounded-lg p-4 transition-all duration-150 border ${atCapacity ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${isSelected || isCompareSelected ? 'border-black/8' : 'border-[#E5E5E5]'}`}
                                >
                                    {compareMode && (
                                        <div className="flex justify-end -mt-1 mb-1">
                                            <div
                                                className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${isCompareSelected ? 'text-white' : 'bg-surface '}`}
                                                style={isCompareSelected ? { backgroundColor: COMPARE_COLORS[compareIdx] } : undefined}
                                            >
                                                {isCompareSelected && <Check size={9} strokeWidth={3} />}
                                            </div>
                                        </div>
                                    )}

                                    <Sparkline data={syntheticCurve(profile)} color={sparkColor} />

                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="flex items-center gap-1.25 mb-0.5">
                                                <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                                    {profile.name}
                                                </span>
                                                {defaultId === profile.id && (
                                                    <Star size={11} strokeWidth={2} fill="currentColor" className="text-amber-400" />
                                                )}
                                            </div>
                                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                                {profile.drop_temp_celsius != null ? `Drop ${profile.drop_temp_celsius}°C` : profile.target_level}
                                                {profile.duration_sec != null && ` · ${fmtDuration(profile.duration_sec)}`}
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
                            <div className="bg-main-bg rounded-lg px-8 py-7 border border-[#E5E5E5] flex flex-col items-center justify-center gap-3 min-h-[320px]">
                                <GitCompare size={32} strokeWidth={1.5} color="var(--color-muted)" />
                                <p className="text-sm text-muted tracking-[0.14px]">좌측 리스트에서 프로파일을 선택하세요</p>
                            </div>
                        ) : (
                            <div className="bg-main-bg rounded-lg px-8 py-7 border border-[#E5E5E5]">
                                <div className="flex items-center justify-between mb-5">
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface ">
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
                                            className="w-8 h-8 rounded-lg border-none bg-surface/50 flex items-center justify-center cursor-not-allowed opacity-35 "
                                        >
                                            <Pencil size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                        </button>
                                        <button
                                            title="More"
                                            className="w-8 h-8 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer "
                                        >
                                            <MoreHorizontal size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-surface rounded-lg px-4 pt-4 pb-2 mb-3 ">
                                    <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase mb-2">Curve Overlay</div>
                                    <ProfileCurveChart key={chartKey} series={chartSeries} />
                                </div>

                                <div className="flex flex-wrap gap-2 mb-5">
                                    {compareProfiles.map((p, i) => {
                                        const hasReal = (compareCurveQueries[i]?.data?.length ?? 0) > 0;
                                        return (
                                            <div key={p.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface ">
                                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COMPARE_COLORS[i] }} />
                                                <span className="text-[12px] font-medium text-secondary tracking-[0.14px]">{p.name}</span>
                                                {!hasReal && (
                                                    <span title="기록된 데이터 없음 · 참고용 곡선" className="flex items-center">
                                                        <AlertCircle size={10} strokeWidth={2} className="text-amber-500" />
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="bg-surface rounded-lg  overflow-hidden mb-5">
                                    <div className="grid" style={{ gridTemplateColumns: `140px repeat(${compareProfiles.length}, 1fr)` }}>
                                        <div className="px-3.5 py-2.5 border-b border-black/5" />
                                        {compareProfiles.map((p, i) => (
                                            <div key={p.id} className="px-3.5 py-2.5 border-b border-black/5 border-l border-l-black/5">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COMPARE_COLORS[i] }} />
                                                    <span className="text-[11px] font-semibold text-primary tracking-[0.14px] truncate">{p.name}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {TABLE_ROWS.flatMap(({ label, getValue }, rowIdx) => [
                                            <div key={`lbl-${label}`} className={`px-3.5 py-2.5 ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5' : ''}`}>
                                                <span className="text-[11px] font-medium text-muted tracking-[0.4px] uppercase">{label}</span>
                                            </div>,
                                            ...compareProfiles.map((p) => (
                                                <div key={`${p.id}-${label}`} className={`px-3.5 py-2.5 border-l border-l-black/5 ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5' : ''}`}>
                                                    <span className="text-[12px] font-semibold text-primary font-mono tracking-[-0.2px]">{getValue(p)}</span>
                                                </div>
                                            )),
                                        ])}
                                    </div>
                                </div>
                            </div>
                        )
                    ) : selected ? (
                        <div className="bg-main-bg rounded-lg px-8 py-7 border border-[#E5E5E5]">
                            <div className="flex items-start justify-between mb-5">
                                <div>
                                    <h2 className="font-display font-light text-[26px] leading-[1.2] text-primary tracking-[-0.3px] mb-1">
                                        {selected.name}
                                    </h2>
                                    {selected.description && (
                                        <p className="text-sm text-secondary tracking-[0.14px] leading-normal">{selected.description}</p>
                                    )}
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
                                            className="w-8 h-8 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer "
                                        >
                                            <Icon size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-surface rounded-lg px-4 pt-4 pb-2 mb-5 ">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase">Profile Curve</div>
                                    {!selectedHasReal && (
                                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50">
                                            <AlertCircle size={10} strokeWidth={2} className="text-amber-500" />
                                            <span className="text-[10px] font-medium text-amber-700 tracking-[0.2px]">
                                                기록된 데이터 없음 · 참고용 곡선
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <ProfileCurveChart
                                    key={chartKey}
                                    series={[{
                                        curve: selectedHasReal
                                            ? selectedRealCurve.map((pt) => ({ t: pt.t, bt: pt.bt }))
                                            : syntheticCurve(selected),
                                        color: 'var(--color-primary)',
                                        label: selected.name,
                                    }]}
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-3 mb-5">
                                {[
                                    { label: 'Total Duration', value: fmtDuration(selected.duration_sec) },
                                    { label: 'Drop Temperature', value: selected.drop_temp_celsius != null ? `${selected.drop_temp_celsius}°C` : '—' },
                                    { label: 'Charge Temperature', value: selected.charge_temp_celsius != null ? `${selected.charge_temp_celsius}°C` : '—' },
                                    { label: 'Development Time', value: fmtDuration(selected.dev_time_sec) },
                                    { label: 'Dev/Total %', value: selected.dev_pct != null ? `${selected.dev_pct.toFixed(1)}%` : '—' },
                                    { label: 'Target Level', value: selected.target_level },
                                ].map(({ label, value }) => (
                                    <div key={label} className="bg-surface rounded-lg px-3.5 py-3 ">
                                        <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-1">{label}</div>
                                        <div className="text-sm font-semibold text-primary font-mono tracking-[-0.2px]">{value}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2.5">
                                <button
                                    onClick={() => onNavigate('roast')}
                                    className="flex-1 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px] "
                                >
                                    Start with this Profile
                                </button>
                                <button
                                    onClick={() => handleDelete(selected.id)}
                                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-full border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-medium cursor-pointer tracking-[0.14px] "
                                >
                                    <Trash2 size={14} strokeWidth={2} />
                                    Delete
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            )}

            <NewProfileModal
                open={showNewModal}
                onClose={() => setShowNewModal(false)}
                onCreated={handleCreated}
            />
        </PageLayout>
    );
};

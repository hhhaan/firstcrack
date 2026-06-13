import { useState, useEffect, useRef } from 'react';
import { X, Plus, History, Pencil, ChevronRight, Check, ChevronDown } from 'lucide-react';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { useRoastSessions } from '@entities/roast';
import { useAuthStore } from '@shared/store/auth';
import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import type { RoastProfile } from '@shared/types/database.types';
import type { RoastProfileWithSource } from '@entities/roast-profile';

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

type Mode = 'pick' | 'manual' | 'from-session' | 'session-list';

interface FormState {
    name: string;
    description: string;
    target_level: string;
    charge_temp_celsius: string;
    drop_temp_celsius: string;
    duration_sec: string;
    dev_time_sec: string;
    dev_pct: string;
}

const INITIAL_FORM: FormState = {
    name: '',
    description: '',
    target_level: 'Medium',
    charge_temp_celsius: '200',
    drop_temp_celsius: '200',
    duration_sec: '720',
    dev_time_sec: '90',
    dev_pct: '13',
};

const fmtDuration = (sec: number | null): string => {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const fmtDate = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(0, 10);
};

interface NewProfileModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: (profile: RoastProfile) => void;
    editingProfile?: RoastProfileWithSource | null;
    onUpdated?: (profile: RoastProfile) => void;
}

export const NewProfileModal = ({ open, onClose, onCreated, editingProfile, onUpdated }: NewProfileModalProps) => {
    const [mode, setMode] = useState<Mode>('pick');
    const [form, setForm] = useState<FormState>(INITIAL_FORM);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [defaultType, setDefaultType] = useState<'bean' | 'blend' | 'none'>('none');
    const [defaultBeanId, setDefaultBeanId] = useState<string | null>(null);
    const [defaultBlendId, setDefaultBlendId] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    const user = useAuthStore((s) => s.user);
    const { data: sessions = [] } = useRoastSessions(user?.id ?? '', 'completed');
    const { data: beans = [] } = useBeans(user?.id ?? '');
    const { data: blends = [] } = useBlends(user?.id ?? '');

    // Derive initial state from props during render to avoid stale UI commits
    const [prevOpen, setPrevOpen] = useState(open);
    const [prevEditingProfile, setPrevEditingProfile] = useState(editingProfile);
    if (open && (open !== prevOpen || editingProfile !== prevEditingProfile)) {
        setPrevOpen(open);
        setPrevEditingProfile(editingProfile);
        if (editingProfile) {
            setMode('manual');
            setForm({
                name: editingProfile.name ?? '',
                description: editingProfile.description ?? '',
                target_level: editingProfile.target_level ?? 'Medium',
                charge_temp_celsius: editingProfile.charge_temp_celsius != null ? String(editingProfile.charge_temp_celsius) : '',
                drop_temp_celsius: editingProfile.drop_temp_celsius != null ? String(editingProfile.drop_temp_celsius) : '',
                duration_sec: editingProfile.duration_sec != null ? String(editingProfile.duration_sec) : '',
                dev_time_sec: editingProfile.dev_time_sec != null ? String(editingProfile.dev_time_sec) : '',
                dev_pct: editingProfile.dev_pct != null ? String(editingProfile.dev_pct) : '',
            });
            setSelectedSessionId(editingProfile.source_session_id ?? null);
            setDefaultType(editingProfile.default_bean_id ? 'bean' : editingProfile.default_blend_id ? 'blend' : 'none');
            setDefaultBeanId(editingProfile.default_bean_id ?? null);
            setDefaultBlendId(editingProfile.default_blend_id ?? null);
        } else {
            setMode('pick');
            setForm(INITIAL_FORM);
            setSelectedSessionId(null);
            setDefaultType('none');
            setDefaultBeanId(null);
            setDefaultBlendId(null);
        }
    }

    useEffect(() => {
        if (!open) return undefined;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    useEffect(() => {
        if (mode === 'manual' || mode === 'from-session') {
            const id = setTimeout(() => nameRef.current?.focus(), 50);
            return () => clearTimeout(id);
        }
    }, [mode]);

    if (!open) return null;

    const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm((prev) => ({ ...prev, [field]: e.target.value }));

    const handleSessionSelect = (sessionId: string) => {
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) return;
        setSelectedSessionId(sessionId);

        const beanName = session.beans?.name ?? '';
        const date = fmtDate(session.roasted_at);
        setForm({
            name: beanName ? `${beanName} ${date}` : date,
            description: '',
            target_level: session.roast_level ?? 'Medium',
            charge_temp_celsius: '200',
            drop_temp_celsius: session.drop_temp_celsius != null ? String(session.drop_temp_celsius) : '200',
            duration_sec: session.duration_seconds != null ? String(session.duration_seconds) : '720',
            dev_time_sec: '90',
            dev_pct: '13',
        });
        setMode('from-session');
    };

    const isValid = form.name.trim().length > 0;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid || !user) return;

        if (editingProfile) {
            const patch: Partial<Omit<RoastProfile, 'id' | 'created_at' | 'updated_at' | 'user_id'>> = {
                name: form.name.trim(),
                description: form.description.trim() || null,
                target_level: form.target_level,
                charge_temp_celsius: Number(form.charge_temp_celsius) || null,
                drop_temp_celsius: Number(form.drop_temp_celsius) || null,
                duration_sec: Number(form.duration_sec) || null,
                dev_time_sec: Number(form.dev_time_sec) || null,
                dev_pct: Number(form.dev_pct) || null,
                default_bean_id: defaultType === 'bean' ? defaultBeanId : null,
                default_blend_id: defaultType === 'blend' ? defaultBlendId : null,
            };
            onUpdated?.({ id: editingProfile.id, ...patch } as RoastProfile);
        } else {
            const profile: Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'> = {
                user_id: user.id,
                name: form.name.trim(),
                description: form.description.trim() || null,
                target_level: form.target_level,
                charge_temp_celsius: Number(form.charge_temp_celsius) || null,
                drop_temp_celsius: Number(form.drop_temp_celsius) || null,
                duration_sec: Number(form.duration_sec) || null,
                dev_time_sec: Number(form.dev_time_sec) || null,
                dev_pct: Number(form.dev_pct) || null,
                source_session_id: mode === 'from-session' ? selectedSessionId : null,
                default_bean_id: defaultType === 'bean' ? defaultBeanId : null,
                default_blend_id: defaultType === 'blend' ? defaultBlendId : null,
            };

            onCreated(profile as RoastProfile);
        }
        onClose();
    };

    const renderForm = () => (
        <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between px-7 pt-6 pb-5 border-b border-black/6">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMode('pick')}
                        className="w-6 h-6 rounded-md border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset) hover:bg-gray-100 transition-colors"
                    >
                        <ChevronRight size={12} strokeWidth={2} color="var(--color-muted)" className="rotate-180" />
                    </button>
                    <h2 id="new-profile-modal-title" className="text-[15px] font-semibold text-primary tracking-[-0.2px] m-0">
                        {editingProfile ? 'Edit Roast Profile' : mode === 'from-session' ? 'Profile from Session' : 'New Roast Profile'}
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-7 h-7 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset) hover:bg-gray-100 transition-colors"
                >
                    <X size={14} strokeWidth={2} color="var(--color-secondary)" />
                </button>
            </div>

            <div className="px-7 py-5 flex flex-col gap-4">
                {mode === 'from-session' && selectedSessionId && (() => {
                    const session = sessions.find((s) => s.id === selectedSessionId);
                    return session ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface shadow-(--shadow-inset) text-[12px] text-secondary">
                            <History size={12} strokeWidth={2} className="text-muted flex-shrink-0" />
                            <span>
                                Based on <span className="font-medium text-primary">{session.beans?.name ?? 'Unknown bean'}</span>
                                {' · '}{fmtDate(session.roasted_at)}
                                {session.duration_seconds != null && ` · ${fmtDuration(session.duration_seconds)}`}
                            </span>
                        </div>
                    ) : null;
                })()}

                <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                        Profile Name <span className="text-red-400">*</span>
                    </label>
                    <input
                        ref={nameRef}
                        type="text"
                        value={form.name}
                        onChange={set('name')}
                        placeholder="e.g. Light Floral"
                        className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary placeholder-muted shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors"
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                        Description
                    </label>
                    <textarea
                        value={form.description}
                        onChange={set('description')}
                        placeholder="Short description…"
                        rows={2}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary placeholder-muted shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors resize-none"
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                        Target Roast Level
                    </label>
                    <div className="relative">
                        <select
                            value={form.target_level}
                            onChange={set('target_level')}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors appearance-none cursor-pointer"
                            style={{ paddingRight: '2rem' }}
                        >
                            {ROAST_LEVELS.map((l) => (
                                <option key={l} value={l}>{l}</option>
                            ))}
                        </select>
                        <ChevronDown
                            size={16}
                            strokeWidth={2}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                            Charge Temp (°C)
                        </label>
                        <input
                            type="number"
                            value={form.charge_temp_celsius}
                            onChange={set('charge_temp_celsius')}
                            min={150} max={280}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary font-mono shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                            Drop Temp (°C)
                        </label>
                        <input
                            type="number"
                            value={form.drop_temp_celsius}
                            onChange={set('drop_temp_celsius')}
                            min={150} max={280}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary font-mono shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                            Duration (sec)
                        </label>
                        <input
                            type="number"
                            value={form.duration_sec}
                            onChange={set('duration_sec')}
                            min={300} max={1800}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary font-mono shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                            Dev Time (sec)
                        </label>
                        <input
                            type="number"
                            value={form.dev_time_sec}
                            onChange={set('dev_time_sec')}
                            min={0} max={600}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary font-mono shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                            Dev %
                        </label>
                        <input
                            type="number"
                            value={form.dev_pct}
                            onChange={set('dev_pct')}
                            min={0} max={100} step={0.1}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary font-mono shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors"
                        />
                    </div>
                </div>

                {/* 기본 생두/블렌드 */}
                <div className="flex flex-col gap-3 pt-2 border-t border-black/6">
                    <label className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">기본 생두 (선택)</label>
                    <div className="flex gap-2">
                        {([['none', '없음'], ['bean', '싱글'], ['blend', '블렌드']] as const).map(([t, label]) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setDefaultType(t)}
                                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                                    defaultType === t
                                        ? 'bg-primary text-white border-primary'
                                        : 'bg-surface text-secondary border-border hover:border-black/15'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {defaultType === 'bean' && (
                        <div className="relative">
                            <select
                                value={defaultBeanId ?? ''}
                                onChange={(e) => setDefaultBeanId(e.target.value || null)}
                                className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors appearance-none cursor-pointer"
                                style={{ paddingRight: '2rem' }}
                            >
                                <option value="">생두 선택</option>
                                {beans.map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                            <ChevronDown
                                size={16}
                                strokeWidth={2}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                            />
                        </div>
                    )}
                    {defaultType === 'blend' && (
                        <div className="relative">
                            <select
                                value={defaultBlendId ?? ''}
                                onChange={(e) => setDefaultBlendId(e.target.value || null)}
                                className="w-full px-3.5 py-2.5 rounded-lg border border-black/10 bg-surface text-sm text-primary shadow-(--shadow-inset) outline-none focus:border-black/25 transition-colors appearance-none cursor-pointer"
                                style={{ paddingRight: '2rem' }}
                            >
                                <option value="">블렌드 선택</option>
                                {blends.map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                            <ChevronDown
                                size={16}
                                strokeWidth={2}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-7 pb-6 pt-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-2.5 rounded-full border-none bg-surface text-sm font-medium text-secondary cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors tracking-[0.14px]"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={!isValid}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer shadow-(--shadow-card) tracking-[0.14px] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                    {editingProfile ? (
                        <><Check size={14} strokeWidth={2.5} /> Save Profile</>
                    ) : (
                        <><Plus size={14} strokeWidth={2.5} /> Create Profile</>
                    )}
                </button>
            </div>
        </form>
    );

    const renderSessionPicker = () => (
        <div>
            <div className="flex items-center justify-between px-7 pt-6 pb-5 border-b border-black/6">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMode('pick')}
                        className="w-6 h-6 rounded-md border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset) hover:bg-gray-100 transition-colors"
                    >
                        <ChevronRight size={12} strokeWidth={2} color="var(--color-muted)" className="rotate-180" />
                    </button>
                    <h2 className="text-[15px] font-semibold text-primary tracking-[-0.2px] m-0">
                        Select Roast Session
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-7 h-7 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset) hover:bg-gray-100 transition-colors"
                >
                    <X size={14} strokeWidth={2} color="var(--color-secondary)" />
                </button>
            </div>
            <div className="px-7 py-4 max-h-[360px] overflow-y-auto flex flex-col gap-2">
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted text-center py-8">완료된 로스팅 세션이 없습니다.</p>
                ) : (
                    sessions.map((session) => (
                        <button
                            key={session.id}
                            type="button"
                            onClick={() => handleSessionSelect(session.id)}
                            className="flex items-center justify-between w-full px-4 py-3 rounded-lg border-none bg-surface text-left cursor-pointer shadow-(--shadow-inset) hover:bg-surface-warm-solid transition-colors group"
                        >
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                    {session.beans?.name ?? 'Unknown bean'}
                                </span>
                                <span className="text-[11px] text-muted">
                                    {fmtDate(session.roasted_at)}
                                    {session.drop_temp_celsius != null && ` · Drop ${session.drop_temp_celsius}°C`}
                                    {session.duration_seconds != null && ` · ${fmtDuration(session.duration_seconds)}`}
                                    {session.roast_level && ` · ${session.roast_level}`}
                                </span>
                            </div>
                            <ChevronRight size={14} strokeWidth={2} color="var(--color-muted)" className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                    ))
                )}
            </div>
        </div>
    );

    const renderPicker = () => (
        <div>
            <div className="flex items-center justify-between px-7 pt-6 pb-5 border-b border-black/6">
                    <h2 id="new-profile-modal-title" className="text-[15px] font-semibold text-primary tracking-[-0.2px] m-0">
                        {editingProfile ? 'Edit Roast Profile' : 'New Roast Profile'}
                    </h2>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-7 h-7 rounded-lg border-none bg-surface flex items-center justify-center cursor-pointer shadow-(--shadow-inset) hover:bg-gray-100 transition-colors"
                >
                    <X size={14} strokeWidth={2} color="var(--color-secondary)" />
                </button>
            </div>

            <div className="px-7 py-6 flex flex-col gap-3">
                <p className="text-[13px] text-secondary tracking-[0.14px] mb-1">
                    프로파일을 어떻게 만들까요?
                </p>

                <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 bg-main-bg cursor-pointer shadow-(--shadow-ring) hover:shadow-[rgba(0,0,0,0.4)_0px_0px_1px,rgba(0,0,0,0.06)_0px_2px_8px] transition-all text-left group"
                >
                    <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                        <Pencil size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                    </div>
                    <div>
                        <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                            직접 입력
                        </div>
                        <div className="text-[12px] text-muted tracking-[0.14px]">
                            Charge temp, Drop temp, Duration 등 직접 설정
                        </div>
                    </div>
                    <ChevronRight size={16} strokeWidth={2} color="var(--color-muted)" className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                <button
                    type="button"
                    onClick={() => setMode('session-list')}
                    className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 bg-main-bg cursor-pointer shadow-(--shadow-ring) hover:shadow-[rgba(0,0,0,0.4)_0px_0px_1px,rgba(0,0,0,0.06)_0px_2px_8px] transition-all text-left group"
                >
                    <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                        <History size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                    </div>
                    <div>
                        <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                            로스팅 기록에서 불러오기
                        </div>
                        <div className="text-[12px] text-muted tracking-[0.14px]">
                            과거 로스팅 세션 기준으로 파라미터 자동 완성
                        </div>
                    </div>
                    <ChevronRight size={16} strokeWidth={2} color="var(--color-muted)" className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
            </div>

            <div className="px-7 pb-6 pt-1 flex justify-end">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-2.5 rounded-full border-none bg-surface text-sm font-medium text-secondary cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors tracking-[0.14px]"
                >
                    Cancel
                </button>
            </div>
        </div>
    );

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="new-profile-modal-title"
            contentClassName="w-full max-w-[520px] bg-white rounded-2xl shadow-2xl border border-black/8 overflow-hidden"
        >
            {mode === 'pick' && !editingProfile && renderPicker()}
            {mode === 'session-list' && !editingProfile && renderSessionPicker()}
            {(mode === 'manual' || mode === 'from-session') && renderForm()}
        </ModalShell>
    );
};

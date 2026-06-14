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

// ── 공통 입력 필드 ───────────────────────────────────────────

const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';
const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';

const chipCls = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150 border ${
        selected ? 'border-primary bg-primary text-white' : 'border-black/10 bg-white/70 text-secondary'
    }`;

const NUMERIC_INPUT_PROPS = {
    type: 'text' as const,
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
} satisfies Partial<React.InputHTMLAttributes<HTMLInputElement>>;

const handleNumericBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ev = e.nativeEvent as InputEvent;
    if (ev.data && !/^\d*$/.test(ev.data)) e.preventDefault();
};

const handleNumericPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!/^\d+$/.test(e.clipboardData.getData('text/plain'))) e.preventDefault();
};

const numericProps = {
    ...NUMERIC_INPUT_PROPS,
    onBeforeInput: handleNumericBeforeInput,
    onPaste: handleNumericPaste,
};

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
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div className="shrink-0 bg-white/60 backdrop-blur-sm z-10 border-b border-black/4">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <button
                            type="button"
                            onClick={() => setMode('pick')}
                            className="w-8 h-8 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                        <h2
                            id="new-profile-modal-title"
                            className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                        >
                            {editingProfile
                                ? 'Edit Roast Profile'
                                : mode === 'from-session'
                                  ? 'Profile from Session'
                                  : 'New Roast Profile'}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>

                {mode === 'from-session' && selectedSessionId && (
                    (() => {
                        const session = sessions.find((s) => s.id === selectedSessionId);
                        return session ? (
                            <div className="px-8 pb-4">
                                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface/60 text-[12px] text-secondary shadow-(--shadow-inset)">
                                    <History size={14} strokeWidth={2} className="text-muted flex-shrink-0" />
                                    <span>
                                        Based on{' '}
                                        <span className="font-medium text-primary">{session.beans?.name ?? 'Unknown bean'}</span>
                                        {' · '}{fmtDate(session.roasted_at)}
                                        {session.duration_seconds != null && ` · ${fmtDuration(session.duration_seconds)}`}
                                    </span>
                                </div>
                            </div>
                        ) : null;
                    })()
                )}
            </div>

            {/* Scrollable Body */}
            <div className="px-8 py-6 overflow-y-auto flex-1">
                <div className="flex flex-col gap-6">
                    {/* Profile Name */}
                    <div>
                        <label className={labelCls}>
                            Profile Name <span className="text-red-400">*</span>
                        </label>
                        <input
                            ref={nameRef}
                            type="text"
                            value={form.name}
                            onChange={set('name')}
                            placeholder="e.g. Light Floral"
                            className={inputCls}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className={labelCls}>Description</label>
                        <textarea
                            value={form.description}
                            onChange={set('description')}
                            placeholder="Short description…"
                            rows={2}
                            className={`${inputCls} min-h-[56px] resize-none`}
                        />
                    </div>

                    {/* Target Roast Level */}
                    <div>
                        <label className={labelCls}>Target Roast Level</label>
                        <div className="relative">
                            <select
                                value={form.target_level}
                                onChange={set('target_level')}
                                className="w-full px-3.5 py-3 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all appearance-none cursor-pointer"
                                style={{ paddingRight: '2.5rem' }}
                            >
                                {ROAST_LEVELS.map((l) => (
                                    <option key={l} value={l}>
                                        {l}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown
                                size={16}
                                strokeWidth={2.5}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                            />
                        </div>
                    </div>

                    {/* Charge Temp / Drop Temp */}
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className={labelCls}>Charge Temp (°C)</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="e.g. 200"
                                value={form.charge_temp_celsius}
                                onChange={set('charge_temp_celsius')}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Drop Temp (°C)</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="e.g. 200"
                                value={form.drop_temp_celsius}
                                onChange={set('drop_temp_celsius')}
                            />
                        </div>
                    </div>

                    {/* Duration / Dev Time / Dev % */}
                    <div className="grid grid-cols-3 gap-6">
                        <div>
                            <label className={labelCls}>Duration (sec)</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="e.g. 720"
                                value={form.duration_sec}
                                onChange={set('duration_sec')}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Dev Time (sec)</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="e.g. 90"
                                value={form.dev_time_sec}
                                onChange={set('dev_time_sec')}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Dev %</label>
                            <input
                                type="number"
                                className={inputCls}
                                placeholder="e.g. 13"
                                value={form.dev_pct}
                                onChange={set('dev_pct')}
                                min={0} max={100} step={0.1}
                            />
                        </div>
                    </div>

                    {/* Default Bean / Blend */}
                    <div className="border-t border-black/4 pt-6">
                        <label className={labelCls}>기본 생두 (선택)</label>
                        <div className="flex gap-2 mt-2">
                            {([['none', '없음'], ['bean', '싱글'], ['blend', '블렌드']] as const).map(([t, label]) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setDefaultType(t)}
                                    className={chipCls(defaultType === t)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {defaultType === 'bean' && (
                            <div className="relative mt-3">
                                <select
                                    value={defaultBeanId ?? ''}
                                    onChange={(e) => setDefaultBeanId(e.target.value || null)}
                                    className="w-full px-3.5 py-3 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all appearance-none cursor-pointer"
                                    style={{ paddingRight: '2.5rem' }}
                                >
                                    <option value="">생두 선택</option>
                                    {beans.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown
                                    size={16}
                                    strokeWidth={2.5}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                                />
                            </div>
                        )}
                        {defaultType === 'blend' && (
                            <div className="relative mt-3">
                                <select
                                    value={defaultBlendId ?? ''}
                                    onChange={(e) => setDefaultBlendId(e.target.value || null)}
                                    className="w-full px-3.5 py-3 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all appearance-none cursor-pointer"
                                    style={{ paddingRight: '2.5rem' }}
                                >
                                    <option value="">블렌드 선택</option>
                                    {blends.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown
                                    size={16}
                                    strokeWidth={2.5}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="px-8 pt-5 pb-8 bg-white/80 backdrop-blur-sm border-t border-black/4 shrink-0">
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface text-secondary text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-primary text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {editingProfile ? (
                            <>
                                <Check size={16} strokeWidth={2.5} /> Save Profile
                            </>
                        ) : (
                            <>
                                <Plus size={16} strokeWidth={2.5} /> Create Profile
                            </>
                        )}
                    </button>
                </div>
            </div>
        </form>
    );

    const renderSessionPicker = () => (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div className="shrink-0 bg-white/60 backdrop-blur-sm z-10 border-b border-black/4">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <button
                            type="button"
                            onClick={() => setMode('pick')}
                            className="w-8 h-8 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                        <h2 className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0">
                            Select Roast Session
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Scrollable Body */}
            <div className="px-8 py-6 overflow-y-auto flex-1">
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted text-center py-8">완료된 로스팅 세션이 없습니다.</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {sessions.map((session) => (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => handleSessionSelect(session.id)}
                                className="w-full px-4 py-3 rounded-xl border border-black/6 bg-white/70 text-left cursor-pointer hover:bg-white/90 transition-all duration-200 group"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-sm font-semibold text-primary">
                                            {session.beans?.name ?? 'Unknown bean'}
                                        </span>
                                        <span className="text-[12px] text-muted">
                                            {fmtDate(session.roasted_at)}
                                            {session.drop_temp_celsius != null && ` · Drop ${session.drop_temp_celsius}°C`}
                                            {session.duration_seconds != null &&
                                                ` · ${fmtDuration(session.duration_seconds)}`}
                                            {session.roast_level && ` · ${session.roast_level}`}
                                        </span>
                                    </div>
                                    <ChevronRight
                                        size={16}
                                        strokeWidth={2}
                                        className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                                    />
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-8 pt-5 pb-8 bg-white/80 backdrop-blur-sm border-t border-black/4 shrink-0">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl border-none bg-surface text-secondary text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                >
                    Cancel
                </button>
            </div>
        </div>
    );

    const renderPicker = () => (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div className="shrink-0 bg-white/60 backdrop-blur-sm z-10 border-b border-black/4">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <h2
                        id="new-profile-modal-title"
                        className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                    >
                        New Roast Profile
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Scrollable Body */}
            <div className="px-8 py-6 overflow-y-auto flex-1">
                <p className="text-sm text-secondary tracking-[0.14px] mb-4">
                    프로파일을 어떻게 만들까요?
                </p>

                <div className="flex flex-col gap-4">
                    {/* Option: Manual Input */}
                    <button
                        type="button"
                        onClick={() => setMode('manual')}
                        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 bg-white/70 cursor-pointer hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all text-left group"
                    >
                        <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                            <Pencil size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                                직접 입력
                            </div>
                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                Charge temp, Drop temp, Duration 등 직접 설정
                            </div>
                        </div>
                        <ChevronRight
                            size={16}
                            strokeWidth={2}
                            className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                    </button>

                    {/* Option: From Session */}
                    <button
                        type="button"
                        onClick={() => setMode('session-list')}
                        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 bg-white/70 cursor-pointer hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all text-left group"
                    >
                        <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                            <History size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                                로스팅 기록에서 불러오기
                            </div>
                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                과거 로스팅 세션 기준으로 파라미터 자동 완성
                            </div>
                        </div>
                        <ChevronRight
                            size={16}
                            strokeWidth={2}
                            className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                    </button>
                </div>
            </div>

            {/* Footer */}
            <div className="px-8 pt-5 pb-8 bg-white/80 backdrop-blur-sm border-t border-black/4 shrink-0">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl border-none bg-surface text-secondary text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
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
            contentClassName="max-w-[640px] w-full max-h-[min(860px,calc(100vh-64px))] flex flex-col rounded-[28px] bg-[rgba(255,255,255,0.96)] backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white overflow-hidden"
        >
            {mode === 'pick' && !editingProfile && renderPicker()}
            {mode === 'session-list' && !editingProfile && renderSessionPicker()}
            {(mode === 'manual' || mode === 'from-session') && renderForm()}
        </ModalShell>
    );
};

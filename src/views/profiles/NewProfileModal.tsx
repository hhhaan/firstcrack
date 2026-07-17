import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useRoastSessions } from '@entities/roast';
import type { RoastProfileWithSource } from '@entities/roast-profile';
import { useAuthStore } from '@shared/store/auth';
import type { RoastProfile } from '@shared/types/database.types';
import { chipCls, inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Check, ChevronDown, ChevronRight, History, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

const selectCls = `${inputCls} appearance-none cursor-pointer`;

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
    const { t } = useTranslation();
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
                charge_temp_celsius:
                    editingProfile.charge_temp_celsius != null ? String(editingProfile.charge_temp_celsius) : '',
                drop_temp_celsius:
                    editingProfile.drop_temp_celsius != null ? String(editingProfile.drop_temp_celsius) : '',
                duration_sec: editingProfile.duration_sec != null ? String(editingProfile.duration_sec) : '',
                dev_time_sec: editingProfile.dev_time_sec != null ? String(editingProfile.dev_time_sec) : '',
                dev_pct: editingProfile.dev_pct != null ? String(editingProfile.dev_pct) : '',
            });
            setSelectedSessionId(editingProfile.source_session_id ?? null);
            setDefaultType(
                editingProfile.default_bean_id ? 'bean' : editingProfile.default_blend_id ? 'blend' : 'none',
            );
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

    const set =
        (field: keyof FormState) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
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
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <button
                            type="button"
                            onClick={() => setMode('pick')}
                            className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                        <h2
                            id="new-profile-modal-title"
                            className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                        >
                            {editingProfile
                                ? t('newProfileModal.editTitle')
                                : mode === 'from-session'
                                  ? t('newProfileModal.fromSession')
                                  : t('newProfileModal.newTitle')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>

                {mode === 'from-session' &&
                    selectedSessionId &&
                    (() => {
                        const session = sessions.find((s) => s.id === selectedSessionId);
                        return session ? (
                            <div className="px-8 pb-4">
                                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface/60 dark:bg-surface-elevated border border-transparent dark:border-[#585d61] text-[12px] text-secondary shadow-(--shadow-inset)">
                                    <History size={14} strokeWidth={2} className="text-muted flex-shrink-0" />
                                    <span>
                                        {t('newProfileModal.basedOn')}{' '}
                                        <span className="font-medium text-primary">
                                            {session.beans?.name ?? t('newProfileModal.unknownBean')}
                                        </span>
                                        {' · '}
                                        {fmtDate(session.roasted_at)}
                                        {session.duration_seconds != null &&
                                            ` · ${fmtDuration(session.duration_seconds)}`}
                                    </span>
                                </div>
                            </div>
                        ) : null;
                    })()}
            </div>

            {/* Scrollable Body */}
            <div className="px-8 py-6 overflow-y-auto flex-1">
                <div className="flex flex-col gap-6">
                    {/* Profile Name */}
                    <div>
                        <label className={labelCls}>
                            {t('newProfileModal.profileName')} <span className="text-red-400">*</span>
                        </label>
                        <input
                            ref={nameRef}
                            type="text"
                            value={form.name}
                            onChange={set('name')}
                            placeholder={t('newProfileModal.profileNamePlaceholder')}
                            className={inputCls}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className={labelCls}>{t('newProfileModal.description')}</label>
                        <textarea
                            value={form.description}
                            onChange={set('description')}
                            placeholder={t('newProfileModal.descriptionPlaceholder')}
                            rows={2}
                            className={`${inputCls} min-h-[56px] resize-none`}
                        />
                    </div>

                    {/* Target Roast Level */}
                    <div>
                        <label className={labelCls}>{t('newProfileModal.targetLevel')}</label>
                        <div className="relative">
                            <select
                                value={form.target_level}
                                onChange={set('target_level')}
                                className={selectCls}
                                style={{ paddingRight: '2.5rem' }}
                            >
                                {ROAST_LEVELS.map((l) => (
                                    <option key={l} value={l}>
                                        {t(`newProfileModal.roastLevel.${l}`)}
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
                            <label className={labelCls}>{t('newProfileModal.chargeTemp')}</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder={t('newProfileModal.tempPlaceholder')}
                                value={form.charge_temp_celsius}
                                onChange={set('charge_temp_celsius')}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t('newProfileModal.dropTemp')}</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder={t('newProfileModal.tempPlaceholder')}
                                value={form.drop_temp_celsius}
                                onChange={set('drop_temp_celsius')}
                            />
                        </div>
                    </div>

                    {/* Duration / Dev Time / Dev % */}
                    <div className="grid grid-cols-3 gap-6">
                        <div>
                            <label className={labelCls}>{t('newProfileModal.duration')}</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder={t('newProfileModal.durationPlaceholder')}
                                value={form.duration_sec}
                                onChange={set('duration_sec')}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t('newProfileModal.devTime')}</label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder={t('newProfileModal.devTimePlaceholder')}
                                value={form.dev_time_sec}
                                onChange={set('dev_time_sec')}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t('newProfileModal.devPct')}</label>
                            <input
                                type="number"
                                className={inputCls}
                                placeholder={t('newProfileModal.devPctPlaceholder')}
                                value={form.dev_pct}
                                onChange={set('dev_pct')}
                                min={0}
                                max={100}
                                step={0.1}
                            />
                        </div>
                    </div>

                    {/* Default Bean / Blend */}
                    <div className="border-t border-black/4 dark:border-[#585d61] pt-6">
                        <label className={labelCls}>{t('newProfileModal.defaultBean')}</label>
                        <div className="flex gap-2 mt-2">
                            {(
                                [
                                    ['none', t('newProfileModal.none')],
                                    ['bean', t('newProfileModal.singleOrigin')],
                                    ['blend', t('newProfileModal.blend')],
                                ] as const
                            ).map(([type, label]) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setDefaultType(type)}
                                    className={chipCls(defaultType === type)}
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
                                    className={selectCls}
                                    style={{ paddingRight: '2.5rem' }}
                                >
                                    <option value="">{t('newProfileModal.selectBeanOption')}</option>
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
                                    className={selectCls}
                                    style={{ paddingRight: '2.5rem' }}
                                >
                                    <option value="">{t('newProfileModal.selectBlendOption')}</option>
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
            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        {t('newProfileModal.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        className="flex-1 py-3.5 rounded-2xl border border-transparent dark:border-white bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {editingProfile ? (
                            <>
                                <Check size={16} strokeWidth={2.5} /> {t('newProfileModal.saveProfile')}
                            </>
                        ) : (
                            <>
                                <Plus size={16} strokeWidth={2.5} /> {t('newProfileModal.createProfile')}
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
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <button
                            type="button"
                            onClick={() => setMode('pick')}
                            className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                        >
                            <ChevronRight size={14} strokeWidth={2.5} className="rotate-180" />
                        </button>
                        <h2 className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0">
                            {t('newProfileModal.selectSession')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Scrollable Body */}
            <div className="px-8 py-6 overflow-y-auto flex-1">
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted text-center py-8">{t('newProfileModal.noSessions')}</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {sessions.map((session) => (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => handleSessionSelect(session.id)}
                                className="w-full px-4 py-3 rounded-xl border border-black/6 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-left cursor-pointer hover:bg-white/90 dark:hover:bg-[#262b31] transition-all duration-200 group"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-sm font-semibold text-primary">
                                            {session.beans?.name ?? t('newProfileModal.unknownBean')}
                                        </span>
                                        <span className="text-[12px] text-muted">
                                            {fmtDate(session.roasted_at)}
                                            {session.drop_temp_celsius != null &&
                                                ` · ${t('newProfileModal.drop')} ${session.drop_temp_celsius}°C`}
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
            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                >
                    {t('newProfileModal.cancel')}
                </button>
            </div>
        </div>
    );

    const renderPicker = () => (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <h2
                        id="new-profile-modal-title"
                        className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                    >
                        {t('newProfileModal.newTitle')}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Scrollable Body */}
            <div className="px-8 py-6 overflow-y-auto flex-1">
                <p className="text-sm text-secondary tracking-[0.14px] mb-4">{t('newProfileModal.howToCreate')}</p>

                <div className="flex flex-col gap-4">
                    {/* Option: Manual Input */}
                    <button
                        type="button"
                        onClick={() => setMode('manual')}
                        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated cursor-pointer transition-all text-left group hover:dark:bg-[#262b31]"
                    >
                        <div className="w-10 h-10 rounded-xl bg-surface dark:bg-[#262b31] flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                            <Pencil size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                                {t('newProfileModal.manualInput')}
                            </div>
                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                {t('newProfileModal.manualInputDesc')}
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
                        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated cursor-pointer transition-all text-left group hover:dark:bg-[#262b31]"
                    >
                        <div className="w-10 h-10 rounded-xl bg-surface dark:bg-[#262b31] flex items-center justify-center flex-shrink-0 shadow-(--shadow-inset)">
                            <History size={18} strokeWidth={1.5} color="var(--color-secondary)" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-primary tracking-[0.14px] mb-0.5">
                                {t('newProfileModal.fromSessionOption')}
                            </div>
                            <div className="text-[12px] text-muted tracking-[0.14px]">
                                {t('newProfileModal.fromSessionDesc')}
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
            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                >
                    {t('newProfileModal.cancel')}
                </button>
            </div>
        </div>
    );

    return (
        <ModalShell onClose={onClose} labelledBy="new-profile-modal-title" contentClassName={modalPanel.formLg}>
            {mode === 'pick' && !editingProfile && renderPicker()}
            {mode === 'session-list' && !editingProfile && renderSessionPicker()}
            {(mode === 'manual' || mode === 'from-session') && renderForm()}
        </ModalShell>
    );
};

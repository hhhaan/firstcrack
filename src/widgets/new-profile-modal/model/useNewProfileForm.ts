import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { copyMachineSnapshot, EMPTY_MACHINE_SNAPSHOT } from '@entities/machine';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastSessions } from '@entities/roast';
import type { RoastProfileWithSource } from '@entities/roast-profile';
import type { RoastProfile } from '@shared/types/database.types';
import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '../lib/format';
import {
    INITIAL_PROFILE_FORM,
    type ProfileDefaultType,
    type ProfileFormMode,
    type ProfileFormState,
} from '../lib/types';

interface UseNewProfileFormArgs {
    open: boolean;
    onClose: () => void;
    onCreated: (profile: RoastProfile) => void;
    editingProfile?: RoastProfileWithSource | null;
    onUpdated?: (profile: RoastProfile) => void;
    /** 열릴 때 이 세션으로 바로 from-session 모드 진입 (History "프로파일로 저장") */
    initialSessionId?: string | null;
}

export const useNewProfileForm = ({
    open,
    onClose,
    onCreated,
    editingProfile,
    onUpdated,
    initialSessionId,
}: UseNewProfileFormArgs) => {
    const [mode, setMode] = useState<ProfileFormMode>('pick');
    const [form, setForm] = useState<ProfileFormState>(INITIAL_PROFILE_FORM);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [defaultType, setDefaultType] = useState<ProfileDefaultType>('none');
    const [defaultBeanId, setDefaultBeanId] = useState<string | null>(null);
    const [defaultBlendId, setDefaultBlendId] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: sessions = [] } = useRoastSessions(workspaceOwnerId, 'completed');
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const { data: blends = [] } = useBlends(workspaceOwnerId);

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
            setForm(INITIAL_PROFILE_FORM);
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

    const setField =
        (field: keyof ProfileFormState) =>
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

    // biome-ignore lint/correctness/useExhaustiveDependencies: handleSessionSelect는 렌더마다 재생성 — mode 가드로 1회만 실행
    useEffect(() => {
        if (open && initialSessionId && !editingProfile && mode === 'pick' && sessions.length > 0) {
            handleSessionSelect(initialSessionId);
        }
    }, [open, initialSessionId, editingProfile, mode, sessions.length]);

    const isValid = form.name.trim().length > 0;
    const selectedSession = selectedSessionId ? (sessions.find((s) => s.id === selectedSessionId) ?? null) : null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid || !workspaceOwnerId) return;

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
                user_id: workspaceOwnerId,
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
                ...copyMachineSnapshot(mode === 'from-session' ? selectedSession : EMPTY_MACHINE_SNAPSHOT),
            };

            onCreated(profile as RoastProfile);
        }
        onClose();
    };

    return {
        mode,
        setMode,
        form,
        setField,
        nameRef,
        sessions,
        beans,
        blends,
        defaultType,
        setDefaultType,
        defaultBeanId,
        setDefaultBeanId,
        defaultBlendId,
        setDefaultBlendId,
        selectedSession,
        handleSessionSelect,
        isValid,
        handleSubmit,
    };
};

export type NewProfileFormApi = ReturnType<typeof useNewProfileForm>;

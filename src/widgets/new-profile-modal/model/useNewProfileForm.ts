import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { copyMachineSnapshot } from '@entities/machine';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastSessions } from '@entities/roast';
import {
    type RoastProfileWithSource,
    resolveSourceSession,
    type SessionSummary,
    summarizeSessionEvents,
} from '@entities/roast-profile';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import type { RoastProfile } from '@shared/types/database.types';
import { useEffect, useMemo, useRef, useState } from 'react';
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

export type NewProfileFormFields = {
    mode: ProfileFormMode;
    form: ProfileFormState;
    selectedSessionId: string | null;
    defaultType: ProfileDefaultType;
    defaultBeanId: string | null;
    defaultBlendId: string | null;
};

/** Close/unmount must return the session picker — leftover create values caused #471. */
export const resolveNewProfileFormState = (
    open: boolean,
    editingProfile?: RoastProfileWithSource | null,
): NewProfileFormFields => {
    if (!open || !editingProfile) {
        return {
            mode: 'session-list',
            form: INITIAL_PROFILE_FORM,
            selectedSessionId: null,
            defaultType: 'none',
            defaultBeanId: null,
            defaultBlendId: null,
        };
    }
    return {
        mode: 'from-session',
        form: {
            name: editingProfile.name ?? '',
            description: editingProfile.description ?? '',
            target_level: editingProfile.target_level ?? 'Medium',
        },
        selectedSessionId: editingProfile.source_session_id,
        defaultType: editingProfile.default_bean_id ? 'bean' : editingProfile.default_blend_id ? 'blend' : 'none',
        defaultBeanId: editingProfile.default_bean_id ?? null,
        defaultBlendId: editingProfile.default_blend_id ?? null,
    };
};

export const useNewProfileForm = ({
    open,
    onClose,
    onCreated,
    editingProfile,
    onUpdated,
    initialSessionId,
}: UseNewProfileFormArgs) => {
    const [mode, setMode] = useState<ProfileFormMode>('session-list');
    const [form, setForm] = useState<ProfileFormState>(INITIAL_PROFILE_FORM);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [defaultType, setDefaultType] = useState<ProfileDefaultType>('none');
    const [defaultBeanId, setDefaultBeanId] = useState<string | null>(null);
    const [defaultBlendId, setDefaultBlendId] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: sessions = [] } = useRoastSessions(workspaceOwnerId, 'completed', { enabled: open });
    const { data: beans = [] } = useBeans(workspaceOwnerId, { enabled: open });
    const { data: blends = [] } = useBlends(workspaceOwnerId, { enabled: open });

    // Derive initial state from props during render to avoid stale UI commits
    const [prevOpen, setPrevOpen] = useState(open);
    const [prevEditingProfile, setPrevEditingProfile] = useState(editingProfile);
    if (open !== prevOpen || editingProfile !== prevEditingProfile) {
        setPrevOpen(open);
        setPrevEditingProfile(editingProfile);
        const next = resolveNewProfileFormState(open, editingProfile);
        setMode(next.mode);
        setForm(next.form);
        setSelectedSessionId(next.selectedSessionId);
        setDefaultType(next.defaultType);
        setDefaultBeanId(next.defaultBeanId);
        setDefaultBlendId(next.defaultBlendId);
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
        if (mode === 'from-session') {
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
        });
        setMode('from-session');
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: handleSessionSelect는 렌더마다 재생성 — mode 가드로 1회만 실행
    useEffect(() => {
        if (open && initialSessionId && !editingProfile && mode === 'session-list' && sessions.length > 0) {
            handleSessionSelect(initialSessionId);
        }
    }, [open, initialSessionId, editingProfile, mode, sessions.length]);

    const selectedSession = selectedSessionId ? (sessions.find((s) => s.id === selectedSessionId) ?? null) : null;

    /** Curve numbers are never typed — always cut from the source session's marks (legacy 90/13 rows show "—"). */
    const summary: SessionSummary | null = useMemo(() => {
        if (editingProfile) {
            return summarizeSessionEvents(
                parseStoredRoastEvents(resolveSourceSession(editingProfile.source_session)?.events),
                {
                    duration_seconds: editingProfile.duration_sec,
                    drop_temp_celsius: editingProfile.drop_temp_celsius,
                    charge_temp_celsius: editingProfile.charge_temp_celsius,
                },
            );
        }
        if (!selectedSession) return null;
        return summarizeSessionEvents(parseStoredRoastEvents(selectedSession.events), selectedSession);
    }, [editingProfile, selectedSession]);

    const isValid = form.name.trim().length > 0 && (!!editingProfile || (selectedSession != null && summary != null));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid || !workspaceOwnerId) return;

        if (editingProfile) {
            const patch: Partial<Omit<RoastProfile, 'id' | 'created_at' | 'updated_at' | 'user_id'>> = {
                name: form.name.trim(),
                description: form.description.trim() || null,
                target_level: form.target_level,
                default_bean_id: defaultType === 'bean' ? defaultBeanId : null,
                default_blend_id: defaultType === 'blend' ? defaultBlendId : null,
            };
            onUpdated?.({ id: editingProfile.id, ...patch } as RoastProfile);
        } else if (selectedSession && summary) {
            const { fc_time_sec: _fc, ...columns } = summary;
            void _fc;
            const profile: Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'> = {
                user_id: workspaceOwnerId,
                name: form.name.trim(),
                description: form.description.trim() || null,
                target_level: form.target_level,
                ...columns,
                source_session_id: selectedSession.id,
                heater_events: null,
                default_bean_id: defaultType === 'bean' ? defaultBeanId : null,
                default_blend_id: defaultType === 'blend' ? defaultBlendId : null,
                ...copyMachineSnapshot(selectedSession),
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
        summary,
        handleSessionSelect,
        isValid,
        handleSubmit,
    };
};

export type NewProfileFormApi = ReturnType<typeof useNewProfileForm>;

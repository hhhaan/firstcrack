import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { copyMachineSnapshot } from '@entities/machine';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastSessions } from '@entities/roast';
import {
    type ProfileSource,
    type RoastProfileUpdate,
    type RoastProfileWithSource,
    registeredProfileSources,
    resolveSourceSession,
    type SessionSummary,
    summarizeSessionEvents,
} from '@entities/roast-profile';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { useFormEscape } from '@shared/lib/useFormEscape';
import type { RoastProfile } from '@shared/types/database.types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate } from '../lib/format';
import { INITIAL_PROFILE_FORM, type ProfileFormMode, type ProfileFormState } from '../lib/types';

interface UseNewProfileFormArgs {
    onClose: () => void;
    onCreated: (profile: RoastProfile) => void;
    editingProfile?: RoastProfileWithSource | null;
    onUpdated?: (profile: RoastProfileUpdate) => void;
    /** 열릴 때 이 세션으로 바로 from-session 모드 진입 (History "프로파일로 저장") */
    initialSessionId?: string | null;
}

export type NewProfileFormFields = {
    mode: ProfileFormMode;
    form: ProfileFormState;
    selectedSessionId: string | null;
    sources: ProfileSource[];
};

/** The keyed modal owns reset: each open starts a fresh draft. */
export const resolveNewProfileFormState = (editingProfile?: RoastProfileWithSource | null): NewProfileFormFields => {
    if (!editingProfile) {
        return {
            mode: 'session-list',
            form: INITIAL_PROFILE_FORM,
            selectedSessionId: null,
            sources: [],
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
        sources: registeredProfileSources(editingProfile),
    };
};

export const useNewProfileForm = ({
    onClose,
    onCreated,
    editingProfile,
    onUpdated,
    initialSessionId,
}: UseNewProfileFormArgs) => {
    const [initial] = useState(() => resolveNewProfileFormState(editingProfile));
    const [mode, setMode] = useState<ProfileFormMode>(initial.mode);
    const [form, setForm] = useState<ProfileFormState>(initial.form);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initial.selectedSessionId);
    const [sources, setSources] = useState<ProfileSource[]>(initial.sources);
    const [saveConflict, setSaveConflict] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: sessions = [] } = useRoastSessions(workspaceOwnerId, 'completed');
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const { data: blends = [] } = useBlends(workspaceOwnerId);

    useFormEscape(true, onClose);

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
        if (initialSessionId && !editingProfile && mode === 'session-list' && sessions.length > 0) {
            handleSessionSelect(initialSessionId);
        }
    }, [initialSessionId, editingProfile, mode, sessions.length]);

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
            const name = form.name.trim();
            const description = form.description.trim() || null;
            const sourcesChanged = JSON.stringify(sources) !== JSON.stringify(initial.sources);
            const patch: RoastProfileUpdate = {
                id: editingProfile.id,
                ...(name !== initial.form.name.trim() ? { name } : {}),
                ...(description !== (initial.form.description.trim() || null) ? { description } : {}),
                ...(form.target_level !== initial.form.target_level ? { target_level: form.target_level } : {}),
                ...(sourcesChanged
                    ? {
                          sources,
                          default_bean_id: sources.length === 1 ? sources[0].bean_id : null,
                          default_blend_id: sources.length === 1 ? sources[0].blend_id : null,
                      }
                    : {}),
            };
            const latest = resolveNewProfileFormState(editingProfile);
            const previousValues = {
                ...initial.form,
                name: initial.form.name.trim(),
                description: initial.form.description.trim() || null,
            };
            const latestValues = {
                ...latest.form,
                name: latest.form.name.trim(),
                description: latest.form.description.trim() || null,
            };
            const conflict =
                (['name', 'description', 'target_level'] as const).some(
                    (field) =>
                        patch[field] !== undefined &&
                        latestValues[field] !== previousValues[field] &&
                        latestValues[field] !== patch[field],
                ) ||
                (sourcesChanged &&
                    JSON.stringify(latest.sources) !== JSON.stringify(initial.sources) &&
                    JSON.stringify(latest.sources) !== JSON.stringify(sources));
            if (conflict) {
                setSaveConflict(true);
                return;
            }
            if (Object.keys(patch).length > 1) onUpdated?.(patch);
        } else if (selectedSession && summary) {
            const { fc_time_sec: _fc, ...columns } = summary;
            void _fc;
            const profile: Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'> & { sources?: ProfileSource[] } = {
                sources,
                user_id: workspaceOwnerId,
                name: form.name.trim(),
                description: form.description.trim() || null,
                target_level: form.target_level,
                ...columns,
                source_session_id: selectedSession.id,
                heater_events: null,
                default_bean_id: sources.length === 1 ? sources[0].bean_id : null,
                default_blend_id: sources.length === 1 ? sources[0].blend_id : null,
                ...copyMachineSnapshot(selectedSession),
            };

            onCreated(profile as RoastProfile);
        }
        onClose();
    };

    return {
        sources,
        setSources,
        mode,
        setMode,
        form,
        setField,
        nameRef,
        sessions,
        beans,
        blends,
        selectedSession,
        summary,
        handleSessionSelect,
        isValid,
        saveConflict,
        handleSubmit,
    };
};

export type NewProfileFormApi = ReturnType<typeof useNewProfileForm>;

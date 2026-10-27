import { useActiveWorkspace } from '@entities/organization';
import {
    profileHeaterEvents,
    type RoastProfileUpdate,
    type RoastProfileWithSource,
    resolveSourceSession,
    useResolvedProfileCurve,
    useUpdateRoastProfile,
} from '@entities/roast-profile';
import { useRoastSettings } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import {
    heaterEventsToJson,
    parseHeaterEvents,
    type ReplayPlanSource,
} from '@features/machine-control/lib/heater-events';
import { type ReplayEvent, type ReplayPoint, resolveReferenceTpTime } from '@features/machine-control/lib/replay';
import { ProfileHeaterEventsEditor } from '@features/machine-control/ui/ProfileHeaterEventsEditor';
import type { RoastProfile } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useMemo, useState } from 'react';
import { useNewProfileForm } from '../model/useNewProfileForm';
import { ProfileFormBody } from './ProfileFormBody';
import { ProfileSessionPicker } from './ProfileSessionPicker';

interface NewProfileModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: (profile: RoastProfile) => void;
    editingProfile?: RoastProfileWithSource | null;
    onUpdated?: (profile: RoastProfileUpdate) => void;
    /** 열릴 때 이 세션으로 바로 from-session 모드 진입 */
    initialSessionId?: string | null;
}

/** Closed callers must not evaluate form, session, or curve hooks. */
export const NewProfileModal = ({ open, ...props }: NewProfileModalProps) =>
    open ? (
        <NewProfileModalOpen
            key={props.editingProfile ? `edit:${props.editingProfile.id}` : `create:${props.initialSessionId ?? ''}`}
            {...props}
        />
    ) : null;

const NewProfileModalOpen = ({
    onClose,
    onCreated,
    editingProfile,
    onUpdated,
    initialSessionId,
}: Omit<NewProfileModalProps, 'open'>) => {
    const form = useNewProfileForm({ onClose, onCreated, editingProfile, onUpdated, initialSessionId });
    const { workspaceOwnerId } = useActiveWorkspace();
    const { mutateAsync: updateRoastProfile } = useUpdateRoastProfile(workspaceOwnerId);
    const unit = useRoastSettings().temperatureUnit;
    const [heatOpen, setHeatOpen] = useState(false);
    const { points } = useResolvedProfileCurve(editingProfile ?? null);
    const heatEditor = useMemo(
        () => resolveProfileHeatEditor(editingProfile ?? null, points),
        [editingProfile, points],
    );

    return (
        <>
            <ModalShell onClose={onClose} labelledBy="new-profile-modal-title" contentClassName={modalPanel.formLg}>
                {form.mode === 'session-list' && !editingProfile ? (
                    <ProfileSessionPicker
                        sessions={form.sessions}
                        onSelect={form.handleSessionSelect}
                        onClose={onClose}
                    />
                ) : (
                    <ProfileFormBody
                        form={form.form}
                        setField={form.setField}
                        nameRef={form.nameRef}
                        isEditing={!!editingProfile}
                        isValid={form.isValid}
                        saveConflict={form.saveConflict}
                        selectedSession={form.selectedSession}
                        summary={form.summary}
                        beans={form.beans}
                        blends={form.blends}
                        sources={form.sources}
                        setSources={form.setSources}
                        // History 진입(initialSessionId)은 목록으로 돌아가면 즉시 재선택되므로 뒤로가기 없음
                        onBack={editingProfile || initialSessionId ? undefined : () => form.setMode('session-list')}
                        onClose={onClose}
                        onSubmit={form.handleSubmit}
                        onEditHeat={editingProfile && heatEditor.curveReady ? () => setHeatOpen(true) : undefined}
                    />
                )}
            </ModalShell>
            {heatOpen && editingProfile && (
                <ProfileHeaterEventsEditor
                    profile={editingProfile}
                    events={heatEditor.events}
                    tpTime={heatEditor.tpTime}
                    btPoints={points}
                    source={heatEditor.source}
                    unit={unit}
                    onClose={() => setHeatOpen(false)}
                    onApply={async (events) => {
                        await updateRoastProfile({
                            id: editingProfile.id,
                            heater_events: events ? heaterEventsToJson(events) : null,
                        });
                        setHeatOpen(false);
                    }}
                />
            )}
        </>
    );
};

const resolveProfileHeatEditor = (
    editingProfile: RoastProfileWithSource | null,
    points: ReplayPoint[],
): {
    events: ReplayEvent[];
    tpTime: number;
    source: ReplayPlanSource | null;
    curveReady: boolean;
} => {
    if (!editingProfile) {
        return { events: [], tpTime: Number.POSITIVE_INFINITY, source: null, curveReady: false };
    }
    const sourceEvents = parseStoredRoastEvents(resolveSourceSession(editingProfile.source_session)?.events);
    const dropTime = sourceEvents.find((e) => e.type === 'Drop')?.time_sec ?? editingProfile.duration_sec ?? null;
    const tpTime = resolveReferenceTpTime(points, dropTime, sourceEvents.find((e) => e.type === 'TP')?.time_sec);
    const stored = profileHeaterEvents(editingProfile);
    const profileEvents = stored == null ? null : parseHeaterEvents(stored);
    return {
        events: profileEvents ?? [],
        tpTime,
        source: stored == null ? null : 'profile',
        curveReady: points.length > 0 || stored != null,
    };
};

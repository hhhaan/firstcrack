import { useActiveWorkspace } from '@entities/organization';
import {
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
import { extractReplayEvents, type ReplayEvent, type ReplayPoint } from '@features/machine-control/lib/replay';
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
    onUpdated?: (profile: RoastProfile) => void;
    /** 열릴 때 이 세션으로 바로 from-session 모드 진입 */
    initialSessionId?: string | null;
}

export const NewProfileModal = ({
    open,
    onClose,
    onCreated,
    editingProfile,
    onUpdated,
    initialSessionId,
}: NewProfileModalProps) => {
    const form = useNewProfileForm({ open, onClose, onCreated, editingProfile, onUpdated, initialSessionId });
    const { workspaceOwnerId } = useActiveWorkspace();
    const { mutateAsync: updateRoastProfile } = useUpdateRoastProfile(workspaceOwnerId);
    const unit = useRoastSettings().temperatureUnit;
    const [heatOpen, setHeatOpen] = useState(false);
    const { points } = useResolvedProfileCurve(editingProfile ?? null);
    const heatEditor = useMemo(
        () => resolveProfileHeatEditor(editingProfile ?? null, points),
        [editingProfile, points],
    );

    if (!open) return null;

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
                        selectedSession={form.selectedSession}
                        summary={form.summary}
                        beans={form.beans}
                        blends={form.blends}
                        defaultType={form.defaultType}
                        setDefaultType={form.setDefaultType}
                        defaultBeanId={form.defaultBeanId}
                        setDefaultBeanId={form.setDefaultBeanId}
                        defaultBlendId={form.defaultBlendId}
                        setDefaultBlendId={form.setDefaultBlendId}
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
    const dropEvents = parseStoredRoastEvents(resolveSourceSession(editingProfile.source_session)?.events);
    const dropTime = dropEvents.find((e) => e.type === 'Drop')?.time_sec ?? editingProfile.duration_sec ?? null;
    const extracted = extractReplayEvents(points, dropTime);
    const stored = editingProfile.heater_events;
    const profileEvents = stored == null ? null : parseHeaterEvents(stored);
    const storedInvalid = stored != null && profileEvents == null;
    return {
        events: storedInvalid ? [] : (profileEvents ?? extracted?.events ?? []),
        tpTime: extracted?.tpTime ?? Number.POSITIVE_INFINITY,
        source: profileEvents || storedInvalid ? 'profile' : extracted ? 'tsv' : null,
        curveReady: points.length > 0 || stored != null,
    };
};

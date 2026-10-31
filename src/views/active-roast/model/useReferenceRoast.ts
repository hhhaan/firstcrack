import type { MachineSnapshot } from '@entities/machine/types';
import { useBbpCurve } from '@entities/roast';
import {
    resolveSourceSession,
    useResolvedProfileCurve,
    useRoastProfileCurve,
    useRoastProfiles,
} from '@entities/roast-profile';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { profileHeatTarget } from '@features/machine-control/lib/heater-events';
import type { HistoryReference } from '@widgets/history-reference/model/reference';
import { useMemo } from 'react';
import { isReplayMachineMismatch, replayPointsForProfile } from '../lib/active-roast-screen';
import { buildReferenceLog } from '../lib/reference-log';

type ReferenceRoastInput = {
    workspaceOwnerId: string;
    targetProfileId: string | null;
    historyReference: HistoryReference | null;
    unit: TemperatureUnit;
    bbpEnabled: boolean;
    machineSnapshot: MachineSnapshot | null;
};

export const useReferenceRoast = ({
    workspaceOwnerId,
    targetProfileId,
    historyReference,
    unit,
    bbpEnabled,
    machineSnapshot,
}: ReferenceRoastInput) => {
    const reference = historyReference?.ownerId === workspaceOwnerId ? historyReference : null;
    const historyCurve = useRoastProfileCurve(reference?.tsvPath);
    const { data: profiles } = useRoastProfiles(workspaceOwnerId);
    const targetProfile = useMemo(
        () =>
            profiles?.find((profile) => profile.id === targetProfileId && profile.user_id === workspaceOwnerId) ?? null,
        [profiles, targetProfileId, workspaceOwnerId],
    );
    const profileCurve = useResolvedProfileCurve(targetProfile);
    const selected = useMemo(() => {
        const source = resolveSourceSession(targetProfile?.source_session);
        return reference
            ? {
                  name: reference.name,
                  points: historyCurve.data ?? [],
                  loading: historyCurve.isLoading,
                  error: historyCurve.isError,
                  events: reference.events,
                  storedHeat: reference.heaterEvents,
                  durationSec: reference.durationSec,
                  machineId: reference.machineId,
                  machineKey: reference.machineKey,
                  bbpSessionId: reference.id,
                  bbpPath: reference.bbpPath,
              }
            : {
                  name: targetProfile?.name,
                  points: profileCurve.points,
                  loading: profileCurve.isLoading,
                  error: profileCurve.isError,
                  events: source?.events,
                  storedHeat: source?.heater_events,
                  durationSec: source?.duration_seconds,
                  machineId: source?.machine_id,
                  machineKey: source?.machine_roaster_key,
                  bbpSessionId: targetProfile?.source_session_id ?? null,
                  bbpPath: source?.bbp_tsv_path,
              };
    }, [
        reference,
        targetProfile,
        historyCurve.data,
        historyCurve.isLoading,
        historyCurve.isError,
        profileCurve.points,
        profileCurve.isLoading,
        profileCurve.isError,
    ]);
    const referenceId = reference?.id ?? targetProfileId;
    const bbp = useBbpCurve(workspaceOwnerId, selected.bbpSessionId, selected.bbpPath, bbpEnabled);
    const sourceEvents = useMemo(() => parseStoredRoastEvents(selected.events), [selected.events]);
    const replayDropTime =
        sourceEvents.find((event) => event.type === 'Drop')?.time_sec ?? selected.durationSec ?? null;
    const referenceTpTime = sourceEvents.find((event) => event.type === 'TP')?.time_sec ?? null;
    const referenceFcStartSec = sourceEvents.find((event) => event.type === 'FC Start')?.time_sec ?? null;
    const heatEvents = selected.storedHeat ?? undefined;
    const referenceLog = useMemo(
        () =>
            selected.name
                ? {
                      name: selected.name,
                      entries: buildReferenceLog(sourceEvents, selected.points, unit, selected.storedHeat),
                      loading: selected.loading,
                      error: selected.error,
                  }
                : undefined,
        [selected, sourceEvents, unit],
    );
    const heatTarget = useMemo(() => {
        if (!reference && !targetProfile) return undefined;
        return profileHeatTarget(selected.points, replayDropTime, heatEvents, referenceTpTime);
    }, [reference, targetProfile, selected.points, replayDropTime, heatEvents, referenceTpTime]);
    const referenceTimeline = useMemo(
        () => ({ roast: selected.points, bbp: bbp.data ?? [], bbpError: bbp.isError }),
        [selected.points, bbp.data, bbp.isError],
    );
    return {
        reference,
        referenceId,
        historyReferenceFailed: Boolean(reference && selected.error),
        backgroundCurvePoints: selected.points,
        referenceTimeline,
        referenceLog,
        heatTarget,
        replayPoints: replayPointsForProfile(referenceId, selected.loading, selected.points),
        heatEvents,
        replayDropTime,
        referenceTpTime,
        referenceFcStartSec,
        replayMachineMismatch: isReplayMachineMismatch(
            selected.machineKey ?? null,
            machineSnapshot?.machine_roaster_key ?? null,
            selected.machineId,
            machineSnapshot?.machine_id,
        ),
    };
};

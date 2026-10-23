import type { LogEntry } from '@shared/types/roast';
import { useEffect, useRef, useState } from 'react';
import { type AlertSoundKind, playAlertSound, primeAlertAudio } from '../lib/alertSound';
import { evaluateRoastAlerts, evaluateTimeAlerts, type RoastAlertKind, type TimeAlertConfig } from '../lib/roastAlerts';
import { logEntryTimeSec } from '../lib/serialize-roast-events';
import { useRoastingStore } from './status';

type UseRoastAlertsParams = {
    enabled: boolean;
    soundEnabled: boolean;
    soundKind: AlertSoundKind;
    tpEnabled: boolean;
    rorCrashCPerMin: number;
    btMaxC: number;
    /** RoR is legitimately negative until the turning point is confirmed. */
    afterTurningPoint: boolean;
    logEntries: LogEntry[];
    timeAlerts: TimeAlertConfig;
    referenceFcStartSec: number | null;
    referenceDropSec: number | null;
};

/**
 * Live threshold + time alarms. Runs while roasting; Drop/End silences threshold and
 * charge/FC/drop-before alarms, but leaves after-drop armed until End roast.
 * Beeps on the rising edge of each kind so a sustained window doesn't sound every poll.
 */
export const useRoastAlerts = ({
    enabled,
    soundEnabled,
    soundKind,
    tpEnabled,
    rorCrashCPerMin,
    btMaxC,
    afterTurningPoint,
    logEntries,
    timeAlerts,
    referenceFcStartSec,
    referenceDropSec,
}: UseRoastAlertsParams): RoastAlertKind[] => {
    const phase = useRoastingStore((s) => s.phase);
    const liveData = useRoastingStore((s) => s.liveData);
    const elapsed = useRoastingStore((s) => s.elapsed);
    const sessionId = useRoastingStore((s) => s.sessionId ?? s.completed?.snapshot.sessionId ?? null);
    const [active, setActive] = useState<RoastAlertKind[]>([]);
    const activeRef = useRef<RoastAlertKind[]>([]);
    const soundRef = useRef(soundEnabled);
    const soundKindRef = useRef(soundKind);
    const sessionRef = useRef(sessionId);
    const tpSeenRef = useRef(false);
    const tpActiveRef = useRef(false);
    const tpNotifiedRef = useRef(false);
    const rorReadyRef = useRef(false);

    useEffect(() => {
        soundRef.current = soundEnabled;
        soundKindRef.current = soundKind;
    }, [soundEnabled, soundKind]);

    const dropEntry = logEntries.find((e) => e.event === 'Drop');
    const dropped = dropEntry != null || logEntries.some((e) => e.event === 'End');
    const armed = enabled && phase === 'roasting';

    // Charge is a click, so the context is created on a user gesture and is running by the first alarm.
    useEffect(() => {
        if (armed && soundEnabled) primeAlertAudio();
    }, [armed, soundEnabled]);

    useEffect(() => {
        if (sessionRef.current !== sessionId) {
            sessionRef.current = sessionId;
            tpSeenRef.current = false;
            tpActiveRef.current = false;
            tpNotifiedRef.current = false;
            rorReadyRef.current = false;
            activeRef.current = [];
            setActive([]);
        }
        const tpDetected = afterTurningPoint || logEntries.some((entry) => entry.event === 'TP');
        if (tpDetected && !tpSeenRef.current) {
            tpSeenRef.current = true;
            tpActiveRef.current = armed && !dropped && tpEnabled;
        }
        // Display RoR can still be negative when raw BT confirms TP. A crash needs a prior rise.
        if (armed && !dropped && tpDetected && liveData?.ror != null && liveData.ror > 0) {
            rorReadyRef.current = true;
        }
        if (!armed) {
            activeRef.current = [];
            setActive((previous) => (previous.length ? [] : previous));
            return;
        }

        const threshold = dropped
            ? []
            : evaluateRoastAlerts(
                  {
                      ror: liveData?.ror ?? null,
                      bt: liveData?.bt ?? null,
                      afterTurningPoint: tpDetected && rorReadyRef.current,
                  },
                  { rorCrashBelowCPerMin: rorCrashCPerMin, btMaxC },
                  activeRef.current,
              );
        const timed = evaluateTimeAlerts(
            {
                elapsedSec: elapsed,
                dropped,
                referenceFcStartSec,
                referenceDropSec,
                sessionDropSec: dropEntry ? logEntryTimeSec(dropEntry) : null,
            },
            timeAlerts,
        );
        const next: RoastAlertKind[] = [
            ...(tpActiveRef.current && tpEnabled && !dropped ? ['turning-point' as const] : []),
            ...threshold,
            ...timed,
        ];

        const rising = next.filter((k) => !activeRef.current.includes(k));
        const changed =
            rising.length > 0 ||
            next.length !== activeRef.current.length ||
            activeRef.current.some((k) => !next.includes(k));
        if (!changed) return;

        activeRef.current = next;
        setActive(next);
        const audible = rising.filter((kind) => kind !== 'turning-point' || !tpNotifiedRef.current);
        if (rising.includes('turning-point')) tpNotifiedRef.current = true;
        if (audible.length > 0 && soundRef.current) playAlertSound(soundKindRef.current);
    }, [
        armed,
        sessionId,
        tpEnabled,
        logEntries,
        dropped,
        dropEntry,
        liveData,
        elapsed,
        afterTurningPoint,
        rorCrashCPerMin,
        btMaxC,
        timeAlerts,
        referenceFcStartSec,
        referenceDropSec,
    ]);

    return active;
};

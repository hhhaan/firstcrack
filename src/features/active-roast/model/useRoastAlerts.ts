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
 * Live threshold + time alarms while roasting.
 * Drop leaves `phase !== 'roasting'` and resets `elapsed`, so the roast clock cannot
 * reach an after-drop offset. That alarm times itself from the completed Drop
 * (`roastStartMs + Drop timeSec`) and rings once during the wait, including while
 * the completion summary is open or closed. Next Charge, Drop cancel, and restart
 * (store reset) drop the timer. End without a Drop never starts one.
 * One beep per rising edge. Threshold and charge/FC/drop-before stay quiet after Drop.
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
    // Stable across Drop: live sessionId clears, the snapshot keeps the same id.
    // A newer Charge fails the id check, so the previous Drop cannot leak.
    const postDropKey = useRoastingStore((s) => {
        if (s.phase === 'roasting') return null;
        const snap = s.completed?.snapshot;
        if (!snap || !(snap.roastStartMs > 0)) return null;
        if (s.sessionId != null && s.sessionId !== snap.sessionId) return null;
        const drop = snap.logEntries.find((entry) => entry.event === 'Drop');
        const dropSec = drop ? logEntryTimeSec(drop) : null;
        if (dropSec == null || !Number.isFinite(dropSec)) return null;
        return `${snap.sessionId}|${snap.roastStartMs}|${dropSec}`;
    });
    const [active, setActive] = useState<RoastAlertKind[]>([]);
    const [afterDropDueKey, setAfterDropDueKey] = useState<string | null>(null);
    const activeRef = useRef<RoastAlertKind[]>([]);
    const sessionRef = useRef(sessionId);
    const tpSeenRef = useRef(false);
    const rorReadyRef = useRef(false);

    const dropEntry = logEntries.find((e) => e.event === 'Drop');
    const dropped = dropEntry != null || logEntries.some((e) => e.event === 'End');
    const roasting = enabled && phase === 'roasting';
    const afterDropMin = timeAlerts.afterDropMin;
    const afterDropDue = afterDropMin != null && postDropKey != null && afterDropDueKey === postDropKey;

    // Charge is a click, so the context is created on a user gesture and is running by the first alarm.
    useEffect(() => {
        if (soundEnabled && (roasting || (enabled && postDropKey != null && afterDropMin != null))) primeAlertAudio();
    }, [roasting, soundEnabled, enabled, postDropKey, afterDropMin]);

    useEffect(() => {
        if (!enabled || afterDropMin == null || postDropKey == null) {
            setAfterDropDueKey(null);
            return;
        }
        const [, startRaw, dropRaw] = postDropKey.split('|');
        const startMs = Number(startRaw);
        const dropSec = Number(dropRaw);
        const dueAt = startMs + (dropSec + afterDropMin * 60) * 1000;
        const delay = dueAt - Date.now();
        if (!(startMs > 0) || !Number.isFinite(dropSec) || !Number.isFinite(delay)) {
            setAfterDropDueKey(null);
            return;
        }
        if (delay <= 0) {
            setAfterDropDueKey(postDropKey);
            return;
        }
        setAfterDropDueKey(null);
        const id = setTimeout(() => setAfterDropDueKey(postDropKey), delay);
        return () => clearTimeout(id);
    }, [enabled, afterDropMin, postDropKey]);

    useEffect(() => {
        if (sessionRef.current !== sessionId) {
            sessionRef.current = sessionId;
            tpSeenRef.current = false;
            rorReadyRef.current = false;
            activeRef.current = [];
            setActive([]);
        }
        const tpDetected = afterTurningPoint || logEntries.some((entry) => entry.event === 'TP');
        const newTp = tpDetected && !tpSeenRef.current;
        if (tpDetected) tpSeenRef.current = true;
        // Display RoR can still be negative when raw BT confirms TP. A crash needs a prior rise.
        if (roasting && !dropped && tpDetected && liveData?.ror != null && liveData.ror > 0) {
            rorReadyRef.current = true;
        }

        const threshold =
            roasting && !dropped
                ? evaluateRoastAlerts(
                      {
                          ror: liveData?.ror ?? null,
                          bt: liveData?.bt ?? null,
                          afterTurningPoint: tpDetected && rorReadyRef.current,
                      },
                      { rorCrashBelowCPerMin: rorCrashCPerMin, btMaxC },
                      activeRef.current,
                  )
                : [];
        const timed = roasting
            ? evaluateTimeAlerts(
                  {
                      elapsedSec: elapsed,
                      dropped,
                      referenceFcStartSec,
                      referenceDropSec,
                      sessionDropSec: dropEntry ? logEntryTimeSec(dropEntry) : null,
                  },
                  timeAlerts,
              )
            : [];
        const next: RoastAlertKind[] = [...threshold, ...timed];
        if (afterDropDue && !next.includes('after-drop')) next.push('after-drop');

        const rising = next.filter((k) => !activeRef.current.includes(k));
        const changed =
            rising.length > 0 ||
            next.length !== activeRef.current.length ||
            activeRef.current.some((k) => !next.includes(k));
        if (changed) {
            activeRef.current = next;
            setActive(next);
        }
        if (soundEnabled && (rising.length > 0 || (roasting && tpEnabled && newTp && !dropped)))
            playAlertSound(soundKind);
    }, [
        roasting,
        afterDropDue,
        soundEnabled,
        soundKind,
        tpEnabled,
        sessionId,
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

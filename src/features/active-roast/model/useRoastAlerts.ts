import { logger } from '@shared/lib/logger';
import type { LogEntry } from '@shared/types/roast';
import { useEffect, useRef, useState } from 'react';
import { evaluateRoastAlerts, evaluateTimeAlerts, type RoastAlertKind, type TimeAlertConfig } from '../lib/roastAlerts';
import { logEntryTimeSec } from '../lib/serialize-roast-events';
import { useRoastingStore } from './status';

type UseRoastAlertsParams = {
    enabled: boolean;
    soundEnabled: boolean;
    rorCrashCPerMin: number;
    btMaxC: number;
    /** RoR is legitimately negative until the turning point is confirmed. */
    afterTurningPoint: boolean;
    logEntries: LogEntry[];
    timeAlerts: TimeAlertConfig;
    referenceFcStartSec: number | null;
    referenceDropSec: number | null;
};

/** Reused across beeps — a context per beep would leak until GC and can hit the per-page limit. */
let _audioCtx: AudioContext | null = null;

const beep = () => {
    try {
        _audioCtx ??= new AudioContext();
        const ctx = _audioCtx;
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        // Short ramp down — a hard stop clicks.
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
    } catch (err) {
        logger.capture(err, { scope: 'roastAlerts.playSound' });
        // no audio device / autoplay blocked — the banner still shows
    }
};

/**
 * Live threshold + time alarms. Runs while roasting; Drop/End silences threshold and
 * charge/FC/drop-before alarms, but leaves after-drop armed until End roast.
 * Beeps on the rising edge of each kind so a sustained window doesn't sound every poll.
 */
export const useRoastAlerts = ({
    enabled,
    soundEnabled,
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
    const [active, setActive] = useState<RoastAlertKind[]>([]);
    const activeRef = useRef<RoastAlertKind[]>([]);
    const soundRef = useRef(soundEnabled);

    useEffect(() => {
        soundRef.current = soundEnabled;
    }, [soundEnabled]);

    const dropEntry = logEntries.find((e) => e.event === 'Drop');
    const dropped = dropEntry != null || logEntries.some((e) => e.event === 'End');
    const armed = enabled && phase === 'roasting';

    useEffect(() => {
        if (!armed) {
            if (activeRef.current.length > 0) {
                activeRef.current = [];
                setActive([]);
            }
            return;
        }

        const threshold = dropped
            ? []
            : evaluateRoastAlerts(
                  { ror: liveData?.ror ?? null, bt: liveData?.bt ?? null, afterTurningPoint },
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
        const next = [...threshold, ...timed];

        const rising = next.filter((k) => !activeRef.current.includes(k));
        const changed =
            rising.length > 0 ||
            next.length !== activeRef.current.length ||
            activeRef.current.some((k) => !next.includes(k));
        if (!changed) return;

        activeRef.current = next;
        setActive(next);
        if (rising.length > 0 && soundRef.current) beep();
    }, [
        armed,
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

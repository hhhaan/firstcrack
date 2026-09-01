import type { LogEntry } from '@shared/types/roast';
import { useEffect, useRef, useState } from 'react';
import { type AlertSoundTone, playAlertTone } from '../lib/alertTone';
import { evaluateRoastAlerts, type RoastAlertKind } from '../lib/roastAlerts';
import { useRoastingStore } from './status';

type UseRoastAlertsParams = {
    enabled: boolean;
    soundEnabled: boolean;
    /** 1–100. Maps to oscillator gain. OS volume is still the ceiling. */
    soundVolume: number;
    soundTone: AlertSoundTone;
    rorCrashCPerMin: number;
    btMaxC: number;
    /** RoR is legitimately negative until the turning point is confirmed. */
    afterTurningPoint: boolean;
    logEntries: LogEntry[];
};

/**
 * Live threshold alarms. Only runs while roasting and before drop; beeps on the rising
 * edge of each alert so a sustained condition doesn't sound every poll.
 */
export const useRoastAlerts = ({
    enabled,
    soundEnabled,
    soundVolume,
    soundTone,
    rorCrashCPerMin,
    btMaxC,
    afterTurningPoint,
    logEntries,
}: UseRoastAlertsParams): RoastAlertKind[] => {
    const phase = useRoastingStore((s) => s.phase);
    const liveData = useRoastingStore((s) => s.liveData);
    const [active, setActive] = useState<RoastAlertKind[]>([]);
    const activeRef = useRef<RoastAlertKind[]>([]);
    const soundRef = useRef(soundEnabled);
    const volumeRef = useRef(soundVolume);
    const toneRef = useRef(soundTone);

    useEffect(() => {
        soundRef.current = soundEnabled;
    }, [soundEnabled]);

    useEffect(() => {
        volumeRef.current = soundVolume;
    }, [soundVolume]);

    useEffect(() => {
        toneRef.current = soundTone;
    }, [soundTone]);

    const dropped = logEntries.some((e) => e.event === 'Drop' || e.event === 'End');
    const armed = enabled && phase === 'roasting' && !dropped;

    useEffect(() => {
        if (!armed) {
            if (activeRef.current.length > 0) {
                activeRef.current = [];
                setActive([]);
            }
            return;
        }

        const next = evaluateRoastAlerts(
            { ror: liveData?.ror ?? null, bt: liveData?.bt ?? null, afterTurningPoint },
            { rorCrashBelowCPerMin: rorCrashCPerMin, btMaxC },
            activeRef.current,
        );

        const rising = next.filter((k) => !activeRef.current.includes(k));
        const changed = rising.length > 0 || next.length !== activeRef.current.length;
        if (!changed) return;

        activeRef.current = next;
        setActive(next);
        if (rising.length > 0 && soundRef.current) playAlertTone(volumeRef.current, toneRef.current);
    }, [armed, liveData, afterTurningPoint, rorCrashCPerMin, btMaxC]);

    return active;
};

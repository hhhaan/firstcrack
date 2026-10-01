import { formatElapsed } from '@shared/lib/format';
import { subscribeSecondClock } from '@shared/lib/second-clock';
import { useEffect, useState } from 'react';
import { useBbpStore } from './bbp';

/** BBP 경과 시간 "M:SS" — 기록 중이 아니면 null. 1초 간격 갱신. */
export const useBbpTimer = (): string | null => {
    const active = useBbpStore((s) => s.active);
    const recording = useBbpStore((s) => s.recording);
    const startMs = useBbpStore((s) => s.startMs);
    // Date.now()는 effect 안에서만 — 렌더는 순수하게 유지한다
    const [elapsedSec, setElapsedSec] = useState(0);

    useEffect(() => {
        if (!recording || !active || startMs <= 0) return;
        const update = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
        update();
        return subscribeSecondClock(update);
    }, [active, recording, startMs]);

    if (!recording || !active || startMs <= 0) return null;
    return formatElapsed(elapsedSec);
};

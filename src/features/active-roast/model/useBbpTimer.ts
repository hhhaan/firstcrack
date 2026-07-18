import { useEffect, useReducer } from 'react';
import { useBbpStore } from './bbp';

/** BBP 경과 시간 "M:SS" — 기록 중이 아니면 null. 1초 간격 리렌더. */
export const useBbpTimer = (): string | null => {
    const active = useBbpStore((s) => s.active);
    const startMs = useBbpStore((s) => s.startMs);
    const [, tick] = useReducer((n: number) => n + 1, 0);

    useEffect(() => {
        if (!active) return;
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [active]);

    if (!active || startMs <= 0) return null;
    const sec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

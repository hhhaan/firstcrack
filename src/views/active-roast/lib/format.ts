/**
 * 초 단위 시간을 "M:SS" 형식으로 변환
 * @example formatElapsed(125) => "2:05"
 */
export const formatElapsed = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * 초 단위 시간을 "-M:SS" 형식으로 변환 (pre-charge 음수 시간)
 * @example formatNegativeElapsed(-90) => "-1:30"
 */
export const formatNegativeElapsed = (secs: number): string => {
    const absT = Math.abs(secs);
    const m = Math.floor(absT / 60);
    const s = Math.floor(absT % 60);
    return `-${m}:${String(s).padStart(2, '0')}`;
};

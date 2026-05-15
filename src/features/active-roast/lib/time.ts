/** "M:SS" 형식의 시간 문자열을 초 단위 정수로 변환한다. */
export const parseTimeSec = (t: string): number => {
    const [m, s] = t.split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
};

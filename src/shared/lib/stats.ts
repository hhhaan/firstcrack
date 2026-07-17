export const mean = (values: number[]): number | null =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** 표본 표준편차 (n−1). n<2 → null. */
export const stddev = (values: number[]): number | null => {
    if (values.length < 2) return null;
    const m = mean(values) as number;
    return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
};

/** |x − mean| > k·σ 인 인덱스 목록. σ가 null/0이면 []. */
export const outlierIndices = (values: number[], k = 2): number[] => {
    const m = mean(values);
    const sd = stddev(values);
    if (m == null || sd == null || sd === 0) return [];
    return values.reduce<number[]>((acc, v, i) => {
        if (Math.abs(v - m) > k * sd) acc.push(i);
        return acc;
    }, []);
};

/** Presentation bounds never change stored measurements or the BBP retention window. */
export const resolveTemperatureBand = (input: {
    points: { bt: number | null; et: number | null }[];
    reference: { bt: number | null; et?: number | null }[];
    autoExpand: boolean;
    configured: { tempMinC: number; tempMaxC: number };
    waitingBand: { tempMinC: number; tempMaxC: number } | null;
}) => {
    if (!input.autoExpand) return input.configured;
    let { tempMinC, tempMaxC } = input.waitingBand ?? input.configured;
    for (const point of [...input.points, ...input.reference]) {
        for (const value of [point.bt, point.et]) {
            if (value == null || !Number.isFinite(value)) continue;
            tempMinC = Math.min(tempMinC, Math.floor((value - 5) / 10) * 10);
            tempMaxC = Math.max(tempMaxC, Math.ceil((value + 5) / 10) * 10);
        }
    }
    return { tempMinC, tempMaxC };
};

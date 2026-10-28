export interface LiveChartExtent {
    key: string;
    right: number;
    span: number;
}

/** Absolute timeline coordinates survive changing the displayed origin at Charge. */
export const growLiveChartExtent = (
    previous: LiveChartExtent | null,
    input: { key: string; origin: number; minimumRight: number; latest: number; span: number },
): LiveChartExtent => {
    const same = previous?.key === input.key;
    const span = same ? previous.span : input.span;
    const padded = Math.ceil((input.origin + input.latest + Math.max(60, span * 0.1)) / 60) * 60;
    const right = Math.max(same ? previous.right : input.origin + input.minimumRight, padded);
    if (same && previous.right === right) return previous;
    return { key: input.key, right, span };
};

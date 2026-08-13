export const canSubmitBlendRoasted = ({
    blendId,
    hasSelection,
    inputSum,
    outputGrams,
    isPending,
    anyOver,
}: {
    blendId: string;
    hasSelection: boolean;
    inputSum: number;
    outputGrams: number;
    isPending: boolean;
    anyOver: boolean;
}): boolean =>
    !!blendId && hasSelection && inputSum > 0 && outputGrams > 0 && !isPending && !anyOver && outputGrams <= inputSum;

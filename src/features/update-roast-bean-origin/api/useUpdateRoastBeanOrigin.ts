import { beanApi, beanKeys } from '@entities/bean';
import {
    beginOptimisticSessionBeanOrigin,
    finishOptimisticRoastSessionEdit,
    invalidateRoastSessionQueries,
    revertOptimisticRoastSessionEdit,
} from '@entities/roast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export const useUpdateRoastBeanOrigin = (workspaceOwnerId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; origin: string | null }) => {
            await beanApi.update(input);
        },
        meta: { feature: 'history-qc', table: 'beans' },
        onMutate: (input) => beginOptimisticSessionBeanOrigin(qc, workspaceOwnerId, input.id, input.origin),
        onError: (_error, _input, edit) => revertOptimisticRoastSessionEdit(qc, workspaceOwnerId, edit),
        onSettled: (_data, _error, input, edit) =>
            finishOptimisticRoastSessionEdit(qc, workspaceOwnerId, edit, async () => {
                await Promise.all([
                    invalidateRoastSessionQueries(qc, workspaceOwnerId),
                    qc.invalidateQueries({ queryKey: beanKeys.all(workspaceOwnerId), refetchType: 'all' }),
                    qc.invalidateQueries({ queryKey: beanKeys.detail(input.id), refetchType: 'all' }),
                ]);
            }),
    });
};

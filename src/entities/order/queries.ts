import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderInsert, OrderLineInsert } from './api';
import { orderApi } from './api';

export const orderKeys = {
    all: (userId: string) => ['orders', userId] as const,
    requirements: (userId: string) => ['roasting-requirements', userId] as const,
};

export const useOrders = (userId: string) =>
    useQuery({
        queryKey: orderKeys.all(userId),
        queryFn: () => orderApi.list(userId),
        enabled: !!userId,
    });

export const useRoastingRequirements = (userId: string) =>
    useQuery({
        queryKey: orderKeys.requirements(userId),
        queryFn: () => orderApi.getRoastingRequirements(userId),
        enabled: !!userId,
    });

export const useCreateOrder = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            order,
            lines,
        }: {
            order: OrderInsert;
            lines: Omit<OrderLineInsert, 'order_id' | 'user_id'>[];
        }) => orderApi.create(order, lines),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
        },
    });
};

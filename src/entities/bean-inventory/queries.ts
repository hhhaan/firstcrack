import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { beanInventoryApi } from './api'
import type { BeanInventoryLog } from '@shared/types/database.types'

export const beanInventoryKeys = {
    all: (userId: string) => ['inventory_logs', userId] as const,
    byBean: (userId: string, beanId: string) => ['inventory_logs', userId, beanId] as const,
}

export const useBeanInventoryLogs = (userId: string, beanId?: string) =>
    useQuery({
        queryKey: beanId ? beanInventoryKeys.byBean(userId, beanId) : beanInventoryKeys.all(userId),
        queryFn: () => beanInventoryApi.list(userId, beanId),
        enabled: !!userId,
    })

export const useCreateBeanInventoryLog = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: beanInventoryApi.create,
        onSuccess: (newLog) => {
            qc.setQueryData<BeanInventoryLog[]>(beanInventoryKeys.all(userId), (prev = []) => [newLog, ...prev])
            if (newLog.bean_id) {
                qc.setQueryData<BeanInventoryLog[]>(
                    beanInventoryKeys.byBean(userId, newLog.bean_id),
                    (prev = []) => [newLog, ...prev]
                )
            }
            if (newLog.type === 'purchase') {
                qc.invalidateQueries({ queryKey: ['beans', userId] })
            }
        },
    })
}

export const useUpdateBeanInventoryLog = (userId: string, beanId?: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: beanInventoryApi.update,
        onSuccess: (updated) => {
            const patch = (prev: BeanInventoryLog[] = []) =>
                prev.map((l) => (l.id === updated.id ? updated : l))

            qc.setQueryData<BeanInventoryLog[]>(beanInventoryKeys.all(userId), patch)
            if (beanId) {
                qc.setQueryData<BeanInventoryLog[]>(beanInventoryKeys.byBean(userId, beanId), patch)
            }
        },
    })
}

export const useDeleteBeanInventoryLog = (userId: string, beanId?: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: beanInventoryApi.delete,
        onSuccess: (_, id) => {
            const remove = (prev: BeanInventoryLog[] = []) => prev.filter((l) => l.id !== id)

            qc.setQueryData<BeanInventoryLog[]>(beanInventoryKeys.all(userId), remove)
            if (beanId) {
                qc.setQueryData<BeanInventoryLog[]>(beanInventoryKeys.byBean(userId, beanId), remove)
            }
        },
    })
}

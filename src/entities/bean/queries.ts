import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { beanApi } from './api'
import type { Bean } from '@shared/types/database.types'

export const beanKeys = {
    all: (userId: string) => ['beans', userId] as const,
    detail: (id: string) => ['beans', 'detail', id] as const,
}

export const useBeans = (userId: string) =>
    useQuery({
        queryKey: beanKeys.all(userId),
        queryFn: () => beanApi.list(userId),
        enabled: !!userId,
    })

export const useBean = (id: string) =>
    useQuery({
        queryKey: beanKeys.detail(id),
        queryFn: () => beanApi.get(id),
        enabled: !!id,
    })

export const useCreateBean = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: beanApi.create,
        onSuccess: (newBean) => {
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (prev = []) => [newBean, ...prev])
        },
    })
}

export const useUpdateBean = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: beanApi.update,
        onSuccess: (updated) => {
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (prev = []) =>
                prev.map((b) => (b.id === updated.id ? updated : b))
            )
            qc.setQueryData(beanKeys.detail(updated.id), updated)
        },
    })
}

export const useDeleteBean = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: beanApi.delete,
        onSuccess: (_, id) => {
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (prev = []) => prev.filter((b) => b.id !== id))
            qc.removeQueries({ queryKey: beanKeys.detail(id) })
        },
    })
}

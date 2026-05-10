import { useEffect, useState } from 'react'
import { supabase } from '@shared/lib/supabase'
import type { Bean, RoastSessionWithRelations } from '@shared/types/database.types'

export interface MonthlyBatch {
    month: string
    batches: number
}

export interface DashboardData {
    batchesThisMonth: number
    batchesLastMonth: number
    kgRoastedThisMonth: number
    kgRoastedLastMonth: number
    avgDurationSeconds: number
    avgDurationLastMonthSeconds: number
    recentSessions: RoastSessionWithRelations[]
    upcomingSessions: RoastSessionWithRelations[]
    inventoryAlerts: Bean[]
    monthlyBatches: MonthlyBatch[]
    loading: boolean
    error: string | null
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const useDashboard = (userId: string): DashboardData => {
    const [data, setData] = useState<Omit<DashboardData, 'loading' | 'error'>>({
        batchesThisMonth: 0,
        batchesLastMonth: 0,
        kgRoastedThisMonth: 0,
        kgRoastedLastMonth: 0,
        avgDurationSeconds: 0,
        avgDurationLastMonthSeconds: 0,
        recentSessions: [],
        upcomingSessions: [],
        inventoryAlerts: [],
        monthlyBatches: [],
    })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!userId) return;

        const fetch = async () => {
            setLoading(true)
            setError(null)

            try {
                const now = new Date()
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
                const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
                const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString()

                const [completedRes, upcomingRes, alertsRes, monthlyRes] = await Promise.all([
                    // Recent sessions + KPI aggregation
                    supabase
                        .from('roast_sessions')
                        .select('*, beans(name, origin), roast_profiles(name, target_level)')
                        .eq('user_id', userId)
                        .eq('status', 'completed')
                        .gte('roasted_at', lastMonthStart)
                        .order('roasted_at', { ascending: false }),

                    // Upcoming scheduled sessions
                    supabase
                        .from('roast_sessions')
                        .select('*, beans(name, origin), roast_profiles(name, target_level)')
                        .eq('user_id', userId)
                        .eq('status', 'scheduled')
                        .gte('scheduled_at', now.toISOString())
                        .order('scheduled_at', { ascending: true })
                        .limit(3),

                    // Inventory alerts — 전체 가져와서 클라이언트에서 필터 (PostgREST는 컬럼끼리 비교 미지원)
                    supabase
                        .from('beans')
                        .select('*')
                        .eq('user_id', userId),

                    // Monthly batches (last 6 months)
                    supabase
                        .from('roast_sessions')
                        .select('roasted_at, weight_grams')
                        .eq('user_id', userId)
                        .eq('status', 'completed')
                        .gte('roasted_at', sixMonthsAgo)
                        .order('roasted_at', { ascending: true }),
                ])

                if (completedRes.error) throw completedRes.error
                if (upcomingRes.error) throw upcomingRes.error
                if (alertsRes.error) throw alertsRes.error
                if (monthlyRes.error) throw monthlyRes.error

                const completed = completedRes.data as RoastSessionWithRelations[]
                const thisMonth = completed.filter((s) => s.roasted_at! >= thisMonthStart)
                const lastMonth = completed.filter((s) => s.roasted_at! < thisMonthStart)

                const sumKg = (arr: typeof completed) =>
                    arr.reduce((acc, s) => acc + s.weight_grams, 0) / 1000
                const avgDuration = (arr: typeof completed) =>
                    arr.length > 0
                        ? arr.reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0) / arr.length
                        : 0

                // Monthly chart — last 6 months
                const monthlyMap = new Map<string, number>()
                for (let i = 5; i >= 0; i--) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                    monthlyMap.set(`${d.getFullYear()}-${d.getMonth()}`, 0)
                }
                for (const s of (monthlyRes.data ?? []) as { roasted_at: string | null }[]) {
                    const d = new Date(s.roasted_at!)
                    const key = `${d.getFullYear()}-${d.getMonth()}`
                    if (monthlyMap.has(key)) {
                        monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1)
                    }
                }
                const monthlyBatches: MonthlyBatch[] = Array.from(monthlyMap.entries()).map(([key, batches]) => {
                    const [year, month] = key.split('-').map(Number)
                    return { month: MONTH_LABELS[month], batches, year, _month: month }
                }) as MonthlyBatch[]

                // Low stock: 클라이언트 측 필터 (RLS 통해 가져온 후)
                const allBeans = (alertsRes.data ?? []) as Bean[]
                const alerts = allBeans.filter((b) => b.stock_grams <= b.low_stock_threshold_grams)

                setData({
                    batchesThisMonth: thisMonth.length,
                    batchesLastMonth: lastMonth.length,
                    kgRoastedThisMonth: sumKg(thisMonth),
                    kgRoastedLastMonth: sumKg(lastMonth),
                    avgDurationSeconds: avgDuration(thisMonth),
                    avgDurationLastMonthSeconds: avgDuration(lastMonth),
                    recentSessions: completed.slice(0, 5),
                    upcomingSessions: upcomingRes.data as RoastSessionWithRelations[],
                    inventoryAlerts: alerts,
                    monthlyBatches,
                })
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Unknown error')
            } finally {
                setLoading(false)
            }
        }

        fetch()
    }, [userId])

    return { ...data, loading, error }
}

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@shared/lib/supabase'
import type { Bean, RoastSessionWithRelations } from '@shared/types/database.types'

export interface MonthlyBatch {
    month: string
    batches: number
}

export interface UpcomingBatch {
    id: string
    bean_name: string
    batch_type: string
    batch_count: number
    target_roasted_kg: number
    status: string
    date: string
}

export interface DashboardData {
    batchesThisMonth: number
    batchesLastMonth: number
    kgRoastedThisMonth: number
    kgRoastedLastMonth: number
    avgDurationSeconds: number
    avgDurationLastMonthSeconds: number
    recentSessions: RoastSessionWithRelations[]
    upcomingBatches: UpcomingBatch[]
    inventoryAlerts: Bean[]
    monthlyBatches: MonthlyBatch[]
    loading: boolean
    error: string | null
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fetchDashboard = async (userId: string): Promise<Omit<DashboardData, 'loading' | 'error'>> => {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString()

    const [completedRes, upcomingPlansRes, alertsRes, monthlyRes] = await Promise.all([
        supabase
            .from('roast_sessions')
            .select('*, beans(name, origin), roast_profiles(name, target_level)')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', lastMonthStart)
            .order('roasted_at', { ascending: false }),

        supabase
            .from('roast_day_plans')
            .select('id, date')
            .eq('user_id', userId)
            .gte('date', today)
            .order('date')
            .limit(14),

        // 전체 가져와서 클라이언트에서 필터 (PostgREST는 컬럼 간 비교 미지원)
        supabase
            .from('beans')
            .select('*')
            .eq('user_id', userId),

        supabase
            .from('roast_sessions')
            .select('roasted_at, weight_grams')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', sixMonthsAgo)
            .order('roasted_at', { ascending: true }),
    ])

    if (completedRes.error) throw completedRes.error
    if (upcomingPlansRes.error) throw upcomingPlansRes.error
    if (alertsRes.error) throw alertsRes.error
    if (monthlyRes.error) throw monthlyRes.error

    let upcomingBatches: UpcomingBatch[] = []
    if (upcomingPlansRes.data && upcomingPlansRes.data.length > 0) {
        const planIds = upcomingPlansRes.data.map((p) => p.id)
        const planDateMap = new Map(upcomingPlansRes.data.map((p) => [p.id, p.date]))
        const { data: batchData } = await supabase
            .from('roast_plan_batches')
            .select('id, plan_id, bean_name, batch_type, batch_count, target_roasted_kg, status, order_index')
            .in('plan_id', planIds)
            .in('status', ['pending', 'in-progress'])
            .order('order_index')
            .limit(5)
        upcomingBatches = (batchData ?? []).map((b) => ({
            id: b.id,
            bean_name: b.bean_name,
            batch_type: b.batch_type,
            batch_count: b.batch_count,
            target_roasted_kg: b.target_roasted_kg,
            status: b.status,
            date: planDateMap.get(b.plan_id) ?? today,
        }))
    }

    const completed = completedRes.data as RoastSessionWithRelations[]
    const thisMonth = completed.filter((s) => s.roasted_at! >= thisMonthStart)
    const lastMonth = completed.filter((s) => s.roasted_at! < thisMonthStart)

    const sumKg = (arr: typeof completed) =>
        arr.reduce((acc, s) => acc + s.weight_grams, 0) / 1000
    const avgDuration = (arr: typeof completed) =>
        arr.length > 0
            ? arr.reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0) / arr.length
            : 0

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

    const allBeans = (alertsRes.data ?? []) as Bean[]
    const inventoryAlerts = allBeans.filter((b) => b.stock_grams <= b.low_stock_threshold_grams)

    return {
        batchesThisMonth: thisMonth.length,
        batchesLastMonth: lastMonth.length,
        kgRoastedThisMonth: sumKg(thisMonth),
        kgRoastedLastMonth: sumKg(lastMonth),
        avgDurationSeconds: avgDuration(thisMonth),
        avgDurationLastMonthSeconds: avgDuration(lastMonth),
        recentSessions: completed.slice(0, 5),
        upcomingBatches,
        inventoryAlerts,
        monthlyBatches,
    }
}

const EMPTY: Omit<DashboardData, 'loading' | 'error'> = {
    batchesThisMonth: 0,
    batchesLastMonth: 0,
    kgRoastedThisMonth: 0,
    kgRoastedLastMonth: 0,
    avgDurationSeconds: 0,
    avgDurationLastMonthSeconds: 0,
    recentSessions: [],
    upcomingBatches: [],
    inventoryAlerts: [],
    monthlyBatches: [],
}

export const useDashboard = (userId: string): DashboardData => {
    const { data, isLoading, error } = useQuery({
        queryKey: ['dashboard', userId],
        queryFn: () => fetchDashboard(userId),
        enabled: !!userId,
        // 5분 캐시 — 날짜 기반 집계 데이터라 Infinity 대신 짧게 설정
        staleTime: 5 * 60 * 1000,
    })

    return {
        ...(data ?? EMPTY),
        loading: isLoading,
        error: error instanceof Error ? error.message : null,
    }
}

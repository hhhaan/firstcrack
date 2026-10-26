import { useActiveWorkspace } from '@entities/organization';
import { useDashboard, useDashboardMonth } from '@features/dashboard-summary';
import { useCoffeeFutures } from '@shared/api/coffee-futures';
import type { View } from '@shared/types/view';
import { PageLayout } from '@shared/ui/PageLayout';
import { isSameMonth, startOfMonth } from 'date-fns';
import { useState } from 'react';
import { DashboardHeader } from './components/DashboardHeader';
import { InventoryAlerts } from './components/InventoryAlerts';
import { KpiSection } from './components/KpiSection';
import { RecentSessionsTable } from './components/RecentSessionsTable';
import { UpcomingBatches } from './components/UpcomingBatches';

interface DashboardProps {
    onNavigate: (view: View) => void;
}

export const Dashboard = ({ onNavigate }: DashboardProps) => {
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const [month, setMonth] = useState(() => startOfMonth(new Date()));
    const db = useDashboard(userId);
    const pastMonth = useDashboardMonth(userId, month);
    const coffee = useCoffeeFutures();
    const current = isSameMonth(month, new Date());
    const kpi = current ? db : pastMonth;

    return (
        <PageLayout>
            <DashboardHeader month={month} onMonthChange={setMonth} onNavigate={onNavigate} />

            <KpiSection
                month={month}
                batchesThisMonth={kpi.batchesThisMonth}
                batchesLastMonth={kpi.batchesLastMonth}
                kgRoastedThisMonth={kpi.kgRoastedThisMonth}
                kgRoastedLastMonth={kpi.kgRoastedLastMonth}
                dailyMetrics={kpi.dailyMetrics}
                monthlyBatches={db.monthlyBatches}
                loading={kpi.loading}
                coffeeFutures={coffee.data}
                coffeeFuturesLoading={coffee.loading}
                coffeeFuturesRefreshing={coffee.refreshing}
                onRefreshCoffeeFutures={coffee.refetch}
            />

            <RecentSessionsTable data={db.recentSessions} loading={db.loading} onNavigate={onNavigate} />

            <div className="mt-8 grid overflow-hidden rounded-2xl border border-border bg-main-bg lg:grid-cols-2">
                <UpcomingBatches data={db.upcomingBatches} loading={db.loading} onNavigate={onNavigate} />
                <InventoryAlerts data={db.inventoryAlerts} loading={db.loading} />
            </div>
        </PageLayout>
    );
};

import { useActiveWorkspace } from '@entities/organization';
import { useDashboard } from '@features/dashboard-summary';
import { useCoffeeFutures } from '@shared/api/coffee-futures';
import type { View } from '@shared/types/view';
import { PageLayout } from '@shared/ui/PageLayout';
import { DashboardHeader } from './components/DashboardHeader';
import { InventoryAlerts } from './components/InventoryAlerts';
import { KpiSection } from './components/KpiSection';
import { MonthlyChartSection } from './components/MonthlyChartSection';
import { RecentSessionsTable } from './components/RecentSessionsTable';
import { UpcomingBatches } from './components/UpcomingBatches';

interface DashboardProps {
    onNavigate: (view: View) => void;
}

export const Dashboard = ({ onNavigate }: DashboardProps) => {
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const db = useDashboard(userId);
    const coffee = useCoffeeFutures();

    return (
        <PageLayout>
            <DashboardHeader onNavigate={onNavigate} />

            <KpiSection
                batchesThisMonth={db.batchesThisMonth}
                batchesLastMonth={db.batchesLastMonth}
                kgRoastedThisMonth={db.kgRoastedThisMonth}
                kgRoastedLastMonth={db.kgRoastedLastMonth}
                avgDurationSeconds={db.avgDurationSeconds}
                avgDurationLastMonthSeconds={db.avgDurationLastMonthSeconds}
                loading={db.loading}
                coffeeFutures={coffee.data}
                coffeeFuturesLoading={coffee.loading}
                coffeeFuturesRefreshing={coffee.refreshing}
                onRefreshCoffeeFutures={coffee.refetch}
            />

            <div className="grid grid-cols-[1fr_350px] gap-5 mb-5">
                <RecentSessionsTable data={db.recentSessions} loading={db.loading} onNavigate={onNavigate} />
                <MonthlyChartSection
                    monthlyBatches={db.monthlyBatches}
                    batchesThisMonth={db.batchesThisMonth}
                    kgRoastedThisMonth={db.kgRoastedThisMonth}
                    recentSessions={db.recentSessions}
                    loading={db.loading}
                />
            </div>

            <div className="grid grid-cols-2 gap-5">
                <UpcomingBatches data={db.upcomingBatches} loading={db.loading} onNavigate={onNavigate} />
                <InventoryAlerts data={db.inventoryAlerts} loading={db.loading} />
            </div>
        </PageLayout>
    );
};

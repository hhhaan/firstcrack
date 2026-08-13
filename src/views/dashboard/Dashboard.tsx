import { useActiveWorkspace } from '@entities/organization';
import { useCoffeeFutures } from '@shared/api/coffee-futures';
import type { View } from '@shared/types/view';
import { PageLayout } from '@shared/ui/PageLayout';
import { useDashboard } from '@widgets/dashboard-summary/api/useDashboard';
import { resolveDashboardQueryView } from '@widgets/dashboard-summary/lib/queryView';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const db = useDashboard(userId);
    const coffee = useCoffeeFutures();
    const view = resolveDashboardQueryView({ loading: db.loading, error: db.error });

    return (
        <PageLayout>
            <DashboardHeader onNavigate={onNavigate} />

            {view.status === 'error' ? (
                <div
                    role="alert"
                    className="rounded-lg border border-border-subtle p-6 text-sm text-red-600 dark:border-[#585d61]"
                >
                    <div className="mb-2">{t('dashboard.loadError')}</div>
                    {view.message ? <div className="mb-3 text-xs text-muted">{view.message}</div> : null}
                    <button
                        type="button"
                        onClick={() => db.refetch()}
                        className="rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                    >
                        {t('dashboard.retry')}
                    </button>
                </div>
            ) : (
                <>
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
                </>
            )}
        </PageLayout>
    );
};

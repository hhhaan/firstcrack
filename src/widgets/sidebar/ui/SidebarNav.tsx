import { useInventoryAlerts } from '@entities/inventory-alert';
import { useActiveWorkspace } from '@entities/organization';
import { cn } from '@shared/lib/cn';
import { FEATURE, useFeature } from '@shared/lib/features';
import { SIDEBAR_GROUPS, type SidebarNavId, useSidebarPreferences } from '@shared/store/sidebar-preferences';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import {
    Activity,
    Calculator,
    Calendar,
    ChartSpline,
    Cpu,
    Flame,
    History,
    LayoutDashboard,
    Lock,
    type LucideIcon,
    ShoppingCart,
    Sprout,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

const navItems: { id: SidebarNavId; labelKey: string; icon: LucideIcon }[] = [
    { id: 'dashboard', labelKey: 'sidebar.nav.dashboard', icon: LayoutDashboard },
    { id: 'schedule', labelKey: 'sidebar.nav.schedule', icon: Calendar },
    { id: 'roast', labelKey: 'sidebar.nav.roast', icon: Flame },
    { id: 'history', labelKey: 'sidebar.nav.history', icon: History },
    { id: 'cupping', labelKey: 'sidebar.nav.cupping', icon: Activity },
    { id: 'orders', labelKey: 'sidebar.nav.orders', icon: ShoppingCart },
    { id: 'beans', labelKey: 'sidebar.nav.beans', icon: Sprout },
    { id: 'pricing', labelKey: 'sidebar.nav.pricing', icon: Calculator },
    { id: 'profiles', labelKey: 'sidebar.nav.profiles', icon: ChartSpline },
    { id: 'machines', labelKey: 'sidebar.nav.machines', icon: Cpu },
];

const navById = new Map(navItems.map((item) => [item.id, item]));
const groupIdSets = SIDEBAR_GROUPS.map((group) => new Set<string>(group.ids));

/** Stable e2e selectors — view id is the product route key. */
const navTestId = (id: View) => `nav-${id}`;

type SidebarNavProps = {
    activeView: View;
    onNavigate: (view: View) => void;
    collapsed: boolean;
    rail: boolean;
    edgePad: string;
};

export const SidebarNav = ({ activeView, onNavigate, collapsed, rail, edgePad }: SidebarNavProps) => {
    const { t } = useTranslation();
    const { order, hidden } = useSidebarPreferences();
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: inventoryAlerts = [] } = useInventoryAlerts(workspaceOwnerId);
    const alertCount = inventoryAlerts.length;
    const canCupping = useFeature(FEATURE.cupping);
    const canOrders = useFeature(FEATURE.orderIntegration);
    const hiddenIds = new Set(hidden);

    return (
        <nav
            className={cn(
                'flex-1 overflow-y-auto py-1 transition-[padding] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                rail ? 'px-3' : edgePad,
            )}
        >
            <div
                className={cn(
                    'flex flex-col transition-[gap] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    collapsed ? 'gap-1' : 'gap-3',
                )}
            >
                {SIDEBAR_GROUPS.map((group, index) => {
                    const ids = order.filter((id) => groupIdSets[index].has(id) && !hiddenIds.has(id));
                    if (ids.length === 0) return null;
                    return (
                        <div key={group.labelKey}>
                            <div
                                className={cn(
                                    'px-2.5 text-xs leading-4 font-medium text-muted transition-[height,margin,opacity] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden whitespace-nowrap motion-reduce:transition-none',
                                    collapsed ? 'h-0 mb-0 opacity-0' : 'h-4 mb-1.5 opacity-100',
                                )}
                            >
                                {t(group.labelKey)}
                            </div>
                            {ids.map((id) => {
                                const item = navById.get(id);
                                if (!item) return null;
                                const { labelKey, icon: Icon } = item;
                                const isActive = activeView === id;
                                const label = t(labelKey);
                                const showBadge = id === 'beans' && alertCount > 0;
                                const locked = (id === 'cupping' && !canCupping) || (id === 'orders' && !canOrders);
                                return (
                                    <button
                                        type="button"
                                        key={id}
                                        data-testid={navTestId(id)}
                                        onClick={() => onNavigate(id)}
                                        aria-label={label}
                                        aria-current={isActive ? 'page' : undefined}
                                        title={collapsed ? label : undefined}
                                        className={cn(
                                            'flex h-9 w-full cursor-pointer items-center overflow-hidden rounded-lg border-none mb-0.5 transition-[padding,background-color] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                                            isActive
                                                ? 'bg-main-bg shadow-(--shadow-inset)'
                                                : 'bg-transparent hover:bg-primary/5',
                                            collapsed || rail ? 'pl-0' : 'pl-2',
                                        )}
                                    >
                                        <div className="w-9 h-9 shrink-0 flex items-center justify-center relative">
                                            <Icon
                                                size={16}
                                                strokeWidth={2}
                                                className={isActive ? 'text-primary' : 'text-muted'}
                                            />
                                            {showBadge && collapsed && (
                                                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" />
                                            )}
                                            {locked && collapsed && (
                                                <span className="absolute bottom-1 right-1 text-muted">
                                                    <Lock size={10} />
                                                </span>
                                            )}
                                        </div>
                                        <div
                                            className={cn(
                                                'flex min-w-0 items-center gap-2 transition-[opacity,translate] duration-150 overflow-hidden whitespace-nowrap motion-reduce:transition-none',
                                                collapsed
                                                    ? 'opacity-0 -translate-x-1'
                                                    : 'opacity-100 translate-x-0 delay-75 motion-reduce:delay-0',
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'text-[13px]',
                                                    isActive
                                                        ? 'font-medium text-primary'
                                                        : 'font-normal text-secondary',
                                                )}
                                            >
                                                {label}
                                            </span>
                                            {locked && !collapsed && (
                                                <Lock size={12} className="shrink-0 text-muted" aria-hidden />
                                            )}
                                            {showBadge && !collapsed && (
                                                <Badge size="sm" tone="amber" className="font-semibold">
                                                    {alertCount}
                                                </Badge>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </nav>
    );
};

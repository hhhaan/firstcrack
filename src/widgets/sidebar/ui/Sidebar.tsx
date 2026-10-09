import {
    Activity,
    Book,
    Calculator,
    Calendar,
    ChevronDown,
    Chip,
    CropGrowth,
    Dashboard,
    Fire,
    RecentlyViewed,
    ShoppingCart,
    SidePanelClose,
    SidePanelOpen,
} from '@carbon/icons-react';
import { useInventoryAlerts } from '@entities/inventory-alert';
import { useActiveWorkspace } from '@entities/organization';
import { cn } from '@shared/lib/cn';
import { FEATURE, useFeature } from '@shared/lib/features';
import { useAuthStore } from '@shared/store/auth';
import { formatShortcut, useShortcutKeys } from '@shared/store/keyboard-shortcuts';
import { useThemeStore } from '@shared/store/theme';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { Check, Lock, Settings } from 'lucide-react';
import { type ComponentType, type CSSProperties, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../../../entities/profile';

interface SidebarProps {
    activeView: View;
    onNavigate: (view: View) => void;
    collapsed: boolean;
    rail?: boolean;
    onToggleCollapse: () => void;
    onOpenSettings: (tab?: string) => void;
}

type SidebarIcon = ComponentType<{ size?: number; className?: string; style?: CSSProperties }>;

const navItems: { id: View; labelKey: string; icon: SidebarIcon }[] = [
    { id: 'dashboard', labelKey: 'sidebar.nav.dashboard', icon: Dashboard },
    { id: 'schedule', labelKey: 'sidebar.nav.schedule', icon: Calendar },
    { id: 'roast', labelKey: 'sidebar.nav.roast', icon: Fire },
    { id: 'history', labelKey: 'sidebar.nav.history', icon: RecentlyViewed },
    { id: 'cupping', labelKey: 'sidebar.nav.cupping', icon: Activity },
    { id: 'orders', labelKey: 'sidebar.nav.orders', icon: ShoppingCart },
    { id: 'beans', labelKey: 'sidebar.nav.beans', icon: CropGrowth },
    { id: 'pricing', labelKey: 'sidebar.nav.pricing', icon: Calculator },
    { id: 'profiles', labelKey: 'sidebar.nav.profiles', icon: Book },
    { id: 'machines', labelKey: 'sidebar.nav.machines', icon: Chip },
];

/** Stable e2e selectors — view id is the product route key. */
const navTestId = (id: View) => `nav-${id}`;

export const Sidebar = ({
    activeView,
    onNavigate,
    collapsed,
    rail = false,
    onToggleCollapse,
    onOpenSettings,
}: SidebarProps) => {
    const { t } = useTranslation();
    const [isHeaderHovered, setIsHeaderHovered] = useState(false);
    const [wsOpen, setWsOpen] = useState(false);
    const settingsKeys = useShortcutKeys('openSettings');
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId, setActiveOwner, memberships, authUserId } = useActiveWorkspace();
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    const logoSrc = resolvedTheme === 'dark' ? '/logo_dark.png' : '/logo.png';
    const { data: profile } = useProfile(user?.id ?? '');
    const { data: inventoryAlerts = [] } = useInventoryAlerts(workspaceOwnerId);
    const alertCount = inventoryAlerts.length;
    const canCupping = useFeature(FEATURE.cupping);
    const canOrders = useFeature(FEATURE.orderIntegration);

    const myName = profile?.business_name || t('sidebar.myWorkspace');
    const activeMembership = useMemo(
        () => memberships.find((m) => m.owner_id === workspaceOwnerId),
        [memberships, workspaceOwnerId],
    );
    const workspaceName =
        workspaceOwnerId === authUserId
            ? myName
            : activeMembership?.owner_business_name || activeMembership?.org_name || t('sidebar.workspace');
    const workspaceInitial = workspaceName.charAt(0).toUpperCase();
    const edgePad = collapsed ? 'px-4' : 'px-3';

    return (
        <aside
            data-testid="app-sidebar"
            className={cn(
                'shrink-0 h-full bg-main-bg border-r border-border dark:border-[#585d61] flex flex-col overflow-hidden transition-[width] duration-220 ease-in-out',
                rail ? 'w-[60px]' : collapsed ? 'w-[68px]' : 'w-[170px] sm:w-[200px] lg:w-[220px]',
            )}
        >
            {/* Header */}
            <div
                className={cn(
                    'border-b border-border-subtle dark:border-[#585d61] transition-all duration-200',
                    rail ? 'px-3 pt-4 pb-3.5' : collapsed ? 'px-4 pt-4 pb-3.5' : 'px-5 pt-5 pb-4',
                )}
                onMouseEnter={() => setIsHeaderHovered(true)}
                onMouseLeave={() => setIsHeaderHovered(false)}
            >
                <div className={cn('flex items-center gap-2.5', collapsed ? 'justify-center' : 'justify-between')}>
                    {collapsed ? (
                        <div className="relative w-9 h-9 flex items-center justify-center">
                            <div
                                className={cn(
                                    'absolute inset-0 flex items-center justify-center transition-all duration-200',
                                    isHeaderHovered && !rail
                                        ? 'opacity-0 scale-90 invisible'
                                        : 'opacity-100 scale-100 visible',
                                )}
                            >
                                <img src={logoSrc} alt="First Crack" className="w-8 h-8 shrink-0" />
                            </div>
                            <button
                                type="button"
                                onClick={onToggleCollapse}
                                aria-label={t('sidebar.expand')}
                                title={t('sidebar.expand')}
                                className={cn(
                                    'absolute inset-0 w-9 h-9 rounded-lg border-none bg-transparent text-primary flex items-center justify-center cursor-pointer shrink-0 transition-all duration-200 hover:bg-surface hover:shadow-(--shadow-inset)',
                                    isHeaderHovered && !rail
                                        ? 'opacity-100 scale-100 visible'
                                        : 'opacity-0 scale-90 invisible',
                                )}
                                disabled={rail}
                                tabIndex={rail ? -1 : undefined}
                            >
                                <SidePanelOpen size={18} />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div
                                className="flex items-center gap-2.5 min-w-0 cursor-pointer select-none"
                                onClick={async () => {
                                    if ((window as Window & { __TAURI__?: unknown }).__TAURI__) {
                                        const { message } = await import('@tauri-apps/plugin-dialog');
                                        void message('First Crack no Football Club');
                                    } else {
                                        alert('First Crack no Football Club');
                                    }
                                }}
                            >
                                <img src={logoSrc} alt="First Crack" className="w-8 h-8 shrink-0" />
                            </div>
                            <button
                                type="button"
                                onClick={onToggleCollapse}
                                aria-label={t('sidebar.collapse')}
                                title={t('sidebar.collapse')}
                                className="w-9 h-9 rounded-lg border-none bg-transparent text-muted flex items-center justify-center cursor-pointer shrink-0 transition-all duration-200 hover:bg-surface hover:shadow-(--shadow-inset) hover:text-primary"
                            >
                                <SidePanelClose size={18} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Workspace selector */}
            <div className={cn('pt-3 pb-2', rail ? 'px-3' : edgePad)}>
                <Popover open={wsOpen} onOpenChange={setWsOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label={t('sidebar.workspaceSelector')}
                            title={collapsed ? workspaceName : undefined}
                            className="w-full flex items-center rounded-lg border-none bg-surface cursor-pointer shadow-(--shadow-inset) h-9 overflow-hidden"
                        >
                            <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                                <div className="w-5.5 h-5.5 rounded-[5px] bg-surface-warm-solid flex items-center justify-center text-[11px] font-semibold text-secondary">
                                    {workspaceInitial}
                                </div>
                            </div>
                            <div
                                className={cn(
                                    'flex-1 flex items-center justify-between pr-2.5 transition-all duration-220 overflow-hidden whitespace-nowrap',
                                    collapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-[160px]',
                                )}
                            >
                                <span className="text-[13px] font-medium text-primary tracking-[0.14px] truncate">
                                    {workspaceName}
                                </span>
                                <ChevronDown size={14} className="shrink-0 ml-1 text-muted" />
                            </div>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[220px] p-1.5" align="start" side="bottom">
                        <button
                            type="button"
                            onClick={() => {
                                setActiveOwner(null);
                                setWsOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border-none bg-transparent hover:bg-surface cursor-pointer text-left"
                        >
                            <div className="w-6 h-6 rounded-[5px] bg-surface-warm-solid flex items-center justify-center text-[10px] font-semibold text-secondary shrink-0">
                                {myName.charAt(0).toUpperCase()}
                            </div>
                            <span className="flex-1 text-[13px] text-primary truncate">{myName}</span>
                            {workspaceOwnerId === authUserId && (
                                <Check size={14} className="text-palette-teal shrink-0" />
                            )}
                        </button>
                        {memberships.map((m) => {
                            const name = m.owner_business_name || m.org_name;
                            const active = workspaceOwnerId === m.owner_id;
                            return (
                                <button
                                    key={m.org_id}
                                    type="button"
                                    onClick={() => {
                                        setActiveOwner(m.owner_id);
                                        setWsOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border-none bg-transparent hover:bg-surface cursor-pointer text-left"
                                >
                                    <div className="w-6 h-6 rounded-[5px] bg-surface-warm-solid flex items-center justify-center text-[10px] font-semibold text-secondary shrink-0">
                                        {name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="flex-1 text-[13px] text-primary truncate">{name}</span>
                                    {active && <Check size={14} className="text-palette-teal shrink-0" />}
                                </button>
                            );
                        })}
                        <div className="h-px bg-border-subtle my-1" />
                        <button
                            type="button"
                            onClick={() => {
                                setWsOpen(false);
                                onOpenSettings('team');
                            }}
                            className="w-full px-2.5 py-2 rounded-lg border-none bg-transparent hover:bg-surface cursor-pointer text-left text-[12px] text-muted"
                        >
                            {t('settings.tabs.team.label')}
                        </button>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Nav */}
            <nav className={cn('flex-1 overflow-y-auto py-1', rail ? 'px-3' : edgePad)}>
                <div className="mb-1">
                    <div
                        className={cn(
                            'font-medium text-muted transition-all duration-220 overflow-hidden whitespace-nowrap',
                            collapsed ? 'opacity-0 h-0 p-0' : 'opacity-100 mb-1.5 px-2.5 text-xs',
                        )}
                    >
                        {t('sidebar.workspace')}
                    </div>
                    {navItems.map(({ id, labelKey, icon: Icon }) => {
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
                                title={collapsed ? label : undefined}
                                className="w-full flex items-center rounded-lg border-none cursor-pointer mb-0.5 transition-colors duration-150 bg-transparent hover:bg-primary/5 h-9 overflow-hidden"
                            >
                                <div className="w-9 h-9 shrink-0 flex items-center justify-center relative">
                                    <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
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
                                        'flex items-center gap-2 transition-all duration-220 overflow-hidden whitespace-nowrap',
                                        collapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-[150px]',
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'text-[13px]',
                                            isActive ? 'font-medium text-primary' : 'font-normal text-secondary',
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
            </nav>

            {/* Footer */}
            <div className={cn('py-2.5 border-t border-border-subtle dark:border-[#585d61]', rail ? 'px-3' : edgePad)}>
                <button
                    type="button"
                    aria-label={t('sidebar.settings')}
                    title={
                        settingsKeys.length
                            ? `${t('sidebar.settings')} (${formatShortcut(settingsKeys)})`
                            : t('sidebar.settings')
                    }
                    onClick={() => onOpenSettings()}
                    className="flex h-9 w-full items-center overflow-hidden rounded-lg bg-transparent text-secondary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                        <Settings size={18} strokeWidth={1.5} />
                    </span>
                    {!collapsed && (
                        <>
                            <span className="flex-1 text-left text-[13px]">{t('sidebar.settings')}</span>
                            <kbd className="pr-2 whitespace-nowrap font-sans text-xs text-muted opacity-60">
                                {formatShortcut(settingsKeys)}
                            </kbd>
                        </>
                    )}
                </button>
            </div>
        </aside>
    );
};

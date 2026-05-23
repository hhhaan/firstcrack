import { type FC, useState } from 'react';
import { cn } from '@shared/lib/cn';
import {
    LayoutDashboard,
    Flame,
    ClipboardList,
    Coffee,
    BookOpen,
    Settings,
    ChevronDown,
    PanelLeft,
    Cpu,
    CalendarDays,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type View } from '@shared/types/view';
import { useAuthStore } from '@shared/store/auth';
import { useProfile } from '../../../entities/profile';

interface SidebarProps {
    activeView: View;
    onNavigate: (view: View) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onOpenSettings: (tab?: string) => void;
}

const navItems: { id: View; labelKey: string; icon: FC<{ size?: number; strokeWidth?: number; color?: string }> }[] = [
    { id: 'dashboard', labelKey: 'sidebar.nav.dashboard', icon: LayoutDashboard },
    { id: 'schedule', labelKey: 'sidebar.nav.schedule', icon: CalendarDays },
    { id: 'roast', labelKey: 'sidebar.nav.roast', icon: Flame },
    { id: 'history', labelKey: 'sidebar.nav.history', icon: ClipboardList },
    { id: 'beans', labelKey: 'sidebar.nav.beans', icon: Coffee },
    { id: 'profiles', labelKey: 'sidebar.nav.profiles', icon: BookOpen },
    { id: 'machines', labelKey: 'sidebar.nav.machines', icon: Cpu },
];

export const Sidebar = ({ activeView, onNavigate, collapsed, onToggleCollapse, onOpenSettings }: SidebarProps) => {
    const { t } = useTranslation();
    const [isHeaderHovered, setIsHeaderHovered] = useState(false);
    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');
    const workspaceName = profile?.business_name || 'My Roastery';
    const workspaceInitial = workspaceName.charAt(0).toUpperCase();

    return (
        <aside
            className="shrink-0 h-screen bg-main-bg border-r border-border flex flex-col overflow-hidden transition-[width] duration-220 ease-in-out"
            style={{ width: collapsed ? 68 : 240 }}
        >
            {/* Header */}
            <div
                className={cn(
                    'border-b border-border-subtle transition-all duration-200',
                    collapsed ? 'px-4 pt-4 pb-3.5' : 'px-5 pt-5 pb-4',
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
                                    isHeaderHovered ? 'opacity-0 scale-90 invisible' : 'opacity-100 scale-100 visible',
                                )}
                            >
                                <img src="/logo.png" alt="First Crack" className="w-8 h-8 shrink-0" />
                            </div>
                            <button
                                onClick={onToggleCollapse}
                                aria-label={t('sidebar.expand')}
                                title={t('sidebar.expand')}
                                className={cn(
                                    'absolute inset-0 w-9 h-9 rounded-lg border-none bg-transparent text-primary flex items-center justify-center cursor-pointer shrink-0 transition-all duration-200 hover:bg-surface hover:shadow-(--shadow-inset)',
                                    isHeaderHovered ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-90 invisible',
                                )}
                            >
                                <PanelLeft size={18} strokeWidth={2.1} />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div
                                className="flex items-center gap-2.5 min-w-0 cursor-pointer select-none"
                                onClick={async () => {
                                    if ((window as Window & { __TAURI__?: unknown }).__TAURI__) {
                                        const { message } = await import('@tauri-apps/plugin-dialog');
                                        message('First Crack no Football Club');
                                    } else {
                                        alert('First Crack no Football Club');
                                    }
                                }}
                            >
                                <img src="/logo.png" alt="First Crack" className="w-8 h-8 shrink-0" />
                            </div>
                            <button
                                onClick={onToggleCollapse}
                                aria-label={t('sidebar.collapse')}
                                title={t('sidebar.collapse')}
                                className="w-9 h-9 rounded-lg border-none bg-transparent text-muted flex items-center justify-center cursor-pointer shrink-0 transition-all duration-200 hover:bg-surface hover:shadow-(--shadow-inset) hover:text-primary"
                            >
                                <PanelLeft size={18} strokeWidth={2.1} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Workspace selector */}
            <div className={collapsed ? 'px-2 pt-3 pb-2' : 'px-3 pt-3 pb-2'}>
                <button
                    onClick={() => onOpenSettings('workspace')}
                    aria-label={t('sidebar.workspaceSelector')}
                    title={collapsed ? t('sidebar.workspace') : undefined}
                    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-2.5 py-2 rounded-lg border-none bg-surface cursor-pointer shadow-(--shadow-inset)`}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-5.5 h-5.5 rounded-[5px] bg-surface-warm-solid flex items-center justify-center text-[11px] font-semibold text-secondary">
                            {workspaceInitial}
                        </div>
                        {!collapsed && (
                            <span className="text-[13px] font-medium text-primary tracking-[0.14px]">{workspaceName}</span>
                        )}
                    </div>
                    {!collapsed && <ChevronDown size={14} strokeWidth={2} color="var(--color-muted)" />}
                </button>
            </div>

            {/* Nav */}
            <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-2 py-1' : 'px-3 py-1'}`}>
                <div className="mb-1">
                    {!collapsed && (
                        <div className="text-[11px] font-medium text-muted tracking-[0.7px] uppercase px-2.5 pt-2 pb-1">
                            {t('sidebar.workspace')}
                        </div>
                    )}
                    {navItems.map(({ id, labelKey, icon: Icon }) => {
                        const isActive = activeView === id;
                        const label = t(labelKey);
                        return (
                            <button
                                key={id}
                                onClick={() => onNavigate(id)}
                                aria-label={label}
                                title={collapsed ? label : undefined}
                                className={cn(
                                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border-none cursor-pointer mb-0.5 transition-colors duration-150 bg-transparent hover:bg-surface/50',
                                    collapsed ? 'justify-center' : 'justify-start',
                                )}
                            >
                                <Icon
                                    size={16}
                                    strokeWidth={isActive ? 2.2 : 1.5}
                                    color={isActive ? 'var(--color-primary)' : 'var(--color-muted)'}
                                />
                                {!collapsed && (
                                    <span
                                        className={`text-[14px] tracking-[0.14px] ${isActive ? 'font-semibold' : 'font-normal'}`}
                                        style={{ color: isActive ? 'var(--color-primary)' : 'var(--color-secondary)' }}
                                    >
                                        {label}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </nav>

            {/* Footer */}
            <div className="p-3 border-t border-border-subtle">
                <button
                    onClick={() => onOpenSettings()}
                    aria-label={t('sidebar.settings')}
                    title={collapsed ? t('sidebar.settings') : undefined}
                    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-start'} gap-2.5 px-2.5 py-2 rounded-lg border-none cursor-pointer shadow-(--shadow-inset)`}
                >
                    <div className="w-7 h-7 rounded-full bg-surface-warm-solid flex items-center justify-center text-[11px] font-semibold text-secondary shrink-0 shadow-(--shadow-inset)">
                        H
                    </div>
                    {!collapsed && (
                        <>
                            <div className="text-left flex-1 min-w-0">
                                <div className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                    {t('sidebar.settings')}
                                </div>
                                <div className="text-[11px] text-muted tracking-[0.14px] overflow-hidden text-ellipsis whitespace-nowrap">
                                    {t('sidebar.workspacePreferences')}
                                </div>
                            </div>
                            <Settings size={14} strokeWidth={1.5} color="var(--color-muted)" />
                        </>
                    )}
                    {collapsed && <Settings size={14} strokeWidth={1.5} color="var(--color-muted)" />}
                </button>
            </div>
        </aside>
    );
};

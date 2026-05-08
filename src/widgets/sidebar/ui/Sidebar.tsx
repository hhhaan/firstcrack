import { type FC } from 'react';
import {
    LayoutDashboard,
    Flame,
    ClipboardList,
    Coffee,
    BookOpen,
    Settings,
    ChevronDown,
    Menu,
    Cpu,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type View } from '../../../shared/types/view';

interface SidebarProps {
    activeView: View;
    onNavigate: (view: View) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onOpenSettings: () => void;
}

const navItems: { id: View; labelKey: string; icon: FC<{ size?: number; strokeWidth?: number; color?: string }> }[] = [
    { id: 'dashboard', labelKey: 'sidebar.nav.dashboard', icon: LayoutDashboard },
    { id: 'roast', labelKey: 'sidebar.nav.roast', icon: Flame },
    { id: 'history', labelKey: 'sidebar.nav.history', icon: ClipboardList },
    { id: 'beans', labelKey: 'sidebar.nav.beans', icon: Coffee },
    { id: 'profiles', labelKey: 'sidebar.nav.profiles', icon: BookOpen },
    { id: 'machines', labelKey: 'sidebar.nav.machines', icon: Cpu },
];

export const Sidebar = ({ activeView, onNavigate, collapsed, onToggleCollapse, onOpenSettings }: SidebarProps) => {
    const { t } = useTranslation();

    return (
        <aside
            className="shrink-0 h-screen bg-main-bg border-r border-border flex flex-col overflow-hidden transition-[width] duration-220 ease-in-out"
            style={{ width: collapsed ? 88 : 240 }}
        >
            {/* Header */}
            <div className={`border-b border-border-subtle ${collapsed ? 'px-3.5 pt-4 pb-3.5' : 'px-5 pt-5 pb-4'}`}>
                <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'justify-between'}`}>
                    {!collapsed && (
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div>
                                <div className="font-display font-light text-base leading-[1.2] text-primary tracking-[-0.2px]">
                                    First Crack
                                </div>
                                <div className="text-[11px] text-muted tracking-[0.14px] font-medium">
                                    {t('sidebar.roasteryDashboard')}
                                </div>
                            </div>
                        </div>
                    )}
                    <button
                        onClick={onToggleCollapse}
                        aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
                        title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
                        className="w-8 h-8 rounded-lg border-none bg-surface text-muted flex items-center justify-center cursor-pointer shrink-0 shadow-(--shadow-inset)"
                    >
                        <Menu size={15} strokeWidth={1.9} />
                    </button>
                </div>
            </div>

            {/* Workspace selector */}
            <div className={collapsed ? 'px-2.5 pt-3 pb-2' : 'px-3 pt-3 pb-2'}>
                <button
                    aria-label={t('sidebar.workspaceSelector')}
                    title={collapsed ? t('sidebar.workspace') : undefined}
                    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-[10px] py-2 rounded-lg border-none bg-surface cursor-pointer shadow-(--shadow-inset)`}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-5.5 h-5.5 rounded-[5px] bg-surface-warm-solid flex items-center justify-center text-[11px] font-semibold text-secondary">
                            B
                        </div>
                        {!collapsed && (
                            <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                Brewlab Works
                            </span>
                        )}
                    </div>
                    {!collapsed && <ChevronDown size={14} strokeWidth={2} color="var(--color-muted)" />}
                </button>
            </div>

            {/* Nav */}
            <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-2.5 py-1' : 'px-3 py-1'}`}>
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
                                className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-start'} gap-2.5 px-2.5 py-2 rounded-lg border-none cursor-pointer mb-0.5 transition-[background] duration-150 ${isActive ? 'bg-surface shadow-(--shadow-inset)' : 'bg-transparent'}`}
                            >
                                <Icon
                                    size={16}
                                    strokeWidth={isActive ? 2 : 1.5}
                                    color={isActive ? 'var(--color-primary)' : 'var(--color-muted)'}
                                />
                                {!collapsed && (
                                    <span
                                        className={`text-[14px] tracking-[0.14px] ${isActive ? 'font-medium' : 'font-normal'}`}
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
                    onClick={onOpenSettings}
                    aria-label={t('sidebar.settings')}
                    title={collapsed ? t('sidebar.settings') : undefined}
                    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-start'} gap-2.5 px-2.5 py-2 rounded-lg border-none bg-surface cursor-pointer shadow-(--shadow-inset)`}
                >
                    <div className="w-7 h-7 rounded-full bg-surface-warm-solid flex items-center justify-center text-[11px] font-semibold text-secondary shrink-0 shadow-(--shadow-inset)">
                        H
                    </div>
                    {!collapsed && (
                        <>
                            <div className="text-left flex-1 min-w-0">
                                <div className="text-[13px] font-medium text-primary tracking-[0.14px]">{t('sidebar.settings')}</div>
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

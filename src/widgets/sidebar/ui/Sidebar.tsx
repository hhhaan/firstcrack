import { ChevronDown, SidePanelClose, SidePanelOpen } from '@carbon/icons-react';
import { useActiveWorkspace } from '@entities/organization';
import { cn } from '@shared/lib/cn';
import { useAuthStore } from '@shared/store/auth';
import { formatShortcut, useShortcutKeys } from '@shared/store/keyboard-shortcuts';
import { useThemeStore } from '@shared/store/theme';
import type { View } from '@shared/types/view';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { Check, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../../../entities/profile';
import { SidebarNav } from './SidebarNav';

interface SidebarProps {
    activeView: View;
    onNavigate: (view: View) => void;
    collapsed: boolean;
    rail?: boolean;
    onToggleCollapse: () => void;
    onOpenSettings: (tab?: string) => void;
}

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
    const edgePad = collapsed ? 'px-[8.5px]' : 'px-4';

    return (
        <aside
            data-testid="app-sidebar"
            className={cn(
                'shrink-0 h-full bg-transparent flex flex-col overflow-hidden transition-[width] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                rail ? 'w-[60px]' : collapsed ? 'w-[53px]' : 'w-[170px] sm:w-[200px] lg:w-[224px]',
            )}
        >
            {/* Header */}
            <div
                className={cn(
                    'group/sidebar-header pt-3 pb-2 transition-[padding] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    rail ? 'px-3' : collapsed ? 'px-[8.5px]' : 'px-5',
                )}
                onMouseEnter={() => setIsHeaderHovered(true)}
                onMouseLeave={() => setIsHeaderHovered(false)}
            >
                <div className="relative flex h-9 items-center">
                    <button
                        type="button"
                        disabled={collapsed}
                        className={cn(
                            'flex w-9 h-9 shrink-0 items-center justify-center border-none bg-transparent p-0 cursor-pointer select-none transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none',
                            collapsed && 'pointer-events-none',
                            collapsed && !rail && 'group-focus-within/sidebar-header:opacity-0',
                            collapsed && isHeaderHovered && !rail ? 'opacity-0' : 'opacity-100',
                        )}
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
                    </button>
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        aria-label={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
                        aria-expanded={!collapsed}
                        title={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
                        disabled={rail}
                        tabIndex={rail ? -1 : undefined}
                        className={cn(
                            'absolute right-0 w-9 h-9 rounded-lg border-none bg-transparent text-muted flex items-center justify-center cursor-pointer transition-[opacity,color,background-color,box-shadow] duration-150 hover:bg-surface hover:shadow-(--shadow-inset) hover:text-primary focus:opacity-100 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none',
                            rail ? 'invisible opacity-0' : collapsed && !isHeaderHovered ? 'opacity-0' : 'opacity-100',
                        )}
                    >
                        {collapsed ? <SidePanelOpen size={18} /> : <SidePanelClose size={18} />}
                    </button>
                </div>
            </div>

            {/* Workspace selector */}
            <div
                className={cn(
                    'pt-3 pb-2 transition-[padding] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    rail ? 'px-3' : edgePad,
                )}
            >
                <Popover open={wsOpen} onOpenChange={setWsOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label={t('sidebar.workspaceSelector')}
                            title={collapsed ? workspaceName : undefined}
                            className="flex h-10 w-full cursor-pointer items-center overflow-hidden rounded-xl border border-border bg-input-bg shadow-xs"
                        >
                            <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                                <div className="w-5.5 h-5.5 rounded-[5px] bg-surface-warm-solid flex items-center justify-center text-[11px] font-semibold text-secondary">
                                    {workspaceInitial}
                                </div>
                            </div>
                            <div
                                className={cn(
                                    'flex-1 min-w-0 flex items-center justify-between pr-2.5 transition-[opacity,translate] duration-150 overflow-hidden whitespace-nowrap motion-reduce:transition-none',
                                    collapsed
                                        ? 'opacity-0 -translate-x-1'
                                        : 'opacity-100 translate-x-0 delay-75 motion-reduce:delay-0',
                                )}
                            >
                                <span className="truncate text-sm font-medium leading-5 text-primary">
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

            <SidebarNav
                activeView={activeView}
                onNavigate={onNavigate}
                collapsed={collapsed}
                rail={rail}
                edgePad={edgePad}
            />

            {/* Footer */}
            <div
                className={cn(
                    'py-2.5 transition-[padding] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    rail ? 'px-3' : edgePad,
                )}
            >
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
                        <Settings size={18} strokeWidth={2} />
                    </span>
                    <span
                        aria-hidden={collapsed}
                        className={cn(
                            'flex flex-1 min-w-0 items-center whitespace-nowrap transition-[opacity,translate] duration-150 motion-reduce:transition-none',
                            collapsed
                                ? 'opacity-0 -translate-x-1'
                                : 'opacity-100 translate-x-0 delay-75 motion-reduce:delay-0',
                        )}
                    >
                        <span className="flex-1 text-left text-sm font-[450]">{t('sidebar.settings')}</span>
                        <kbd className="pr-2 whitespace-nowrap font-sans text-xs text-muted opacity-60">
                            {formatShortcut(settingsKeys)}
                        </kbd>
                    </span>
                </button>
            </div>
        </aside>
    );
};

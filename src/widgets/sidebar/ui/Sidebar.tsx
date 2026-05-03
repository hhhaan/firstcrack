import { type FC } from 'react';
import { LayoutDashboard, Flame, ClipboardList, Coffee, BookOpen, Settings, ChevronDown, Menu, Cpu } from 'lucide-react';
import { type View } from '../../../shared/types/view';

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
}

const navItems: { id: View; label: string; icon: FC<{ size?: number; strokeWidth?: number; color?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'roast', label: 'Active Roast', icon: Flame },
  { id: 'history', label: 'Roast History', icon: ClipboardList },
  { id: 'beans', label: 'Bean Inventory', icon: Coffee },
  { id: 'profiles', label: 'Profiles', icon: BookOpen },
  { id: 'machines', label: 'Machines', icon: Cpu },
];

export const Sidebar = ({
  activeView,
  onNavigate,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
}: SidebarProps) => {
  return (
    <aside
      className="flex-shrink-0 h-screen bg-(--color-main-bg) border-r border-(--color-border) flex flex-col overflow-hidden transition-[width] duration-[220ms] ease-in-out"
      style={{ width: collapsed ? 88 : 240 }}
    >
      {/* Header */}
      <div className={`border-b border-(--color-border-subtle) ${collapsed ? 'px-[14px] pt-4 pb-[14px]' : 'px-5 pt-5 pb-4'}`}>
        <div className={`flex items-center gap-[10px] ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div className="flex items-center gap-[10px] min-w-0">
              <div>
                <div className="font-display font-light text-base leading-[1.2] text-(--color-primary) tracking-[-0.2px]">
                  First Crack
                </div>
                <div className="text-[11px] text-(--color-muted) tracking-[0.14px] font-medium">
                  Roastery Dashboard
                </div>
              </div>
            </div>
          )}
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-8 h-8 rounded-lg border-none bg-(--color-surface) text-(--color-muted) flex items-center justify-center cursor-pointer flex-shrink-0 shadow-(--shadow-inset)"
          >
            <Menu size={15} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      {/* Workspace selector */}
      <div className={collapsed ? 'px-[10px] pt-3 pb-2' : 'px-3 pt-3 pb-2'}>
        <button
          aria-label="Workspace selector"
          title={collapsed ? 'Workspace' : undefined}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-[10px] py-2 rounded-lg border-none bg-(--color-surface) cursor-pointer shadow-(--shadow-inset)`}
        >
          <div className="flex items-center gap-2">
            <div className="w-[22px] h-[22px] rounded-[5px] bg-(--color-surface-warm-solid) flex items-center justify-center text-[11px] font-semibold text-(--color-secondary)">
              B
            </div>
            {!collapsed && (
              <span className="text-[13px] font-medium text-(--color-primary) tracking-[0.14px]">
                Brewlab Works
              </span>
            )}
          </div>
          {!collapsed && <ChevronDown size={14} strokeWidth={2} color="var(--color-muted)" />}
        </button>
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-[10px] py-1' : 'px-3 py-1'}`}>
        <div className="mb-1">
          {!collapsed && (
            <div className="text-[11px] font-medium text-(--color-muted) tracking-[0.7px] uppercase px-[10px] pt-2 pb-1">
              Workspace
            </div>
          )}
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activeView === id;
            const isRoast = id === 'roast';
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                aria-label={label}
                title={collapsed ? label : undefined}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-start'} gap-[10px] px-[10px] py-2 rounded-lg border-none cursor-pointer mb-0.5 transition-[background] duration-150 ${isActive ? 'bg-(--color-surface) shadow-(--shadow-inset)' : 'bg-transparent'}`}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.5}
                  color={isRoast && isActive ? '#22c55e' : isActive ? 'var(--color-primary)' : 'var(--color-muted)'}
                />
                {!collapsed && (
                  <span
                    className={`text-[14px] tracking-[0.14px] ${isActive ? 'font-medium' : 'font-normal'}`}
                    style={{ color: isRoast && isActive ? '#22c55e' : isActive ? 'var(--color-primary)' : 'var(--color-secondary)' }}
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
      <div className="p-3 border-t border-(--color-border-subtle)">
        <button
          onClick={onOpenSettings}
          aria-label="Open settings"
          title={collapsed ? 'Settings' : undefined}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-start'} gap-[10px] px-[10px] py-2 rounded-lg border-none bg-(--color-surface) cursor-pointer shadow-(--shadow-inset)`}
        >
          <div className="w-7 h-7 rounded-full bg-(--color-surface-warm-solid) flex items-center justify-center text-[11px] font-semibold text-(--color-secondary) flex-shrink-0 shadow-(--shadow-inset)">
            H
          </div>
          {!collapsed && (
            <>
              <div className="text-left flex-1 min-w-0">
                <div className="text-[13px] font-medium text-(--color-primary) tracking-[0.14px]">
                  Settings
                </div>
                <div className="text-[11px] text-(--color-muted) tracking-[0.14px] overflow-hidden text-ellipsis whitespace-nowrap">
                  Workspace preferences
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

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

export default function Sidebar({
  activeView,
  onNavigate,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
}: SidebarProps) {
  const sidebarWidth = collapsed ? 88 : 240;

  return (
    <aside
      style={{
        width: sidebarWidth,
        flexShrink: 0,
        height: '100vh',
        background: 'var(--color-main-bg)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.22s ease',
      }}
    >
      <div
        style={{
          padding: collapsed ? '16px 14px 14px' : '20px 20px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: 10,
          }}
        >
          {!collapsed && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 300,
                    fontSize: 16,
                    lineHeight: 1.2,
                    color: 'var(--color-primary)',
                    letterSpacing: '-0.2px',
                  }}
                >
                  First Crack
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted)',
                    letterSpacing: '0.14px',
                    fontWeight: 500,
                  }}
                >
                  Roastery Dashboard
                </div>
              </div>
            </div>
          )}

          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-surface)',
              color: 'var(--color-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              boxShadow: 'var(--shadow-inset)',
            }}
          >
            <Menu size={15} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div style={{ padding: collapsed ? '12px 10px 8px' : '12px 12px 8px' }}>
        <button
          aria-label="Workspace selector"
          title={collapsed ? 'Workspace' : undefined}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: '8px 10px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--color-surface)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-inset)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: 'var(--color-surface-warm-solid)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-secondary)',
              }}
            >
              B
            </div>
            {!collapsed && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--color-primary)',
                  letterSpacing: '0.14px',
                }}
              >
                Brewlab Works
              </span>
            )}
          </div>
          {!collapsed && <ChevronDown size={14} strokeWidth={2} color="var(--color-muted)" />}
        </button>
      </div>

      <nav style={{ flex: 1, padding: collapsed ? '4px 10px' : '4px 12px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 4 }}>
          {!collapsed && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--color-muted)',
                letterSpacing: '0.7px',
                textTransform: 'uppercase',
                padding: '8px 10px 4px',
              }}
            >
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
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  marginBottom: 2,
                  background: isActive ? 'var(--color-surface)' : 'transparent',
                  boxShadow: isActive ? 'var(--shadow-inset)' : 'none',
                  transition: 'background 0.15s',
                }}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.5}
                  color={isRoast && isActive ? '#22c55e' : isActive ? 'var(--color-primary)' : 'var(--color-muted)'}
                />
                {!collapsed && (
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: isActive ? 500 : 400,
                      color: isRoast && isActive ? '#22c55e' : isActive ? 'var(--color-primary)' : 'var(--color-secondary)',
                      letterSpacing: '0.14px',
                    }}
                  >
                    {label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div
        style={{
          padding: '12px',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
        <button
          onClick={onOpenSettings}
          aria-label="Open settings"
          title={collapsed ? 'Settings' : undefined}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--color-surface)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-inset)',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--color-surface-warm-solid)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-secondary)',
              flexShrink: 0,
              boxShadow: 'var(--shadow-inset)',
            }}
          >
            H
          </div>
          {!collapsed && (
            <>
              <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-primary)',
                    letterSpacing: '0.14px',
                  }}
                >
                  Settings
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted)',
                    letterSpacing: '0.14px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
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
}

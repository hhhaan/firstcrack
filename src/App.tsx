import { useState } from 'react';
import './App.css';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';
import { SettingsModal, type SettingsTabId } from './widgets/settings-modal/ui/SettingsModal';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { ActiveRoast } from './views/ActiveRoast';
import { History } from './views/History';
import { Beans } from './views/Beans';
import { Profiles } from './views/Profiles';
import { Machines } from './views/Machines';
import { type View } from './shared/types/view';

export const App = () => {
  const [loggedIn, setLoggedIn] = useState(import.meta.env.DEV);
  const [view, setView] = useState<View>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>('general');

  const openSettings = (tab: SettingsTabId = 'general') => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  };

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        activeView={view}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        onOpenSettings={() => openSettings()}
      />
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-surface)' }}>
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {/* 탭 전환 후 복귀해도 타이머·sidecar 폴링이 유지되도록 unmount 대신 CSS hide 사용
            TODO: 로스트 상태를 전역 store(Zustand 등)로 올리면 여러 뷰에서 로스트 진행 상황 접근 가능 */}
        <div style={{ display: view === 'roast' ? 'block' : 'none' }}>
          <ActiveRoast isActive={view === 'roast'} onOpenRoastSettings={() => openSettings('roast')} />
        </div>
        {view === 'history' && <History />}
        {view === 'beans' && <Beans onNavigate={setView} />}
        {view === 'profiles' && <Profiles onNavigate={setView} />}
        {view === 'machines' && <Machines onNavigate={setView} />}
      </div>
      <SettingsModal open={settingsOpen} initialTab={settingsInitialTab} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

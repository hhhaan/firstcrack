import { useState } from 'react';
import './App.css';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';
import { SettingsModal } from './widgets/settings-modal/ui/SettingsModal';
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
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-surface)' }}>
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'roast' && <ActiveRoast />}
        {view === 'history' && <History />}
        {view === 'beans' && <Beans onNavigate={setView} />}
        {view === 'profiles' && <Profiles />}
        {view === 'machines' && <Machines />}
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

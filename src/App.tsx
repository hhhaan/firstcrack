import { useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import ActiveRoast from './views/ActiveRoast';
import History from './views/History';
import Beans from './views/Beans';
import Profiles from './views/Profiles';

export type View = 'dashboard' | 'roast' | 'history' | 'beans' | 'profiles';

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<View>('dashboard');

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar activeView={view} onNavigate={setView} />
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-secondary)' }}>
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'roast' && <ActiveRoast />}
        {view === 'history' && <History />}
        {view === 'beans' && <Beans />}
        {view === 'profiles' && <Profiles />}
      </div>
    </div>
  );
}

export default App;

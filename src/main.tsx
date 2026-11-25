import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReplayApp from './components/replay-app';
import LiveWorkspace from './components/live-workspace';
import './styles.css';

function App() {
  const [live, setLive] = useState(() => new URLSearchParams(location.search).get('mode') === 'live');
  function openMode(next: boolean) {
    const url = new URL(location.href);
    if (next) url.searchParams.set('mode', 'live');
    else url.searchParams.delete('mode');
    history.replaceState(history.state, '', url);
    setLive(next);
  }
  return live ? <LiveWorkspace onReplay={() => openMode(false)}/> : <ReplayApp onLive={() => openMode(true)}/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

import React, {lazy,Suspense,useState} from 'react';
import {createRoot} from 'react-dom/client';
import LiveWorkspace from './components/live-workspace';
import './styles.css';

const ReplayApp = lazy(() => import('./components/replay-app'));

function App() {
  const [live, setLive] = useState(() => new URLSearchParams(location.search).get('mode') !== 'replay');
  function openMode(next: boolean) {
    const url = new URL(location.href);
    if (next) url.searchParams.set('mode', 'live');
    else url.searchParams.set('mode', 'replay');
    history.replaceState(history.state, '', url);
    setLive(next);
  }
  return live ? <LiveWorkspace onReplay={() => openMode(false)}/> : <Suspense fallback={null}><ReplayApp onLive={() => openMode(true)}/></Suspense>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

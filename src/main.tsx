import React from 'react';
import {createRoot} from 'react-dom/client';
import ReplayApp from './components/replay-app';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><ReplayApp/></React.StrictMode>);

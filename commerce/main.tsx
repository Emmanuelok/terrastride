import React from 'react';
import {createRoot} from 'react-dom/client';
import Store from '../components/store';
import PwaControls from '../components/pwa';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<><Store/><PwaControls/></>);

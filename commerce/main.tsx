import React from 'react';
import {createRoot} from 'react-dom/client';
import Store from '../components/store';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<Store/>);

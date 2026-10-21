import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/cyrillic-700.css';
import './style.css';

createRoot(document.getElementById('root')).render(<App />);

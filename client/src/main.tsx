import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider><AuthProvider><App /></AuthProvider></ThemeProvider></StrictMode>);

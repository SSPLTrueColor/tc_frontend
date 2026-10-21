import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './tokens/tokens.css';
import './styles/app.css';
import './domain/extensions/index';
import { getDb } from './services/db';
import { getSettings } from './services/settings';

// Apply the theme before the first paint (no dark flash): the signed-in user's choice, otherwise light.
{
  const { session } = getDb();
  const theme = session.signedIn ? getSettings(session.userId).theme : 'light';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

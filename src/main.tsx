import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const updateSW = registerSW({
  onNeedRefresh() {
    showUpdatePrompt(() => void updateSW(true));
  },
  onOfflineReady() {
    showStatusToast('SignalScope is ready for offline use.');
  }
});
void updateSW;

function showUpdatePrompt(onReload: () => void): void {
  if (document.getElementById('pwa-update-prompt')) return;
  const prompt = document.createElement('div');
  prompt.id = 'pwa-update-prompt';
  prompt.className = 'pwa-toast';
  prompt.innerHTML = '<span>New SignalScope version available.</span>';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Update';
  button.addEventListener('click', onReload, { once: true });
  prompt.appendChild(button);
  document.body.appendChild(prompt);
}

function showStatusToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'pwa-toast pwa-toast-subtle';
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4_000);
}

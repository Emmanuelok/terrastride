import {useEffect, useRef, useState} from 'react';
import {Download, RefreshCw, WifiOff, X} from 'lucide-react';
import './pwa.css';

type InstallPrompt = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};
const DISMISSED_KEY = 'stride:pwa-install-dismissed-until';
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone);
const isDismissed = () => { try { return Number(localStorage.getItem(DISMISSED_KEY)) > Date.now(); } catch { return false; } };

export default function PwaControls() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [hidden, setHidden] = useState(isDismissed);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [iosHelp, setIosHelp] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updateHidden, setUpdateHidden] = useState(false);
  const [updating, setUpdating] = useState(false);
  const reloadRequested = useRef(false);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const didInstall = () => { setInstalled(true); setPrompt(null); };
    const connectivity = () => setOffline(!navigator.onLine);
    const media = window.matchMedia('(display-mode: standalone)');
    const modeChanged = () => setInstalled(isStandalone());
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', didInstall);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    media.addEventListener('change', modeChanged);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', didInstall);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      media.removeEventListener('change', modeChanged);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const changed = () => {
      setWaiting(null);
      if (reloadRequested.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).then(registration => {
      if (disposed) return;
      const checkWaiting = () => {
        if (!disposed && registration.waiting) { setWaiting(registration.waiting); setUpdateHidden(false); }
      };
      const watchInstalling = () => {
        const worker = registration.installing;
        if (!worker) return;
        const stateChanged = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) checkWaiting(); };
        worker.addEventListener('statechange', stateChanged);
        cleanup.push(() => worker.removeEventListener('statechange', stateChanged));
      };
      checkWaiting();
      watchInstalling();
      registration.addEventListener('updatefound', watchInstalling);
      cleanup.push(() => registration.removeEventListener('updatefound', watchInstalling));
      let lastCheck = Date.now();
      const checkForUpdate = () => {
        if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastCheck > 60 * 60 * 1000) {
          lastCheck = Date.now();
          void registration.update().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', checkForUpdate);
      cleanup.push(() => document.removeEventListener('visibilitychange', checkForUpdate));
    }).catch(() => { /* The storefront remains usable when installation is unavailable. */ });
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      cleanup.forEach(remove => remove());
    };
  }, []);

  const dismissInstall = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now() + 14 * 24 * 60 * 60 * 1000)); } catch { /* Preference storage is optional. */ }
  };
  const install = async () => {
    if (!prompt) { setIosHelp(true); return; }
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true);
      else dismissInstall();
    } catch { setInstallError(true); }
    setPrompt(null);
  };
  const refresh = () => {
    if (!waiting) return;
    reloadRequested.current = true;
    setUpdating(true);
    waiting.postMessage({type: 'STRIDE_SKIP_WAITING'});
  };

  if (offline) return <aside className="pwa-notice pwa-offline" role="status"><WifiOff size={18} aria-hidden="true"/><span>You’re offline. Reconnect to load products or save changes.</span></aside>;
  if (waiting && !updateHidden) return <aside className="pwa-notice" aria-label="STRIDE update"><RefreshCw size={18} aria-hidden="true"/><span role="status">A fresh STRIDE is ready.</span><button className="pwa-action" onClick={refresh} disabled={updating}>{updating ? 'Refreshing…' : 'Refresh'}</button><button className="pwa-close" onClick={() => setUpdateHidden(true)} aria-label="Dismiss update notice"><X size={17}/></button></aside>;
  if (installed || hidden || (!prompt && !ios && !installError)) return null;
  return <aside className="pwa-notice pwa-install" aria-label="Install STRIDE">
    <Download size={18} aria-hidden="true"/>
    {iosHelp ? <div><strong>Add STRIDE to your Home Screen</strong><p>In Safari, open the Share menu, choose Add to Home Screen, then tap Add.</p></div> : installError ? <p role="status">Use your browser’s install option to add STRIDE.</p> : <><span>Your next move. One tap away.</span><button className="pwa-action" onClick={() => void install()}>Install STRIDE</button></>}
    <button className="pwa-close" onClick={dismissInstall} aria-label="Dismiss install suggestion"><X size={17}/></button>
  </aside>;
}

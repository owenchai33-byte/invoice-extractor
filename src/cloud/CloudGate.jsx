import { useState, useEffect } from 'react';
import { cloudEnabled, supabase } from './client';
import { cloudBoot } from './sync';
import AuthGate from './AuthGate';

// Wraps the whole app. When cloud is OFF (no env keys) it renders children
// immediately — the app is byte-for-byte its old localStorage-only self.
// When cloud is ON: check session → (login if needed) → pull/seed → render.
export default function CloudGate({ children }) {
  const [phase, setPhase] = useState(cloudEnabled ? 'checking' : 'ready');

  useEffect(() => {
    if (!cloudEnabled) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (!data.session) { setPhase('login'); return; }
      setPhase('syncing');
      await cloudBoot();
      if (alive) setPhase('ready');
    })();
    return () => { alive = false; };
  }, []);

  if (phase === 'ready') return children;
  if (phase === 'login') return <AuthGate onAuthed={async () => { setPhase('syncing'); await cloudBoot(); setPhase('ready'); }} />;
  return <Splash label={phase === 'syncing' ? 'Syncing your data…' : 'Loading…'} />;
}

function Splash({ label }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fafaf9', color: '#52525b', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif', fontSize: 14 }}>
      <span style={{ width: 14, height: 14, border: '2px solid #d4d4d8', borderTopColor: '#18181b', borderRadius: '50%', display: 'inline-block', animation: 'ccspin 0.7s linear infinite' }} />
      {label}
      <style>{`@keyframes ccspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

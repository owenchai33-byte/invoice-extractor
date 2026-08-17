import { useState } from 'react';
import { supabase } from './client';

// Shared-login screen. Both Owen and his sister sign in with the one account
// created in the Supabase dashboard. supabase-js remembers the session, so this
// only shows on first use / after an explicit sign-out.
export default function AuthGate({ onAuthed }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !pw) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) { setErr(error.message || 'Sign-in failed'); return; }
    onAuthed();
  };

  return (
    <div style={S.wrap}>
      <form style={S.card} onSubmit={submit}>
        <div style={S.brand}><span style={S.logo}>S</span><b>Sabrina&nbsp;OS</b></div>
        <div style={S.sub}>Sign in to sync your data</div>
        <input style={S.inp} type="email" placeholder="Email" autoComplete="username"
               value={email} onChange={e => setEmail(e.target.value)} autoFocus />
        <input style={S.inp} type="password" placeholder="Password" autoComplete="current-password"
               value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div style={S.err}>{err}</div>}
        <button style={{ ...S.btn, opacity: busy ? .6 : 1 }} disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const S = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', padding: 16, boxSizing: 'border-box', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif' },
  card: { width: '100%', maxWidth: 320, boxSizing: 'border-box', background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 30px rgba(0,0,0,.08)' },
  brand: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 },
  logo: { width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#18181b,#3f3f46)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  sub: { fontSize: 13, color: '#71717a', marginBottom: 4 },
  inp: { border: '1px solid #d4d4d8', borderRadius: 8, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  err: { fontSize: 12.5, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px' },
  btn: { border: 'none', background: '#18181b', color: '#fff', borderRadius: 9, padding: '11px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
};

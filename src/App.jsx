import { useState, useEffect, useRef, useCallback } from 'react';
import InvoicesWorkspace from './InvoicesWorkspace';
import Payroll from './Payroll';
import ContractGenerator from './ContractGenerator';
import Payslip from './Payslip';
import EmployeePayslip from './EmployeePayslip';
import MerchantReport from './MerchantReport';
import BankRecon from './BankRecon';
import Attendance from './Attendance';
import BeverageFOC from './BeverageFOC';
import { saveBackup, checkWeeklyDownload, downloadBackup, markBackupDone, checkAndRestore, restoreFromBackup, restoreFromFile } from './backup';

/*
 * ─── Audrey's Message Center ───
 * Format change requests go here. Sabrina approves/rejects in the app.
 * Add messages with status:'pending'. After Sabrina responds in the app,
 * update to 'approved'/'rejected' on next deploy.
 */
const AUDREY_MESSAGES = [];

const LS_MSG = 'cjk_msg_responses';
const loadMsg = () => { try { return JSON.parse(localStorage.getItem(LS_MSG)) || {}; } catch { return {}; } };

function MessageCenter({ messages, onClose }) {
  const [responses, setResponses] = useState(() => loadMsg());
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const respond = (id, action) => {
    const next = { ...responses, [id]: { action, date: new Date().toISOString() } };
    setResponses(next);
    try { localStorage.setItem(LS_MSG, JSON.stringify(next)); } catch {}
  };

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 6,
      background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)', width: 340, maxHeight: 420,
      overflow: 'auto', zIndex: 200,
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>Messages from Audrey</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 16, color: '#a1a1aa', cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
      </div>
      {messages.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>
          No messages yet. When Audrey needs to change any format, a request will appear here for your approval.
        </div>
      ) : (
        messages.map(m => {
          const r = responses[m.id];
          return (
            <div key={m.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: '#a1a1aa', fontWeight: 600 }}>{m.date}</span>
                <span style={{ fontSize: 10, color: m.type === 'format-change' ? '#dc2626' : '#71717a', fontWeight: 600, textTransform: 'uppercase' }}>{m.type === 'format-change' ? 'Format Change' : 'Request'}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#18181b', marginBottom: 4 }}>{m.subject}</div>
              <div style={{ fontSize: 12, color: '#52525b', lineHeight: 1.5, marginBottom: 8 }}>{m.description}</div>
              {r ? (
                <div style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 4, display: 'inline-block',
                  background: r.action === 'approve' ? '#dcfce7' : '#fef2f2',
                  color: r.action === 'approve' ? '#166534' : '#991b1b',
                }}>
                  {r.action === 'approve' ? '✅ Approved' : '❌ Rejected'} — {new Date(r.date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => respond(m.id, 'approve')} style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                    background: '#18181b', color: '#fff', border: 'none',
                  }}>✅ Approve</button>
                  <button onClick={() => respond(m.id, 'reject')} style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                    background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
                  }}>❌ Reject</button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const SECTIONS = [
  { id: 'af', label: 'Account & Finance', tabs: [
    { id: 'invoice', label: 'Payment Summary' },
    { id: 'merchant', label: 'POS Merchant Report' },
    { id: 'bankrecon', label: 'Bank Recon' },
    { id: 'bevfoc', label: 'Beverage FOC' },
  ]},
  { id: 'hr', label: 'Human Resource', tabs: [
    { id: 'attendance', label: 'Attendance' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'payslip', label: 'Payslip' },
    { id: 'epayslip', label: 'Employee Payslip' },
    { id: 'contract', label: 'Contracts' },
  ]},
];
const TAB_TO_SECTION = {};
SECTIONS.forEach(s => s.tabs.forEach(t => { TAB_TO_SECTION[t.id] = s.id; }));

const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif`;
const APP_PIN = '9069';
const PIN_TABS = new Set(['payroll', 'payslip', 'epayslip']);

function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const submit = () => {
    if (pin === APP_PIN) onUnlock();
    else { setErr(true); setPin(''); }
  };
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'80vh',fontFamily:FONT_STACK}}>
      <div style={{textAlign:'center',padding:40,background:'#fff',borderRadius:12,border:'1px solid #e4e4e7',boxShadow:'0 4px 24px rgba(0,0,0,.06)',minWidth:320}}>
        <div style={{fontSize:28,marginBottom:8}}>🔒</div>
        <div style={{fontSize:15,fontWeight:700,marginBottom:4,color:'#18181b'}}>Protected Page</div>
        <div style={{fontSize:12,color:'#71717a',marginBottom:20}}>Enter PIN to continue</div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={e => { setErr(false); setPin(e.target.value.replace(/\D/g,'')); }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus
          style={{width:120,textAlign:'center',fontSize:24,letterSpacing:8,padding:'10px 12px',border:`2px solid ${err?'#dc2626':'#d4d4d8'}`,borderRadius:8,outline:'none',fontFamily:'monospace'}}
          placeholder="····"
        />
        {err && <div style={{fontSize:12,color:'#dc2626',marginTop:8}}>Wrong PIN</div>}
        <div><button onClick={submit} style={{marginTop:16,padding:'8px 32px',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer',border:'none',background:'#18181b',color:'#fff'}}>Unlock</button></div>
      </div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState(() => {
    try { const v = localStorage.getItem('sabrina_active'); return (v === 'choonhua' || v === 'yhs') ? 'invoice' : (v || 'invoice'); }
    catch { return 'invoice'; }
  });
  const [time, setTime] = useState(() => new Date());
  const [pinUnlocked, setPinUnlocked] = useState(false);

  useEffect(() => {
    setPinUnlocked(false);
    try { localStorage.setItem('sabrina_active', active); } catch {}
    if (active === 'invoice') document.title = 'CJK Payment Summary';
    else if (active === 'contract') document.title = 'CJK Contracts';
  }, [active]);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && PIN_TABS.has(active)) setPinUnlocked(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);

  const [toast, setToast] = useState('');
  const [backupDue, setBackupDue] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMsg, setShowMsg] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const fileRef = useRef(null);
  const menuRef = useRef(null);
  const msgRef = useRef(null);
  const msgResponses = loadMsg();
  const pendingMsgCount = AUDREY_MESSAGES.filter(m => !msgResponses[m.id]).length;
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const skipUndo = useRef(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (sessionStorage.getItem('cjk_restore_skipped')) return;
    checkAndRestore().then(r => { if (r === 'available') setShowRestore(true); });
  }, []);

  useEffect(() => {
    const orig = localStorage.setItem.bind(localStorage);
    const snap = () => { const d = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); d[k] = orig.call(localStorage, k) || localStorage.getItem(k); } return d; };
    const snapGet = () => { const d = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); d[k] = localStorage.getItem(k); } return d; };
    let pending = null;
    const patched = function(k, v) {
      if (!skipUndo.current && !k.startsWith('cjk_backup')) {
        if (!pending) pending = snapGet();
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (pending) {
            undoStack.current.push(pending);
            if (undoStack.current.length > 20) undoStack.current.shift();
            setCanUndo(true);
            redoStack.current = [];
            setCanRedo(false);
            pending = null;
          }
        }, 500);
      }
      orig(k, v);
      saveBackup();
    };
    localStorage.setItem = patched;
    return () => { localStorage.setItem = orig; };
  }, []);

  useEffect(() => {
    if (!checkWeeklyDownload()) return;
    const t = setTimeout(() => {
      downloadBackup();
      markBackupDone();
      setToast('✅ Weekly backup saved to Downloads');
      setTimeout(() => setToast(''), 4000);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!showMenu) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showMenu]);

  const handleRestore = useCallback(async () => {
    const ok = await restoreFromBackup();
    setShowRestore(false);
    if (ok && localStorage.getItem('cjk_payroll_staff_v3')) {
      window.location.reload();
    } else {
      sessionStorage.setItem('cjk_restore_skipped', '1');
      setToast('⚠️ Backup has no data — use Backup > Restore from File if you have a downloaded backup');
      setTimeout(() => setToast(''), 5000);
    }
  }, []);

  const handleFileRestore = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await restoreFromFile(file);
      setToast('✅ Data restored from file');
      setTimeout(() => { setToast(''); window.location.reload(); }, 1500);
    } catch { setToast('❌ Invalid backup file'); setTimeout(() => setToast(''), 3000); }
    e.target.value = '';
    setShowMenu(false);
  }, []);

  const snapNow = useCallback(() => {
    const d = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); d[k] = localStorage.getItem(k); } return d;
  }, []);

  const handleUndo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(snapNow());
    setCanRedo(true);
    const prev = undoStack.current.pop();
    skipUndo.current = true;
    localStorage.clear();
    Object.entries(prev).forEach(([k, v]) => localStorage.setItem(k, v));
    skipUndo.current = false;
    setCanUndo(undoStack.current.length > 0);
    setToast('↩ Undone');
    setTimeout(() => { setToast(''); window.location.reload(); }, 800);
  }, [snapNow]);

  const handleRedo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(snapNow());
    setCanUndo(true);
    const next = redoStack.current.pop();
    skipUndo.current = true;
    localStorage.clear();
    Object.entries(next).forEach(([k, v]) => localStorage.setItem(k, v));
    skipUndo.current = false;
    setCanRedo(redoStack.current.length > 0);
    setToast('↪ Redone');
    setTimeout(() => { setToast(''); window.location.reload(); }, 800);
  }, [snapNow]);

  const timeStr = time.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = time.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="app-shell" style={{
      minHeight: '100vh',
      background: '#fafaf9',
      fontFamily: FONT_STACK,
      color: '#0a0a0a',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    }}>
      {/* ─── Top Navigation ─── */}
      <header
        className="sabrina-nav"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(250, 250, 249, 0.85)',
          backdropFilter: 'saturate(180%) blur(14px)',
          WebkitBackdropFilter: 'saturate(180%) blur(14px)',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <div style={{
          maxWidth: 1480,
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          height: 52,
          gap: 24,
        }}>
          {/* Logo / brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 22, height: 22,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
            }}>
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '-0.02em' }}>S</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: '#0a0a0a',
              }}>
                Sabrina
              </span>
              <span style={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: '#a3a3a3',
                textTransform: 'uppercase',
              }}>
                OS
              </span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 18, background: 'rgba(0,0,0,0.08)' }} />

          {/* Section switcher */}
          <nav style={{ display: 'flex', gap: 2, flex: 1 }}>
            {SECTIONS.map(s => {
              const isSec = TAB_TO_SECTION[active] === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.tabs[0].id)}
                  style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    padding: '6px 14px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: isSec ? 700 : 500,
                    fontFamily: 'inherit',
                    color: isSec ? '#0a0a0a' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 160ms cubic-bezier(0.4, 0, 0.2, 1)',
                    letterSpacing: '-0.005em',
                  }}
                  onMouseEnter={e => { if (!isSec) e.currentTarget.style.color = '#0a0a0a'; }}
                  onMouseLeave={e => { if (!isSec) e.currentTarget.style.color = '#737373'; }}
                >
                  {isSec && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.04)',
                      borderRadius: 6,
                      zIndex: -1,
                    }} />
                  )}
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Right side meta */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 11.5,
            color: '#737373',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.005em',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 0 3px rgba(34,197,94,0.15)',
              }} />
              <span style={{ fontWeight: 500 }}>Online</span>
            </div>
            <div style={{ position: 'relative' }} ref={msgRef}>
              <button onClick={() => { setShowMsg(!showMsg); setShowMenu(false); }} style={{
                background: 'none', border: '1px solid #e5e5e5', borderRadius: 4, padding: '2px 8px',
                fontSize: 11, color: '#737373', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                position: 'relative',
              }} title="Messages from Audrey">
                <span style={{ fontSize: 13 }}>💬</span> Messages
                {pendingMsgCount > 0 && <span style={{
                  position: 'absolute', top: -5, right: -5, background: '#dc2626', color: '#fff',
                  fontSize: 9, fontWeight: 700, borderRadius: '50%', width: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{pendingMsgCount}</span>}
              </button>
              {showMsg && <MessageCenter messages={AUDREY_MESSAGES} onClose={() => setShowMsg(false)} />}
            </div>
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button onClick={() => setShowMenu(!showMenu)} style={{
                background: 'none', border: '1px solid #e5e5e5', borderRadius: 4, padding: '2px 8px',
                fontSize: 11, color: '#737373', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }} title="Backup & Restore">
                <span style={{ fontSize: 13 }}>🛡</span> Backup
              </button>
              {showMenu && <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: 4, minWidth: 180, zIndex: 200,
              }}>
                <button onClick={() => { downloadBackup(); markBackupDone(); setToast('✅ Backup downloaded'); setTimeout(() => setToast(''), 3000); setShowMenu(false); }} style={{
                  display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'none',
                  textAlign: 'left', fontSize: 12, cursor: 'pointer', borderRadius: 4, color: '#171717',
                }} onMouseEnter={e => e.target.style.background='#f5f5f5'} onMouseLeave={e => e.target.style.background='none'}>
                  ⬇ Download Backup
                </button>
                <button onClick={() => { fileRef.current?.click(); }} style={{
                  display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'none',
                  textAlign: 'left', fontSize: 12, cursor: 'pointer', borderRadius: 4, color: '#171717',
                }} onMouseEnter={e => e.target.style.background='#f5f5f5'} onMouseLeave={e => e.target.style.background='none'}>
                  ⬆ Restore from File
                </button>
              </div>}
              <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileRestore} />
            </div>
            <div style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.08)' }} />
            <span style={{ color: '#a3a3a3' }}>{dateStr}</span>
            <span style={{ fontWeight: 500 }}>{timeStr}</span>
          </div>
        </div>

      </header>

      {/* ─── Sub-tabs ─── */}
      {(() => {
        const sec = SECTIONS.find(s => s.id === TAB_TO_SECTION[active]);
        if (!sec) return null;
        return (
          <div className="sabrina-nav" style={{
            background: '#fff',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            position: 'sticky',
            top: 52,
            zIndex: 99,
          }}>
            <div style={{
              maxWidth: 1480,
              margin: '0 auto',
              padding: '0 24px',
              display: 'flex',
              gap: 2,
              height: 40,
              alignItems: 'center',
            }}>
              {sec.tabs.map(t => {
                const isActive = active === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActive(t.id)}
                    style={{
                      position: 'relative',
                      background: 'transparent',
                      border: 'none',
                      padding: '4px 12px',
                      borderRadius: 5,
                      fontSize: 12.5,
                      fontWeight: isActive ? 600 : 500,
                      fontFamily: 'inherit',
                      color: isActive ? '#0a0a0a' : '#737373',
                      cursor: 'pointer',
                      transition: 'all 160ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#0a0a0a'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#737373'; }}
                  >
                    {isActive && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(0,0,0,0.04)',
                        borderRadius: 5,
                        zIndex: -1,
                      }} />
                    )}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ─── Content ─── */}
      <main>
        {active === 'invoice' && <InvoicesWorkspace />}
        {active === 'payroll' && (pinUnlocked ? <Payroll canUndo={canUndo} onUndo={handleUndo} canRedo={canRedo} onRedo={handleRedo} /> : <PinGate onUnlock={() => setPinUnlocked(true)} />)}
        {active === 'contract' && <ContractGenerator />}
        {active === 'payslip' && (pinUnlocked ? <Payslip /> : <PinGate onUnlock={() => setPinUnlocked(true)} />)}
        {active === 'epayslip' && (pinUnlocked ? <EmployeePayslip /> : <PinGate onUnlock={() => setPinUnlocked(true)} />)}
        {active === 'merchant' && <MerchantReport />}
        <div style={{display: active === 'bankrecon' ? 'block' : 'none'}}><BankRecon /></div>
        <div style={{display: active === 'attendance' ? 'block' : 'none'}}><Attendance /></div>
        {active === 'bevfoc' && <BeverageFOC />}
      </main>

      <style>{`
        @media print {
          .sabrina-nav { display: none !important; }
          /* vh units resolve to full page height in print; on nested 100vh roots
             that overflows the printable area and spawns blank pages. Flatten them. */
          .app-shell, .app-shell main { min-height: 0 !important; }
        }
        /* Subtle scrollbar refinement */
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.12);
          border-radius: 10px;
          border: 2px solid #fafaf9;
        }
        ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
        /* Refined text selection */
        ::selection { background: rgba(10,10,10,0.12); color: #0a0a0a; }
      `}</style>

      {toast && <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        background: '#171717', color: '#fff', padding: '10px 20px', borderRadius: 8,
        fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      }}>{toast}</div>}

      {backupDue && <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        background: '#171717', color: '#fff', padding: '12px 20px', borderRadius: 10,
        fontSize: 13, fontWeight: 500, zIndex: 9998, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span>🛡 Weekly backup ready</span>
        <button onClick={() => { downloadBackup(); markBackupDone(); setBackupDue(false); setToast('✅ Backup downloaded'); setTimeout(() => setToast(''), 3000); }} style={{
          background: '#fff', color: '#171717', border: 'none', borderRadius: 6,
          padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>Download</button>
        <button onClick={() => { markBackupDone(); setBackupDue(false); }} style={{
          background: 'transparent', color: '#888', border: 'none', fontSize: 16,
          cursor: 'pointer', padding: '0 4px', lineHeight: 1,
        }}>✕</button>
      </div>}

      {showRestore && <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: 24, maxWidth: 380, textAlign: 'center',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Data Missing</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#525252' }}>
            Your app data appears to be empty, but a backup was found. Would you like to restore it?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={handleRestore} style={{
              padding: '8px 20px', background: '#171717', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}>Restore Backup</button>
            <button onClick={() => { sessionStorage.setItem('cjk_restore_skipped', '1'); setShowRestore(false); }} style={{
              padding: '8px 20px', background: '#f5f5f5', color: '#525252', border: 'none',
              borderRadius: 6, fontSize: 13, cursor: 'pointer',
            }}>Skip</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

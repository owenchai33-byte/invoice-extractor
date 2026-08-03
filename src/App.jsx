import { useState, useEffect } from 'react';
import InvoicesWorkspace from './InvoicesWorkspace';
import Payroll from './Payroll';
import ContractGenerator from './ContractGenerator';
import Payslip from './Payslip';
import EmployeePayslip from './EmployeePayslip';

const SECTIONS = [
  { id: 'af', label: 'Account & Finance', tabs: [
    { id: 'choonhua', label: 'Choon Hua' },
    { id: 'yhs', label: 'YHS' },
  ]},
  { id: 'hr', label: 'Human Resource', tabs: [
    { id: 'payroll', label: 'Payroll' },
    { id: 'payslip', label: 'Payslip' },
    { id: 'epayslip', label: 'Employee Payslip' },
    { id: 'contract', label: 'Contracts' },
  ]},
];
const TAB_TO_SECTION = {};
SECTIONS.forEach(s => s.tabs.forEach(t => { TAB_TO_SECTION[t.id] = s.id; }));

const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif`;

export default function App() {
  const [active, setActive] = useState(() => {
    try { const v = localStorage.getItem('sabrina_active'); return v === 'invoice' ? 'choonhua' : (v || 'choonhua'); }
    catch { return 'choonhua'; }
  });
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    try { localStorage.setItem('sabrina_active', active); } catch {}
    const titles = { choonhua: 'CJK Choon Hua Payment Summary', yhs: 'CJK YHS Payment Summary', payroll: 'CJK Payroll', contract: 'CJK Contracts', payslip: 'CJK Payslips', epayslip: 'CJK Employee Payslips' };
    document.title = titles[active] || 'Sabrina OS';
  }, [active]);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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
            <div style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.08)' }} />
            <span style={{ color: '#a3a3a3' }}>{dateStr}</span>
            <span style={{ fontWeight: 500 }}>{timeStr}</span>
          </div>
        </div>

      </header>

      {/* ─── Sub-tabs ─── */}
      {(() => {
        const sec = SECTIONS.find(s => s.id === TAB_TO_SECTION[active]);
        if (!sec || sec.tabs.length <= 1) return null;
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
        {(active === 'choonhua' || active === 'yhs') && <InvoicesWorkspace supplier={active} />}
        {active === 'payroll' && <Payroll />}
        {active === 'contract' && <ContractGenerator />}
        {active === 'payslip' && <Payslip />}
        {active === 'epayslip' && <EmployeePayslip />}
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
    </div>
  );
}

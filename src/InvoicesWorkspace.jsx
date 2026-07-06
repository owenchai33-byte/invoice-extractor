import { useState, useEffect } from 'react';
import InvoiceExtractor from './InvoiceExtractor';
import YHSExtractor from './YHSExtractor';

// Sub-tab wrapper for the Invoices / Payment Summary area. Each supplier that
// needs its own extraction + subsidy model gets a tab here. Choon Hua is the
// original cascading-carton model; YHS is the flat 2%/transport/ML-bonus model.
const SUB_TABS = [
  { id: 'choonhua', label: 'Choon Hua' },
  { id: 'yhs', label: 'YHS' },
];

export default function InvoicesWorkspace() {
  const [sub, setSub] = useState(() => {
    try { return localStorage.getItem('invoices_subtab') || 'choonhua'; }
    catch { return 'choonhua'; }
  });
  useEffect(() => { try { localStorage.setItem('invoices_subtab', sub); } catch {} }, [sub]);

  return (
    <div>
      {/* Sub-tab bar — hidden on print so the payment summary prints clean */}
      <div className="noP" style={{
        display: 'flex',
        gap: 4,
        justifyContent: 'center',
        padding: '12px 0 4px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        {SUB_TABS.map(t => {
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              style={{
                position: 'relative',
                background: active ? '#111' : 'transparent',
                color: active ? '#fff' : '#666',
                border: active ? 'none' : '1px solid #d4d4d8',
                padding: '6px 18px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 150ms',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'choonhua' && <InvoiceExtractor />}
      {sub === 'yhs' && <YHSExtractor />}
    </div>
  );
}

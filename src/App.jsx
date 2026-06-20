import { useState } from 'react';
import InvoiceExtractor from './InvoiceExtractor';
import Payroll from './Payroll';

const FEATURES = [
  { id: 'invoice', label: 'Invoice Extractor' },
  { id: 'payroll', label: 'Payroll' },
];

export default function App() {
  const [active, setActive] = useState('invoice');

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {/* Navigation bar */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '0 16px',
        borderBottom: '2px solid #000',
        background: '#fafafa',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
      className="no-print"
      >
        <div style={{
          fontWeight: 800,
          fontSize: '13px',
          letterSpacing: '0.05em',
          padding: '12px 16px 12px 0',
          borderRight: '1px solid #ddd',
          marginRight: '8px',
          whiteSpace: 'nowrap',
        }}>
          CJK BUSINESS OS
        </div>

        {FEATURES.map(f => (
          <button
            key={f.id}
            onClick={() => setActive(f.id)}
            style={{
              padding: '12px 20px',
              fontSize: '13px',
              fontWeight: active === f.id ? 700 : 400,
              background: active === f.id ? '#fff' : 'transparent',
              border: 'none',
              borderBottom: active === f.id ? '2px solid #000' : '2px solid transparent',
              marginBottom: '-2px',
              cursor: 'pointer',
              color: active === f.id ? '#000' : '#888',
              transition: 'all 0.15s',
            }}
          >
            {f.label}
          </button>
        ))}
      </nav>

      {/* Active feature */}
      <div>
        {active === 'invoice' && <InvoiceExtractor />}
        {active === 'payroll' && <Payroll />}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

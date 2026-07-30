import { useState } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Payslip workspace — shell for now. Next step: pull each staff's payroll figures
// (salary, incentive, EPF/SOCSO/EIS, net pay) and render a printable payslip per person,
// matching Sabrina's Excel payslip format.
export default function Payslip() {
  const now = new Date();
  const [mo, setMo] = useState(now.getMonth());
  const [yr, setYr] = useState(now.getFullYear());

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh' }}>
      <style>{`
        .ps-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
        .ps-bar h1{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0;color:#18181b}
        .ps-mnav{display:flex;align-items:center;gap:8px}
        .ps-mbtn{border:1px solid #e4e4e7;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#52525b;font-size:11px}
        .ps-mlbl{font-size:13px;font-weight:600;min-width:120px;text-align:center;color:#18181b}
        .ps-body{max-width:1100px;margin:0 auto;padding:24px}
        .ps-empty{background:#fff;border:1px dashed #d4d4d8;border-radius:12px;padding:48px 24px;text-align:center;color:#71717a}
        .ps-empty h2{margin:0 0 8px;font-size:16px;color:#18181b}
        .ps-empty p{margin:0;font-size:13px}
      `}</style>

      <div className="ps-bar">
        <h1>PAYSLIP</h1>
        <div className="ps-mnav">
          <button className="ps-mbtn" onClick={() => { if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1); }}>&#9664;</button>
          <div className="ps-mlbl">{MONTHS[mo]} {yr}</div>
          <button className="ps-mbtn" onClick={() => { if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1); }}>&#9654;</button>
        </div>
      </div>

      <div className="ps-body">
        <div className="ps-empty">
          <h2>Payslip generator</h2>
          <p>Ready to build. Send me your Excel payslip layout and I'll generate one printable payslip per staff, pulling their figures straight from {MONTHS[mo]} {yr} payroll.</p>
        </div>
      </div>
    </div>
  );
}

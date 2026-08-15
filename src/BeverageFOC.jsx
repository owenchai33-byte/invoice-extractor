import { useState, useEffect, useMemo } from 'react';

const LS_KEY = 'cjk_bev_foc';
const FOC_PRICE = 35.30;

const BEVERAGES = [
  { key: 'seasons_24s', label: 'Seasons 24s can', rate: 0.60 },
  { key: '100p_can', label: '100 Plus can 24s/28s', rate: 0.70 },
  { key: 'fn_15l', label: 'F&N 1.5L', rate: 0.70 },
  { key: '100p_15l', label: '100 Plus 1.5L/1.75L', rate: 0.70 },
  { key: 'borneo', label: 'Borneo / Ice Mountain', rate: 0.25 },
  { key: 'sunvalley', label: 'Sun Valley 1L/2L', rate: 1.50 },
  { key: 'fn_can12', label: 'F&N can 12s', rate: 0.50 },
  { key: 'seasons_250', label: 'Seasons 250ml / 1L', rate: 0.20 },
  { key: '100p_500', label: '100 Plus 500ml', rate: 0.50 },
];

const DAIRIES = [
  { key: 'dairy_48', label: '48 cans', rate: 1.00 },
  { key: 'dairy_24', label: '24 cans', rate: 0.50 },
  { key: 'dairy_1kg', label: '1kg', rate: 0.50 },
  { key: 'dairy_25kg', label: '2.5kg', rate: 0.50 },
];

const DAIRY_BONUS_THRESHOLD = 600;
const DAIRY_BONUS_CTNS = 5;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const nf = v => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BeverageFOC() {
  const now = new Date();
  const prevMo = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYr = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [mo, setMo] = useState(prevMo);
  const [yr, setYr] = useState(prevYr);
  const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`;

  const [allData, setAllData] = useState(() => load(LS_KEY, {}));
  const qty = allData[mk] || {};
  const setQty = (key, val) => {
    const next = { ...allData, [mk]: { ...qty, [key]: val } };
    setAllData(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };

  const changeMonth = d => {
    if (d < 0) { if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1); }
    else { if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1); }
  };

  const calc = useMemo(() => {
    let bevTotal = 0, dairyTotal = 0, dairyCtns = 0;
    const bevRows = BEVERAGES.map(b => {
      const q = parseFloat(qty[b.key]) || 0;
      const rebate = q * b.rate;
      bevTotal += rebate;
      return { ...b, qty: q, rebate };
    });
    const dairyRows = DAIRIES.map(d => {
      const q = parseFloat(qty[d.key]) || 0;
      const rebate = q * d.rate;
      dairyTotal += rebate;
      dairyCtns += q;
      return { ...d, qty: q, rebate };
    });
    const bonus = dairyCtns >= DAIRY_BONUS_THRESHOLD;
    const grandTotal = bevTotal + dairyTotal;
    const focCtns = Math.floor(grandTotal / FOC_PRICE);
    const remainder = grandTotal - focCtns * FOC_PRICE;
    const totalFoc = focCtns + (bonus ? DAIRY_BONUS_CTNS : 0);
    return { bevRows, dairyRows, bevTotal, dairyTotal, dairyCtns, bonus, grandTotal, focCtns, remainder, totalFoc };
  }, [qty]);

  useEffect(() => { document.title = `BEVERAGE FOC - ${MONTHS[mo].slice(0,3).toUpperCase()}'${String(yr).slice(-2)}`; }, [mo, yr]);

  const clearMonth = () => {
    if (!confirm(`Clear all quantities for ${MONTHS[mo]} ${yr}?`)) return;
    const next = { ...allData }; delete next[mk]; setAllData(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };

  return (
    <div className="foc-root">
      <style>{CSS}</style>
      <div className="foc-bar no-print">
        <h1>BEVERAGE FOC CALCULATOR</h1>
        <div className="foc-mnav">
          <button className="foc-mbtn" onClick={() => changeMonth(-1)}>&#9664;</button>
          <div className="foc-mlbl">{MONTHS[mo]} {yr}</div>
          <button className="foc-mbtn" onClick={() => changeMonth(1)}>&#9654;</button>
        </div>
        <div className="foc-acts">
          <button className="foc-btn foc-btn-o" onClick={clearMonth}>Clear</button>
          <button className="foc-btn" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="foc-body">
        <div className="foc-print-header">
          <div className="foc-print-title">F&N BEVERAGE FOC CALCULATION</div>
          <div className="foc-print-period">{MONTHS[mo]} {yr}</div>
          <div className="foc-print-co">CHAI JEE KIONG TRADING SDN BHD</div>
        </div>

        <div className="foc-tables">
          <div className="foc-section">
            <div className="foc-sec-title">Beverages</div>
            <table className="foc-tbl">
              <thead>
                <tr><th className="foc-th-cat">Category</th><th className="foc-th-rate">Rate (RM/ctn)</th><th className="foc-th-qty">Qty (ctns)</th><th className="foc-th-amt">Rebate (RM)</th></tr>
              </thead>
              <tbody>
                {calc.bevRows.map(r => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="foc-num">{nf(r.rate)}</td>
                    <td className="foc-num"><input type="number" min="0" className="foc-in no-print" value={qty[r.key] || ''} onChange={e => setQty(r.key, e.target.value)} placeholder="-" /><span className="foc-pr">{r.qty || '-'}</span></td>
                    <td className="foc-num">{r.rebate > 0 ? nf(r.rebate) : '-'}</td>
                  </tr>
                ))}
                <tr className="foc-sub"><td>Subtotal</td><td></td><td></td><td className="foc-num">{nf(calc.bevTotal)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="foc-section">
            <div className="foc-sec-title">Dairies</div>
            <table className="foc-tbl">
              <thead>
                <tr><th className="foc-th-cat">Category</th><th className="foc-th-rate">Rate (RM/ctn)</th><th className="foc-th-qty">Qty (ctns)</th><th className="foc-th-amt">Rebate (RM)</th></tr>
              </thead>
              <tbody>
                {calc.dairyRows.map(r => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="foc-num">{nf(r.rate)}</td>
                    <td className="foc-num"><input type="number" min="0" className="foc-in no-print" value={qty[r.key] || ''} onChange={e => setQty(r.key, e.target.value)} placeholder="-" /><span className="foc-pr">{r.qty || '-'}</span></td>
                    <td className="foc-num">{r.rebate > 0 ? nf(r.rebate) : '-'}</td>
                  </tr>
                ))}
                <tr className="foc-sub"><td>Subtotal ({Math.round(calc.dairyCtns)} ctns)</td><td></td><td></td><td className="foc-num">{nf(calc.dairyTotal)}</td></tr>
              </tbody>
            </table>
            {calc.bonus && <div className="foc-bonus">Dairies hit {DAIRY_BONUS_THRESHOLD} ctns — extra {DAIRY_BONUS_CTNS} FOC cartons!</div>}
            {!calc.bonus && calc.dairyCtns > 0 && <div className="foc-bonus-info">{DAIRY_BONUS_THRESHOLD - Math.round(calc.dairyCtns)} more dairies ctns needed for +{DAIRY_BONUS_CTNS} bonus FOC</div>}
          </div>
        </div>

        <div className="foc-result">
          <table className="foc-res-tbl">
            <tbody>
              <tr><td className="foc-res-lb">Total Rebate</td><td className="foc-res-val">RM {nf(calc.grandTotal)}</td></tr>
              <tr><td className="foc-res-lb">FOC (rebate)</td><td className="foc-res-val">{calc.focCtns} cartons</td></tr>
              {calc.bonus && <tr><td className="foc-res-lb">FOC (dairy bonus)</td><td className="foc-res-val">{DAIRY_BONUS_CTNS} cartons</td></tr>}
              <tr className="foc-res-total"><td className="foc-res-lb">TOTAL FOC</td><td className="foc-res-val">{calc.totalFoc} cartons of 100 Plus 325ml</td></tr>
              {calc.remainder > 0 && <tr><td className="foc-res-lb foc-res-sm">Remainder</td><td className="foc-res-val foc-res-sm">RM {nf(calc.remainder)}</td></tr>}
            </tbody>
          </table>
          <div className="foc-note">1 FOC carton = 100 Plus Original 325ml × 24 @ RM{nf(FOC_PRICE)}</div>
        </div>

        <div className="foc-ref no-print">
          <div className="foc-ref-title">Rebate Reference</div>
          <div className="foc-ref-note">Supplier: Signature Selection Sdn Bhd &nbsp;|&nbsp; Valid: 01/11/2025 – 28/04/2026</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.foc-root{background:#fafafa;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.foc-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.foc-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b}
.foc-mnav{display:flex;align-items:center;gap:8px}
.foc-mbtn{border:1px solid #e4e4e7;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#52525b;font-size:11px}
.foc-mlbl{font-size:13px;font-weight:600;min-width:120px;text-align:center;color:#18181b}
.foc-acts{margin-left:auto;display:flex;align-items:center;gap:10px}
.foc-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.foc-btn:hover{background:#000}
.foc-btn-o{background:#fff;color:#18181b}
.foc-btn-o:hover{background:#f4f4f5}

.foc-body{max-width:720px;margin:0 auto;padding:28px 24px 80px}
.foc-print-header{display:none}
.foc-tables{display:flex;flex-direction:column;gap:28px}
.foc-section{}
.foc-sec-title{font-size:14px;font-weight:700;color:#18181b;margin-bottom:8px;letter-spacing:.02em}

.foc-tbl{width:100%;border-collapse:collapse;font-size:13px}
.foc-tbl th{text-align:left;padding:8px 10px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#71717a;border-bottom:2px solid #e4e4e7;background:#fafafa}
.foc-tbl td{padding:6px 10px;border-bottom:1px solid #f4f4f5}
.foc-num{text-align:right;font-variant-numeric:tabular-nums}
.foc-th-cat{width:40%}
.foc-th-rate{width:18%;text-align:right}
.foc-th-qty{width:20%;text-align:right}
.foc-th-amt{width:22%;text-align:right}
.foc-sub td{font-weight:700;border-top:2px solid #e4e4e7;border-bottom:none;padding-top:8px}
.foc-in{width:64px;text-align:right;border:1px solid #d4d4d8;border-radius:4px;padding:3px 6px;font-size:13px;font-family:inherit}
.foc-in::-webkit-inner-spin-button,.foc-in::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.foc-in{-moz-appearance:textfield}
.foc-pr{display:none}

.foc-bonus{margin-top:8px;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;font-size:12px;font-weight:600;color:#059669}
.foc-bonus-info{margin-top:6px;font-size:11px;color:#a1a1aa}

.foc-result{margin-top:32px;background:#fff;border:2px solid #18181b;border-radius:10px;padding:20px 24px}
.foc-res-tbl{width:100%;border-collapse:collapse}
.foc-res-lb{padding:6px 0;font-size:13px;color:#52525b}
.foc-res-val{padding:6px 0;text-align:right;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.foc-res-total td{font-size:18px;font-weight:800;color:#18181b;padding-top:10px;border-top:2px solid #e4e4e7}
.foc-res-sm{font-size:11px!important;color:#a1a1aa!important;font-weight:400!important}
.foc-note{margin-top:12px;font-size:11px;color:#a1a1aa;text-align:center}

.foc-ref{margin-top:20px;padding:12px 16px;background:#f4f4f5;border-radius:8px}
.foc-ref-title{font-size:12px;font-weight:700;color:#52525b;margin-bottom:2px}
.foc-ref-note{font-size:11px;color:#a1a1aa}

@media print{
  .no-print{display:none!important}
  .foc-root{background:#fff}
  .foc-bar{display:none}
  .foc-body{max-width:none;padding:0}
  .foc-print-header{display:block;text-align:center;margin-bottom:20px}
  .foc-print-title{font-size:16px;font-weight:700}
  .foc-print-period{font-size:13px;color:#444}
  .foc-print-co{font-size:11px;color:#888;margin-top:2px}
  .foc-pr{display:inline!important}
  .foc-tbl{font-size:11px}
  .foc-result{border-width:1px}
  @page{size:A4 portrait;margin:15mm}
}
`;

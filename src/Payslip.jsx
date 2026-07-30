import { useState, useEffect, useMemo, useRef } from 'react';
import { computeStaffMonth, LS_S, LS_P, LS_SB, SAMPLE_STAFF, fmt } from './Payroll';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const acct = v => (!v || v === 0) ? '-' : fmt(v);              // accounting: zero shows a dash
const lastDay = (mo, yr) => { const d = new Date(yr, mo + 1, 0); return `${d.getDate()}-${MON3[mo]}-${yr}`; };

// ─── One payslip (matches Sabrina's Excel layout) ───
function Slip({ r, mo, yr }) {
  const earn = [['BASIC SALARY', r.salary], ['INCENTIVE', r.incentive]];
  if (r.bonus > 0) earn.push([(r.bonusLabel || 'BONUS'), r.bonus]);
  const earnTotal = r.salary + (r.incentive || 0) + (r.bonus || 0);
  const ded = [['EPF', r.epfP], ['SOCSO (+SKBBK=1.25%)', r.socsoP], ['EIS', r.eisE], ['ADVANCE', r.advance || 0]];
  const dedTotal = Math.round((r.epfP + r.socsoP + r.eisE + (r.advance || 0)) * 100) / 100;
  const n = Math.max(earn.length, ded.length);

  return (
    <div className="slip">
      <div className="slip-co">C.J.K. CHAI JEE KIONG TRADING SDN BHD</div>
      <div className="slip-ad">NO. 19, 21, 23, 25, 27, JALAN PETANAK, 93100, KUCHING, SARAWAK.</div>
      <div className="slip-ti">PAYMENT SLIP FOR THE MONTH OF {MONTHS[mo].toUpperCase()} {yr}</div>

      <table className="slip-info">
        <tbody>
          <tr><td className="lb">PAY TO</td><td className="vl">{r.name}</td><td className="lb">DATE</td><td className="vl">{lastDay(mo, yr)}</td></tr>
          <tr><td className="lb">IC NO</td><td className="vl">{r.ic}</td><td className="lb">STATUS</td><td className="vl">{(r.status || '').toUpperCase()}</td></tr>
          <tr><td className="lb">DESIGNATION</td><td className="vl" colSpan={3}>{r.position}</td></tr>
        </tbody>
      </table>

      <table className="slip-box">
        <thead>
          <tr><th className="hl">EARNINGS</th><th className="ha">AMOUNT (RM)</th><th className="hl">DEDUCTIONS</th><th className="ha">AMOUNT (RM)</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: n }).map((_, i) => (
            <tr key={i}>
              <td className="cl">{earn[i] ? earn[i][0] : ''}</td>
              <td className="ca">{earn[i] ? acct(earn[i][1]) : ''}</td>
              <td className="cl">{ded[i] ? ded[i][0] : ''}</td>
              <td className="ca">{ded[i] ? acct(ded[i][1]) : ''}</td>
            </tr>
          ))}
          <tr className="tot">
            <td className="cl">TOTAL</td><td className="ca">{acct(earnTotal)}</td>
            <td className="cl">TOTAL</td><td className="ca">{acct(dedTotal)}</td>
          </tr>
        </tbody>
      </table>

      <table className="slip-net">
        <tbody><tr><td className="cl">NET PAY</td><td className="ca">{acct(r.netPay)}</td></tr></tbody>
      </table>
    </div>
  );
}

export default function Payslip() {
  const now = new Date();
  const [mo, setMo] = useState(now.getMonth());
  const [yr, setYr] = useState(now.getFullYear());
  const [idx, setIdx] = useState(0);
  const stripRef = useRef(null);

  // Pull staff + monthly data straight from payroll storage
  const staff = useMemo(() => load(LS_S, SAMPLE_STAFF), []);
  const pd = useMemo(() => load(LS_P, {}), []);
  const showBonus = useMemo(() => { const v = localStorage.getItem(LS_SB); return v === null ? true : JSON.parse(v); }, []);

  const rows = useMemo(() => {
    const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`, ref = new Date(yr, mo, 15);
    const all = staff.map(s => computeStaffMonth(s, pd[mk]?.[s.id], ref, showBonus));
    return [...all.filter(r => r.method === 'bank'), ...all.filter(r => r.method === 'cash')];
  }, [staff, pd, showBonus, mo, yr]);

  const cur = Math.min(idx, Math.max(0, rows.length - 1));
  const go = d => setIdx(i => Math.min(rows.length - 1, Math.max(0, i + d)));

  // Keyboard arrows navigate one-by-one
  useEffect(() => {
    const h = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  // Keep the active thumbnail in view
  useEffect(() => { const el = stripRef.current?.querySelector('.thumb.on'); if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [cur]);

  const changeMonth = d => { setIdx(0); if (d < 0) { if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1); } else { if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1); } };

  // Print pairs (2 payslips per A4)
  const pairs = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push([rows[i], rows[i + 1]]);

  return (
    <div className="ps-root">
      <style>{CSS}</style>

      <div className="ps-bar no-print">
        <h1>PAYSLIP</h1>
        <div className="ps-mnav">
          <button className="ps-mbtn" onClick={() => changeMonth(-1)}>&#9664;</button>
          <div className="ps-mlbl">{MONTHS[mo]} {yr}</div>
          <button className="ps-mbtn" onClick={() => changeMonth(1)}>&#9654;</button>
        </div>
        <div className="ps-acts">
          <span className="ps-count">{rows.length ? `${cur + 1} / ${rows.length}` : '0'}</span>
          <button className="ps-btn" onClick={() => window.print()}>Print all (2 per page)</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ps-body"><div className="ps-empty"><h2>No staff found</h2><p>Add staff in the Payroll tab first, then their payslips will show here.</p></div></div>
      ) : (
        <>
          {/* Single-payslip viewer */}
          <div className="ps-stage no-print">
            <button className="ps-arrow" disabled={cur === 0} onClick={() => go(-1)}>&#9664;</button>
            <div className="ps-slipwrap"><Slip r={rows[cur]} mo={mo} yr={yr} /></div>
            <button className="ps-arrow" disabled={cur >= rows.length - 1} onClick={() => go(1)}>&#9654;</button>
          </div>

          {/* Bottom preview strip */}
          <div className="ps-strip no-print" ref={stripRef}>
            {rows.map((r, i) => (
              <button key={r.id} className={"thumb" + (i === cur ? " on" : "")} onClick={() => setIdx(i)} title={r.name}>
                <span className="thumb-n">{i + 1}</span>
                <span className="thumb-name">{(r.name || '').split(' ').slice(0, 2).join(' ')}</span>
                <span className="thumb-net">RM {fmt(r.netPay)}</span>
              </button>
            ))}
          </div>

          {/* Hidden until print: all payslips, 2 per A4 */}
          <div className="ps-print">
            {pairs.map((pair, pi) => (
              <div className="ps-page" key={pi}>
                {pair.map((r, j) => r ? <Slip key={r.id} r={r} mo={mo} yr={yr} /> : <div key={j} className="slip slip-blank" />)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CSS = `
.ps-root{background:#fafafa;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.ps-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.ps-bar h1{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0;color:#18181b}
.ps-mnav{display:flex;align-items:center;gap:8px}
.ps-mbtn{border:1px solid #e4e4e7;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#52525b;font-size:11px}
.ps-mlbl{font-size:13px;font-weight:600;min-width:120px;text-align:center;color:#18181b}
.ps-acts{margin-left:auto;display:flex;align-items:center;gap:14px}
.ps-count{font-size:12px;color:#71717a;font-variant-numeric:tabular-nums}
.ps-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.ps-btn:hover{background:#000}
.ps-body{max-width:1100px;margin:0 auto;padding:24px}
.ps-empty{background:#fff;border:1px dashed #d4d4d8;border-radius:12px;padding:48px 24px;text-align:center;color:#71717a}
.ps-empty h2{margin:0 0 8px;font-size:16px;color:#18181b}

.ps-stage{display:flex;align-items:center;justify-content:center;gap:20px;padding:28px 16px 120px}
.ps-arrow{flex:none;width:44px;height:44px;border-radius:50%;border:1px solid #e4e4e7;background:#fff;color:#3f3f46;font-size:15px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.ps-arrow:hover:not(:disabled){background:#f4f4f5}
.ps-arrow:disabled{opacity:.35;cursor:default}
.ps-slipwrap{font-size:15px}

/* Bottom preview strip */
.ps-strip{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;gap:8px;overflow-x:auto;padding:10px 14px;background:#fff;border-top:1px solid #e4e4e7;box-shadow:0 -2px 8px rgba(0,0,0,.05)}
.thumb{flex:none;width:120px;display:flex;flex-direction:column;gap:2px;text-align:left;padding:7px 10px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;cursor:pointer}
.thumb:hover{background:#f4f4f5}
.thumb.on{border-color:#18181b;background:#f4f4f5;box-shadow:0 0 0 1px #18181b inset}
.thumb-n{font-size:10px;color:#a1a1aa;font-weight:700}
.thumb-name{font-size:11px;font-weight:600;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thumb-net{font-size:10.5px;color:#059669;font-variant-numeric:tabular-nums}

/* ─── The payslip itself (em-based so it scales screen vs print) ─── */
.slip{width:34em;box-sizing:border-box;background:#fff;border:1px solid #000;padding:1em 1.2em 1.3em;color:#000;line-height:1.25}
.slip-co{font-family:"Times New Roman",Times,serif;font-weight:700;font-size:1.12em;text-align:center;letter-spacing:.01em}
.slip-ad{font-size:.72em;text-align:center;margin-top:.15em}
.slip-ti{font-weight:700;font-size:.92em;text-align:center;text-decoration:underline;margin:.7em 0 .6em}
.slip-info{width:100%;border-collapse:collapse;font-size:.8em;margin-bottom:.6em}
.slip-info td{padding:.12em 0;vertical-align:top}
.slip-info .lb{font-weight:700;width:7.5em;white-space:nowrap}
.slip-info .vl{padding-right:1em}
.slip-box{width:100%;border-collapse:collapse;font-size:.8em}
.slip-box th,.slip-box td{border:1px solid #000;padding:.2em .5em}
.slip-box .hl{text-align:left;font-weight:700;width:26%}
.slip-box .ha{text-align:right;font-weight:700;width:24%}
.slip-box .cl{text-align:left}
.slip-box .ca{text-align:right;font-variant-numeric:tabular-nums}
.slip-box .tot .cl,.slip-box .tot .ca{font-weight:700;border-top:1.5px solid #000}
.slip-net{width:100%;border-collapse:collapse;font-size:.85em;margin-top:.5em}
.slip-net td{border:1px solid #000;padding:.28em .5em;font-weight:700}
.slip-net .cl{text-align:left;width:50%}
.slip-net .ca{text-align:right;font-variant-numeric:tabular-nums}

/* Print: all payslips, 2 per A4 */
.ps-print{display:none}
@media print{
  .no-print{display:none!important}
  .ps-root{background:#fff}
  .ps-print{display:block}
  .ps-page{display:flex;gap:6mm;justify-content:center;align-items:flex-start;page-break-after:always;padding-top:6mm}
  .ps-page .slip{width:96mm;font-size:8.2pt;border:1px solid #000}
  .slip-blank{border:none!important}
  @page{size:A4 portrait;margin:6mm}
}
`;

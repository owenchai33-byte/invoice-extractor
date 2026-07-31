import { useState, useEffect, useMemo, useRef } from 'react';
import { computeStaffMonth, LS_S, LS_P, LS_SB, SAMPLE_STAFF, fmt } from './Payroll';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const numFmt = v => (!v || v === 0) ? '-' : Number(v).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const lastDay = (mo, yr) => { const d = new Date(yr, mo + 1, 0); return `${d.getDate()}-${MON3[mo]}-${yr}`; };

// ─── One payslip (matches Sabrina's Excel layout exactly) ───
function Slip({ r, mo, yr }) {
  const earn = [['BASIC SALARY', r.salary], ['INCENTIVE', r.incentive]];
  if (r.bonus > 0) earn.push([(r.bonusLabel || 'BONUS'), r.bonus]);
  const earnTotal = r.salary + (r.incentive || 0) + (r.bonus || 0);
  const ded = [['EPF', r.epfP], ['SOCSO (+SKBBK=1.25%)', r.socsoP], ['EIS', r.eisE], ['ADVANCE', r.advance || 0]];
  const dedTotal = Math.round((r.epfP + r.socsoP + r.eisE + (r.advance || 0)) * 100) / 100;
  const n = Math.max(earn.length, ded.length);

  return (
    <div className="slip">
      <div className="slip-co"><i>C.J.K.</i> CHAI JEE KIONG TRADING SDN BHD</div>
      <div className="slip-ad">NO. 19, 21, 23, 25, 27, JALAN PETANAK, 93100, KUCHING, SARAWAK.</div>
      <div className="slip-ti">PAYMENT SLIP FOR THE MONTH OF {MONTHS[mo].toUpperCase()} {yr}</div>

      {/* Info section — no borders, just aligned text like Excel */}
      <div className="slip-info">
        <div className="slip-info-row">
          <span className="si-lb">PAY TO</span>
          <span className="si-vl">{r.name}</span>
          <span className="si-lb">DATE</span>
          <span className="si-vr">{lastDay(mo, yr)}</span>
        </div>
        <div className="slip-info-row">
          <span className="si-lb">IC NO</span>
          <span className="si-vl">{r.ic}</span>
          <span className="si-lb">STATUS</span>
          <span className="si-vr">{(r.status || '').toUpperCase()}</span>
        </div>
        <div className="slip-info-row">
          <span className="si-lb">DESIGNATION</span>
          <span className="si-vl">{r.position}</span>
        </div>
      </div>

      <table className="slip-box">
        <thead>
          <tr><th className="hl">EARNINGS</th><th className="ha">AMOUNT (RM)</th><th className="hl">DEDUCTIONS</th><th className="ha">AMOUNT (RM)</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: n }).map((_, i) => (
            <tr key={i}>
              <td className="cl">{earn[i] ? earn[i][0] : ''}</td>
              <td className="ca">{earn[i] ? numFmt(earn[i][1]) : ''}</td>
              <td className={ded[i] && ded[i][0].length > 15 ? "cl cl-long" : "cl"}>{ded[i] ? ded[i][0] : ''}</td>
              <td className="ca">{ded[i] ? numFmt(ded[i][1]) : ''}</td>
            </tr>
          ))}
          <tr className="tot">
            <td className="cl">TOTAL</td><td className="ca">{numFmt(earnTotal)}</td>
            <td className="cl">TOTAL</td><td className="ca">{numFmt(dedTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div className="slip-net">
        <span className="sn-lb">NET PAY</span>
        <span className="sn-val">{numFmt(r.netPay)}</span>
      </div>

      {/* Signature block — labels at top, lines at bottom, gap in between */}
      <div className="slip-sig">
        <div className="sig-labels"><span>AUTHORISED BY</span><span>RECEIVED BY</span></div>
        <div className="sig-bottom">
          <div className="sig-col">
            <div className="sig-line"></div>
            <div className="sig-name">CHAI CHEE CHOI</div>
            <div className="sig-title">DIRECTOR</div>
          </div>
          <div className="sig-col">
            <div className="sig-line"></div>
          </div>
        </div>
      </div>
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

  useEffect(() => { document.title = `CJK Payslips - ${MONTHS[mo]} ${yr}`; }, [mo, yr]);

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
.slip{width:34em;height:24em;box-sizing:border-box;background:#fff;padding:1.2em 1.5em 1em;color:#000;line-height:1.3;font-family:"Calibri","Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column}
.slip-co{font-family:"Times New Roman",Times,serif;font-weight:700;font-size:1.1em;text-align:center;letter-spacing:.01em}
.slip-co i{font-style:italic}
.slip-ad{font-size:.85em;text-align:center;margin-top:.1em}
.slip-ti{font-weight:700;font-size:.88em;text-align:center;text-decoration:underline;margin:.7em 0 .5em}

/* Info section — no borders, plain aligned text */
.slip-info{font-size:.8em;margin-bottom:.5em}
.slip-info-row{display:flex;align-items:baseline;margin-bottom:.1em}
.si-lb{width:20%;flex-shrink:0}
.si-vl{width:30%;flex-shrink:0;font-weight:700;text-align:center}
.si-vr{width:30%;flex-shrink:0;text-align:center;font-weight:700}

/* Earnings/Deductions bordered table */
.slip-box{width:100%;border-collapse:collapse;font-size:.8em}
.slip-box th{border:1px solid #000;padding:.2em .5em;text-align:center;font-weight:700}
.slip-box td{border-left:1px solid #000;border-right:1px solid #000;padding:.2em .5em}
.slip-box .hl{width:20%}
.slip-box .ha{width:30%}
.slip-box .cl{text-align:left}
.slip-box .ca{text-align:right;font-variant-numeric:tabular-nums}
.slip-box .cl-long{font-size:.75em;white-space:nowrap}
.slip-box .tot td{border-top:1px solid #000;border-bottom:1px solid #000}

/* NET PAY row — value box aligned under earnings AMOUNT column like Excel */
.slip-net{display:flex;align-items:center;margin-top:.5em;font-size:.85em;font-weight:700}
.sn-lb{width:20%;flex-shrink:0}
.sn-val{border:none;border-top:1px solid #000;border-bottom:3px double #000;padding:.2em .5em;font-variant-numeric:tabular-nums;width:30%;text-align:right;box-sizing:border-box}

/* Signature block — labels top, lines bottom, signing gap between */
.slip-sig{display:flex;flex-direction:column;margin-top:.8em;font-size:.75em;padding:0 3%;flex:1}
.sig-labels{display:flex;justify-content:space-between}
.sig-bottom{display:flex;justify-content:space-between;margin-top:auto}
.sig-col{width:28%}
.sig-line{border-bottom:1px solid #000;margin-bottom:.3em}
.sig-name{font-weight:700;text-align:center}
.sig-title{font-weight:700;text-align:center}

/* Print: all payslips, 2 per A4 — matches Excel: Calibri 13pt, 0 margins */
.ps-print{display:none}
@media print{
  .no-print{display:none!important}
  .ps-root{background:#fff}
  .ps-print{display:block}
  .ps-page{display:flex;flex-direction:column;page-break-after:always}
  .ps-page .slip{width:100%;font-size:13pt;line-height:1.3;padding:0 5mm;height:50vh;box-sizing:border-box;display:flex;flex-direction:column}
  .ps-page .slip-co{font-size:1em}
  .ps-page .slip-ad{font-size:1em}
  .ps-page .slip-box th,.ps-page .slip-box td{padding:.25em .4em}
  .ps-page .slip-box .cl-long{font-size:.85em}
  .ps-page .slip-ti{margin:.4em 0 .3em}
  .ps-page .slip-info{margin-bottom:.3em}
  .ps-page .si-vl{flex:none}

  .slip-blank{border:none!important;height:50vh}
  @page{size:A4 portrait;margin:0}
}
`;

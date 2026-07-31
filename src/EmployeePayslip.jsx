import { useState, useEffect, useMemo, useRef } from 'react';
import { computeStaffMonth, LS_S, LS_P, LS_SB, SAMPLE_STAFF, fmt } from './Payroll';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const numFmt = v => (!v || v === 0) ? '-' : Number(v).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const lastDay = (mo, yr) => { const d = new Date(yr, mo + 1, 0); return `${d.getDate()}-${MON3[mo]}-${yr}`; };
const incDate = (mo, yr) => { const m2 = (mo + 1) % 12; const y2 = mo === 11 ? yr + 1 : yr; return `11-${MON3[m2]}-${y2}`; };

function EpCard({ r, mo, yr }) {
  const dailyRate = (r.salary / 26);
  const epfMDaily = (r.epfM / 26);
  const salaryNet = Math.round((r.salary + (r.bonus || 0) - r.epfP - r.socsoInv - r.socsoSkbbk - r.eisE - (r.advance || 0)) * 100) / 100;
  const nameCls = (r.name || '').length > 22 ? 'ep-val ep-sm' : 'ep-val';

  return (
    <div className="ep-card">
      <div className="ep-halves">
        {/* Left: Salary */}
        <div className="ep-half ep-salary">
          <div className="ep-title">PAYSLIP {MONTHS[mo].toUpperCase()} {yr}</div>
          <div className="ep-info">
            <div className="ep-row"><span className="ep-lb">PAY TO</span><span className={nameCls}>{r.name}</span></div>
            <div className="ep-row"><span className="ep-lb">DESIGNATION</span><span className={nameCls}>{r.position}</span></div>
            <div className="ep-row"><span className="ep-lb">DATE</span><span className="ep-val">{lastDay(mo, yr)}</span></div>
          </div>

          <div className="ep-sec">
            <div className="ep-hdr"><span>EARNINGS</span><span>AMOUNT (RM)</span></div>
            <div className="ep-line"><span className="ep-lbl">BASIC SALARY</span><span className="ep-rate">{numFmt(dailyRate)}</span><span className="ep-amt">{numFmt(r.salary)}</span></div>
            {r.bonus > 0 && <div className="ep-line"><span className="ep-lbl">{r.bonusLabel || 'BONUS (PAID)'}</span><span className="ep-rate"></span><span className="ep-amt">{numFmt(r.bonus)}</span></div>}
          </div>

          <div className="ep-sec">
            <div className="ep-hdr"><span>DEDUCTIONS</span><span>AMOUNT (RM)</span></div>
            <div className="ep-line"><span className="ep-lbl ep-ded-lbl">EPF {numFmt(r.epfM)}/{numFmt(epfMDaily)}</span><span className="ep-amt">{numFmt(r.epfP)}</span></div>
            <div className="ep-line"><span className="ep-lbl ep-ded-lbl">SOCSO (0.5%) {numFmt(r.socsoM)}</span><span className="ep-amt">{numFmt(r.socsoInv)}</span></div>
            <div className="ep-line"><span className="ep-lbl ep-ded-lbl">SOCSO (SKBBK 0.75%)</span><span className="ep-amt">{numFmt(r.socsoSkbbk)}</span></div>
            <div className="ep-line"><span className="ep-lbl ep-ded-lbl">EIS{'      '}{numFmt(r.eisE)}</span><span className="ep-amt">{numFmt(r.eisE)}</span></div>
            <div className="ep-line"><span className="ep-lbl ep-ded-lbl">ADVANCE</span><span className="ep-amt">{numFmt(r.advance || 0)}</span></div>
          </div>

          <div className="ep-subtotal"><span className="ep-amt">{numFmt(salaryNet)}</span></div>
          <div className="ep-row ep-extra"><span className="ep-lb">ABSENCE</span><span className="ep-val">-</span></div>
          <div className="ep-row ep-extra"><span className="ep-lb">OTHERS</span><span className="ep-val"></span></div>
        </div>

        {/* Right: Incentive */}
        <div className="ep-half ep-incentive">
          <div className="ep-title">PAYSLIP {MONTHS[mo].toUpperCase()} {yr}</div>
          <div className="ep-info">
            <div className="ep-row"><span className="ep-lb">PAY TO</span><span className={nameCls}>{r.name}</span></div>
            <div className="ep-row"><span className="ep-lb">DESIGNATION</span><span className={nameCls}>{r.position}</span></div>
            <div className="ep-row"><span className="ep-lb">DATE</span><span className="ep-val">{incDate(mo, yr)}</span></div>
          </div>

          <div className="ep-sec">
            <div className="ep-hdr"><span>EARNINGS</span><span>AMOUNT (RM)</span></div>
            <div className="ep-line"><span className="ep-lbl">INCENTIVE</span><span className="ep-rate"></span><span className="ep-amt">{numFmt(r.incentive)}</span></div>
          </div>

          <div className="ep-inc-net">
            <span className="ep-lb">NET PAY</span>
          </div>
        </div>
      </div>

      <div className="ep-bottom">
        <span className="ep-net-lb">NET PAY</span>
      </div>
    </div>
  );
}

export default function EmployeePayslip() {
  const now = new Date();
  const [mo, setMo] = useState(now.getMonth());
  const [yr, setYr] = useState(now.getFullYear());
  const [idx, setIdx] = useState(0);
  const stripRef = useRef(null);

  const staff = useMemo(() => load(LS_S, SAMPLE_STAFF), []);
  const pd = useMemo(() => load(LS_P, {}), []);
  const showBonus = useMemo(() => { const v = localStorage.getItem(LS_SB); return v === null ? true : JSON.parse(v); }, []);

  const rows = useMemo(() => {
    const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`, ref = new Date(yr, mo, 15);
    const all = staff.map(s => computeStaffMonth(s, pd[mk]?.[s.id], ref, showBonus));
    return [...all.filter(r => r.method === 'bank'), ...all.filter(r => r.method === 'cash')];
  }, [staff, pd, showBonus, mo, yr]);

  const pairs = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push([rows[i], rows[i + 1]]);

  const cur = Math.min(idx, Math.max(0, pairs.length - 1));
  const go = d => setIdx(i => Math.min(pairs.length - 1, Math.max(0, i + d)));

  useEffect(() => {
    const h = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => { const el = stripRef.current?.querySelector('.thumb.on'); if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [cur]);

  const changeMonth = d => { setIdx(0); if (d < 0) { if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1); } else { if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1); } };

  useEffect(() => { document.title = `CJK Employee Payslips - ${MONTHS[mo]} ${yr}`; }, [mo, yr]);

  return (
    <div className="ep-root">
      <style>{CSS}</style>

      <div className="ep-bar no-print">
        <h1>EMPLOYEE PAYSLIP</h1>
        <div className="ep-mnav">
          <button className="ep-mbtn" onClick={() => changeMonth(-1)}>&#9664;</button>
          <div className="ep-mlbl">{MONTHS[mo]} {yr}</div>
          <button className="ep-mbtn" onClick={() => changeMonth(1)}>&#9654;</button>
        </div>
        <div className="ep-acts">
          <span className="ep-count">{pairs.length ? `Page ${cur + 1} / ${pairs.length}` : '0'}</span>
          <button className="ep-btn" onClick={() => window.print()}>Print all (2 per page)</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{maxWidth:1100,margin:'0 auto',padding:24}}><div style={{background:'#fff',border:'1px dashed #d4d4d8',borderRadius:12,padding:'48px 24px',textAlign:'center',color:'#71717a'}}><h2 style={{margin:'0 0 8px',fontSize:16,color:'#18181b'}}>No staff found</h2><p>Add staff in the Payroll tab first.</p></div></div>
      ) : (
        <>
          <div className="ep-stage no-print">
            <button className="ep-arrow" disabled={cur === 0} onClick={() => go(-1)}>&#9664;</button>
            <div className="ep-pagewrap">
              <EpCard r={pairs[cur][0]} mo={mo} yr={yr} />
              {pairs[cur][1] && <EpCard r={pairs[cur][1]} mo={mo} yr={yr} />}
            </div>
            <button className="ep-arrow" disabled={cur >= pairs.length - 1} onClick={() => go(1)}>&#9654;</button>
          </div>

          <div className="ep-strip no-print" ref={stripRef}>
            {rows.map((r, i) => (
              <button key={r.id} className={"thumb" + (Math.floor(i / 2) === cur ? " on" : "")} onClick={() => setIdx(Math.floor(i / 2))} title={r.name}>
                <span className="thumb-n">{i + 1}</span>
                <span className="thumb-name">{(r.name || '').split(' ').slice(0, 2).join(' ')}</span>
                <span className="thumb-net">RM {fmt(r.netPay)}</span>
              </button>
            ))}
          </div>

          <div className="ep-print">
            {pairs.map((pair, pi) => (
              <div className="ep-page" key={pi}>
                {pair.map((r, j) => r ? <EpCard key={r.id} r={r} mo={mo} yr={yr} /> : <div key={j} className="ep-card ep-blank" />)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CSS = `
.ep-root{background:#fafafa;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.ep-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.ep-bar h1{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0;color:#18181b}
.ep-mnav{display:flex;align-items:center;gap:8px}
.ep-mbtn{border:1px solid #e4e4e7;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#52525b;font-size:11px}
.ep-mlbl{font-size:13px;font-weight:600;min-width:120px;text-align:center;color:#18181b}
.ep-acts{margin-left:auto;display:flex;align-items:center;gap:14px}
.ep-count{font-size:12px;color:#71717a;font-variant-numeric:tabular-nums}
.ep-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.ep-btn:hover{background:#000}

.ep-stage{display:flex;align-items:center;justify-content:center;gap:20px;padding:28px 16px 120px}
.ep-arrow{flex:none;width:44px;height:44px;border-radius:50%;border:1px solid #e4e4e7;background:#fff;color:#3f3f46;font-size:15px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.ep-arrow:hover:not(:disabled){background:#f4f4f5}
.ep-arrow:disabled{opacity:.35;cursor:default}

.ep-pagewrap{display:flex;gap:1.5em;padding:0;align-items:stretch}
.ep-pagewrap .ep-card{width:19cm;height:13.35cm;padding:1.2em;box-shadow:0 2px 16px rgba(0,0,0,.12);border-radius:4px;font-size:11px}

.ep-strip{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;gap:8px;overflow-x:auto;padding:10px 14px;background:#fff;border-top:1px solid #e4e4e7;box-shadow:0 -2px 8px rgba(0,0,0,.05)}

/* Employee payslip card */
.ep-card{box-sizing:border-box;background:#fff;color:#000;font-family:"Calibri","Segoe UI",system-ui,sans-serif;line-height:1.3;display:flex;flex-direction:column}
.ep-halves{display:flex;gap:.8em;flex:1}
.ep-half{flex:1;display:flex;flex-direction:column}
.ep-salary{flex:1.2}
.ep-incentive{flex:0.8}

.ep-title{font-weight:700;text-decoration:underline;text-align:center;margin-bottom:.4em;font-size:1em}
.ep-info{margin-bottom:.5em}
.ep-row{display:flex;align-items:baseline;margin-bottom:.1em}
.ep-lb{width:35%;flex-shrink:0;font-size:1em}
.ep-val{flex:1;font-weight:700;font-size:1em}
.ep-sm{font-size:.78em;white-space:nowrap}
.ep-extra{font-size:.95em}

.ep-sec{margin-bottom:.3em}
.ep-hdr{display:flex;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:.1em;margin-bottom:.15em;font-weight:700;font-size:.95em}
.ep-line{display:flex;align-items:baseline;font-size:.9em;line-height:1.4}
.ep-lbl{flex:1;white-space:nowrap}
.ep-ded-lbl{font-size:.85em}
.ep-rate{width:3.5em;text-align:right;font-size:.85em;color:#555;flex-shrink:0;margin-right:.3em}
.ep-amt{width:4.5em;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}

.ep-subtotal{text-align:right;font-weight:700;border-top:1px solid #000;padding-top:.15em;margin-bottom:.3em;font-size:.9em}
.ep-inc-net{margin-top:auto;font-weight:700;font-size:1em}

.ep-bottom{font-weight:700;font-size:1em;margin-top:auto;padding-top:.3em}
.ep-net-lb{display:block}

/* Print */
.ep-print{display:none}
@media print{
  .no-print{display:none!important}
  .ep-root{background:#fff}
  .ep-print{display:block}
  .ep-page{display:flex;flex-direction:column;page-break-after:always}
  .ep-page .ep-card{width:100%;font-size:11pt;padding:5mm 10mm;height:50vh;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}
  .ep-blank{border:none!important;height:50vh}
  @page{size:A4 portrait;margin:0}
}
`;

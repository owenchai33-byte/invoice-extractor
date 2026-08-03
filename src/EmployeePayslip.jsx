import { useState, useEffect, useMemo, useRef } from 'react';
import { computeStaffMonth, LS_S, LS_P, LS_SB, SAMPLE_STAFF, fmt } from './Payroll';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const nf = v => (!v || v === 0) ? '-' : Number(v).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const lastDay = (mo, yr) => { const d = new Date(yr, mo + 1, 0); return `${d.getDate()}-${MON3[mo]}-${yr.toString().slice(-2)}`; };
const incDay = (mo, yr) => { const m2 = (mo + 1) % 12; const y2 = mo === 11 ? yr + 1 : yr; return `11-${MON3[m2]}-${y2.toString().slice(-2)}`; };
const fitCls = (txt, base) => { const len = (txt || '').length; if (len > 34) return base + ' ep-xs'; if (len > 22) return base + ' ep-sm'; return base; };
const fmtAbs = v => { const n = parseFloat(v); if (!n) return '-'; const w = Math.floor(n); const h = (n % 1) >= 0.5; let s = ''; if (w > 0) s += w; if (h) s += '½'; return s + (n > 1 ? ' DAYS' : ' DAY'); };

if (typeof localStorage !== 'undefined') { try { const _sv = JSON.parse(localStorage.getItem(LS_S)); if (_sv) { const _df = Object.fromEntries(SAMPLE_STAFF.map(s => [s.id, s])); let _ch = false; _sv.forEach(s => { const d = _df[s.id]; if (d?.bankAcc && !s.bankAcc) { s.bankAcc = d.bankAcc; _ch = true; } }); if (_ch) localStorage.setItem(LS_S, JSON.stringify(_sv)); } } catch {} }

function Fv({ f, children }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!show) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [show]);
  return (
    <span ref={ref} className="fv-wrap" onClick={e => { e.stopPropagation(); setShow(!show); }}>
      {children}
      {show && <span className="fv-tip">{f}</span>}
    </span>
  );
}

function EpCard({ r, mo, yr, compact, absVal, onAbsChange }) {
  const hasInc = (r.incentive || 0) > 0;
  const daily = r.salary / 26;
  const epfMD = r.epfM / 26;
  const salNet = Math.round((r.salary + (r.bonus || 0) - r.epfP - r.socsoInv - r.socsoSkbbk - r.eisE - (r.advance || 0)) * 100) / 100;

  return (
    <div className={"ep-card" + (compact ? " ep-compact" : "")}>
      <div className="ep-halves">
        {/* Salary side */}
        <div className={hasInc ? 'ep-sal' : 'ep-sal ep-sal-full'}>
          <div className="ep-ti">PAYSLIP {MONTHS[mo].toUpperCase()} {yr}</div>
          <div className="ep-info">
            <div className="ep-row"><span className="ep-lb">PAY TO</span><span className={fitCls(r.name,'ep-vl')}>{r.name}</span></div>
            <div className="ep-row"><span className="ep-lb">DESIGNATION</span><span className={fitCls(r.position,'ep-vl')}>{r.position}</span></div>
            <div className="ep-row"><span className="ep-lb">DATE</span><span className="ep-vl">{lastDay(mo, yr)}</span></div>
            {r.bankAcc ? <div className="ep-row"><span className="ep-lb">BANK ACC NO.</span><span className={fitCls(r.bankAcc,'ep-vl')}>{r.bankAcc}</span></div> : <div className="ep-row ep-spacer">&nbsp;</div>}
          </div>

          <table className="ep-tbl">
            <colgroup><col className="ep-col-lbl"/><col className="ep-col-mid"/><col className="ep-col-amt"/></colgroup>
            <tbody className="ep-earn">
              <tr className="ep-hdr"><th className="ep-tl">EARNINGS</th><th colSpan="2" className="ep-tr">AMOUNT (RM)</th></tr>
              <tr><td className="ep-tl">BASIC SALARY</td><td className="ep-tm"><Fv f={`Salary \xf7 26 = ${nf(r.salary)} \xf7 26`}>{nf(daily)}</Fv></td><td className="ep-tr"><Fv f="Basic monthly salary">{nf(r.salary)}</Fv></td></tr>
              {r.bonus > 0 && <tr className="ep-bonus"><td className="ep-tl">{r.bonusLabel || 'BONUS (PAID)'}</td><td className="ep-tm"></td><td className="ep-tr"><Fv f="Bonus payment">{nf(r.bonus)}</Fv></td></tr>}
            </tbody>
            <tbody className="ep-ded">
              <tr className="ep-hdr"><th className="ep-tl">DEDUCTIONS</th><th colSpan="2" className="ep-tr">AMOUNT (RM)</th></tr>
              <tr><td className="ep-tl">EPF{' '}<Fv f={`EPF employer (table lookup on salary ${nf(r.salary)})`}>{nf(r.epfM)}</Fv>/<Fv f={`EPF employer \xf7 26 = ${nf(r.epfM)} \xf7 26`}>{nf(epfMD)}</Fv></td><td colSpan="2" className="ep-tr"><Fv f={`EPF employee (table lookup on salary ${nf(r.salary)})`}>{nf(r.epfP)}</Fv></td></tr>
              <tr><td className="ep-tl">SOCSO (0.5%) <Fv f="SOCSO employer contribution">{nf(r.socsoM)}</Fv></td><td colSpan="2" className="ep-tr"><Fv f="SOCSO employee invaliditi contribution">{nf(r.socsoInv)}</Fv></td></tr>
              <tr><td className="ep-tl">SOCSO (SKBBK 0.75%)</td><td colSpan="2" className="ep-tr"><Fv f="SOCSO SKBBK employment injury (0.75%)">{nf(r.socsoSkbbk)}</Fv></td></tr>
              <tr><td className="ep-tl">EIS{' '}<Fv f="EIS employee contribution">{nf(r.eisE)}</Fv></td><td colSpan="2" className="ep-tr"><Fv f="EIS employee contribution">{nf(r.eisE)}</Fv></td></tr>
              <tr><td className="ep-tl">ADVANCE</td><td colSpan="2" className="ep-tr"><Fv f="Monthly advance deduction">{nf(r.advance || 0)}</Fv></td></tr>
              <tr className="ep-sub"><td className="ep-tl"></td><td colSpan="2" className="ep-tr"><Fv f={`${nf(r.salary)}${r.bonus > 0 ? ' + ' + nf(r.bonus) : ''} − ${nf(r.epfP)} − ${nf(r.socsoInv)} − ${nf(r.socsoSkbbk)} − ${nf(r.eisE)}${(r.advance || 0) > 0 ? ' − ' + nf(r.advance) : ''}`}>{nf(salNet)}</Fv></td></tr>
              <tr className="ep-xtra"><td className="ep-tl">ABSENCE <span className="ep-abs-pr">{fmtAbs(absVal)}</span></td><td className="ep-tm"><input type="number" step="0.5" min="0" className="ep-abs-in no-print" value={absVal || ''} onChange={e => onAbsChange(e.target.value)} placeholder="-" /></td><td className="ep-tr"></td></tr>
              <tr className="ep-xtra"><td className="ep-tl">OTHERS</td><td colSpan="2" className="ep-tr"></td></tr>
            </tbody>
            <tbody className="ep-net-body">
              <tr className="ep-net-gap"><td colSpan="3"></td></tr>
              <tr className="ep-net-gap"><td colSpan="3"></td></tr>
              <tr><td className="ep-net-lb">NET PAY</td><td colSpan="2" className="ep-net-td"></td></tr>
            </tbody>
          </table>
        </div>

        {/* Incentive side */}
        {hasInc && (
          <div className="ep-inc">
            <div className="ep-ti">PAYSLIP {MONTHS[mo].toUpperCase()} {yr}</div>
            <div className="ep-info">
              <div className="ep-row"><span className="ep-lb">PAY TO</span><span className={fitCls(r.name,'ep-vl')}>{r.name}</span></div>
              <div className="ep-row"><span className="ep-lb">DESIGNATION</span><span className={fitCls(r.position,'ep-vl')}>{r.position}</span></div>
              <div className="ep-row"><span className="ep-lb">DATE</span><span className="ep-vl">{incDay(mo, yr)}</span></div>
              <div className="ep-row ep-spacer">&nbsp;</div>
            </div>

            <table className="ep-tbl">
              <thead><tr><th className="ep-tl">EARNINGS</th><th className="ep-tr">AMOUNT (RM)</th></tr></thead>
              <tbody className="ep-inc-body">
                <tr><td className="ep-tl">INCENTIVE</td><td className="ep-tr"><Fv f="Monthly incentive payment">{nf(r.incentive)}</Fv></td></tr>
              </tbody>
              <tbody className="ep-net-body">
                <tr className="ep-net-gap"><td colSpan="2"></td></tr>
                <tr className="ep-net-gap"><td colSpan="2"></td></tr>
                <tr><td className="ep-net-lb">NET PAY</td><td className="ep-net-td"></td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmployeePayslip() {
  const now = new Date();
  const [mo, setMo] = useState(now.getMonth());
  const [yr, setYr] = useState(now.getFullYear());
  const [idx, setIdx] = useState(0);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth > 1200);
  const stripRef = useRef(null);

  useEffect(() => {
    const check = () => setWide(window.innerWidth > 1200);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const staff = useMemo(() => load(LS_S, SAMPLE_STAFF), []);
  const pd = useMemo(() => load(LS_P, {}), []);
  const showBonus = useMemo(() => { const v = localStorage.getItem(LS_SB); return v === null ? true : JSON.parse(v); }, []);
  const [abs, setAbs] = useState(() => load('cjk_absence', {}));
  const absK = sid => `${yr}-${String(mo + 1).padStart(2, '0')}-${sid}`;
  const getAbs = sid => abs[absK(sid)] || '';
  const setAbsV = (sid, v) => { const k = absK(sid); const next = { ...abs, [k]: v }; setAbs(next); try { localStorage.setItem('cjk_absence', JSON.stringify(next)); } catch {} };

  const rows = useMemo(() => {
    const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`, ref = new Date(yr, mo, 15);
    const all = staff.map(s => computeStaffMonth(s, pd[mk]?.[s.id], ref, showBonus));
    return [...all.filter(r => r.method === 'bank'), ...all.filter(r => r.method === 'cash')];
  }, [staff, pd, showBonus, mo, yr]);

  const printPages = useMemo(() => {
    const pages = [];
    let cur = { items: [], slots: 0 };
    rows.forEach(r => {
      const half = (r.incentive || 0) > 0;
      const size = half ? 2 : 1;
      if (cur.slots + size > 4) { pages.push(cur); cur = { items: [], slots: 0 }; }
      cur.items.push({ r, half });
      cur.slots += size;
    });
    if (cur.items.length > 0) pages.push(cur);
    return pages;
  }, [rows]);

  const step = wide ? 2 : 1;
  const maxIdx = Math.max(0, rows.length - step);
  const cur = Math.min(wide ? (idx % 2 === 0 ? idx : Math.max(0, idx - 1)) : idx, maxIdx);
  const go = d => setIdx(Math.min(maxIdx, Math.max(0, cur + d * step)));

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
          <span className="ep-count">{rows.length ? (wide ? `Page ${cur / 2 + 1} / ${Math.ceil(rows.length / 2)}` : `${cur + 1} / ${rows.length}`) : '0'}</span>
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
              <EpCard r={rows[cur]} mo={mo} yr={yr} absVal={getAbs(rows[cur].id)} onAbsChange={v => setAbsV(rows[cur].id, v)} />
              {wide && rows[cur + 1] && <EpCard r={rows[cur + 1]} mo={mo} yr={yr} absVal={getAbs(rows[cur + 1].id)} onAbsChange={v => setAbsV(rows[cur + 1].id, v)} />}
            </div>
            <button className="ep-arrow" disabled={cur >= maxIdx} onClick={() => go(1)}>&#9654;</button>
          </div>

          <div className="ep-strip no-print" ref={stripRef}>
            {rows.map((r, i) => (
              <button key={r.id} className={"thumb" + ((wide ? (i === cur || i === cur + 1) : i === cur) ? " on" : "")} onClick={() => setIdx(wide ? Math.floor(i / 2) * 2 : i)} title={r.name}>
                <span className="thumb-n">{i + 1}</span>
                <span className="thumb-name">{(r.name || '').split(' ').slice(0, 2).join(' ')}</span>
                <span className="thumb-net">RM {fmt(r.netPay)}</span>
              </button>
            ))}
          </div>

          <div className="ep-print">
            {printPages.map((pg, pi) => (
              <div className="ep-page" key={pi}>
                {pg.items.map(it => <EpCard key={it.r.id} r={it.r} mo={mo} yr={yr} compact={!it.half} absVal={getAbs(it.r.id)} onAbsChange={v => setAbsV(it.r.id, v)} />)}
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

.ep-stage{display:flex;align-items:center;justify-content:center;gap:20px;padding:28px 72px 120px}
.ep-arrow{position:fixed;top:50%;transform:translateY(-50%);z-index:30;width:44px;height:44px;border-radius:50%;border:1px solid #e4e4e7;background:#fff;color:#3f3f46;font-size:15px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.ep-stage>.ep-arrow:first-child{left:12px}
.ep-stage>.ep-arrow:last-child{right:12px}
.ep-arrow:hover:not(:disabled){background:#f4f4f5}
.ep-arrow:disabled{opacity:.35;cursor:default}

.ep-pagewrap{display:flex;gap:0;padding:0;align-items:stretch;justify-content:center}
.ep-pagewrap .ep-card{width:100%;max-width:21cm;padding:1.2em 1.5em;box-shadow:0 2px 16px rgba(0,0,0,.12);border-radius:4px;font-size:11.5px}

.ep-strip{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;gap:8px;overflow-x:auto;padding:10px 14px;background:#fff;border-top:1px solid #e4e4e7;box-shadow:0 -2px 8px rgba(0,0,0,.05)}
.thumb{flex:none;width:120px;display:flex;flex-direction:column;gap:2px;text-align:left;padding:7px 10px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;cursor:pointer}
.thumb:hover{background:#f4f4f5}
.thumb.on{border-color:#18181b;background:#f4f4f5;box-shadow:0 0 0 1px #18181b inset}
.thumb-n{font-size:10px;color:#a1a1aa;font-weight:700}
.thumb-name{font-size:11px;font-weight:600;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thumb-net{font-size:10.5px;color:#059669;font-variant-numeric:tabular-nums}

/* ─── Formula tooltip ─── */
.fv-wrap{position:relative;cursor:pointer;border-bottom:1px dashed #bbb}
.fv-wrap:hover{background:#eff6ff}
.fv-tip{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:#18181b;color:#fff;font-size:11px;font-weight:400;padding:5px 10px;border-radius:6px;white-space:nowrap;z-index:100;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.fv-tip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#18181b}

/* ─── Card ─── */
.ep-card{box-sizing:border-box;background:#fff;color:#000;font-family:"Calibri","Segoe UI",system-ui,sans-serif;line-height:1.55;display:flex;flex-direction:column}
.ep-halves{display:flex;gap:1cm}
.ep-sal{flex:1;display:flex;flex-direction:column}
.ep-sal-full{flex:1}
.ep-inc{flex:1;display:flex;flex-direction:column}

.ep-ti{font-weight:700;text-decoration:underline;margin-bottom:.4em;font-size:1em}
.ep-info{margin-bottom:.6em}
.ep-row{display:flex;align-items:baseline;margin-bottom:.1em}
.ep-lb{width:40%;flex-shrink:0;font-size:1em}
.ep-vl{flex:1;font-weight:700;font-size:1em;text-align:center}
.ep-sm{font-size:.78em;white-space:nowrap}
.ep-xs{font-size:.62em;white-space:nowrap}
.ep-xtra td{border-top:none;font-size:.92em;padding:.15em .4em}
.ep-abs-in{width:3em;font-size:inherit;border:1px solid #d4d4d8;border-radius:3px;padding:1px 4px;text-align:center;font-family:inherit}
.ep-abs-in::-webkit-inner-spin-button,.ep-abs-in::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.ep-abs-in{-moz-appearance:textfield}
.ep-abs-pr{display:none}

/* ─── Tables ─── */
.ep-tbl{width:100%;border-collapse:collapse;font-size:1em;table-layout:fixed}
.ep-col-lbl{width:40%}
.ep-col-mid{width:15%}
.ep-col-amt{width:45%}
.ep-tbl th{border:1px solid #000;padding:.15em .4em;font-weight:700}
.ep-tbl td{border-left:1px solid #000;border-right:1px solid #000;padding:.2em .4em}
.ep-tbl td.ep-tm{border-left:none;border-right:none;padding:.2em .4em}
.ep-tbl td.ep-tm+td.ep-tr{border-left:none}
.ep-tl{text-align:left}
.ep-tm{text-align:right;font-size:.9em}
.ep-tr{text-align:right;font-variant-numeric:tabular-nums}
.ep-ded tr:last-child td,.ep-inc-body tr:last-child td{border-bottom:1px solid #000}
.ep-hdr th{border:1px solid #000}
.ep-bonus td{color:#c00}
.ep-ded td{font-size:.92em}
.ep-sub td{border-top:1px solid #000;font-weight:700}

/* ─── NET PAY ─── */
.ep-net-gap td{border:none!important;height:.6em;padding:0}
.ep-tbl .ep-net-body .ep-net-lb{border:none;padding:.3em .4em;text-align:left;font-weight:700;font-size:1em;vertical-align:middle}
.ep-tbl .ep-net-body .ep-net-td{border:2px solid #000;height:2.5em;padding:0;box-sizing:border-box}

/* ─── Print ─── */
.ep-print{display:none}
@media print{
  .no-print{display:none!important}
  .ep-root{background:#fff}
  .ep-print{display:block}
  .ep-page{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:0;page-break-after:always;height:100vh;box-sizing:border-box}
  .ep-page .ep-card{font-size:10.5pt;padding:3mm 10mm;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;grid-column:span 2}
  .ep-page .ep-net-body .ep-net-td{height:1.8em}
  .ep-page .ep-compact{grid-column:span 1}
  .ep-abs-pr{display:inline!important}
  .fv-wrap{border-bottom:none;cursor:default}
  .fv-tip{display:none!important}
  @page{size:A4 portrait;margin:0}
}
`;

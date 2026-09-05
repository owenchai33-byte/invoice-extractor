import { useState, useEffect, useMemo, useRef } from 'react';
import { computeStaffMonth, LS_S, LS_P, LS_SB, LS_PIN, LS_H, SAMPLE_STAFF, fmt, isStaffHidden } from './Payroll';
const LS_EP_TS = 'cjk_ep_updated';
const ATT_DATA_PREFIX = 'cjk_attendance_';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const nf = v => (!v || v === 0) ? '-' : Number(v).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const lastDay = (mo, yr) => { const d = new Date(yr, mo + 1, 0); return `${d.getDate()}-${MON3[mo]}-${yr.toString().slice(-2)}`; };
const vlCls = t => { const l = (t || '').length; return 'ep-vl' + (l > 50 ? ' ep-vl-xs' : l > 36 ? ' ep-vl-sm' : ''); };
const incDay = (mo, yr) => { const m2 = (mo + 1) % 12; const y2 = mo === 11 ? yr + 1 : yr; const d = new Date(y2, m2, 11); const day = d.getDay() === 0 ? 12 : 11; return `${day}-${MON3[m2]}-${y2.toString().slice(-2)}`; };
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

function EpCard({ r, mo, yr, compact, absVal, onAbsChange, othVal, onOthChange, locked, showStart }) {
  const hasInc = (r.incentive || 0) > 0;
  const daily = r.salary / 26;
  const epfMD = r.epfM / 26;
  const epfWage = r.salary + (r.incentive || 0) + (r.bonus || 0);
  const socsoWage = r.salary + (r.incentive || 0);
  const salNet = Math.round((r.salary + (r.bonus || 0) - r.epfP - r.socsoInv - r.socsoSkbbk - r.eisE - (r.advance || 0)) * 100) / 100;

  return (
    <div className={"ep-card" + (compact ? " ep-compact" : "")}>
      <div className="ep-halves" style={hasInc ? {display:'flex',gap:0} : undefined}>
        {/* Salary side */}
        <div className={hasInc ? 'ep-sal' : 'ep-sal ep-sal-full'} style={hasInc ? {width:'50%',minWidth:0,boxSizing:'border-box',paddingRight:'0.5cm'} : undefined}>
          <div className="ep-ti">PAYSLIP {MONTHS[mo].toUpperCase()} {yr}</div>
          <div className="ep-info">
            <div className="ep-row"><span className="ep-lb">PAY TO</span><span className={vlCls(r.name)}>{r.name}</span></div>
            <div className="ep-row"><span className="ep-lb">DESIGNATION</span><span className={vlCls(r.position)}>{r.position}</span></div>
            <div className="ep-row"><span className="ep-lb">DATE</span><span className="ep-vl">{lastDay(mo, yr)}</span></div>
            {r.bankAcc ? <div className="ep-row"><span className="ep-lb">BANK ACC NO.</span><span className={'ep-vl'}>{r.bankAcc}</span></div> : <div className="ep-row ep-spacer">&nbsp;</div>}
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
              <tr><td className="ep-tl"><div className="ep-split"><span>EPF</span><span className="ep-nums"><Fv f={`EPF employer (table lookup on ${nf(epfWage)})`}>{nf(r.epfM)}</Fv>/<Fv f={`EPF employer \xf7 26 = ${nf(r.epfM)} \xf7 26`}>{nf(epfMD)}</Fv></span></div></td><td colSpan="2" className="ep-tr"><Fv f={`EPF employee (table lookup on ${nf(epfWage)})`}>{nf(r.epfP)}</Fv></td></tr>
              <tr><td className="ep-tl"><div className="ep-split"><span>SOCSO (0.5%)</span><span className="ep-nums"><Fv f={`SOCSO employer (table lookup on ${nf(socsoWage)})`}>{nf(r.socsoM)}</Fv></span></div></td><td colSpan="2" className="ep-tr"><Fv f={`SOCSO Invalidity 0.5% (table lookup on ${nf(socsoWage)})`}>{nf(r.socsoInv)}</Fv></td></tr>
              <tr><td className="ep-tl ep-skbbk">SOCSO (SKBBK 0.75%)</td><td colSpan="2" className="ep-tr"><Fv f={`SOCSO L24 0.75% (table lookup on ${nf(socsoWage)})`}>{nf(r.socsoSkbbk)}</Fv></td></tr>
              <tr><td className="ep-tl"><div className="ep-split"><span>EIS</span><span className="ep-nums"><Fv f={`EIS employer (table lookup on ${nf(socsoWage)})`}>{nf(r.eisE)}</Fv></span></div></td><td colSpan="2" className="ep-tr"><Fv f={`EIS employee (table lookup on ${nf(socsoWage)})`}>{nf(r.eisE)}</Fv></td></tr>
              <tr><td className="ep-tl">ADVANCE</td><td colSpan="2" className="ep-tr"><Fv f="Monthly advance deduction">{nf(r.advance || 0)}</Fv></td></tr>
              <tr className="ep-sub"><td className="ep-tl"></td><td colSpan="2" className="ep-tr"><Fv f={`${nf(r.salary)}${r.bonus > 0 ? ' + ' + nf(r.bonus) : ''} − ${nf(r.epfP)} − ${nf(r.socsoInv)} − ${nf(r.socsoSkbbk)} − ${nf(r.eisE)}${(r.advance || 0) > 0 ? ' − ' + nf(r.advance) : ''}`}>{nf(salNet)}</Fv></td></tr>
              <tr className="ep-xtra"><td className="ep-tl">ABSENCE</td><td colSpan="2" className="ep-tr ep-abs-td"><input type="number" step="0.5" min="0" className="ep-abs-in no-print" value={absVal || ''} onChange={e => onAbsChange(e.target.value)} placeholder="-" disabled={locked} /><span className="ep-abs-pr">{fmtAbs(absVal)}</span></td></tr>
              <tr className="ep-xtra"><td className="ep-tl">OTHERS</td><td colSpan="2" className="ep-tr ep-oth-td">{showStart&&<>{othVal&&<span className="ep-oth-lbl">START</span>}<input type="text" className="ep-oth-in no-print" value={othVal || ''} onChange={e => onOthChange(e.target.value)} disabled={locked} /><span className="ep-oth-pr">{othVal||''}</span></>}</td></tr>
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
          <div className="ep-inc" style={{width:'50%',minWidth:0,boxSizing:'border-box',paddingLeft:'0.5cm'}}>
            <div className="ep-ti">PAYSLIP {MONTHS[mo].toUpperCase()} {yr}</div>
            <div className="ep-info">
              <div className="ep-row"><span className="ep-lb">PAY TO</span><span className={vlCls(r.name)}>{r.name}</span></div>
              <div className="ep-row"><span className="ep-lb">DESIGNATION</span><span className={vlCls(r.position)}>{r.position}</span></div>
              <div className="ep-row"><span className="ep-lb">DATE</span><span className="ep-vl">{incDay(mo, yr)}</span></div>
              <div className="ep-row ep-spacer">&nbsp;</div>
            </div>

            <table className="ep-tbl">
              <colgroup><col className="ep-col-lbl"/><col className="ep-col-mid"/><col className="ep-col-amt"/></colgroup>
              <thead><tr className="ep-hdr"><th className="ep-tl">EARNINGS</th><th colSpan="2" className="ep-tr">AMOUNT (RM)</th></tr></thead>
              <tbody className="ep-inc-body">
                <tr><td className="ep-tl">INCENTIVE</td><td className="ep-tm"></td><td className="ep-tr"><Fv f="Monthly incentive payment">{nf(r.incentive)}</Fv></td></tr>
              </tbody>
              <tbody className="ep-net-body">
                <tr className="ep-net-gap"><td colSpan="3"></td></tr>
                <tr className="ep-net-gap"><td colSpan="3"></td></tr>
                <tr><td className="ep-net-lb">NET PAY</td><td colSpan="2" className="ep-net-td"></td></tr>
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
  const prevMo = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYr = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [mo, setMo] = useState(() => { try { const v = localStorage.getItem('cjk_ep_mo'); return v !== null ? Number(v) : prevMo; } catch { return prevMo; } });
  const [yr, setYr] = useState(() => { try { const v = localStorage.getItem('cjk_ep_yr'); return v !== null ? Number(v) : prevYr; } catch { return prevYr; } });
  useEffect(() => { try { localStorage.setItem('cjk_ep_mo', mo); localStorage.setItem('cjk_ep_yr', yr); } catch {} }, [mo, yr]);
  const [idx, setIdx] = useState(0);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth > 1200);
  const stripRef = useRef(null);
  const _epTsKey = () => `${yr}-${String(mo+1).padStart(2,'0')}`;
  const _readEpTs = k => { const raw = localStorage.getItem(LS_EP_TS); if (!raw) return ''; try { const o = JSON.parse(raw); return o[k] || ''; } catch { return ''; } };
  const [updTs, setUpdTs] = useState(() => _readEpTs(_epTsKey()));
  useEffect(() => { setUpdTs(_readEpTs(_epTsKey())); }, [mo, yr]);
  const _touchTs = () => { const t = new Date().toISOString(); const k = _epTsKey(); let o = {}; try { o = JSON.parse(localStorage.getItem(LS_EP_TS) || '{}'); } catch {} o[k] = t; localStorage.setItem(LS_EP_TS, JSON.stringify(o)); setUpdTs(t); };
  const[locked,setLocked]=useState(true);
  const tryUnlock=()=>{const stored=localStorage.getItem(LS_PIN);if(!stored){const p=prompt('Set a 4-digit PIN to lock editing:');if(p&&/^\d{4}$/.test(p)){localStorage.setItem(LS_PIN,p);setLocked(false);}else if(p){alert('PIN must be exactly 4 digits.');}}else{const p=prompt('Enter PIN to unlock editing:');if(p===stored)setLocked(false);else if(p)alert('Wrong PIN.');}};
  const currentMK=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const isMonthLocked=`${yr}-${String(mo+1).padStart(2,'0')}`<currentMK;
  useEffect(()=>{if(isMonthLocked)setLocked(true);},[mo,yr]);

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
  const setAbsV = (sid, v) => { const k = absK(sid); const next = { ...abs, [k]: v }; setAbs(next); try { localStorage.setItem('cjk_absence', JSON.stringify(next)); } catch {} _touchTs(); };
  const [oth, setOth] = useState(() => load('cjk_ep_others', {}));
  const othK = sid => `${yr}-${String(mo + 1).padStart(2, '0')}-${sid}`;
  const getOth = sid => oth[othK(sid)] || '';
  const setOthV = (sid, v) => { const k = othK(sid); const next = { ...oth, [k]: v }; setOth(next); try { localStorage.setItem('cjk_ep_others', JSON.stringify(next)); } catch {} _touchTs(); };
  const viewMK = `${yr}-${String(mo + 1).padStart(2, '0')}`;
  const syncAttendance = () => {
    let raw; try { raw = JSON.parse(localStorage.getItem(`${ATT_DATA_PREFIX}${viewMK}`)); } catch {}
    if (!raw || !Object.keys(raw).length) { alert('No attendance data found. Upload attendance in the Attendance tab first.'); return; }
    const emps = Object.values(raw);
    const suspectDates = new Set();
    if (emps.length > 1) {
      const allDates = new Set();
      emps.forEach(e => (e.days || []).forEach(d => { if (d.type === 'absent') allDates.add(d.date); }));
      for (const date of allDates) { if (emps.every(e => { const d = (e.days || []).find(d => d.date === date); return d && d.type === 'absent'; })) suspectDates.add(date); }
    }
    let dismissed; try { dismissed = new Set(JSON.parse(localStorage.getItem(`cjk_att_dismissed_${viewMK}`) || '[]')); } catch { dismissed = new Set(); }
    const leave = {};
    for (const e of emps) {
      const absent = (e.days || []).filter(d => d.type === 'absent' && !suspectDates.has(d.date)).length;
      const half = (e.days || []).filter(d => (d.type === 'half-am' || d.type === 'half-pm') && !dismissed.has(`${e.id}-${d.date}`)).length;
      leave[(e.name || '').trim().toLowerCase()] = absent + half * 0.5;
    }
    const attNames = Object.keys(leave);
    const findMatch = (rName) => {
      if (leave[rName] !== undefined) return rName;
      const sub = attNames.find(n => n.includes(rName) || rName.includes(n));
      if (sub !== undefined) return sub;
      const rWords = rName.split(/\s+/);
      let best = null, bestCount = 0;
      for (const n of attNames) { const nWords = n.split(/\s+/); const shared = rWords.filter(w => nWords.includes(w)).length; if (shared >= 2 && shared > bestCount) { bestCount = shared; best = n; } }
      return best;
    };
    let matched = 0; const unmatched = []; const details = [];
    for (const r of rows) {
      const rName = (r.name || '').trim().toLowerCase();
      const matchName = findMatch(rName);
      const days = matchName !== null ? leave[matchName] : undefined;
      if (days !== undefined) {
        setAbsV(r.id, days > 0 ? String(days) : '');
        matched++;
        details.push(`${r.name}: ${days > 0 ? days : 0}`);
      } else { unmatched.push(r.name); }
    }
    if (matched === 0) { alert(`No matching employees.\n\nPayslip names: ${rows.map(r => r.name).join(', ')}\n\nAttendance names: ${attNames.join(', ')}`); return; }
    let msg = `Synced ${matched}/${rows.length}.`;
    msg += `\n\n${details.join('\n')}`;
    if (suspectDates.size) msg += `\n\nExcluded ${suspectDates.size} public holiday(s).`;
    if (unmatched.length) msg += `\n\nNot matched: ${unmatched.join(', ')}`;
    alert(msg);
  };
  const canShowStart = (r) => r.status === 'probationary' && r.addedMonth === viewMK;

  const hiddenData = useMemo(() => load(LS_H, {}), []);
  const rows = useMemo(() => {
    const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`, ref = new Date(yr, mo, 15);
    const visible = staff.filter(s => !isStaffHidden(hiddenData, s.id, mk) && (!s.addedMonth || s.addedMonth <= mk));
    const all = visible.map(s => computeStaffMonth(s, pd[mk]?.[s.id], ref, showBonus));
    return [...all.filter(r => r.method === 'bank'), ...all.filter(r => r.method === 'cash')];
  }, [staff, pd, showBonus, mo, yr, hiddenData]);

  const printPages = useMemo(() => {
    const pages = [];
    let slots = 0, cur = [];
    rows.forEach(r => {
      const s = (r.incentive || 0) > 0 ? 2 : 1;
      if (slots + s > 4) { pages.push({ items: cur }); cur = []; slots = 0; }
      cur.push({ r, half: s === 2 }); slots += s;
    });
    if (cur.length) pages.push({ items: cur });
    return pages;
  }, [rows]);

  const screenPages = useMemo(() => {
    if (!wide) return rows.map(r => ({ items: [{ r, half: (r.incentive || 0) > 0 }] }));
    const pages = [];
    for (let i = 0; i < rows.length; i += 2) {
      const items = [{ r: rows[i], half: (rows[i].incentive || 0) > 0 }];
      if (rows[i + 1]) items.push({ r: rows[i + 1], half: (rows[i + 1].incentive || 0) > 0 });
      pages.push({ items });
    }
    return pages;
  }, [rows, wide]);

  const maxPage = Math.max(0, screenPages.length - 1);
  const curPage = Math.min(idx, maxPage);
  const go = d => setIdx(i => Math.min(maxPage, Math.max(0, i + d)));
  const staffPage = useMemo(() => { const m = {}; screenPages.forEach((p, pi) => p.items.forEach(it => { m[it.r.id] = pi; })); return m; }, [screenPages]);
  const [sel, setSel] = useState(() => rows.length ? rows[0].id : null);
  useEffect(() => { if (screenPages[curPage]) { const ids = screenPages[curPage].items.map(it => it.r.id); if (!ids.includes(sel)) setSel(ids[0]); } }, [curPage, screenPages]);
  const [printMode, setPrintMode] = useState(null);
  useEffect(() => { if (printMode) { window.print(); setPrintMode(null); } }, [printMode]);


  useEffect(() => {
    const h = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => { const el = stripRef.current?.querySelector('.thumb.on'); if (el) el.scrollIntoView({ block: 'nearest' }); }, [curPage]);

  const atMin = mo === 6 && yr === 2026;
  const changeMonth = d => { setIdx(0); if (d < 0) { if (atMin) return; if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1); } else { if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1); } };


  return (
    <div className="ep-root">
      <style>{CSS}</style>

      <div className="ep-bar no-print">
        <h1>EMPLOYEE PAYSLIP</h1>
        <div className="ep-mnav">
          <button className="ep-mbtn" disabled={atMin} onClick={() => changeMonth(-1)}>&#9664;</button>
          <div className="ep-mlbl">{MONTHS[mo]} {yr}</div>
          <button className="ep-mbtn" onClick={() => changeMonth(1)}>&#9654;</button>
          {updTs&&<span style={{fontSize:11,color:'#a1a1aa',marginLeft:8,whiteSpace:'nowrap'}}>Updated {new Date(updTs).toLocaleString('en-MY',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:true})}</span>}
        </div>
        <div className="ep-acts">
          <button className={"ep-btn "+(locked?"ep-btn-o":"")} onClick={locked?tryUnlock:()=>setLocked(true)} style={{fontSize:12}}>{locked?(isMonthLocked?'🔒 Month Locked':'🔒 Locked'):'🔓 Editing'}</button>
          <span className="ep-count">{screenPages.length ? `Page ${curPage + 1} / ${screenPages.length}` : '0'}</span>
          <button className="ep-btn ep-btn-sync" onClick={syncAttendance}>Sync Attendance</button>
          <button className="ep-btn ep-btn-o" onClick={() => setPrintMode('current')}>Print current</button>
          <button className="ep-btn" onClick={() => setPrintMode('all')}>Print all</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{maxWidth:1100,margin:'0 auto',padding:24}}><div style={{background:'#fff',border:'1px dashed #d4d4d8',borderRadius:12,padding:'48px 24px',textAlign:'center',color:'#71717a'}}><h2 style={{margin:'0 0 8px',fontSize:16,color:'#18181b'}}>No staff found</h2><p>Add staff in the Payroll tab first.</p></div></div>
      ) : (
        <>
          <div className="ep-layout no-print">
          <div className="ep-stage">
            <button className="ep-arrow" disabled={curPage === 0} onClick={() => go(-1)}>&#9664;</button>
            <div className="ep-pagewrap">
              {screenPages[curPage].items.map(it => <div key={it.r.id} className={"ep-sel-wrap" + (sel === it.r.id ? " ep-selected" : "")} onClick={() => setSel(it.r.id)}><EpCard r={it.r} mo={mo} yr={yr} compact={!it.half} absVal={getAbs(it.r.id)} onAbsChange={v => setAbsV(it.r.id, v)} othVal={getOth(it.r.id)} onOthChange={v => setOthV(it.r.id, v)} locked={locked} showStart={canShowStart(it.r)} /></div>)}
            </div>
            <button className="ep-arrow" disabled={curPage >= maxPage} onClick={() => go(1)}>&#9654;</button>
          </div>

          <div className="ep-sidebar" ref={stripRef}>
            {rows.map((r, i) => (
              <button key={r.id} className={"thumb" + (staffPage[r.id] === curPage ? " on" : "")} onClick={() => setIdx(staffPage[r.id])} title={r.name}>
                <span className="thumb-n">{i + 1}</span>
                <span className="thumb-name">{(r.name || '').split(' ').slice(0, 2).join(' ')}</span>
                <span className="thumb-net">RM {fmt(r.netPay)}</span>
              </button>
            ))}
          </div>
          </div>

          <div className="ep-print">
            {(printMode === 'current' ? [{ items: screenPages[curPage].items.filter(it => it.r.id === sel) }] : printPages).map((pg, pi) => {
              const els = [];
              let idx = 0;
              while (idx < pg.items.length) {
                const it = pg.items[idx];
                if (it.half) {
                  els.push(<EpCard key={it.r.id} r={it.r} mo={mo} yr={yr} compact={false} absVal={getAbs(it.r.id)} onAbsChange={v => setAbsV(it.r.id, v)} othVal={getOth(it.r.id)} onOthChange={v => setOthV(it.r.id, v)} locked={locked} showStart={canShowStart(it.r)} />);
                  idx++;
                } else {
                  const pair = [it];
                  if (idx + 1 < pg.items.length && !pg.items[idx + 1].half) { pair.push(pg.items[idx + 1]); idx += 2; } else { idx++; }
                  els.push(<div className={"ep-pair" + (pair.length === 1 ? " ep-pair-single" : "")} key={'p-' + pair[0].r.id}>{pair.map(p => <EpCard key={p.r.id} r={p.r} mo={mo} yr={yr} compact={true} absVal={getAbs(p.r.id)} onAbsChange={v => setAbsV(p.r.id, v)} othVal={getOth(p.r.id)} onOthChange={v => setOthV(p.r.id, v)} locked={locked} showStart={canShowStart(p.r)} />)}</div>);
                }
              }
              return <div className="ep-page" key={pi}>{els}</div>;
            })}
          </div>
        </>
      )}
    </div>
  );
}

const CSS = `
.ep-root{background:#fafafa;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.ep-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.ep-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b}
.ep-mnav{display:flex;align-items:center;gap:8px}
.ep-mbtn{border:1px solid #e4e4e7;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#52525b;font-size:11px}
.ep-mlbl{font-size:13px;font-weight:600;min-width:120px;text-align:center;color:#18181b}
.ep-acts{margin-left:auto;display:flex;align-items:center;gap:14px}
.ep-count{font-size:12px;color:#71717a;font-variant-numeric:tabular-nums}
.ep-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.ep-btn:hover{background:#000}
.ep-btn-o{background:#fff;color:#18181b}
.ep-btn-o:hover{background:#f4f4f5}
.ep-btn-sync{background:#059669;border-color:#059669;color:#fff}
.ep-btn-sync:hover{background:#047857}

.ep-layout{display:flex;height:calc(100vh - 148px)}
.ep-stage{flex:1;display:flex;align-items:flex-start;justify-content:center;gap:20px;padding:20px 72px;overflow:hidden}
.ep-arrow{position:fixed;top:50%;transform:translateY(-50%);z-index:30;width:44px;height:44px;border-radius:50%;border:1px solid #e4e4e7;background:#fff;color:#3f3f46;font-size:15px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.ep-stage>.ep-arrow:first-child{left:12px}
.ep-stage>.ep-arrow:last-child{right:170px}
.ep-arrow:hover:not(:disabled){background:#f4f4f5}
.ep-arrow:disabled{opacity:.35;cursor:default}

.ep-pagewrap{display:flex;gap:0;padding:0;align-items:stretch;justify-content:center}
.ep-pagewrap .ep-card{width:100%;max-width:21cm;padding:1.2em 1.5em;box-shadow:0 2px 16px rgba(0,0,0,.12);border-radius:4px;font-size:13px}
.ep-pagewrap .ep-compact{max-width:10.5cm}

.ep-sel-wrap{cursor:pointer;border-radius:6px;border:2px solid transparent;transition:border-color .15s}
.ep-sel-wrap.ep-selected{border-color:#2563eb}

.ep-sidebar{width:150px;flex-shrink:0;overflow-y:auto;padding:8px;background:#fff;border-left:1px solid #e4e4e7;display:flex;flex-direction:column;gap:6px}
.thumb{display:flex;flex-direction:column;gap:2px;text-align:left;padding:7px 10px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;cursor:pointer}
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
.ep-halves{display:grid;grid-template-columns:1fr 1fr;gap:1cm}
.ep-sal{min-width:0;display:flex;flex-direction:column}
.ep-sal-full{grid-column:1 / -1}
.ep-inc{min-width:0;display:flex;flex-direction:column}

.ep-ti{font-weight:700;text-decoration:underline;margin-bottom:.4em;font-size:1em}
.ep-info{margin-bottom:.6em}
.ep-row{display:flex;align-items:baseline;margin-bottom:.1em}
.ep-lb{width:40%;flex-shrink:0;font-size:1em}
.ep-vl{flex:1;font-weight:700;font-size:1em;text-align:center;word-wrap:break-word;overflow:hidden;line-height:1.25;max-height:2.5em}
.ep-vl-sm{font-size:.82em}
.ep-vl-xs{font-size:.7em}
.ep-xtra td{border-top:none;font-size:.92em;padding:.15em .4em}
.ep-abs-in{width:3em;font-size:inherit;border:1px solid #d4d4d8;border-radius:3px;padding:1px 4px;text-align:center;font-family:inherit}
.ep-abs-in::-webkit-inner-spin-button,.ep-abs-in::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.ep-abs-in{-moz-appearance:textfield}
.ep-abs-pr{display:none}
.ep-abs-td{text-align:left!important}
.ep-oth-td{text-align:left!important}
.ep-oth-lbl{font-size:inherit;margin-right:4px}
.ep-oth-in{width:6em;font-size:inherit;border:1px solid #d4d4d8;border-radius:3px;padding:1px 4px;text-align:center;font-family:inherit}
.ep-oth-pr{display:none}

/* ─── Tables ─── */
.ep-tbl{width:100%;border-collapse:collapse;font-size:1em;table-layout:fixed}
.ep-col-lbl{width:40%}
.ep-col-mid{width:18%}
.ep-col-amt{width:42%}
.ep-tbl th{border:1px solid #000;padding:.15em .4em;font-weight:700}
.ep-tbl td{border-left:1px solid #000;border-right:1px solid #000;padding:.2em .4em}
.ep-tbl td.ep-tm{border-left:none;border-right:none;padding:.2em .4em}
.ep-tbl td.ep-tm+td.ep-tr{border-left:none}
.ep-tl{text-align:left}
.ep-split{display:flex;justify-content:space-between;align-items:baseline}
.ep-nums{font-variant-numeric:tabular-nums;text-align:right}
.ep-skbbk{white-space:nowrap}
.ep-tm{text-align:left;font-size:.9em}
.ep-tr{text-align:right;font-variant-numeric:tabular-nums}
.ep-ded tr:last-child td,.ep-inc-body tr:last-child td{border-bottom:1px solid #000}
.ep-hdr th{border:1px solid #000;text-align:center}
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
  .ep-page{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:148.5mm 148.5mm;gap:0;page-break-after:always;page-break-inside:avoid;break-inside:avoid;height:297mm;width:210mm;box-sizing:border-box;overflow:hidden}
  .ep-page .ep-card{font-size:11.5pt;padding:3mm 5mm;box-sizing:border-box;display:block;overflow:hidden;grid-column:span 2;min-height:0}
  .ep-page .ep-pair{grid-column:span 2;display:flex;gap:1cm;padding:3mm 5mm;box-sizing:border-box;min-height:0;overflow:hidden}
  .ep-pair>.ep-card{flex:1;padding:0;box-shadow:none;min-width:0}
  .ep-pair-single>.ep-card{flex:none;width:calc(50% - 5mm)}
  .ep-halves{gap:0}
  .ep-halves .ep-sal:not(.ep-sal-full){padding-right:.5cm}
  .ep-halves .ep-inc{padding-left:.5cm}
  .ep-page .ep-net-body .ep-net-td{height:1.8em}
  .ep-abs-pr{display:inline!important}
  .ep-oth-pr{display:inline!important}
  .fv-wrap{border-bottom:none;cursor:default}
  .fv-tip{display:none!important}
  @page{size:A4 portrait;margin:0}
}
`;

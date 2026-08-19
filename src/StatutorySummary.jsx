import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { computeStaffMonth, fmt, LS_S, LS_P, LS_H, LS_SB } from './Payroll';
import { callAI, parseAIJson, AI_PROVIDER, AI_CFG, FlappyLoader } from './InvoiceExtractor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function loadJ(k, f) { try { return JSON.parse(localStorage.getItem(k)) || f; } catch { return f; } }
function pad(n) { return String(n).padStart(2, '0'); }
function normIC(ic) { return (ic || '').replace(/[\s\-]/g, ''); }
function fmtN(n) { return n == null ? '—' : Number(n).toFixed(2); }
function monthsMatch(a, b) {
  const pa = /(\d{1,2})\s*[\/\-]\s*(\d{4})/.exec(a || '');
  const pb = /(\d{1,2})\s*[\/\-]\s*(\d{4})/.exec(b || '');
  return pa && pb && parseInt(pa[1]) === parseInt(pb[1]) && parseInt(pa[2]) === parseInt(pb[2]);
}


const BORANG_TEXT_PROMPT = `You are parsing extracted text from Malaysian statutory contribution reports. The text has been extracted from digital PDF reports.

Identify each form type:
- KWSP/EPF: contains "KUMPULAN WANG SIMPANAN PEKERJA", "KWSP", "EPF", or "Borang A"
- SOCSO: contains "ACR" in header/title, or "Skim Bencana Pekerjaan" / "Skim Keilatan". Higher contribution amounts (typically RM 30-90 per person).
- EIS: contains "ECR" in header/title, or "Sistem Insurans Pekerjaan" / "SIP". Lower contribution amounts (typically RM 2-15 per person).

CRITICAL: Use "SOCSO" or "EIS" as form_type — NOT "PERKESO". ACR = SOCSO, ECR = EIS. They are SEPARATE forms.

Extract:
- form_type: "KWSP", "SOCSO", or "EIS"
- month: contribution month in MM/YYYY format
- For KWSP: each staff member's IC, name, majikan (EMPLOYER CONTRIBUTION amount), pekerja (EMPLOYEE CONTRIBUTION amount)
  IMPORTANT: The EPF report has columns for WAGES/GAJI/UPAH and CARUMAN/CONTRIBUTION.
  - Do NOT use the WAGES/GAJI/UPAH column (this is the salary, typically RM 1000-5000+)
  - "majikan" = EMPLOYER CONTRIBUTION (CARUMAN MAJIKAN) — typically RM 50-500
  - "pekerja" = EMPLOYEE CONTRIBUTION (CARUMAN PEKERJA) — typically RM 0-400
  - These are SMALLER amounts than the wages. If you see a large number like 1700 or 4500, that is WAGES, not a contribution.
- For SOCSO/EIS: each staff member's IC, name, caruman (contribution) amount

Return ONLY valid JSON:
{"forms":[{"form_type":"KWSP","month":"08/2026","staff":[{"ic":"071210130907","name":"TAN WEI HOW","majikan":357.00,"pekerja":302.00}]},{"form_type":"SOCSO","month":"07/2026","staff":[{"ic":"870907135413","name":"AZNAN BIN ZAHIDI","caruman":45.65}]},{"form_type":"EIS","month":"07/2026","staff":[{"ic":"870907135413","name":"AZNAN BIN ZAHIDI","caruman":5.50}]}]}

RULES:
- IC: exactly 12 digits, no dashes or spaces
- Amounts as numbers with 2 decimal places
- Multi-page forms: merge all pages of same form type into one entry
- Extract ALL staff from each form independently
- EPF majikan and pekerja are CONTRIBUTION amounts, NOT salary/wages`;

async function pdfExtractText(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
  let allText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 3) lines.push('\n');
      else if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) lines.push('\t');
      lines.push(item.str);
      lastY = y;
    }
    allText += lines.join('') + '\n---PAGE---\n';
  }
  return allText.trim();
}


function buildRecon(payrollRows, extracted, mo, yr) {
  const result = { monthAlerts: [], byIC: new Map(), extra: [] };
  const forms = extracted?.forms || [];
  const payMonth = mo + 1;
  const epfExpMo = payMonth + 1 > 12 ? 1 : payMonth + 1;
  const epfExpYr = payMonth + 1 > 12 ? yr + 1 : yr;
  const epfExp = `${pad(epfExpMo)}/${epfExpYr}`;
  const prkExp = `${pad(payMonth)}/${yr}`;

  const epfForm = forms.find(f => /kwsp|epf/i.test(f.form_type)) || null;
  const socsoForm = forms.find(f => /socso|acr/i.test(f.form_type)) || null;
  const eisForm = forms.find(f => /eis|ecr/i.test(f.form_type)) || null;

  if (epfForm && !monthsMatch(epfForm.month, epfExp))
    result.monthAlerts.push({ form: 'EPF', expected: epfExp, actual: epfForm.month || '?' });
  if (socsoForm && !monthsMatch(socsoForm.month, prkExp))
    result.monthAlerts.push({ form: 'SOCSO', expected: prkExp, actual: socsoForm.month || '?' });
  if (eisForm && !monthsMatch(eisForm.month, prkExp))
    result.monthAlerts.push({ form: 'EIS', expected: prkExp, actual: eisForm.month || '?' });

  const payICs = new Set(payrollRows.map(r => normIC(r.ic)));

  if (epfForm) {
    (epfForm.staff || []).forEach(s => {
      const ic = normIC(s.ic);
      const e = result.byIC.get(ic) || {};
      e.epfM = s.majikan; e.epfP = s.pekerja;
      result.byIC.set(ic, e);
      if (!payICs.has(ic)) result.extra.push({ ic, name: s.name, source: 'EPF' });
    });
  }
  if (socsoForm) {
    (socsoForm.staff || []).forEach(s => {
      const ic = normIC(s.ic);
      const e = result.byIC.get(ic) || {};
      e.socso = s.caruman;
      result.byIC.set(ic, e);
      if (!payICs.has(ic) && !result.extra.find(x => x.ic === ic))
        result.extra.push({ ic, name: s.name, source: 'SOCSO' });
    });
  }
  if (eisForm) {
    (eisForm.staff || []).forEach(s => {
      const ic = normIC(s.ic);
      const e = result.byIC.get(ic) || {};
      e.eis = s.caruman;
      result.byIC.set(ic, e);
      if (!payICs.has(ic) && !result.extra.find(x => x.ic === ic))
        result.extra.push({ ic, name: s.name, source: 'EIS' });
    });
  }

  return result;
}

export default function StatutorySummary() {
  const now = new Date();
  const [mo, setMo] = useState(() => { try { const v = localStorage.getItem('cjk_stat_mo'); return v !== null ? Number(v) : now.getMonth(); } catch { return now.getMonth(); } });
  const [yr, setYr] = useState(() => { try { const v = localStorage.getItem('cjk_stat_yr'); return v !== null ? Number(v) : now.getFullYear(); } catch { return now.getFullYear(); } });
  useEffect(() => { try { localStorage.setItem('cjk_stat_mo', mo); localStorage.setItem('cjk_stat_yr', yr); } catch {} }, [mo, yr]);
  const [sel, setSel] = useState(null);
  const [showMech, setShowMech] = useState(false);
  const atMin = mo === 6 && yr === 2026;
  const mk = `${yr}-${pad(mo + 1)}`;
  const ref = new Date(yr, mo, 15);

  const staff = useMemo(() => loadJ(LS_S, []), []);
  const pd = useMemo(() => loadJ(LS_P, {}), []);
  const hidden = useMemo(() => loadJ(LS_H, {}), []);
  const sb = useMemo(() => { try { const v = localStorage.getItem(LS_SB); return v === null ? true : JSON.parse(v); } catch { return true; } }, []);

  const visible = useMemo(() => {
    const hSet = new Set(hidden[mk] || []);
    return staff.filter(s => !hSet.has(s.id) && (!s.addedMonth || s.addedMonth <= mk));
  }, [staff, hidden, mk]);

  const rows = useMemo(() => visible.map(s => computeStaffMonth(s, pd[mk]?.[s.id], ref, sb)), [visible, pd, mk, ref, sb]);

  const totals = useMemo(() => {
    const t = { epfM: 0, epfP: 0, socsoM: 0, socsoP: 0, eisM: 0, eisP: 0 };
    rows.forEach(r => {
      t.epfM += r.epfM; t.epfP += r.epfP;
      t.socsoM += r.socsoM; t.socsoP += r.socsoP;
      t.eisM += r.eisE; t.eisP += r.eisE;
    });
    Object.keys(t).forEach(k => t[k] = Math.round(t[k] * 100) / 100);
    return t;
  }, [rows]);

  const changeMonth = useCallback((d) => {
    if (d < 0) {
      if (mo === 6 && yr === 2026) return;
      if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1);
    } else {
      if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1);
    }
    setSel(null);
  }, [mo, yr]);

  const exportXls = useCallback(() => {
    const header = ['NO', 'NAME', 'IC NO', 'EPF (M)', 'EPF (P)', 'JUMLAH EPF', 'SOCSO (M)', 'SOCSO (P)', 'JUMLAH SOCSO', 'EIS (M)', 'EIS (P)', 'JUMLAH EIS'];
    const data = rows.map((r, i) => [
      i + 1, r.name, r.ic,
      r.epfM, r.epfP, r.epfM + r.epfP,
      r.socsoM, r.socsoP, r.socsoM + r.socsoP,
      r.eisE, r.eisE, r.eisE * 2,
    ]);
    data.push([
      '', 'TOTAL', '',
      totals.epfM, totals.epfP, Math.round((totals.epfM + totals.epfP) * 100) / 100,
      totals.socsoM, totals.socsoP, Math.round((totals.socsoM + totals.socsoP) * 100) / 100,
      totals.eisM, totals.eisP, Math.round((totals.eisM + totals.eisP) * 100) / 100,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statutory');
    XLSX.writeFile(wb, `Statutory Summary - ${MONTHS[mo]} ${yr}.xlsx`);
  }, [rows, totals, mo, yr]);

  // Reconciliation — persist per month to localStorage
  const reconKey = `cjk_stat_recon_${yr}_${mo}`;
  const loadRecon = (key) => {
    try {
      const s = localStorage.getItem(key);
      if (!s) return { st: 'idle', res: null };
      const d = JSON.parse(s);
      return { st: 'done', res: { ...d, byIC: new Map(Object.entries(d.byIC || {})) } };
    } catch { try { localStorage.removeItem(key); } catch {} return { st: 'idle', res: null }; }
  };
  const [rState, setRState] = useState(() => loadRecon(reconKey).st);
  const [rResults, setRResults] = useState(() => loadRecon(reconKey).res);
  const [rError, setRError] = useState('');
  const fileRef = useRef(null);
  const reconInitRef = useRef(true);

  useEffect(() => {
    if (reconInitRef.current) { reconInitRef.current = false; return; }
    const { st, res } = loadRecon(reconKey);
    setRState(st); setRResults(res); setRError('');
  }, [reconKey]);

  const processBorang = useCallback(async (files) => {
    setRState('processing');
    setRError('');
    try {
      const apiKey = localStorage.getItem(AI_CFG.storageKey);
      if (!apiKey) throw new Error('API key not set. Go to Invoices tab → ⚙ to configure your ' + AI_CFG.label + ' key.');

      let allText = '';
      for (const file of files) {
        const txt = await pdfExtractText(file);
        allText += txt + '\n';
      }
      if ((allText.match(/\d{12}/g) || []).length < 2) throw new Error('No text found in PDF — please upload the downloaded digital report, not a scanned photocopy.');

      let result, attempts = 0;
      while (true) {
        try {
          result = await callAI({ provider: AI_PROVIDER, apiKey, model: 'claude-haiku-4-5', images: [], prompt: BORANG_TEXT_PROMPT + '\n\nEXTRACTED TEXT:\n' + allText, maxOutputTokens: 12000 });
          break;
        } catch (e) {
          if (e.code === 'rate_limit' && attempts < 3) { attempts++; await new Promise(r => setTimeout(r, 2000 * attempts)); continue; }
          throw e;
        }
      }
      const extracted = parseAIJson(result.text);
      const recon = buildRecon(rows, extracted, mo, yr);
      setRResults(recon);
      setRState('done');
      try { localStorage.setItem(reconKey, JSON.stringify({ ...recon, byIC: Object.fromEntries(recon.byIC) })); } catch {}
    } catch (e) {
      setRError(e.message || 'Processing failed');
      setRState('error');
    }
  }, [rows, mo, yr]);

  const clearRecon = useCallback(() => { setRState('idle'); setRResults(null); setRError(''); try { localStorage.removeItem(reconKey); } catch {} if (fileRef.current) fileRef.current.value = ''; }, [reconKey]);

  const reconStats = useMemo(() => {
    if (!rResults) return null;
    let matched = 0, mismatch = 0, missing = 0;
    rows.forEach(r => {
      const fm = rResults.byIC.get(normIC(r.ic));
      if (!fm) { missing++; return; }
      const ok = (fm.epfM == null || Math.abs(r.epfM - fm.epfM) < 0.02)
        && (fm.epfP == null || Math.abs(r.epfP - fm.epfP) < 0.02)
        && (fm.socso == null || Math.abs((r.socsoM + r.socsoP) - fm.socso) < 0.02)
        && (fm.eis == null || Math.abs((r.eisE * 2) - fm.eis) < 0.02);
      if (ok) matched++; else mismatch++;
    });
    return { matched, mismatch, missing, total: rows.length };
  }, [rows, rResults]);

  const HL = '#dbeafe';
  const getCellBg = (ri, ci, base, formSt) => {
    if (sel?.row === ri && sel?.col === ci) return '#93c5fd';
    if (sel && (sel.row === ri || sel.col === ci)) return HL;
    if (formSt === 'match') return '#dcfce7';
    if (formSt === 'mismatch') return '#fee2e2';
    return base;
  };

  const th = { padding: '8px 12px', fontSize: 13, fontWeight: 700, textAlign: 'center', borderBottom: '2px solid #e4e4e7', whiteSpace: 'nowrap', color: '#18181b' };
  const td = { padding: '8px 12px', fontSize: 14, textAlign: 'right', borderBottom: '1px solid #f4f4f5', color: '#18181b', fontFamily: 'monospace', cursor: 'pointer' };
  const tdName = { ...td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500, fontSize: 13 };
  const btn = { padding: '6px 14px', borderRadius: 7, border: '1px solid #e4e4e7', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 };

  return (
    <div style={{ padding: '20px 24px', fontFamily: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif` }}>
      <div className="noP" style={{
        background: '#fff', borderBottom: '1px solid #e4e4e7', padding: '0 24px',
        display: 'flex', alignItems: 'center', gap: 12, height: 56,
        marginBottom: 16, borderRadius: 0,
        marginLeft: -24, marginRight: -24, marginTop: -16, flexWrap: 'nowrap',
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 800, letterSpacing: '.04em', margin: 0, color: '#18181b', whiteSpace: 'nowrap' }}>
          STATUTORY SUMMARY
        </h1>
        <button onClick={() => setShowMech(v => !v)} style={{ border: '1px solid #e4e4e7', background: showMech ? '#f0f9ff' : '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>
          {showMech ? '▾ Mechanism' : '▸ Mechanism'}
        </button>
        <div style={{ width: 1, height: 24, background: '#e4e4e7' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button disabled={atMin} onClick={() => changeMonth(-1)} style={{ ...btn, width: 28, height: 28, padding: 0, opacity: atMin ? 0.4 : 1, cursor: atMin ? 'default' : 'pointer' }}>&#9664;</button>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 120, textAlign: 'center', color: '#18181b' }}>
            {MONTHS[mo]} {yr}
          </div>
          <button onClick={() => changeMonth(1)} style={{ ...btn, width: 28, height: 28, padding: 0 }}>&#9654;</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {rState === 'done' && reconStats && (
            <span style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: reconStats.mismatch === 0 && reconStats.missing === 0 ? '#f0fdf4' : '#fef2f2',
              color: reconStats.mismatch === 0 && reconStats.missing === 0 ? '#16a34a' : '#dc2626' }}>
              {reconStats.mismatch === 0 && reconStats.missing === 0
                ? `✓ ${reconStats.matched}/${reconStats.total} matched`
                : `${reconStats.matched}/${reconStats.total} matched · ${reconStats.mismatch} mismatch${reconStats.mismatch !== 1 ? 'es' : ''}`}
            </span>
          )}
          {rState === 'done' && <button onClick={clearRecon} style={btn}>Scan Another</button>}
          {rState === 'done' && <button onClick={exportXls} style={{ ...btn, background: '#111', color: '#fff' }}>⬇ Export Excel</button>}
        </div>
      </div>

      {showMech && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 18px', marginBottom: 14, fontSize: 12, lineHeight: 1.7, color: '#1e3a5f' }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>Month Detection Mechanism</div>
          <div>• <b>EPF Borang A</b>: "Bulan Caruman" = payroll month + 1 (e.g. July wages → Caruman <b>{pad(mo + 2 > 12 ? 1 : mo + 2)}/{mo + 2 > 12 ? yr + 1 : yr}</b>)</div>
          <div>• <b>SOCSO Borang 8A</b>: "Caruman Gaji Bulan" = payroll month (July wages → <b>{pad(mo + 1)}/{yr}</b>)</div>
          <div>• <b>EIS Borang 8A</b>: same as SOCSO — actual payroll month</div>
          <div style={{ marginTop: 4, color: '#64748b' }}>SOCSO vs EIS auto-detected by comparing amounts against payroll.</div>
        </div>
      )}

      {rState === 'idle' && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          {rows.length === 0 ? (
            <div style={{ color: '#a1a1aa', fontSize: 14 }}>No payroll data for this month</div>
          ) : (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#18181b', marginBottom: 4 }}>Upload Borang to Reconcile</div>
              <div style={{ fontSize: 12, color: '#71717a', marginBottom: 16 }}>Upload your EPF Borang A / SOCSO & EIS Borang 8A PDF</div>
              <label style={{ ...btn, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: 14 }}>
                <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => { const f = Array.from(e.target.files); if (f.length) processBorang(f); }} />
                📄 Upload Borang PDFs
              </label>
            </>
          )}
        </div>
      )}

      {rState === 'processing' && <FlappyLoader label="Reading Borang forms..." />}

      {rState === 'error' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 18px', marginBottom: 16, fontSize: 13, color: '#991b1b', display: 'inline-block', maxWidth: 500, textAlign: 'left' }}>{rError}</div>
          <div>
            <label style={{ ...btn, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: 14 }}>
              <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => { const f = Array.from(e.target.files); if (f.length) { setRState('idle'); setRError(''); processBorang(f); } }} />
              📄 Try Again
            </label>
          </div>
        </div>
      )}

      {rResults?.monthAlerts?.length > 0 && rResults.monthAlerts.map((a, i) => (
        <div key={i} style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 16px', marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#92400e' }}>
          ⚠ {a.form} month mismatch — expected <b>{a.expected}</b> for {MONTHS[mo]} payroll, form shows <b>{a.actual}</b>
        </div>
      ))}

      {rState === 'done' && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ ...th, textAlign: 'center', width: 40 }}>NO</th>
                <th style={{ ...th, textAlign: 'left', minWidth: 120 }}>IC NO</th>
                <th style={{ ...th, textAlign: 'left', minWidth: 180 }}>NAME</th>
                <th colSpan={3} style={{ ...th, background: '#eff6ff', borderBottom: '2px solid #bfdbfe' }}>EPF</th>
                <th colSpan={3} style={{ ...th, background: '#f0fdf4', borderBottom: '2px solid #bbf7d0' }}>SOCSO</th>
                <th colSpan={3} style={{ ...th, background: '#fefce8', borderBottom: '2px solid #fef08a' }}>EIS</th>
              </tr>
              <tr style={{ background: '#fafafa' }}>
                <th style={th} />
                <th style={th} />
                <th style={th} />
                <th style={{ ...th, background: sel?.col === 3 ? HL : '#eff6ff', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: sel?.col === 4 ? HL : '#eff6ff', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: sel?.col === 5 ? HL : '#eff6ff', fontSize: 11 }}>Jumlah</th>
                <th style={{ ...th, background: sel?.col === 6 ? HL : '#f0fdf4', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: sel?.col === 7 ? HL : '#f0fdf4', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: sel?.col === 8 ? HL : '#f0fdf4', fontSize: 11 }}>Jumlah</th>
                <th style={{ ...th, background: sel?.col === 9 ? HL : '#fefce8', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: sel?.col === 10 ? HL : '#fefce8', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: sel?.col === 11 ? HL : '#fefce8', fontSize: 11 }}>Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const base = i % 2 ? '#fafafa' : '#fff';
                const click = (c) => () => setSel(prev => prev?.row === i && prev?.col === c ? null : { row: i, col: c });
                const fm = rResults?.byIC?.get(normIC(r.ic));
                const chk = (pay, form) => form != null ? (Math.abs(pay - form) < 0.02 ? 'match' : 'mismatch') : null;
                const eMst = chk(r.epfM, fm?.epfM);
                const ePst = chk(r.epfP, fm?.epfP);
                const sSt = chk(r.socsoM + r.socsoP, fm?.socso);
                const eSt = chk(r.eisE * 2, fm?.eis);

                return (
                  <tr key={r.id}>
                    <td onClick={click(0)} style={{ ...td, textAlign: 'center', fontFamily: 'inherit', color: '#71717a', background: getCellBg(i, 0, base, null) }}>{i + 1}</td>
                    <td onClick={click(1)} style={{ ...td, textAlign: 'left', fontFamily: 'monospace', fontSize: 11, background: getCellBg(i, 1, base, fm ? 'match' : null) }}>{r.ic}</td>
                    <td onClick={click(2)} style={{ ...tdName, background: getCellBg(i, 2, base, fm ? (eMst !== 'mismatch' && ePst !== 'mismatch' && sSt !== 'mismatch' && eSt !== 'mismatch' ? 'match' : 'mismatch') : null) }}>{r.name}</td>
                    <td onClick={click(3)} style={{ ...td, background: getCellBg(i, 3, base, eMst) }}>
                      {fmt(r.epfM)}
                      {eMst === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.epfM)}</div>}
                    </td>
                    <td onClick={click(4)} style={{ ...td, fontWeight: 700, background: getCellBg(i, 4, base, ePst) }}>
                      {fmt(r.epfP)}
                      {ePst === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.epfP)}</div>}
                    </td>
                    <td onClick={click(5)} style={{ ...td, color: '#2563eb', background: getCellBg(i, 5, base, eMst && ePst ? (eMst === 'match' && ePst === 'match' ? 'match' : 'mismatch') : null) }}>
                      {fmt(r.epfM + r.epfP)}
                    </td>
                    <td onClick={click(6)} style={{ ...td, background: getCellBg(i, 6, base, null) }}>{fmt(r.socsoM)}</td>
                    <td onClick={click(7)} style={{ ...td, fontWeight: 700, background: getCellBg(i, 7, base, null) }}>{fmt(r.socsoP)}</td>
                    <td onClick={click(8)} style={{ ...td, color: '#16a34a', background: getCellBg(i, 8, base, sSt) }}>
                      {fmt(r.socsoM + r.socsoP)}
                      {sSt === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.socso)}</div>}
                    </td>
                    <td onClick={click(9)} style={{ ...td, background: getCellBg(i, 9, base, null) }}>{fmt(r.eisE)}</td>
                    <td onClick={click(10)} style={{ ...td, fontWeight: 700, background: getCellBg(i, 10, base, null) }}>{fmt(r.eisE)}</td>
                    <td onClick={click(11)} style={{ ...td, color: '#ca8a04', background: getCellBg(i, 11, base, eSt) }}>
                      {fmt(r.eisE * 2)}
                      {eSt === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.eis)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 0 ? HL : '#f4f4f5' }} />
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 1 ? HL : '#f4f4f5' }} />
                <td style={{ ...tdName, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 2 ? HL : '#f4f4f5' }}>TOTAL</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 3 ? HL : '#f4f4f5' }}>{fmt(totals.epfM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 4 ? HL : '#f4f4f5' }}>{fmt(totals.epfP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#2563eb', fontSize: 15, background: sel?.col === 5 ? HL : '#f4f4f5' }}>{fmt(Math.round((totals.epfM + totals.epfP) * 100) / 100)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 6 ? HL : '#f4f4f5' }}>{fmt(totals.socsoM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 7 ? HL : '#f4f4f5' }}>{fmt(totals.socsoP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#16a34a', fontSize: 15, background: sel?.col === 8 ? HL : '#f4f4f5' }}>{fmt(Math.round((totals.socsoM + totals.socsoP) * 100) / 100)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 9 ? HL : '#f4f4f5' }}>{fmt(totals.eisM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 10 ? HL : '#f4f4f5' }}>{fmt(totals.eisP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#ca8a04', fontSize: 15, background: sel?.col === 11 ? HL : '#f4f4f5' }}>{fmt(Math.round((totals.eisM + totals.eisP) * 100) / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rResults?.extra?.length > 0 && (
        <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '10px 16px', marginTop: 12, fontSize: 12, color: '#6b21a8' }}>
          <b>{rResults.extra.length} staff in form but not in payroll:</b>{' '}
          {rResults.extra.map(e => e.name).join(', ')}
        </div>
      )}
    </div>
  );
}

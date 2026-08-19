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

const BORANG_PROMPT = `You are reading scanned Malaysian statutory contribution forms (KWSP Borang A and PERKESO Borang 8A). These are PHOTOCOPIED forms where amounts appear inside small digit grid boxes. Read every digit box VERY carefully — zoom in mentally on each cell.

FORM 1 — EPF "Borang A" (KWSP):
Header: "KUMPULAN WANG SIMPANAN PEKERJA" / "KWSP 6"
"Bulan Caruman" = contribution month (MM/YYYY)
Table columns left to right: NO | NO. AHLI | K | NO. KAD PENGENALAN (IC) | NAMA PEKERJA | UPAH (RM) | CARUMAN: MAJIKAN | CARUMAN: PEKERJA
CRITICAL: The CARUMAN section has TWO separate groups of digit boxes per row.
- The FIRST group (columns labeled 1-4 under "MAJIKAN") = employer contribution in RM
- The SECOND group (columns labeled 5-8 under "PEKERJA") = employee contribution in RM
- Each group shows a decimal amount across individual digit cells (hundreds, tens, ones, then sens)
- Do NOT confuse UPAH (salary) digits with CARUMAN digits — UPAH is a separate column to the LEFT
- The TOTAL row at the bottom shows sum totals — use it to cross-check your extraction
- Typical EPF amounts: MAJIKAN ranges from RM 12 to RM 500+, PEKERJA from RM 0 to RM 400+

FORM 2 — SOCSO or EIS "Borang 8A" (PERKESO):
Header: "PERTUBUHAN KESELAMATAN SOSIAL"
"CARUMAN GAJI BULAN" = salary month (MM/YYYY)
Table: NO.KAD PENGENALAN (IC) | NAMA PEKERJA | CARUMAN (RM column + SEN column)
Two separate Borang 8A forms may exist in the same PDF: SOCSO (higher amounts, typically RM 10-70 per person) and EIS (lower amounts, typically RM 2-15 per person).

Return ONLY valid JSON:
{"forms":[{"form_type":"KWSP","month":"08/2026","staff":[{"ic":"071210130907","name":"TAN WEI HOW","majikan":12.00,"pekerja":0.00}]},{"form_type":"PERKESO","month":"07/2026","total":2225.00,"staff":[{"ic":"870907135413","name":"AZNAN BIN ZAHIDI","caruman":45.65}]}]}

RULES:
- IC: exactly 12 digits, no dashes or spaces
- Read each digit box individually then combine: e.g. boxes showing [3][3][3][0][0] = 333.00
- PERKESO: RM and SEN are separate columns, combine into decimal (RM=34, SEN=15 → 34.15)
- Multi-page forms: merge all pages of same form type into one entry
- Skip blank pages, ignore watermarks ("FOR RECORD PURPOSES ONLY", "TIDAK SAH")
- Staff not in one form may appear in another — extract ALL staff from each form independently
- Double-check amounts against the TOTAL row at the bottom of each form page`;

async function pdfToDataUrls(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const urls = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 3.0 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 400) {
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) dark++;
    }
    if (dark > 50) urls.push(c.toDataURL('image/jpeg', 0.92));
  }
  return urls;
}

function buildRecon(payrollRows, extracted, mo, yr) {
  const result = { monthAlerts: [], byIC: new Map(), extra: [] };
  const forms = extracted?.forms || [];
  const payMonth = mo + 1;
  const epfExpMo = payMonth + 1 > 12 ? 1 : payMonth + 1;
  const epfExpYr = payMonth + 1 > 12 ? yr + 1 : yr;
  const epfExp = `${pad(epfExpMo)}/${epfExpYr}`;
  const prkExp = `${pad(payMonth)}/${yr}`;

  const epfForm = forms.find(f => f.form_type === 'KWSP');
  const prkForms = forms.filter(f => f.form_type === 'PERKESO');
  let socsoForm = null, eisForm = null;

  if (prkForms.length >= 2) {
    const expSocso = payrollRows.reduce((s, r) => s + r.socsoM + r.socsoP, 0);
    const t0 = prkForms[0].staff?.reduce((s, r) => s + (r.caruman || 0), 0) || 0;
    const t1 = prkForms[1].staff?.reduce((s, r) => s + (r.caruman || 0), 0) || 0;
    if (Math.abs(t0 - expSocso) < Math.abs(t1 - expSocso)) {
      socsoForm = prkForms[0]; eisForm = prkForms[1];
    } else {
      socsoForm = prkForms[1]; eisForm = prkForms[0];
    }
  } else if (prkForms.length === 1) {
    const expSocso = payrollRows.reduce((s, r) => s + r.socsoM + r.socsoP, 0);
    const expEis = payrollRows.reduce((s, r) => s + r.eisE * 2, 0);
    const t = prkForms[0].staff?.reduce((s, r) => s + (r.caruman || 0), 0) || 0;
    if (Math.abs(t - expSocso) < Math.abs(t - expEis)) socsoForm = prkForms[0];
    else eisForm = prkForms[0];
  }

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

  // Reconciliation — persist to localStorage like BankRecon
  const LS_RECON = 'cjk_stat_recon';
  const [rState, setRState] = useState(() => {
    try {
      const s = localStorage.getItem(LS_RECON);
      if (!s) return 'idle';
      const d = JSON.parse(s);
      if (d._mo !== mo || d._yr !== yr) { localStorage.removeItem(LS_RECON); return 'idle'; }
      return 'done';
    } catch { try { localStorage.removeItem(LS_RECON); } catch {} return 'idle'; }
  });
  const [rResults, setRResults] = useState(() => {
    try {
      const s = localStorage.getItem(LS_RECON);
      if (!s) return null;
      const d = JSON.parse(s);
      if (d._mo !== mo || d._yr !== yr) return null;
      return { ...d, byIC: new Map(Object.entries(d.byIC || {})) };
    } catch { return null; }
  });
  const [rError, setRError] = useState('');
  const fileRef = useRef(null);
  const reconInitRef = useRef(true);

  useEffect(() => {
    if (reconInitRef.current) { reconInitRef.current = false; return; }
    setRState('idle'); setRResults(null); setRError('');
    try { localStorage.removeItem(LS_RECON); } catch {};
  }, [mo, yr]);

  const processBorang = useCallback(async (file) => {
    setRState('processing');
    setRError('');
    try {
      const apiKey = localStorage.getItem(AI_CFG.storageKey);
      if (!apiKey) throw new Error('API key not set. Go to Invoices tab → ⚙ to configure your ' + AI_CFG.label + ' key.');
      const dataUrls = await pdfToDataUrls(file);
      if (dataUrls.length === 0) throw new Error('PDF appears blank — no pages with content.');
      let result, attempts = 0;
      while (true) {
        try {
          result = await callAI({ provider: AI_PROVIDER, apiKey, model: 'claude-sonnet-5', images: dataUrls, prompt: BORANG_PROMPT, maxOutputTokens: 12000 });
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
      try { localStorage.setItem(LS_RECON, JSON.stringify({ _mo: mo, _yr: yr, ...recon, byIC: Object.fromEntries(recon.byIC) })); } catch {}
    } catch (e) {
      setRError(e.message || 'Processing failed');
      setRState('error');
    }
  }, [rows, mo, yr]);

  const clearRecon = useCallback(() => { setRState('idle'); setRResults(null); setRError(''); try { localStorage.removeItem(LS_RECON); } catch {} if (fileRef.current) fileRef.current.value = ''; }, []);

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
          {rState === 'idle' && rows.length > 0 && (
            <label style={{ ...btn, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) processBorang(f); }} />
              📄 Upload Borang
            </label>
          )}
          {rState === 'processing' && <span style={{ ...btn, opacity: 0.5, cursor: 'wait' }}>Scanning...</span>}
          {rState === 'done' && <button onClick={clearRecon} style={btn}>Scan Another</button>}
          {rState === 'error' && <button onClick={clearRecon} style={{ ...btn, color: '#dc2626' }}>✗ Retry</button>}
          <button onClick={exportXls} style={{ ...btn, background: '#111', color: '#fff' }}>⬇ Export Excel</button>
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

      {rState === 'error' && rError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: '#991b1b' }}>{rError}</div>
      )}

      {rResults?.monthAlerts?.length > 0 && rResults.monthAlerts.map((a, i) => (
        <div key={i} style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 16px', marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#92400e' }}>
          ⚠ {a.form} month mismatch — expected <b>{a.expected}</b> for {MONTHS[mo]} payroll, form shows <b>{a.actual}</b>
        </div>
      ))}

      {rState === 'processing' && <FlappyLoader label="Reading Borang forms..." />}

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#a1a1aa', padding: 60, fontSize: 14 }}>No payroll data for this month</div>
      ) : rState !== 'processing' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ ...th, textAlign: 'center', width: 40 }}>NO</th>
                <th style={{ ...th, textAlign: 'left', minWidth: 180 }}>NAME</th>
                <th colSpan={3} style={{ ...th, background: '#eff6ff', borderBottom: '2px solid #bfdbfe' }}>EPF</th>
                <th colSpan={3} style={{ ...th, background: '#f0fdf4', borderBottom: '2px solid #bbf7d0' }}>SOCSO</th>
                <th colSpan={3} style={{ ...th, background: '#fefce8', borderBottom: '2px solid #fef08a' }}>EIS</th>
              </tr>
              <tr style={{ background: '#fafafa' }}>
                <th style={th} />
                <th style={th} />
                <th style={{ ...th, background: sel?.col === 2 ? HL : '#eff6ff', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: sel?.col === 3 ? HL : '#eff6ff', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: sel?.col === 4 ? HL : '#eff6ff', fontSize: 11 }}>Jumlah</th>
                <th style={{ ...th, background: sel?.col === 5 ? HL : '#f0fdf4', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: sel?.col === 6 ? HL : '#f0fdf4', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: sel?.col === 7 ? HL : '#f0fdf4', fontSize: 11 }}>Jumlah</th>
                <th style={{ ...th, background: sel?.col === 8 ? HL : '#fefce8', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: sel?.col === 9 ? HL : '#fefce8', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: sel?.col === 10 ? HL : '#fefce8', fontSize: 11 }}>Jumlah</th>
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
                    <td onClick={click(1)} style={{ ...tdName, background: getCellBg(i, 1, base, fm ? (eMst !== 'mismatch' && ePst !== 'mismatch' && sSt !== 'mismatch' && eSt !== 'mismatch' ? 'match' : 'mismatch') : null) }}>{r.name}</td>
                    <td onClick={click(2)} style={{ ...td, background: getCellBg(i, 2, base, eMst) }}>
                      {fmt(r.epfM)}
                      {eMst === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.epfM)}</div>}
                    </td>
                    <td onClick={click(3)} style={{ ...td, fontWeight: 700, background: getCellBg(i, 3, base, ePst) }}>
                      {fmt(r.epfP)}
                      {ePst === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.epfP)}</div>}
                    </td>
                    <td onClick={click(4)} style={{ ...td, color: '#2563eb', background: getCellBg(i, 4, base, eMst && ePst ? (eMst === 'match' && ePst === 'match' ? 'match' : 'mismatch') : null) }}>
                      {fmt(r.epfM + r.epfP)}
                    </td>
                    <td onClick={click(5)} style={{ ...td, background: getCellBg(i, 5, base, null) }}>{fmt(r.socsoM)}</td>
                    <td onClick={click(6)} style={{ ...td, fontWeight: 700, background: getCellBg(i, 6, base, null) }}>{fmt(r.socsoP)}</td>
                    <td onClick={click(7)} style={{ ...td, color: '#16a34a', background: getCellBg(i, 7, base, sSt) }}>
                      {fmt(r.socsoM + r.socsoP)}
                      {sSt === 'mismatch' && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginTop: 2, background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}>Form: {fmtN(fm.socso)}</div>}
                    </td>
                    <td onClick={click(8)} style={{ ...td, background: getCellBg(i, 8, base, null) }}>{fmt(r.eisE)}</td>
                    <td onClick={click(9)} style={{ ...td, fontWeight: 700, background: getCellBg(i, 9, base, null) }}>{fmt(r.eisE)}</td>
                    <td onClick={click(10)} style={{ ...td, color: '#ca8a04', background: getCellBg(i, 10, base, eSt) }}>
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
                <td style={{ ...tdName, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 1 ? HL : '#f4f4f5' }}>TOTAL</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 2 ? HL : '#f4f4f5' }}>{fmt(totals.epfM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 3 ? HL : '#f4f4f5' }}>{fmt(totals.epfP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#2563eb', fontSize: 15, background: sel?.col === 4 ? HL : '#f4f4f5' }}>{fmt(Math.round((totals.epfM + totals.epfP) * 100) / 100)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 5 ? HL : '#f4f4f5' }}>{fmt(totals.socsoM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 6 ? HL : '#f4f4f5' }}>{fmt(totals.socsoP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#16a34a', fontSize: 15, background: sel?.col === 7 ? HL : '#f4f4f5' }}>{fmt(Math.round((totals.socsoM + totals.socsoP) * 100) / 100)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', background: sel?.col === 8 ? HL : '#f4f4f5' }}>{fmt(totals.eisM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700, background: sel?.col === 9 ? HL : '#f4f4f5' }}>{fmt(totals.eisP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#ca8a04', fontSize: 15, background: sel?.col === 10 ? HL : '#f4f4f5' }}>{fmt(Math.round((totals.eisM + totals.eisP) * 100) / 100)}</td>
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

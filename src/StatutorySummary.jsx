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

function parseFormMonth(s) {
  const m = /(\d{1,2})\s*[\/\-]\s*(\d{4})/.exec(s || '');
  return m ? { mo: parseInt(m[1]), yr: parseInt(m[2]) } : null;
}
function monthsMatch(a, b) {
  const pa = parseFormMonth(a), pb = parseFormMonth(b);
  return pa && pb && pa.mo === pb.mo && pa.yr === pb.yr;
}

const BORANG_PROMPT = `Extract data from these scanned Malaysian statutory contribution forms. The PDF contains up to 3 forms separated by blank pages.

FORM TYPES:
1. EPF "Borang A" (KWSP) — header: "KUMPULAN WANG SIMPANAN PEKERJA"
   - "Bulan Caruman" field = contribution month in MM/YYYY format
   - Per staff row: IC (NO KAD PENGENALAN, 12 digits), name, MAJIKAN amount (RM), PEKERJA amount (RM)
   - Amounts are in individual digit grid boxes — read each digit carefully

2. SOCSO or EIS "Borang 8A" (PERKESO) — header: "PERTUBUHAN KESELAMATAN SOSIAL"
   - "CARUMAN GAJI BULAN" field = salary month in MM/YYYY format
   - Per staff row: IC (12 digits), name, caruman amount (RM column + SEN column combined)
   - TWO separate Borang 8A forms may exist: SOCSO has higher per-person amounts, EIS has lower

Return ONLY valid JSON, no explanation:
{"forms":[{"form_type":"KWSP","month":"08/2026","staff":[{"ic":"071210130907","name":"TAN WEI HOW","majikan":12.00,"pekerja":0.00}]},{"form_type":"PERKESO","month":"07/2026","total":2225.00,"staff":[{"ic":"870907135413","name":"AZNAN BIN ZAHIDI","caruman":45.65}]}]}

RULES:
- IC: exactly 12 digits, no dashes or spaces
- Amounts in digit grid boxes — read each digit carefully, combine into decimal RM amount
- PERKESO caruman: combine RM + SEN columns (e.g. RM=4, SEN=95 → 4.95)
- Multi-page forms: merge all pages of same form type into one entry
- Skip blank pages, ignore watermarks ("FOR RECORD PURPOSES ONLY", "TIDAK SAH")
- Extract EVERY staff row — do not skip any`;

async function pdfToDataUrls(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const urls = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2.0 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 400) {
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) dark++;
    }
    if (dark > 50) urls.push(c.toDataURL('image/jpeg', 0.85));
  }
  return urls;
}

function buildRecon(payrollRows, extracted, mo, yr) {
  const result = { monthAlerts: [], epf: null, socso: null, eis: null };
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

  const payByIC = new Map();
  payrollRows.forEach(r => payByIC.set(normIC(r.ic), r));

  if (epfForm) {
    const staff = [];
    const fmByIC = new Map();
    (epfForm.staff || []).forEach(s => fmByIC.set(normIC(s.ic), s));
    for (const [ic, pr] of payByIC) {
      const fm = fmByIC.get(ic);
      if (fm) {
        const mOk = Math.abs(pr.epfM - (fm.majikan || 0)) < 0.02;
        const pOk = Math.abs(pr.epfP - (fm.pekerja || 0)) < 0.02;
        staff.push({ ic, name: pr.name, payM: pr.epfM, payP: pr.epfP, formM: fm.majikan, formP: fm.pekerja, status: mOk && pOk ? 'match' : 'mismatch' });
        fmByIC.delete(ic);
      } else {
        staff.push({ ic, name: pr.name, payM: pr.epfM, payP: pr.epfP, formM: null, formP: null, status: 'missing' });
      }
    }
    for (const [ic, fm] of fmByIC) {
      staff.push({ ic, name: fm.name, payM: null, payP: null, formM: fm.majikan, formP: fm.pekerja, status: 'extra' });
    }
    result.epf = { staff };
  }

  const buildPrkRecon = (form, getExpected) => {
    if (!form) return null;
    const staff = [];
    const fmByIC = new Map();
    (form.staff || []).forEach(s => fmByIC.set(normIC(s.ic), s));
    for (const [ic, pr] of payByIC) {
      const fm = fmByIC.get(ic);
      const exp = Math.round(getExpected(pr) * 100) / 100;
      if (fm) {
        staff.push({ ic, name: pr.name, payAmt: exp, formAmt: fm.caruman, status: Math.abs(exp - (fm.caruman || 0)) < 0.02 ? 'match' : 'mismatch' });
        fmByIC.delete(ic);
      } else {
        staff.push({ ic, name: pr.name, payAmt: exp, formAmt: null, status: 'missing' });
      }
    }
    for (const [ic, fm] of fmByIC) {
      staff.push({ ic, name: fm.name, payAmt: null, formAmt: fm.caruman, status: 'extra' });
    }
    return { staff };
  };

  result.socso = buildPrkRecon(socsoForm, r => r.socsoM + r.socsoP);
  result.eis = buildPrkRecon(eisForm, r => r.eisE * 2);
  return result;
}

export default function StatutorySummary() {
  const now = new Date();
  const [mo, setMo] = useState(() => { try { const v = localStorage.getItem('cjk_stat_mo'); return v !== null ? Number(v) : now.getMonth(); } catch { return now.getMonth(); } });
  const [yr, setYr] = useState(() => { try { const v = localStorage.getItem('cjk_stat_yr'); return v !== null ? Number(v) : now.getFullYear(); } catch { return now.getFullYear(); } });
  useEffect(() => { try { localStorage.setItem('cjk_stat_mo', mo); localStorage.setItem('cjk_stat_yr', yr); } catch {} }, [mo, yr]);
  const [sel, setSel] = useState(null);
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

  // Reconciliation state
  const [rState, setRState] = useState('idle');
  const [rResults, setRResults] = useState(null);
  const [rError, setRError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => { setRState('idle'); setRResults(null); setRError(''); }, [mo, yr]);

  const processBorang = useCallback(async (file) => {
    setRState('processing');
    setRError('');
    try {
      const apiKey = localStorage.getItem(AI_CFG.storageKey);
      if (!apiKey) throw new Error('API key not set. Go to Invoices tab → ⚙ to configure your ' + AI_CFG.label + ' key.');
      const dataUrls = await pdfToDataUrls(file);
      if (dataUrls.length === 0) throw new Error('PDF appears to be blank — no pages with content found.');
      let result, attempts = 0;
      while (true) {
        try {
          result = await callAI({ provider: AI_PROVIDER, apiKey, model: AI_CFG.model, images: dataUrls, prompt: BORANG_PROMPT, maxOutputTokens: 12000 });
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
    } catch (e) {
      setRError(e.message || 'Processing failed');
      setRState('error');
    }
  }, [rows, mo, yr]);

  const clearRecon = useCallback(() => { setRState('idle'); setRResults(null); setRError(''); if (fileRef.current) fileRef.current.value = ''; }, []);

  const HL = '#dbeafe';
  const isHL = (r, c) => sel && (sel.row === r || sel.col === c);
  const cellBg = (r, c, base) => sel?.row === r && sel?.col === c ? '#93c5fd' : isHL(r, c) ? HL : base;

  const th = { padding: '8px 12px', fontSize: 13, fontWeight: 700, textAlign: 'center', borderBottom: '2px solid #e4e4e7', whiteSpace: 'nowrap', color: '#18181b' };
  const td = { padding: '8px 12px', fontSize: 14, textAlign: 'right', borderBottom: '1px solid #f4f4f5', color: '#18181b', fontFamily: 'monospace', cursor: 'pointer' };
  const tdName = { ...td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500, fontSize: 13 };
  const btn = { padding: '6px 14px', borderRadius: 7, border: '1px solid #e4e4e7', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 };

  const statusColor = { match: '#16a34a', mismatch: '#dc2626', missing: '#d97706', extra: '#7c3aed' };
  const statusLabel = { match: '✓', mismatch: '✗', missing: 'Not in form', extra: 'Extra' };
  const statusBg = { match: '#fff', mismatch: '#fef2f2', missing: '#fffbeb', extra: '#faf5ff' };
  const rtd = { padding: '6px 10px', fontSize: 13, borderBottom: '1px solid #f4f4f5', fontFamily: 'monospace', textAlign: 'right' };
  const rtdName = { ...rtd, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500 };

  const reconStats = (staffList) => {
    if (!staffList) return null;
    const m = staffList.filter(s => s.status === 'match').length;
    const mm = staffList.filter(s => s.status === 'mismatch').length;
    const mi = staffList.filter(s => s.status === 'missing').length;
    const ex = staffList.filter(s => s.status === 'extra').length;
    return { m, mm, mi, ex, total: staffList.length };
  };

  const renderReconSection = (title, color, data, isEpf) => {
    if (!data) return <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>{title}: No form detected</div>;
    const stats = reconStats(data.staff);
    const allMatch = stats.mm === 0 && stats.mi === 0 && stats.ex === 0;
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>{title}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: allMatch ? '#16a34a' : '#dc2626', background: allMatch ? '#f0fdf4' : '#fef2f2', padding: '2px 10px', borderRadius: 99 }}>
            {stats.m}/{stats.m + stats.mm} matched{stats.mi > 0 && `, ${stats.mi} missing`}{stats.ex > 0 && `, ${stats.ex} extra`}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ ...rtd, fontWeight: 700, textAlign: 'center', width: 36, fontFamily: 'inherit' }}>#</th>
                <th style={{ ...rtdName, fontWeight: 700, minWidth: 140 }}>Name</th>
                <th style={{ ...rtd, fontWeight: 700, textAlign: 'left', minWidth: 100, fontFamily: 'inherit' }}>IC</th>
                {isEpf ? (<>
                  <th style={{ ...rtd, fontWeight: 700, background: '#f0f9ff' }}>Pay M</th>
                  <th style={{ ...rtd, fontWeight: 700, background: '#f0f9ff' }}>Form M</th>
                  <th style={{ ...rtd, fontWeight: 700, background: '#fefce8' }}>Pay P</th>
                  <th style={{ ...rtd, fontWeight: 700, background: '#fefce8' }}>Form P</th>
                </>) : (<>
                  <th style={{ ...rtd, fontWeight: 700, background: '#f0f9ff' }}>Payroll</th>
                  <th style={{ ...rtd, fontWeight: 700, background: '#f0f9ff' }}>Form</th>
                </>)}
                <th style={{ ...rtd, fontWeight: 700, textAlign: 'center', width: 80, fontFamily: 'inherit' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s, i) => (
                <tr key={s.ic + i} style={{ background: statusBg[s.status] }}>
                  <td style={{ ...rtd, textAlign: 'center', fontFamily: 'inherit', color: '#71717a' }}>{i + 1}</td>
                  <td style={rtdName}>{s.name}</td>
                  <td style={{ ...rtd, textAlign: 'left', fontFamily: 'inherit', fontSize: 11, color: '#52525b' }}>{s.ic}</td>
                  {isEpf ? (<>
                    <td style={rtd}>{fmtN(s.payM)}</td>
                    <td style={{ ...rtd, color: s.status === 'mismatch' && s.formM != null && Math.abs((s.payM || 0) - s.formM) >= 0.02 ? '#dc2626' : undefined, fontWeight: s.status === 'mismatch' && s.formM != null && Math.abs((s.payM || 0) - s.formM) >= 0.02 ? 700 : undefined }}>{fmtN(s.formM)}</td>
                    <td style={rtd}>{fmtN(s.payP)}</td>
                    <td style={{ ...rtd, color: s.status === 'mismatch' && s.formP != null && Math.abs((s.payP || 0) - s.formP) >= 0.02 ? '#dc2626' : undefined, fontWeight: s.status === 'mismatch' && s.formP != null && Math.abs((s.payP || 0) - s.formP) >= 0.02 ? 700 : undefined }}>{fmtN(s.formP)}</td>
                  </>) : (<>
                    <td style={rtd}>{fmtN(s.payAmt)}</td>
                    <td style={{ ...rtd, color: s.status === 'mismatch' ? '#dc2626' : undefined, fontWeight: s.status === 'mismatch' ? 700 : undefined }}>{fmtN(s.formAmt)}</td>
                  </>)}
                  <td style={{ ...rtd, textAlign: 'center', fontFamily: 'inherit', color: statusColor[s.status], fontWeight: 700 }}>{statusLabel[s.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 24px', fontFamily: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif` }}>
      <div className="noP" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button disabled={atMin} onClick={() => changeMonth(-1)} style={{ ...btn, width: 28, height: 28, padding: 0, opacity: atMin ? 0.4 : 1, cursor: atMin ? 'default' : 'pointer' }}>&#9664;</button>
          <div style={{ fontSize: 14, fontWeight: 700, minWidth: 140, textAlign: 'center', color: '#18181b' }}>
            {MONTHS[mo]} {yr}
          </div>
          <button onClick={() => changeMonth(1)} style={{ ...btn, width: 28, height: 28, padding: 0 }}>&#9654;</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportXls} style={{ ...btn, background: '#111', color: '#fff' }}>⬇ Export Excel</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#a1a1aa', padding: 60, fontSize: 14 }}>No payroll data for this month</div>
      ) : (
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
                return (
                  <tr key={r.id}>
                    <td onClick={click(0)} style={{ ...td, textAlign: 'center', fontFamily: 'inherit', color: '#71717a', background: cellBg(i, 0, base) }}>{i + 1}</td>
                    <td onClick={click(1)} style={{ ...tdName, background: cellBg(i, 1, base) }}>{r.name}</td>
                    <td onClick={click(2)} style={{ ...td, background: cellBg(i, 2, base) }}>{fmt(r.epfM)}</td>
                    <td onClick={click(3)} style={{ ...td, fontWeight: 700, background: cellBg(i, 3, base) }}>{fmt(r.epfP)}</td>
                    <td onClick={click(4)} style={{ ...td, color: '#2563eb', background: cellBg(i, 4, base) }}>{fmt(r.epfM + r.epfP)}</td>
                    <td onClick={click(5)} style={{ ...td, background: cellBg(i, 5, base) }}>{fmt(r.socsoM)}</td>
                    <td onClick={click(6)} style={{ ...td, fontWeight: 700, background: cellBg(i, 6, base) }}>{fmt(r.socsoP)}</td>
                    <td onClick={click(7)} style={{ ...td, color: '#16a34a', background: cellBg(i, 7, base) }}>{fmt(r.socsoM + r.socsoP)}</td>
                    <td onClick={click(8)} style={{ ...td, background: cellBg(i, 8, base) }}>{fmt(r.eisE)}</td>
                    <td onClick={click(9)} style={{ ...td, fontWeight: 700, background: cellBg(i, 9, base) }}>{fmt(r.eisE)}</td>
                    <td onClick={click(10)} style={{ ...td, color: '#ca8a04', background: cellBg(i, 10, base) }}>{fmt(r.eisE * 2)}</td>
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

      {/* Borang Reconciliation */}
      {rows.length > 0 && (
        <div style={{ borderTop: '2px solid #e4e4e7', marginTop: 32, paddingTop: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#18181b', marginBottom: 16 }}>Borang Reconciliation</div>

          <div style={{ background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 18px', marginBottom: 20, fontSize: 12, lineHeight: 1.7, color: '#1e3a5f' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>Month Detection Mechanism</div>
            <div>• <b>EPF Borang A</b>: "Bulan Caruman" = payroll month + 1 (e.g. July wages → Caruman <b>{pad(mo + 2 > 12 ? 1 : mo + 2)}/{mo + 2 > 12 ? yr + 1 : yr}</b>)</div>
            <div>• <b>SOCSO Borang 8A</b>: "Caruman Gaji Bulan" = payroll month (July wages → <b>{pad(mo + 1)}/{yr}</b>)</div>
            <div>• <b>EIS Borang 8A</b>: same as SOCSO — actual payroll month</div>
            <div style={{ marginTop: 6, color: '#64748b' }}>SOCSO and EIS are both "Borang 8A" — the system auto-detects which is which by comparing amounts against payroll data.</div>
          </div>

          {rState === 'idle' && (
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, border: '2px dashed #d4d4d8', borderRadius: 12, padding: '36px 20px', cursor: 'pointer', background: '#fafafa', transition: 'border-color 0.2s' }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#3b82f6'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#d4d4d8'; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#d4d4d8'; const f = e.dataTransfer.files[0]; if (f && f.type === 'application/pdf') processBorang(f); }}>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) processBorang(f); }} />
              <div style={{ fontSize: 28 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b' }}>Upload Scanned Borang PDF</div>
              <div style={{ fontSize: 12, color: '#71717a' }}>Drop here or click to browse — supports EPF Borang A + SOCSO/EIS Borang 8A in one PDF</div>
            </label>
          )}

          {rState === 'processing' && <FlappyLoader label="Reading Borang forms..." />}

          {rState === 'error' && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>Error</div>
              <div style={{ fontSize: 12, color: '#7f1d1d' }}>{rError}</div>
              <button onClick={clearRecon} style={{ ...btn, marginTop: 10, fontSize: 11 }}>Try Again</button>
            </div>
          )}

          {rState === 'done' && rResults && (<>
            {rResults.monthAlerts.length > 0 && rResults.monthAlerts.map((a, i) => (
              <div key={i} style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 16px', marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                ⚠ {a.form} month mismatch — expected <b>{a.expected}</b> for {MONTHS[mo]} payroll, form shows <b>{a.actual}</b>
              </div>
            ))}

            {renderReconSection('EPF (Borang A)', '#2563eb', rResults.epf, true)}
            {renderReconSection('SOCSO (Borang 8A)', '#16a34a', rResults.socso, false)}
            {renderReconSection('EIS (Borang 8A)', '#ca8a04', rResults.eis, false)}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={clearRecon} style={{ ...btn, fontSize: 12 }}>Scan Another PDF</button>
            </div>
          </>)}
        </div>
      )}
    </div>
  );
}

import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  LOGO, CO, fmt, normalizeDate, formatVolUnit,
  EditableAmount, EditableText,
  pdfToImageFiles, downsizeBase64ToJPEG, callAI,
  AI_PROVIDER, AI_CFG, BATCH_DELAY_MS,
} from './InvoiceExtractor';

const F = 'Calibri, "Segoe UI", Arial, sans-serif';
const B = '1px solid #000';

// ============================================================
// YEO HIAP SENG SUBSIDY MODEL
// ============================================================
// Flat model (not cascading like Choon Hua):
//   - 2% discount on the whole invoice total
//   - Transport subsidy: every carton earns RM0.30 + RM0.20 on TOTAL cartons
//   - Product volume bonus: cartons of a given volume earn a per-volume rate
//     (RM/CTN). Volumes and their rates are CONFIGURABLE — see volCats. The
//     original deal had 250ML & 300ML at RM0.50; other volumes (320ML, 1L,
//     1.5L, …) are added as they appear on invoices, each with its own editable
//     rate (defaults to RM0.50 — VERIFY against the YHS agreement).
//   - Other discount + credit note (manual)
// TOTAL PAYABLE = invoice total − 2% − transport(0.30) − transport(0.20)
//                 − Σ(volume bonuses) − other discount − credit note.
const YHS_RATE_2PCT = 0.02;
const YHS_TRANSPORT_1 = 0.30;
const YHS_TRANSPORT_2 = 0.20;
const YHS_DEFAULT_RATE = 0.50;
const YHS_SUPPLIER = 'YEO HIAP SENG TRADING SDN BHD';

// Default configurable volume categories. Each is {ml, rate}; the display label
// is derived from ml via formatVolUnit (250→"250ML", 1000→"1L", 1500→"1.5L").
const DEFAULT_VOLCATS = [
  { ml: 250, rate: YHS_DEFAULT_RATE },
  { ml: 300, rate: YHS_DEFAULT_RATE },
  { ml: 320, rate: YHS_DEFAULT_RATE },
  { ml: 1000, rate: YHS_DEFAULT_RATE },
  { ml: 1500, rate: YHS_DEFAULT_RATE },
];

export function volLabel(ml) {
  return formatVolUnit(ml) || `${ml}ML`;
}

// Pure calc — exported so the test suite can lock it against the source Excel.
// Round to 4 dp to kill float noise while preserving the spreadsheet's precision
// (the 2% line is not rounded to sen, e.g. 61004.69 × 2% = 1220.0938).
// Each invoice carries `vols`: a { [ml]: cartonCount } map. `volCats` defines
// which volumes earn a bonus and at what rate.
export function calcYHS({ invoices = [], volCats = [], otherDiscount = 0, creditNote = 0 }) {
  const r4 = v => Math.round(v * 10000) / 10000;
  const totalAmount = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalCtn = invoices.reduce((s, i) => s + (Number(i.qty) || 0), 0);

  const discount2 = r4(totalAmount * YHS_RATE_2PCT);
  const transport1 = r4(totalCtn * YHS_TRANSPORT_1);
  const transport2 = r4(totalCtn * YHS_TRANSPORT_2);

  // Per-volume totals and bonuses.
  const volumes = volCats.map(vc => {
    const ctn = invoices.reduce((s, i) => s + (Number(i.vols?.[vc.ml]) || 0), 0);
    const rate = Number(vc.rate) || 0;
    return { ml: vc.ml, label: volLabel(vc.ml), rate, ctn, bonus: r4(ctn * rate) };
  });
  const totalBonus = r4(volumes.reduce((s, v) => s + v.bonus, 0));

  const od = Number(otherDiscount) || 0;
  const cn = Number(creditNote) || 0;
  const payable = r4(
    totalAmount - discount2 - transport1 - transport2 - totalBonus - od - cn
  );

  return {
    totalAmount: r4(totalAmount), totalCtn,
    discount2, transport1, transport2,
    volumes, totalBonus,
    otherDiscount: r4(od), creditNote: r4(cn), payable,
  };
}

// AI prompt — extracts per-invoice totals plus a per-volume carton breakdown.
// The model detects each line item's volume (in ml) and sums cartons by volume.
const YHS_PROMPT = `You are an invoice data extractor for Yeo Hiap Seng, a Malaysian beverage distributor. Analyze this invoice image carefully and extract data into this EXACT JSON format. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.

{"supplier":"full supplier company name from the invoice header","invoice_no":"the document number","invoice_date":"DD/MM/YYYY","total_amount":6548.76,"total_qty":360,"volumes":[{"volume_ml":250,"ctn":360},{"volume_ml":1500,"ctn":0}],"uncertain_fields":[]}

============================================================
ABSOLUTE TRUTHFULNESS — MOST IMPORTANT:
============================================================
A. NEVER FABRICATE. If you cannot read a number clearly, flag it in uncertain_fields. Do NOT invent plausible values.
B. WHEN IN DOUBT, FLAG IT. Flagging extra fields is harmless; missing an unclear field is harmful.
C. DO NOT GUESS DIGITS. 0/6/8, 1/7, 3/5/8, 5/6 are commonly confused. Read each digit individually. If ANY digit in invoice_no or total_amount is ambiguous, flag that field.
D. NO ROUNDING on monetary values. If the invoice shows 6,548.76 write 6548.76 exactly.

============================================================
EXTRACTION RULES:
============================================================
1. invoice_no: From "Document No" / "Invoice No" field. Read each digit individually. Flag if unclear.
2. invoice_date: From "Invoice Date" / "Document Date". Output STRICTLY DD/MM/YYYY with leading zeros. Flag if unclear.
3. total_amount: The final "Total Amount Due" / "Grand Total" (bottom-line MYR amount, NOT subtotal before tax). Read each digit. Flag if unclear.
4. total_qty: Total number of CARTONS (CTN) on the whole invoice — the "PRODUCT TOTAL" / "TOTAL QTY" carton count. A carton count, not a piece count.
5. volumes: An ARRAY breaking the cartons down by product VOLUME. For each distinct volume on the invoice, output {"volume_ml": <volume in millilitres>, "ctn": <total cartons of that volume>}.
   - Read the volume from each line item's description (e.g. "250ML", "300ML", "320ML", "1L", "1.5L").
   - Convert litres to millilitres: 1L → 1000, 1.5L → 1500, 2L → 2000.
   - Sum the carton quantities of all line items that share the same volume.
   - Common YHS volumes: 250ML, 300ML, 320ML, 1000ML (1L), 1500ML (1.5L). There may be others — include every volume you see.
   - The sum of all volumes[].ctn should equal total_qty. If some cartons have no readable volume, still count them in total_qty but you may omit them from volumes.
6. supplier: From the TOP HEADER (the company that ISSUED the invoice), usually "YEO HIAP SENG".
7. uncertain_fields: ARRAY of field names you had ANY doubt about. Possible: "invoice_no","invoice_date","total_amount","total_qty","volumes". BE LIBERAL.

SELF-CHECK: sum of volumes[].ctn should be ≤ total_qty. Every digit in invoice_no and total_amount must be one you'd bet on, else flag it.

Return ONLY the JSON object. Nothing else.`;

// Small click-to-edit integer cell for the CTN columns.
function EditableInt({ value, onCommit, placeholder = '0' }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value ?? ''));
  const ref = useRef(null);
  useEffect(() => { if (!editing) setLocal(value == null ? '' : String(value)); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const commit = () => {
    const n = parseInt(local, 10);
    const clean = isNaN(n) || n < 0 ? 0 : n;
    if (clean !== value) onCommit(clean);
    setEditing(false);
  };
  if (editing) {
    return <input ref={ref} type="number" value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setLocal(String(value ?? '')); setEditing(false); } }}
      className="noP"
      style={{ width: '100%', border: '1px solid #2563eb', borderRadius: 3, padding: '3px 4px', fontSize: 16, fontFamily: F, textAlign: 'center', boxSizing: 'border-box' }} />;
  }
  return <span onClick={() => setEditing(true)} className="editable-text"
    title="Click to edit"
    style={{ display: 'block', cursor: 'text', padding: '3px 4px', borderRadius: 3, fontSize: 16, textAlign: 'center', color: (value ? '#000' : '#bbb') }}>
    {value ? value : placeholder}
  </span>;
}

// Click-to-edit rate cell (RM/CTN) for the volume-subsidy table.
function EditableRate({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value ?? ''));
  const ref = useRef(null);
  useEffect(() => { if (!editing) setLocal(value == null ? '' : String(value)); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const commit = () => {
    const n = parseFloat(local);
    const clean = isNaN(n) || n < 0 ? 0 : n;
    if (clean !== value) onCommit(clean);
    setEditing(false);
  };
  if (editing) {
    return <input ref={ref} type="number" step="0.01" value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setLocal(String(value ?? '')); setEditing(false); } }}
      className="noP"
      style={{ width: '100%', border: '1px solid #2563eb', borderRadius: 3, padding: '3px 4px', fontSize: 15, fontFamily: F, textAlign: 'center', boxSizing: 'border-box' }} />;
  }
  return <span onClick={() => setEditing(true)} className="editable-text"
    title="Click to edit rate (RM per carton)"
    style={{ display: 'block', cursor: 'text', padding: '3px 4px', borderRadius: 3, fontSize: 15, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
    RM{Number(value || 0).toFixed(2)}
  </span>;
}

const T = {
  th: { border: B, padding: '9px 6px', fontWeight: 700, fontSize: 13, textAlign: 'center', background: '#f0f0f0', fontFamily: F },
  td: { border: B, padding: '7px 8px', fontSize: 15, textAlign: 'center', verticalAlign: 'middle', fontFamily: F, fontVariantNumeric: 'tabular-nums' },
  bxL: { border: B, padding: '6px 14px', fontSize: 15, fontWeight: 700, textAlign: 'right', background: '#f0f0f0', fontFamily: F },
  bxM: { border: B, padding: '6px 10px', fontSize: 15, fontWeight: 700, textAlign: 'center', fontFamily: F, width: 24 },
  bxR: { border: B, padding: '6px 14px', fontSize: 16, fontWeight: 700, textAlign: 'right', fontFamily: F, minWidth: 120, width: 120, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
};
const btn = p => ({ padding: '8px 18px', borderRadius: 5, border: p ? 'none' : '1px solid #aaa', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: p ? '#111' : '#fff', color: p ? '#fff' : '#333', fontFamily: F });

const LS_YHS = 'yhs_invoices';
const LS_VOLCATS = 'yhs_volcats_v1';

// Keep volume categories sorted ascending by ml, de-duplicated.
function normalizeVolCats(list) {
  const seen = new Map();
  list.forEach(vc => {
    const ml = Number(vc.ml);
    if (!ml || ml <= 0) return;
    if (!seen.has(ml)) seen.set(ml, { ml, rate: Number(vc.rate) || 0 });
  });
  return [...seen.values()].sort((a, b) => a.ml - b.ml);
}

export default function YHSExtractor() {
  const [invoices, setInvoices] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_YHS)) || []; } catch { return []; }
  });
  const [volCats, setVolCats] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_VOLCATS));
      return Array.isArray(saved) && saved.length ? normalizeVolCats(saved) : normalizeVolCats(DEFAULT_VOLCATS);
    } catch { return normalizeVolCats(DEFAULT_VOLCATS); }
  });
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingCount, setProcessingCount] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [otherDiscount, setOtherDiscount] = useState(0);
  const [creditNote, setCreditNote] = useState(0);
  const [previewId, setPreviewId] = useState(null);
  const [newVolMl, setNewVolMl] = useState('');
  const fileRef = useRef(null);
  const uploadAreaRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(LS_YHS, JSON.stringify(invoices)); } catch {} }, [invoices]);
  useEffect(() => { try { localStorage.setItem(LS_VOLCATS, JSON.stringify(volCats)); } catch {} }, [volCats]);
  useEffect(() => { try { const k = localStorage.getItem(AI_CFG.storageKey); if (k) setApiKey(k); } catch {} }, []);
  useEffect(() => {
    if (uploading && invoices.length > 0 && uploadAreaRef.current) {
      setTimeout(() => uploadAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, [uploading, invoices.length]);

  const previewInv = previewId ? invoices.find(i => i.id === previewId) : null;
  useEffect(() => {
    if (!previewId) return;
    const handler = e => { if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT') setPreviewId(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewId]);

  const saveKey = () => {
    if (!keyInput.trim()) return;
    setApiKey(keyInput.trim());
    try { localStorage.setItem(AI_CFG.storageKey, keyInput.trim()); } catch {}
    setShowSettings(false);
  };

  const updateField = (id, field, val) =>
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, [field]: val } : inv));

  const updateVol = (id, ml, ctn) =>
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, vols: { ...inv.vols, [ml]: ctn } } : inv));

  const removeInvoice = id => setInvoices(prev => prev.filter(i => i.id !== id));

  // Volume-category management.
  const setRate = (ml, rate) => setVolCats(prev => prev.map(vc => vc.ml === ml ? { ...vc, rate } : vc));
  const removeVolCat = ml => setVolCats(prev => prev.filter(vc => vc.ml !== ml));
  const addVolCat = () => {
    const ml = parseInt(newVolMl, 10);
    if (!ml || ml <= 0) return;
    setVolCats(prev => normalizeVolCats([...prev, { ml, rate: YHS_DEFAULT_RATE }]));
    setNewVolMl('');
  };

  const reset = () => {
    setInvoices([]); setUploading(false); setProcessing(false); setError(null);
    setOtherDiscount(0); setCreditNote(0); setPreviewId(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const processSingleFile = useCallback(async (file) => {
    if (!file?.type.startsWith('image/')) throw new Error('Not an image file: ' + file.name);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let optimizedImage;
          try { optimizedImage = await downsizeBase64ToJPEG(reader.result, 1280, 0.75); }
          catch { optimizedImage = reader.result; }
          const BACKOFF_MS = [0, 15000, 20000, 30000, 30000];
          let lastErr = null;
          for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
            try {
              if (BACKOFF_MS[attempt] > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
              let txt;
              try {
                const result = await callAI({ provider: AI_PROVIDER, apiKey, model: AI_CFG.model, imageDataUrl: optimizedImage, prompt: YHS_PROMPT });
                txt = (result.text || '').trim().replace(/```json|```/g, '').trim();
              } catch (apiErr) {
                if (apiErr.code === 'rate_limit') {
                  lastErr = attempt === BACKOFF_MS.length - 1
                    ? new Error('Rate limit hit even after retries. Wait a minute and try again.')
                    : apiErr;
                  continue;
                }
                throw apiErr;
              }
              if (!txt.startsWith('{')) txt = txt.substring(txt.indexOf('{'));
              if (!txt.endsWith('}')) txt = txt.substring(0, txt.lastIndexOf('}') + 1);
              txt = txt.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
              let parsed;
              try { parsed = JSON.parse(txt); }
              catch (parseErr) {
                const repaired = txt.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
                try { parsed = JSON.parse(repaired); }
                catch {
                  const isTruncated = /Unexpected end/i.test(parseErr.message);
                  throw new Error(`AI returned malformed data for "${file.name}". ${isTruncated ? 'Response cut off — try a clearer photo.' : 'Try re-uploading a sharper photo.'}`);
                }
              }
              const dc = normalizeDate(parsed.invoice_date);
              if (dc.ok) parsed.invoice_date = dc.date;

              // Convert the volumes array → a { [ml]: ctn } map.
              const vols = {};
              if (Array.isArray(parsed.volumes)) {
                parsed.volumes.forEach(v => {
                  const ml = Number(v.volume_ml);
                  const ctn = Number(v.ctn) || 0;
                  if (ml > 0 && ctn) vols[ml] = (vols[ml] || 0) + ctn;
                });
              }

              let imagePreview = null;
              try { imagePreview = await downsizeBase64ToJPEG(reader.result, 1024, 0.7); } catch {}

              resolve({
                id: 'yhs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                invoice_no: parsed.invoice_no || '',
                invoice_date: parsed.invoice_date || '',
                supplier: parsed.supplier || YHS_SUPPLIER,
                amount: Number(parsed.total_amount) || 0,
                qty: Number(parsed.total_qty) || 0,
                vols,
                uncertain: Array.isArray(parsed.uncertain_fields) ? parsed.uncertain_fields : [],
                image: imagePreview,
              });
              return;
            } catch (inner) { lastErr = inner; }
          }
          reject(lastErr || new Error('Failed after retries'));
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, [apiKey]);

  const processFiles = useCallback(async (files) => {
    if (!apiKey) { setError(`Set your ${AI_CFG.label} API key first`); setShowSettings(true); return; }
    const fileArr = Array.from(files);
    if (fileArr.length === 0) { setError('No files selected'); return; }
    setError(null); setProcessing(true);

    const imageFiles = [];
    for (const f of fileArr) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (isPdf) {
        try { imageFiles.push(...await pdfToImageFiles(f)); }
        catch (e) { setError(prev => (prev ? prev + '\n' : '') + `Failed to read PDF: ${f.name} — ${e.message}`); }
      } else if (f.type.startsWith('image/')) {
        imageFiles.push(f);
      }
    }
    if (imageFiles.length === 0) { setError('No valid image or PDF files selected'); setProcessing(false); return; }

    setProcessingCount({ done: 0, total: imageFiles.length });
    const results = [];
    for (let i = 0; i < imageFiles.length; i++) {
      try {
        if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        results.push(await processSingleFile(imageFiles[i]));
        setProcessingCount(prev => ({ ...prev, done: prev.done + 1 }));
      } catch (e) {
        setError(prev => (prev ? prev + '\n' : '') + `Failed: ${imageFiles[i].name} — ${e.message}`);
      }
    }
    if (results.length > 0) {
      setInvoices(prev => [...prev, ...results]);
      // Auto-add any volumes the AI detected that aren't configured yet, at the
      // default rate — so a new volume slots straight in as its own column.
      const detected = new Set();
      results.forEach(r => Object.keys(r.vols || {}).forEach(ml => detected.add(Number(ml))));
      setVolCats(prev => {
        const known = new Set(prev.map(vc => vc.ml));
        const additions = [...detected].filter(ml => !known.has(ml)).map(ml => ({ ml, rate: YHS_DEFAULT_RATE }));
        return additions.length ? normalizeVolCats([...prev, ...additions]) : prev;
      });
    }
    setUploading(false); setProcessing(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [processSingleFile, apiKey]);

  const calc = calcYHS({ invoices, volCats, otherDiscount, creditNote });
  const showUpload = invoices.length === 0 || uploading;
  const nCols = 5 + volCats.length; // NO,DATE,INVOICE,AMOUNT,QTY + volume columns

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new(), d = [];
    d.push([CO.name + ' ' + CO.reg]); d.push([CO.addr]); d.push(['Tel: ' + CO.tel + '    E-mail: ' + CO.email]);
    d.push([]); d.push(['PAYMENT SUMMARY']); d.push(['SUPPLIER: ' + YHS_SUPPLIER]); d.push([]);
    const head = ['NO.', 'DATE', 'INVOICE NO.', 'AMOUNT', 'QUANTITY (CTN)', ...volCats.map(vc => volLabel(vc.ml) + ' (CTN)')];
    d.push(head);
    invoices.forEach((inv, i) => {
      d.push([i + 1, inv.invoice_date, inv.invoice_no, inv.amount, inv.qty, ...volCats.map(vc => inv.vols?.[vc.ml] || '')]);
    });
    d.push(['TOTAL:', '', '', calc.totalAmount, calc.totalCtn, ...calc.volumes.map(v => v.ctn)]);
    d.push([]);
    d.push(['', 'TOTAL INVOICE AMOUNT:', '', '', calc.totalAmount]);
    d.push(['', '2% DISCOUNT:', '', '-', calc.discount2]);
    d.push(['', `TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.30):`, '', '-', calc.transport1]);
    d.push(['', `TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.20):`, '', '-', calc.transport2]);
    calc.volumes.filter(v => v.ctn > 0).forEach(v => {
      d.push(['', `${v.label} (${v.ctn} x RM${v.rate.toFixed(2)}):`, '', '-', v.bonus]);
    });
    d.push(['', 'OTHER DISCOUNT:', '', calc.otherDiscount ? '-' : '', calc.otherDiscount || '']);
    d.push(['', 'CREDIT NOTE:', '', calc.creditNote ? '-' : '', calc.creditNote || '']);
    d.push(['', 'TOTAL AMOUNT PAYABLE:', '', '', calc.payable]);
    const ws = XLSX.utils.aoa_to_sheet(d);
    ws['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 15 }, ...volCats.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, ws, 'YHS');
    XLSX.writeFile(wb, 'Payment_Summary_YHS.xlsx');
  };

  // A summary row: label (right-aligned), minus sign, value.
  const SumRow = ({ label, value, sign = '-', bold = false, highlight = false, topBorder = false }) => (
    <tr>
      <td colSpan={3} style={{ border: 'none' }} />
      <td style={{ ...T.bxL, ...(topBorder ? { borderTop: '2px solid #000' } : {}), ...(bold ? { fontSize: 16 } : {}) }}>{label}</td>
      <td style={{ ...T.bxM, ...(topBorder ? { borderTop: '2px solid #000' } : {}) }}>{sign}</td>
      <td style={{ ...T.bxR, ...(topBorder ? { borderTop: '2px solid #000' } : {}), ...(highlight ? { background: '#ffe600', fontSize: 18 } : {}) }}>{fmt(value)}</td>
    </tr>
  );

  return (
    <div style={{ fontFamily: F, fontSize: 16, background: '#fff', color: '#000', minHeight: '100vh' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .editable-text:hover{background:#f0f9ff;outline:1px dashed #93c5fd;outline-offset:-1px}
        @media print{
          .noP{display:none!important}
          body,html{margin:0;padding:0;background:#fff}
          @page{size:A4 landscape;margin:8mm 8mm}
          .wrap{max-width:100%!important;padding:0!important}
          .print-area{font-size:11px!important}
          .print-area table{font-size:10px!important}
          .print-area td,.print-area th{padding:3px 5px!important}
          .print-area img{max-height:70px!important}
          .print-area table{page-break-inside:avoid}
        }
      `}</style>

      <div className="wrap print-area" style={{ maxWidth: 980, margin: '0 auto', padding: '20px' }}>
        {/* HEADER */}
        <div style={{ position: 'relative', textAlign: 'center', paddingBottom: 8, borderBottom: '2px solid #000', minHeight: 90 }}>
          <img src={LOGO} alt="CJK" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', height: 85, maxWidth: 95, objectFit: 'contain' }} />
          <div style={{ padding: '2px 105px 0', lineHeight: 1.3 }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{CO.name}</div>
            <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' }}>{CO.reg}</div>
            <div style={{ fontSize: 12, marginTop: 5, whiteSpace: 'nowrap' }}>{CO.addr}</div>
            <div style={{ fontSize: 12, marginTop: 1, whiteSpace: 'nowrap' }}>
              Tel: {CO.tel} &nbsp;&nbsp;&nbsp; E-mail: <a href={'mailto:' + CO.email} style={{ color: '#0056b3' }}>{CO.email}</a>
            </div>
          </div>
          <button className="noP" onClick={() => setShowSettings(!showSettings)}
            style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: '#888' }}>
            ⚙ API
          </button>
        </div>

        {/* API KEY */}
        {(showSettings || !apiKey) && (
          <div className="noP" style={{ background: '#f8f8f8', border: '1px solid #ddd', borderRadius: 6, padding: '12px 16px', margin: '14px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              {AI_CFG.label} API Key {apiKey && <span style={{ color: '#080', fontWeight: 400 }}>✓ saved</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                placeholder={AI_CFG.placeholder} onKeyDown={e => e.key === 'Enter' && saveKey()}
                style={{ flex: 1, padding: '6px 10px', border: '1px solid #bbb', borderRadius: 4, fontSize: 14, fontFamily: 'monospace' }} />
              <button onClick={saveKey} style={btn(1)}>Save</button>
              {apiKey && <button onClick={() => setShowSettings(false)} style={btn(0)}>Close</button>}
            </div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 5 }}>
              Free at <a href={AI_CFG.consoleUrl} target="_blank" rel="noreferrer" style={{ color: '#0056b3' }}>{AI_CFG.consoleName}</a>
              <span style={{ marginLeft: 8, color: '#bbb' }}>· Shares the same {AI_CFG.label} key as the Choon Hua tab</span>
            </div>
          </div>
        )}

        {error && <div className="noP" style={{ background: '#fff0f0', border: '1px solid #d00', borderRadius: 6, padding: '10px 14px', color: '#c00', fontSize: 14, margin: '10px 0', whiteSpace: 'pre-wrap' }}>
          {error}<span style={{ float: 'right', cursor: 'pointer' }} onClick={() => setError(null)}>✕</span>
        </div>}

        {/* PAYMENT SUMMARY */}
        {invoices.length > 0 && (<>
          <div style={{ textAlign: 'center', margin: '20px 0 6px' }}>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: 1 }}>PAYMENT SUMMARY</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>SUPPLIER: {YHS_SUPPLIER}</div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead><tr>
              <th style={{ ...T.th, width: 32 }}>NO.</th>
              <th style={{ ...T.th, width: 78 }}>DATE</th>
              <th style={{ ...T.th, width: 118 }}>INVOICE NO.</th>
              <th style={{ ...T.th, width: 100 }}>AMOUNT</th>
              <th style={{ ...T.th, width: 78 }}>QUANTITY (CTN)</th>
              {volCats.map(vc => (
                <th key={vc.ml} style={{ ...T.th, width: 72 }}>
                  {volLabel(vc.ml)} (CTN)
                  <button className="noP" onClick={() => removeVolCat(vc.ml)} title={`Remove ${volLabel(vc.ml)} column`}
                    style={{ display: 'block', margin: '2px auto 0', background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕ remove</button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {invoices.map((inv, idx) => (
                <tr key={inv.id}>
                  <td style={T.td}>{idx + 1}</td>
                  <td style={T.td}>
                    <EditableText value={inv.invoice_date} onCommit={v => updateField(inv.id, 'invoice_date', v)}
                      invalid={inv.uncertain?.includes('invoice_date')} placeholder="DD/MM/YYYY" />
                  </td>
                  <td style={T.td}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <EditableText value={inv.invoice_no} onCommit={v => updateField(inv.id, 'invoice_no', v)}
                        invalid={inv.uncertain?.includes('invoice_no')} placeholder="No." />
                      {inv.image && (
                        <button className="noP" onClick={() => setPreviewId(inv.id)} title="View source invoice image"
                          style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 3, padding: '1px 5px', cursor: 'pointer', fontSize: 12, lineHeight: 1, fontFamily: F }}>👁</button>
                      )}
                      <button className="noP" onClick={() => removeInvoice(inv.id)} title="Remove invoice"
                        style={{ background: '#fff', border: '1px solid #f3c6c6', color: '#c00', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontSize: 12, lineHeight: 1, fontFamily: F }}>✕</button>
                    </div>
                  </td>
                  <td style={{ ...T.td, fontWeight: 700, textAlign: 'right' }}>
                    <EditableAmount value={inv.amount} onCommit={v => updateField(inv.id, 'amount', v)} format={fmt} align="right" />
                  </td>
                  <td style={T.td}><EditableInt value={inv.qty} onCommit={v => updateField(inv.id, 'qty', v)} /></td>
                  {volCats.map(vc => (
                    <td key={vc.ml} style={T.td}>
                      <EditableInt value={inv.vols?.[vc.ml] || 0} onCommit={v => updateVol(inv.id, vc.ml, v)} />
                    </td>
                  ))}
                </tr>
              ))}
              {/* TOTAL row */}
              <tr>
                <td colSpan={3} style={{ ...T.td, fontWeight: 700, textAlign: 'right', background: '#f0f0f0' }}>TOTAL:</td>
                <td style={{ ...T.td, fontWeight: 700, textAlign: 'right', background: '#f0f0f0' }}>{fmt(calc.totalAmount)}</td>
                <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{calc.totalCtn}</td>
                {calc.volumes.map(v => (
                  <td key={v.ml} style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{v.ctn}</td>
                ))}
              </tr>
            </tbody>
          </table>

          {/* VOLUME SUBSIDY TABLE — editable rate per volume, add/remove volumes */}
          <div style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.5, marginBottom: 6, color: '#333' }}>VOLUME SUBSIDY RATES</div>
            <table style={{ borderCollapse: 'collapse', width: 'auto', minWidth: 420 }}>
              <thead><tr>
                <th style={{ ...T.th, width: 110 }}>VOLUME</th>
                <th style={{ ...T.th, width: 100 }}>TOTAL CTN</th>
                <th style={{ ...T.th, width: 120 }}>RATE (RM/CTN)</th>
                <th style={{ ...T.th, width: 120 }}>SUBSIDY</th>
                <th className="noP" style={{ ...T.th, width: 40, border: 'none', background: 'none' }}></th>
              </tr></thead>
              <tbody>
                {calc.volumes.map(v => (
                  <tr key={v.ml}>
                    <td style={{ ...T.td, fontWeight: 700 }}>{v.label}</td>
                    <td style={T.td}>{v.ctn}</td>
                    <td style={T.td}><EditableRate value={v.rate} onCommit={r => setRate(v.ml, r)} /></td>
                    <td style={{ ...T.td, fontWeight: 700, textAlign: 'right' }}>{fmt(v.bonus)}</td>
                    <td className="noP" style={{ border: 'none', textAlign: 'center' }}>
                      <button onClick={() => removeVolCat(v.ml)} title="Remove volume"
                        style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 14 }}>✕</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0', textAlign: 'right' }}>TOTAL:</td>
                  <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{calc.volumes.reduce((s, v) => s + v.ctn, 0)}</td>
                  <td style={{ ...T.td, background: '#f0f0f0' }}></td>
                  <td style={{ ...T.td, fontWeight: 700, textAlign: 'right', background: '#f0f0f0' }}>{fmt(calc.totalBonus)}</td>
                  <td className="noP" style={{ border: 'none' }}></td>
                </tr>
              </tbody>
            </table>
            <div className="noP" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 13, color: '#666' }}>Add volume:</span>
              <input type="number" value={newVolMl} placeholder="e.g. 500 (ml)"
                onChange={e => setNewVolMl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addVolCat()}
                style={{ width: 130, padding: '4px 8px', fontSize: 13, border: '1px solid #aaa', borderRadius: 4, fontFamily: F }} />
              <button onClick={addVolCat} disabled={!newVolMl}
                style={{ padding: '4px 12px', fontSize: 13, background: newVolMl ? '#111' : '#ddd', color: '#fff', border: 'none', borderRadius: 4, cursor: newVolMl ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                + Add
              </button>
              <span style={{ fontSize: 12, color: '#999' }}>enter volume in ml — 1L = 1000, 1.5L = 1500. New volumes default to RM0.50/CTN — verify the rate.</span>
            </div>
          </div>

          {/* SUMMARY DEDUCTIONS */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 22 }}>
            <tbody>
              <SumRow label="TOTAL INVOICE AMOUNT:" value={calc.totalAmount} sign="" bold />
              <SumRow label="2% DISCOUNT:" value={calc.discount2} />
              <SumRow label={`TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.30):`} value={calc.transport1} />
              <SumRow label={`TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.20):`} value={calc.transport2} />
              {calc.volumes.filter(v => v.ctn > 0).map(v => (
                <SumRow key={v.ml} label={`${v.label} (${v.ctn} x RM${v.rate.toFixed(2)}):`} value={v.bonus} />
              ))}
              {/* OTHER DISCOUNT — editable */}
              <tr>
                <td colSpan={3} style={{ border: 'none' }} />
                <td style={T.bxL}>OTHER DISCOUNT:</td>
                <td style={T.bxM}>{otherDiscount ? '-' : ''}</td>
                <td style={T.bxR}>
                  <input className="noP" type="number" step="0.01" value={otherDiscount || ''} placeholder="0.00"
                    onChange={e => setOtherDiscount(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', border: '1px solid #ccc', borderRadius: 3, padding: '3px 4px', fontSize: 15, fontFamily: F, textAlign: 'right', boxSizing: 'border-box' }} />
                </td>
              </tr>
              {/* CREDIT NOTE — editable */}
              <tr>
                <td colSpan={3} style={{ border: 'none' }} />
                <td style={T.bxL}>CREDIT NOTE:</td>
                <td style={T.bxM}>{creditNote ? '-' : ''}</td>
                <td style={T.bxR}>
                  <input className="noP" type="number" step="0.01" value={creditNote || ''} placeholder="0.00"
                    onChange={e => setCreditNote(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', border: '1px solid #ccc', borderRadius: 3, padding: '3px 4px', fontSize: 15, fontFamily: F, textAlign: 'right', boxSizing: 'border-box' }} />
                </td>
              </tr>
              <SumRow label="TOTAL AMOUNT PAYABLE:" value={calc.payable} sign="" bold highlight topBorder />
            </tbody>
          </table>

          <div className="noP" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28 }}>
            <button style={btn(0)} onClick={() => setUploading(true)}>+ Add Invoice</button>
            <button style={btn(1)} onClick={() => window.print()}>🖨 Print / Save PDF</button>
            <button style={btn(0)} onClick={downloadExcel}>↓ Excel</button>
            <button style={{ ...btn(0), color: '#aaa', borderColor: '#ddd' }} onClick={reset}>Reset</button>
          </div>
        </>)}

        {/* UPLOAD */}
        {showUpload && !processing && apiKey && (
          <div ref={uploadAreaRef} className="noP"
            style={{ border: '2px dashed ' + (drag || invoices.length > 0 ? '#c87b00' : '#ccc'), borderRadius: 8, padding: '48px 20px', textAlign: 'center', cursor: 'pointer', background: drag || invoices.length > 0 ? '#fffbeb' : '#fafafa', marginTop: 18, transition: 'background .2s, border-color .2s' }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: .5 }}>📄</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {invoices.length > 0 ? `Add more invoices to your batch of ${invoices.length}` : 'Drop Yeo Hiap Seng invoice photos or PDFs here'}</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 3 }}>or click to browse — JPG, PNG, PDF (multi-page OK)</div>
            <input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf" multiple style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.length) processFiles(e.target.files); e.target.value = ''; }} />
            {invoices.length > 0 && <button style={{ ...btn(0), marginTop: 12 }} onClick={e => { e.stopPropagation(); setUploading(false); }}>Cancel</button>}
          </div>
        )}

        {processing && (
          <div className="noP" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ width: 32, height: 32, border: '3px solid #eee', borderTop: '3px solid #000', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 14, color: '#888' }}>
              Extracting with {AI_CFG.label}...{processingCount.total > 1 && ` (${processingCount.done}/${processingCount.total})`}
            </div>
          </div>
        )}
      </div>

      {/* SOURCE PREVIEW MODAL */}
      {previewInv && (
        <div className="noP" onClick={() => setPreviewId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', width: 'min(1400px, 96vw)', height: 'min(900px, 92vh)', display: 'flex', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 48px rgba(0,0,0,0.4)', fontFamily: F }}>
            <div style={{ flex: '1 1 62%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
              {previewInv.image
                ? <img src={previewInv.image} alt="Source invoice" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff' }} />
                : <div style={{ color: '#888', fontSize: 14 }}>No source image available</div>}
            </div>
            <div style={{ flex: '1 1 38%', minWidth: 340, padding: '18px 22px', overflowY: 'auto', background: '#fafafa', borderLeft: '1px solid #e5e7eb', fontSize: 14, color: '#111' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Verify against source</div>
                <button onClick={() => setPreviewId(null)} style={{ padding: '5px 12px', fontSize: 12, border: '1px solid #d1d5db', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: F }}>Close (Esc)</button>
              </div>
              {previewInv.uncertain?.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>
                  ⚠ AI flagged as unclear: <strong>{previewInv.uncertain.join(', ')}</strong>. Verify these against the image.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 11, columnGap: 14, alignItems: 'center' }}>
                <div style={{ color: '#6b7280' }}>Invoice No</div>
                <EditableText value={previewInv.invoice_no} onCommit={v => updateField(previewInv.id, 'invoice_no', v)} placeholder="No." />
                <div style={{ color: '#6b7280' }}>Date</div>
                <EditableText value={previewInv.invoice_date} onCommit={v => updateField(previewInv.id, 'invoice_date', v)} placeholder="DD/MM/YYYY" />
                <div style={{ color: '#6b7280' }}>Amount</div>
                <EditableAmount value={previewInv.amount} onCommit={v => updateField(previewInv.id, 'amount', v)} format={fmt} align="left" />
                <div style={{ color: '#6b7280' }}>Total CTN</div>
                <EditableInt value={previewInv.qty} onCommit={v => updateField(previewInv.id, 'qty', v)} />
                {volCats.map(vc => (
                  <Fragment key={vc.ml}>
                    <div style={{ color: '#6b7280' }}>{volLabel(vc.ml)} CTN</div>
                    <EditableInt value={previewInv.vols?.[vc.ml] || 0} onCommit={v => updateVol(previewInv.id, vc.ml, v)} />
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

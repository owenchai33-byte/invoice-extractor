import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  LOGO, CO, fmt, normalizeDate,
  EditableAmount, EditableText,
  pdfToImageFiles, downsizeBase64ToJPEG, callAI,
  AI_PROVIDER, AI_CFG, BATCH_DELAY_MS,
} from './InvoiceExtractor';

const F = 'Calibri, "Segoe UI", Arial, sans-serif';
const B = '1px solid #000';

// ============================================================
// YEO HIAP SENG SUBSIDY MODEL
// ============================================================
// A flat model — different from Choon Hua's cascading per-carton subsidy.
// Every carton on every invoice earns a fixed transport subsidy of
// RM0.30 + RM0.20 = RM0.50/CTN. On top of that, cartons of specific
// volumes earn a product bonus: 250ML and 300ML cartons each get an
// extra RM0.50/CTN. The whole invoice total also gets a flat 2% discount.
// TOTAL PAYABLE = invoice total − 2% − transport(0.30) − transport(0.20)
//                 − 250ML bonus − 300ML bonus − other discount − credit note.
const YHS_RATE_2PCT = 0.02;
const YHS_TRANSPORT_1 = 0.30;
const YHS_TRANSPORT_2 = 0.20;
const YHS_ML_BONUS = 0.50;
const YHS_SUPPLIER = 'YEO HIAP SENG TRADING SDN BHD';

// Pure calc — kept side-effect-free and exported so the test suite can lock
// it against the source Excel. Round to 4 dp to kill float noise while
// preserving the spreadsheet's precision (the 2% line is not rounded to sen
// in the source sheet, e.g. 61004.69 × 2% = 1220.0938).
export function calcYHS({ invoices = [], otherDiscount = 0, creditNote = 0 }) {
  const r4 = v => Math.round(v * 10000) / 10000;
  const totalAmount = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalCtn = invoices.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const total250 = invoices.reduce((s, i) => s + (Number(i.ctn250) || 0), 0);
  const total300 = invoices.reduce((s, i) => s + (Number(i.ctn300) || 0), 0);

  const discount2 = r4(totalAmount * YHS_RATE_2PCT);
  const transport1 = r4(totalCtn * YHS_TRANSPORT_1);
  const transport2 = r4(totalCtn * YHS_TRANSPORT_2);
  const bonus250 = r4(total250 * YHS_ML_BONUS);
  const bonus300 = r4(total300 * YHS_ML_BONUS);
  const od = Number(otherDiscount) || 0;
  const cn = Number(creditNote) || 0;

  const payable = r4(
    totalAmount - discount2 - transport1 - transport2 - bonus250 - bonus300 - od - cn
  );

  return {
    totalAmount: r4(totalAmount), totalCtn, total250, total300,
    discount2, transport1, transport2, bonus250, bonus300,
    otherDiscount: r4(od), creditNote: r4(cn), payable,
  };
}

// AI prompt — YHS invoices only need per-invoice totals plus the 250ML/300ML
// carton split (those two volumes earn the extra bonus). No line-item volume
// matching like Choon Hua.
const YHS_PROMPT = `You are an invoice data extractor for Yeo Hiap Seng, a Malaysian beverage distributor. Analyze this invoice image carefully and extract data into this EXACT JSON format. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.

{"supplier":"full supplier company name from the invoice header","invoice_no":"the document number","invoice_date":"DD/MM/YYYY","total_amount":6548.76,"total_qty":360,"qty_250ml":360,"qty_300ml":0,"uncertain_fields":[]}

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
4. total_qty: Total number of CARTONS (CTN) on the whole invoice — the "PRODUCT TOTAL" / "TOTAL QTY" carton count. This is a carton count, not a piece count.
5. qty_250ml: Of that total, how many CARTONS are 250ML products. Look at each line item's description/volume. Sum the carton quantities of every line whose volume is 250ML. If none, use 0.
6. qty_300ml: Same, for 300ML products. If none, use 0.
7. Cartons that are neither 250ML nor 300ML still count in total_qty but NOT in qty_250ml or qty_300ml.
8. supplier: From the TOP HEADER (the company that ISSUED the invoice), usually "YEO HIAP SENG".
9. uncertain_fields: ARRAY of field names you had ANY doubt about. Possible: "invoice_no","invoice_date","total_amount","total_qty","qty_250ml","qty_300ml". BE LIBERAL.

SELF-CHECK: qty_250ml + qty_300ml must be ≤ total_qty. Every digit in invoice_no and total_amount must be one you'd bet on, else flag it.

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

const T = {
  th: { border: B, padding: '10px 8px', fontWeight: 700, fontSize: 15, textAlign: 'center', background: '#f0f0f0', fontFamily: F },
  td: { border: B, padding: '8px 10px', fontSize: 16, textAlign: 'center', verticalAlign: 'middle', fontFamily: F, fontVariantNumeric: 'tabular-nums' },
  bxL: { border: B, padding: '6px 14px', fontSize: 15, fontWeight: 700, textAlign: 'right', background: '#f0f0f0', fontFamily: F },
  bxM: { border: B, padding: '6px 10px', fontSize: 15, fontWeight: 700, textAlign: 'center', fontFamily: F, width: 24 },
  bxR: { border: B, padding: '6px 14px', fontSize: 16, fontWeight: 700, textAlign: 'right', fontFamily: F, minWidth: 120, width: 120, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
};
const btn = p => ({ padding: '8px 18px', borderRadius: 5, border: p ? 'none' : '1px solid #aaa', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: p ? '#111' : '#fff', color: p ? '#fff' : '#333', fontFamily: F });

const LS_YHS = 'yhs_invoices';

export default function YHSExtractor() {
  const [invoices, setInvoices] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_YHS)) || []; } catch { return []; }
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
  const fileRef = useRef(null);
  const uploadAreaRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(LS_YHS, JSON.stringify(invoices)); } catch {} }, [invoices]);
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

  const removeInvoice = id => setInvoices(prev => prev.filter(i => i.id !== id));
  const reset = () => { setInvoices([]); setUploading(false); setProcessing(false); setError(null); setOtherDiscount(0); setCreditNote(0); setPreviewId(null); if (fileRef.current) fileRef.current.value = ''; };

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
                    ? new Error('Rate limit hit even after retries. Wait a minute, or add a credit card to Groq for 10x higher limits (costs $0 under free quota).')
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

              let imagePreview = null;
              try { imagePreview = await downsizeBase64ToJPEG(reader.result, 1024, 0.7); } catch {}

              resolve({
                id: 'yhs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                invoice_no: parsed.invoice_no || '',
                invoice_date: parsed.invoice_date || '',
                supplier: parsed.supplier || YHS_SUPPLIER,
                amount: Number(parsed.total_amount) || 0,
                qty: Number(parsed.total_qty) || 0,
                ctn250: Number(parsed.qty_250ml) || 0,
                ctn300: Number(parsed.qty_300ml) || 0,
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
    if (results.length > 0) setInvoices(prev => [...prev, ...results]);
    setUploading(false); setProcessing(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [processSingleFile, apiKey]);

  const calc = calcYHS({ invoices, otherDiscount, creditNote });
  const showUpload = invoices.length === 0 || uploading;

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new(), d = [];
    d.push([CO.name + ' ' + CO.reg]); d.push([CO.addr]); d.push(['Tel: ' + CO.tel + '    E-mail: ' + CO.email]);
    d.push([]); d.push(['PAYMENT SUMMARY']); d.push(['SUPPLIER: ' + YHS_SUPPLIER]); d.push([]);
    d.push(['NO.', 'DATE', 'INVOICE NO.', '', 'AMOUNT', 'QUANTITY (CTN)', '250ML (CTN)', '300ML (CTN)']);
    invoices.forEach((inv, i) => {
      d.push([i + 1, inv.invoice_date, inv.invoice_no, '', inv.amount, inv.qty, inv.ctn250 || '', inv.ctn300 || '']);
    });
    d.push(['TOTAL:', '', '', '', calc.totalAmount, calc.totalCtn, calc.total250, calc.total300]);
    d.push([]);
    d.push(['', 'TOTAL INVOICE AMOUNT:', '', '', calc.totalAmount]);
    d.push(['', '2% DISCOUNT:', '', '-', calc.discount2]);
    d.push(['', `TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.30):`, '', '-', calc.transport1]);
    d.push(['', 'OTHER DISCOUNT:', '', calc.otherDiscount ? '-' : '', calc.otherDiscount || '']);
    d.push(['', `TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.20):`, '', '-', calc.transport2]);
    d.push(['', `250ML (${calc.total250} x RM0.50):`, '', '-', calc.bonus250]);
    d.push(['', `300ML (${calc.total300} x RM0.50):`, '', '-', calc.bonus300]);
    d.push(['', 'CREDIT NOTE:', '', calc.creditNote ? '-' : '', calc.creditNote || '']);
    d.push(['', 'TOTAL AMOUNT PAYABLE:', '', '', calc.payable]);
    const ws = XLSX.utils.aoa_to_sheet(d);
    ws['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 16 }, { wch: 3 }, { wch: 14 }, { wch: 15 }, { wch: 13 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, ws, 'YHS');
    XLSX.writeFile(wb, 'Payment_Summary_YHS.xlsx');
  };

  // A summary row in the deductions block: label (right-aligned), minus sign, value.
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
          @page{size:A4 portrait;margin:8mm 8mm}
          .wrap{max-width:100%!important;padding:0!important}
          .print-area{font-size:12px!important}
          .print-area table{font-size:11px!important}
          .print-area td,.print-area th{padding:4px 6px!important}
          .print-area img{max-height:80px!important}
          .print-area table{page-break-inside:avoid}
        }
      `}</style>

      <div className="wrap print-area" style={{ maxWidth: 820, margin: '0 auto', padding: '20px' }}>
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
              <th style={{ ...T.th, width: 36 }}>NO.</th>
              <th style={{ ...T.th, width: 86 }}>DATE</th>
              <th style={{ ...T.th, width: 130 }}>INVOICE NO.</th>
              <th style={{ ...T.th, width: 110 }}>AMOUNT</th>
              <th style={{ ...T.th, width: 100 }}>QUANTITY (CTN)</th>
              <th style={{ ...T.th, width: 90 }}>250ML (CTN)</th>
              <th style={{ ...T.th, width: 90 }}>300ML (CTN)</th>
            </tr></thead>
            <tbody>
              {invoices.map((inv, idx) => {
                return (
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
                    <td style={T.td}><EditableInt value={inv.ctn250} onCommit={v => updateField(inv.id, 'ctn250', v)} /></td>
                    <td style={T.td}><EditableInt value={inv.ctn300} onCommit={v => updateField(inv.id, 'ctn300', v)} /></td>
                  </tr>
                );
              })}
              {/* TOTAL row */}
              <tr>
                <td colSpan={3} style={{ ...T.td, fontWeight: 700, textAlign: 'right', background: '#f0f0f0' }}>TOTAL:</td>
                <td style={{ ...T.td, fontWeight: 700, textAlign: 'right', background: '#f0f0f0' }}>{fmt(calc.totalAmount)}</td>
                <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{calc.totalCtn}</td>
                <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{calc.total250}</td>
                <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{calc.total300}</td>
              </tr>

              {/* SUMMARY DEDUCTIONS */}
              <tr><td colSpan={7} style={{ padding: 6, border: 'none' }} /></tr>
              <SumRow label="TOTAL INVOICE AMOUNT:" value={calc.totalAmount} sign="" bold />
              <SumRow label="2% DISCOUNT:" value={calc.discount2} />
              <SumRow label={`TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.30):`} value={calc.transport1} />
              {/* OTHER DISCOUNT — editable */}
              <tr>
                <td colSpan={3} style={{ border: 'none' }} />
                <td style={T.bxL}>OTHER DISCOUNT:</td>
                <td style={T.bxM}>{otherDiscount ? '-' : ''}</td>
                <td style={T.bxR}>
                  <input className="noP" type="number" step="0.01" value={otherDiscount || ''} placeholder="0.00"
                    onChange={e => setOtherDiscount(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', border: '1px solid #ccc', borderRadius: 3, padding: '3px 4px', fontSize: 15, fontFamily: F, textAlign: 'right', boxSizing: 'border-box' }} />
                  <span className="printOnly" style={{ display: 'none' }}>{fmt(otherDiscount)}</span>
                </td>
              </tr>
              <SumRow label={`TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.20):`} value={calc.transport2} />
              <SumRow label={`250ML (${calc.total250} x RM0.50):`} value={calc.bonus250} />
              <SumRow label={`300ML (${calc.total300} x RM0.50):`} value={calc.bonus300} />
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
                <div style={{ color: '#6b7280' }}>250ML CTN</div>
                <EditableInt value={previewInv.ctn250} onCommit={v => updateField(previewInv.id, 'ctn250', v)} />
                <div style={{ color: '#6b7280' }}>300ML CTN</div>
                <EditableInt value={previewInv.ctn300} onCommit={v => updateField(previewInv.id, 'ctn300', v)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

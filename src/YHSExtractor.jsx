import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  LOGO, CO, fmt, normalizeDate, formatVolUnit,
  EditableAmount, EditableText,
  pdfToImageFiles, downsizeBase64ToJPEG, callAI, parseAIJson,
  AI_PROVIDER, AI_CFG, BATCH_CONCURRENCY, BATCH_MIN_GAP_MS, runPool, FlappyLoader,
} from './InvoiceExtractor';

const F = 'Calibri, "Segoe UI", Arial, sans-serif';
const B = '1px solid #000';

// ============================================================
// YEO HIAP SENG SUBSIDY MODEL
// ============================================================
// Flat model (not cascading like Choon Hua):
//   - 2% discount on the whole invoice total
//   - Transport subsidy: every carton earns RM0.30 + RM0.20 on TOTAL cartons
//   - Product volume bonus: every carton that has a volume earns a flat
//     RM0.50/CTN (all volumes share the same rate). The volume breakdown is
//     recorded PER INVOICE — each invoice lists only the volumes it actually
//     carries (250ML, 300ML, 320ML, 1L, 1.5L, …), not a fixed global grid.
//   - Other discount + credit note (manual)
// TOTAL PAYABLE = invoice total − 2% − transport(0.30) − transport(0.20)
//                 − Σ(all volume cartons × rate) − other discount − credit note.
const YHS_RATE_2PCT = 0.02;
const YHS_TRANSPORT_1 = 0.30;
const YHS_TRANSPORT_2 = 0.20;
const YHS_DEFAULT_RATE = 0.50;
const YHS_SUPPLIER = 'YEO HIAP SENG TRADING SDN BHD';

// Volumes offered in the per-invoice "add volume" picker (ml). Owen can still
// type any other volume via the custom option.
const COMMON_VOLS = [250, 300, 320, 500, 1000, 1500];

export function volLabel(ml) {
  return formatVolUnit(ml) || `${ml}ML`;
}

// Pure calc — exported so the test suite can lock it against the source Excel.
// Round to 4 dp to kill float noise while preserving the sheet's precision (the
// 2% line is not rounded to sen, e.g. 61004.69 × 2% = 1220.0938). Volumes are
// aggregated from each invoice's `vols` map ({ [ml]: cartonCount }). Each volume
// earns a PER-VOLUME rate from `rates` ({ [ml]: RM/CTN }); volumes without an
// explicit rate fall back to `defaultRate`. Set a volume's rate to 0 for products
// that get no discount. `ctnOverrides` ({ [ml]: cartons }) lets the qty that earns
// the bonus differ from the actual total — e.g. only part of the 300ML cartons get
// a discount. The bonus uses the override; transport still uses the real total.
export function calcYHS({ invoices = [], rates = {}, defaultRate = YHS_DEFAULT_RATE, ctnOverrides = {}, otherDiscount = 0, creditNote = 0 }) {
  const r4 = v => Math.round(v * 10000) / 10000;
  const dRate = Number(defaultRate) || 0;
  const rateFor = ml => (rates && rates[ml] != null) ? (Number(rates[ml]) || 0) : dRate;
  const totalAmount = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalCtn = invoices.reduce((s, i) => s + (Number(i.qty) || 0), 0);

  const discount2 = r4(totalAmount * YHS_RATE_2PCT);
  const transport1 = r4(totalCtn * YHS_TRANSPORT_1);
  const transport2 = r4(totalCtn * YHS_TRANSPORT_2);

  // Aggregate carton counts per volume across every invoice.
  const volMap = {};
  invoices.forEach(i => {
    const vols = i.vols || {};
    Object.keys(vols).forEach(ml => {
      const m = Number(ml), c = Number(vols[ml]) || 0;
      if (m > 0 && c) volMap[m] = (volMap[m] || 0) + c;
    });
  });
  const volumes = Object.keys(volMap)
    .map(ml => {
      const m = Number(ml), ctn = volMap[ml], r = rateFor(m);
      const ov = (ctnOverrides && ctnOverrides[m] != null) ? Math.max(0, Number(ctnOverrides[m]) || 0) : null;
      const subsidyCtn = ov != null ? ov : ctn;
      return { ml: m, label: volLabel(m), rate: r, ctn, subsidyCtn, overridden: ov != null, bonus: r4(subsidyCtn * r) };
    })
    .sort((a, b) => a.ml - b.ml);
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
const YHS_PROMPT = `You are an invoice data extractor for Yeo Hiap Seng, a Malaysian beverage distributor. Analyze this invoice image carefully and extract data into this EXACT JSON format. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.

{"supplier":"full supplier company name from the invoice header","invoice_no":"the document number","invoice_date":"DD/MM/YYYY","total_amount":6548.76,"total_qty":360,"volumes":[{"volume_ml":250,"ctn":360}],"uncertain_fields":[]}

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
4. total_qty: Total number of CARTONS (CTN) on the whole invoice — the "TOTAL QTY" / "TOTAL OTHERS" / "TOTAL CAN" carton count. A carton count, not a piece count.
5. volumes: An ARRAY breaking the cartons down by product VOLUME. Include ONLY volumes that actually appear on THIS invoice.
   - READ THE VOLUME LITERALLY FROM EACH LINE ITEM'S DESCRIPTION TEXT. The volume is the number+unit written at the START of the description, e.g.:
       "1L COMBI YEOS JASMINE GT 1X12"        -> volume_ml 1000   (1L = 1000ml)
       "300ML CAN YEOS SOY BEAN MILK X24"     -> volume_ml 300
       "250ML PET YEOS ..."                   -> volume_ml 250
       "320ML ..."                            -> volume_ml 320
       "1.5L ..."                             -> volume_ml 1500
       "500ML ..."                            -> volume_ml 500
   - Convert litres to millilitres: 1L→1000, 1.2L→1200, 1.25L→1250, 1.5L→1500, 2L→2000.
   - NEVER substitute a volume that is not written in the description. If a line says "1L", the volume is 1000 — it is NOT 320, NOT 300, NOT any other number. Do NOT pick from a list of "typical" volumes; read what is actually printed.
   - Sum the carton (QTY / CAR) counts of all line items that share the same volume.
   - If you genuinely cannot read a line's volume, add "volumes" to uncertain_fields rather than guessing a value.
   - The sum of all volumes[].ctn should equal total_qty.
6. CONTINUATION / FOOTER PAGES: Some invoices span multiple pages (marked "PAGE 1/2", "PAGE 2/2", etc.). A page that shows only the header and payment footer with NO product line-item table and NO grand total is a continuation page — for it, return total_amount 0, total_qty 0, volumes []. Do NOT invent products for it. (The full invoice totals live on the page that has the product table.)
7. supplier: From the TOP HEADER (the company that ISSUED the invoice), usually "YEO HIAP SENG".
8. uncertain_fields: ARRAY of field names you had ANY doubt about. Possible: "invoice_no","invoice_date","total_amount","total_qty","volumes". BE LIBERAL.

SELF-CHECK: sum of volumes[].ctn should be ≤ total_qty. Every volume you output must be written verbatim in a line-item description on THIS image. Every digit in invoice_no and total_amount must be one you'd bet on, else flag it.

Return ONLY the JSON object. Nothing else.`;

// How many invoice images to send in a single API call. On a rate-limited FREE
// tier, batching (4 per call) is what keeps a batch under the per-minute cap. On
// the paid Anthropic tier there's no such pressure, so we send ONE invoice per
// call — the most reliable option, with zero risk of the model mixing two
// invoices' data together — and rely on parallelism for speed.
const YHS_CHUNK = AI_PROVIDER === 'anthropic' ? 1 : 4;

const RATE_MSG = 'Google Gemini rate limit hit (429). The free tier caps requests per minute/day. Wait a minute and try again — or enable billing on your Gemini key for far higher limits (cents at your volume, and it stops Google training on your data).';

// Multi-image prompt: same extraction rules, but return an ordered array with
// exactly one object per image so we can map results back by position.
const yhsMultiPrompt = (n) => `You are given ${n} Yeo Hiap Seng invoice images, in order. Extract each one INDEPENDENTLY and return a JSON ARRAY of EXACTLY ${n} objects — one per image, in the SAME ORDER as the images. Respond with ONLY the JSON array — no markdown, no backticks, no explanation.

Each array element MUST be this exact object shape:
{"invoice_no":"the document number","invoice_date":"DD/MM/YYYY","total_amount":6548.76,"total_qty":360,"volumes":[{"volume_ml":250,"ctn":360}],"uncertain_fields":[]}

CRITICAL: Do NOT mix data between invoices. Each object describes ONLY its own image. Never carry an amount, invoice number, or carton count from one image into another. If you can read K images clearly but not all, still return exactly ${n} objects — flag the unclear ones in their own uncertain_fields.

Per-object rules (apply to each image separately):
- invoice_no: the "Document No" / "Invoice No". Read each digit; flag if unclear.
- invoice_date: DD/MM/YYYY with leading zeros; flag if unclear.
- total_amount: the final "Total Amount Due" / "Grand Total" (NOT subtotal). Read each digit exactly, no rounding; flag if unclear.
- total_qty: total CARTON (CTN) count on that invoice.
- volumes: array of {volume_ml, ctn}, ONE entry per distinct volume ON THAT invoice. READ THE VOLUME LITERALLY from the start of each line-item description ("1L COMBI..." -> 1000, "300ML CAN..." -> 300, "320ML..." -> 320, "1.5L..." -> 1500). Convert litres to ml (1L=1000, 1.2L=1200, 1.5L=1500). NEVER substitute a volume not written in the description — if it says 1L it is 1000, never 320. If a line's volume is unreadable, flag "volumes" instead of guessing. Include only volumes actually present. Sum of ctn should be ≤ total_qty.
- CONTINUATION PAGES: if an image shows only a header + payment footer with NO product line-item table and no grand total (e.g. a "PAGE 2/2"), return total_amount 0, total_qty 0, volumes [] for it — do not invent products.
- uncertain_fields: array of field names you had any doubt about; be liberal.

Return ONLY the JSON array of ${n} objects. Nothing else.`;

// Small click-to-edit integer cell.
function EditableInt({ value, onCommit, placeholder = '0', width = 60 }) {
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
      style={{ width, border: '1px solid #2563eb', borderRadius: 3, padding: '2px 4px', fontSize: 15, fontFamily: F, textAlign: 'center', boxSizing: 'border-box' }} />;
  }
  return <span onClick={() => setEditing(true)} className="editable-text"
    title="Click to edit"
    style={{ display: 'inline-block', minWidth: 34, cursor: 'text', padding: '2px 4px', borderRadius: 3, fontSize: 15, textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: (value ? '#000' : '#bbb') }}>
    {value ? value : placeholder}
  </span>;
}

// Parse a friendly volume string into millilitres:
//   "320ML"/"320ml"/"320" → 320,  "1L"/"1l" → 1000,  "1.5L" → 1500,  "1.2" → 1200.
// A bare number ≤ 10 is read as litres (1.5 → 1500); larger bare numbers are ml.
// Returns null if it can't be read, so the caller can keep the old value.
export function parseVolInput(str) {
  const s = String(str ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^([\d.]+)(ml|l)?$/.exec(s);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!isFinite(n) || n <= 0) return null;
  if (m[2] === 'l') n *= 1000;
  else if (!m[2] && n <= 10) n *= 1000;
  return Math.round(n);
}

// Click-to-edit volume label. Shows "320ML"; on click becomes a text box you can
// type any volume into ("300ML", "1L", "325"). Commits the parsed ml on Enter/blur.
function EditableVol({ ml, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(volLabel(ml));
  const ref = useRef(null);
  useEffect(() => { if (!editing) setLocal(volLabel(ml)); }, [ml, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const commit = () => {
    const parsed = parseVolInput(local);
    if (parsed && parsed !== ml) onCommit(parsed);
    setEditing(false);
  };
  if (editing) {
    return <input ref={ref} type="text" value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setLocal(volLabel(ml)); setEditing(false); } }}
      className="noP"
      style={{ width: 66, border: '1px solid #2563eb', borderRadius: 3, padding: '1px 3px', fontSize: 14, fontWeight: 700, fontFamily: F, textAlign: 'center', boxSizing: 'border-box' }} />;
  }
  return <span onClick={() => setEditing(true)} className="editable-text" title="Click to edit volume"
    style={{ fontWeight: 700, minWidth: 52, textAlign: 'right', cursor: 'text', padding: '1px 3px', borderRadius: 3, display: 'inline-block' }}>
    {volLabel(ml)}
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

// Numeric field that keeps exactly what you type (so decimals and multi-digit
// entry work) while committing the parsed value live. Binding an <input> straight
// to a parsed number wipes a trailing "." and blocks decimals — this fixes that.
// A blank field commits 0.
function NumberField({ value, onCommit, placeholder = '0.00', style = {} }) {
  const [local, setLocal] = useState(value ? String(value) : '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setLocal(value ? String(value) : ''); }, [value, focused]);
  return (
    <input type="number" step="0.01" min="0" inputMode="decimal" className="noP"
      value={local} placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={e => { setLocal(e.target.value); onCommit(Math.max(0, parseFloat(e.target.value) || 0)); }}
      onBlur={() => setFocused(false)}
      style={style} />
  );
}

// Read-only summary line in the deductions table.
function SumRow({ label, value, sign = '-', bold = false, highlight = false, topBorder = false }) {
  return (
    <tr>
      <td colSpan={2} style={{ border: 'none' }} />
      <td style={{ ...T.bxL, ...(topBorder ? { borderTop: '2px solid #000' } : {}), ...(bold ? { fontSize: 16 } : {}) }}>{label}</td>
      <td style={{ ...T.bxM, ...(topBorder ? { borderTop: '2px solid #000' } : {}) }}>{sign}</td>
      <td style={{ ...T.bxR, ...(topBorder ? { borderTop: '2px solid #000' } : {}), ...(highlight ? { background: '#ffe600', fontSize: 18 } : {}) }}>{fmt(value)}</td>
    </tr>
  );
}

// Per-invoice volume breakdown cell (only the volumes this invoice carries).
// Defined at module scope so typing in the add-volume inputs doesn't remount it
// (an inner component definition would drop focus after a single keystroke).
function VolCell({ inv, volAdd, setVolAdd, setInvVol, removeInvVol, addInvVol, changeInvVol }) {
  const entries = Object.keys(inv.vols || {}).map(Number).sort((a, b) => a - b).filter(ml => inv.vols[ml] != null);
  const add = volAdd[inv.id] || { ml: String(COMMON_VOLS[0]), custom: '', ctn: '' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'stretch' }}>
      {entries.length === 0 && <span className="printOnly" style={{ color: '#bbb', fontSize: 13 }}>—</span>}
      {entries.map(ml => (
        <div key={ml} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <EditableVol ml={ml} onCommit={newMl => changeInvVol(inv.id, ml, newMl)} />
          <EditableInt value={inv.vols[ml]} onCommit={v => (v > 0 ? setInvVol(inv.id, ml, v) : removeInvVol(inv.id, ml))} />
          <span style={{ color: '#888', fontSize: 12 }}>CTN</span>
          <button className="noP" onClick={() => removeInvVol(inv.id, ml)} title="Remove volume"
            style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      ))}
      {/* add-volume control (screen only) */}
      <div className="noP" style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 2 }}>
        <select value={add.ml}
          onChange={e => setVolAdd(prev => ({ ...prev, [inv.id]: { ...add, ml: e.target.value } }))}
          style={{ fontSize: 12, padding: '2px 4px', border: '1px solid #bbb', borderRadius: 3, fontFamily: F }}>
          {COMMON_VOLS.map(ml => <option key={ml} value={String(ml)}>{volLabel(ml)}</option>)}
          <option value="custom">custom…</option>
        </select>
        {add.ml === 'custom' && (
          <input type="number" value={add.custom} placeholder="ml"
            onChange={e => setVolAdd(prev => ({ ...prev, [inv.id]: { ...add, custom: e.target.value } }))}
            style={{ width: 54, fontSize: 12, padding: '2px 4px', border: '1px solid #bbb', borderRadius: 3, fontFamily: F }} />
        )}
        <input type="number" value={add.ctn} placeholder="CTN"
          onChange={e => setVolAdd(prev => ({ ...prev, [inv.id]: { ...add, ctn: e.target.value } }))}
          onKeyDown={e => e.key === 'Enter' && addInvVol(inv.id)}
          style={{ width: 54, fontSize: 12, padding: '2px 4px', border: '1px solid #bbb', borderRadius: 3, fontFamily: F }} />
        <button onClick={() => addInvVol(inv.id)}
          style={{ fontSize: 12, padding: '2px 8px', background: '#111', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}>+ add</button>
      </div>
    </div>
  );
}

// Per-volume RM rates are GLOBAL across batches (product-stable) — one shared key.
// Invoices + per-batch overrides/discounts are namespaced by batch id (see below).
const LS_RATES = 'yhs_volrates_v2';

export default function YHSExtractor({ batchId = 'default' }) {
  // Per-batch persistence — each Chrome tab keeps its own invoices/overrides/discounts
  // alive under keys namespaced by batchId. Legacy single-list data (the old un-namespaced
  // keys) is migrated into the first ('default') batch so nothing is lost on upgrade.
  const LS_YHS    = `yhs_invoices__${batchId}`;
  const LS_VOLCTN = `yhs_volctn__${batchId}`;
  const LS_META   = `yhs_meta__${batchId}`;   // { otherDiscount, creditNote }
  const isDefault = batchId === 'default';
  const loadLS = (key, legacy, fallback) => {
    try { const v = localStorage.getItem(key); if (v != null) return JSON.parse(v); } catch {}
    if (legacy) { try { const v = localStorage.getItem(legacy); if (v != null) return JSON.parse(v); } catch {} }
    return fallback;
  };
  const [invoices, setInvoices] = useState(() => loadLS(LS_YHS, isDefault ? 'yhs_invoices' : null, []));
  // Per-volume subsidy rates: { [ml]: RM/CTN }. A volume not in the map falls back
  // to YHS_DEFAULT_RATE (0.50). Set a volume to 0 for products with no discount.
  const [volRates, setVolRates] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_RATES)) || {}; } catch { return {}; }
  });
  const setVolRate = (ml, r) => setVolRates(prev => ({ ...prev, [ml]: r }));
  // Per-volume subsidy-qty overrides: { [ml]: cartons }. When set, only this many
  // cartons of that volume earn the bonus (e.g. some 300ML products get no discount).
  // Absent → the full aggregated carton count is used.
  const [volCtn, setVolCtn] = useState(() => loadLS(LS_VOLCTN, isDefault ? 'yhs_volctn_v1' : null, {}));
  const setVolCtnOverride = (ml, n) => setVolCtn(prev => ({ ...prev, [ml]: Math.max(0, parseInt(n, 10) || 0) }));
  const clearVolCtnOverride = (ml) => setVolCtn(prev => { const c = { ...prev }; delete c[ml]; return c; });
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingCount, setProcessingCount] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [otherDiscount, setOtherDiscount] = useState(() => loadLS(LS_META, null, {}).otherDiscount || 0);
  const [creditNote, setCreditNote] = useState(() => loadLS(LS_META, null, {}).creditNote || 0);
  const [previewId, setPreviewId] = useState(null);
  const [volAdd, setVolAdd] = useState({}); // { [invId]: { ml, custom, ctn } }
  const fileRef = useRef(null);
  const uploadAreaRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(LS_YHS, JSON.stringify(invoices)); } catch {} }, [invoices, LS_YHS]);
  useEffect(() => { try { localStorage.setItem(LS_RATES, JSON.stringify(volRates)); } catch {} }, [volRates]);
  useEffect(() => { try { localStorage.setItem(LS_VOLCTN, JSON.stringify(volCtn)); } catch {} }, [volCtn, LS_VOLCTN]);
  useEffect(() => { try { localStorage.setItem(LS_META, JSON.stringify({ otherDiscount, creditNote })); } catch {} }, [otherDiscount, creditNote, LS_META]);
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

  // Per-invoice volume edits.
  const setInvVol = (id, ml, ctn) =>
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, vols: { ...inv.vols, [ml]: ctn } } : inv));
  const removeInvVol = (id, ml) =>
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      const vols = { ...inv.vols }; delete vols[ml];
      return { ...inv, vols };
    }));
  // Re-key one invoice's volume (correct a misread volume, e.g. 320ML → 300ML),
  // carrying its carton count over. If the target volume already exists on that
  // invoice, the cartons merge into it.
  const changeInvVol = (id, oldMl, newMl) => {
    if (!newMl || newMl <= 0 || newMl === oldMl) return;
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      const vols = { ...inv.vols };
      const ctn = Number(vols[oldMl]) || 0;
      delete vols[oldMl];
      vols[newMl] = (Number(vols[newMl]) || 0) + ctn;
      return { ...inv, vols };
    }));
  };
  const addInvVol = (id) => {
    const entry = volAdd[id] || {};
    const ml = entry.ml === 'custom' ? parseInt(entry.custom, 10) : parseInt(entry.ml, 10);
    const ctn = parseInt(entry.ctn, 10);
    if (!ml || ml <= 0 || !ctn || ctn <= 0) return;
    setInvoices(prev => prev.map(inv => inv.id === id
      ? { ...inv, vols: { ...inv.vols, [ml]: (Number(inv.vols?.[ml]) || 0) + ctn } }
      : inv));
    setVolAdd(prev => ({ ...prev, [id]: { ml: String(COMMON_VOLS[0]), custom: '', ctn: '' } }));
  };

  const removeInvoice = id => setInvoices(prev => prev.filter(i => i.id !== id));
  const reset = () => {
    // Clears the whole list for a fresh delivery. Per-volume RM rates persist
    // (they're product-stable), but the batch-specific CTN overrides are cleared.
    setInvoices([]); setUploading(false); setProcessing(false); setError(null);
    setOtherDiscount(0); setCreditNote(0); setPreviewId(null); setVolAdd({}); setVolCtn({});
    if (fileRef.current) fileRef.current.value = '';
  };

  // Read a File into a data URL.
  const readDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Failed to read file'));
    r.readAsDataURL(file);
  });

  // Build one invoice record from a parsed JSON object + its preview image.
  const mkInvoice = (parsed, image) => {
    const p = parsed || {};
    const dc = normalizeDate(p.invoice_date);
    const vols = {};
    if (Array.isArray(p.volumes)) p.volumes.forEach(v => {
      const ml = Number(v.volume_ml), ctn = Number(v.ctn) || 0;
      if (ml > 0 && ctn) vols[ml] = (vols[ml] || 0) + ctn;
    });
    return {
      id: 'yhs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      invoice_no: p.invoice_no || '',
      invoice_date: dc.ok ? dc.date : (p.invoice_date || ''),
      supplier: p.supplier || YHS_SUPPLIER,
      amount: Number(p.total_amount) || 0,
      qty: Number(p.total_qty) || 0,
      vols,
      uncertain: Array.isArray(p.uncertain_fields) ? p.uncertain_fields : [],
      image,
    };
  };

  // Extract ONE invoice from one file — the reliable per-image path, also used as
  // the fallback when a batched call doesn't return one object per image.
  const processSingleFile = useCallback(async (file) => {
    if (!file?.type.startsWith('image/')) throw new Error('Not an image file: ' + file.name);
    const raw = await readDataUrl(file);
    let optimized; try { optimized = await downsizeBase64ToJPEG(raw, 1280, 0.75); } catch { optimized = raw; }
    const BACKOFF_MS = [0, 15000, 20000, 30000, 30000];
    let lastErr = null;
    for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
      try {
        if (BACKOFF_MS[attempt] > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
        let result;
        try {
          const _t0 = performance.now();
          result = await callAI({ provider: AI_PROVIDER, apiKey, model: AI_CFG.model, imageDataUrl: optimized, prompt: YHS_PROMPT });
          console.log(`[YHS] ${file.name}: ${AI_CFG.model} in ${Math.round(performance.now() - _t0)}ms`);
        } catch (apiErr) {
          if (apiErr.code === 'rate_limit') { lastErr = attempt === BACKOFF_MS.length - 1 ? new Error(RATE_MSG) : apiErr; continue; }
          throw apiErr;
        }
        const parsed = parseAIJson(result.text);
        let preview = null; try { preview = await downsizeBase64ToJPEG(raw, 1024, 0.7); } catch {}
        return mkInvoice(parsed, preview);
      } catch (inner) { lastErr = inner; }
    }
    throw lastErr || new Error('Failed after retries');
  }, [apiKey]);

  // Extract a CHUNK of invoices in ONE API call (the speed win — fewer requests
  // means we stay under the free-tier rate limit). If the model doesn't return
  // exactly one object per image, fall back to per-image extraction so we never
  // lose or misalign an invoice.
  const processChunk = useCallback(async (files, onOne) => {
    const raws = await Promise.all(files.map(readDataUrl));
    const optimized = await Promise.all(raws.map(r => downsizeBase64ToJPEG(r, 1280, 0.75).catch(() => r)));
    const previews = await Promise.all(raws.map(r => downsizeBase64ToJPEG(r, 1024, 0.7).catch(() => null)));

    const BACKOFF_MS = [0, 15000, 20000];
    let lastErr = null;
    for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
      try {
        if (BACKOFF_MS[attempt] > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
        let result;
        try {
          const _t0 = performance.now();
          result = await callAI({ provider: AI_PROVIDER, apiKey, model: AI_CFG.model, images: optimized, prompt: yhsMultiPrompt(files.length), maxOutputTokens: 2000 + files.length * 1000 });
          console.log(`[YHS] batch×${files.length}: ${AI_CFG.model} in ${Math.round(performance.now() - _t0)}ms`);
        } catch (apiErr) {
          if (apiErr.code === 'rate_limit') { lastErr = attempt === BACKOFF_MS.length - 1 ? new Error(RATE_MSG) : apiErr; continue; }
          throw apiErr;
        }
        const parsed = parseAIJson(result.text);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.invoices) ? parsed.invoices : null);
        if (!arr || arr.length !== files.length) { lastErr = new Error('batch returned ' + (arr ? arr.length : 'non-array') + ' for ' + files.length + ' images'); break; }
        const invs = arr.map((p, i) => mkInvoice(p, previews[i]));
        invs.forEach(() => onOne && onOne());
        return invs;
      } catch (inner) {
        if (inner.code === 'rate_limit') { lastErr = inner; continue; }
        lastErr = inner; break; // parse / count-mismatch / other → fall back to per-image
      }
    }
    // Fallback: per-image extraction (reliable). If this was a rate-limit, the
    // per-image path surfaces the actionable 429 message.
    console.warn('[YHS] batch call fell back to per-image:', lastErr?.message);
    const out = [];
    for (const f of files) { out.push(await processSingleFile(f)); onOne && onOne(); }
    return out;
  }, [apiKey, processSingleFile]);

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
    let done = 0;
    const onOne = () => { done++; setProcessingCount({ done, total: imageFiles.length }); };

    // Split into chunks → one API call per chunk (the batching speed win).
    const chunks = [];
    for (let i = 0; i < imageFiles.length; i += YHS_CHUNK) chunks.push(imageFiles.slice(i, i + YHS_CHUNK));

    const settled = await runPool(chunks, BATCH_CONCURRENCY, ch => processChunk(ch, onOne), null, BATCH_MIN_GAP_MS);
    const results = [];
    settled.forEach((s, ci) => {
      if (s.ok) results.push(...s.value);
      else setError(prev => (prev ? prev + '\n' : '') + `Failed batch ${ci + 1}: ${s.error.message}`);
    });
    // Drop empty continuation/footer pages (a multi-page invoice's "PAGE 2/2" with
    // no product table extracts to amount 0 + qty 0 + no volumes). A real invoice —
    // even an FOC one — always has qty > 0, so this only removes blank pages.
    const kept = results.filter(r => !(r.amount === 0 && r.qty === 0 && Object.keys(r.vols || {}).length === 0));
    if (kept.length > 0) setInvoices(prev => [...prev, ...kept]);
    setUploading(false); setProcessing(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [processChunk, apiKey]);

  // defaultRate 0 → a volume earns no subsidy until Owen sets its rate below.
  const calc = calcYHS({ invoices, rates: volRates, defaultRate: 0, ctnOverrides: volCtn, otherDiscount, creditNote });
  const showUpload = invoices.length === 0 || uploading;

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new(), d = [];
    d.push([CO.name + ' ' + CO.reg]); d.push([CO.addr]); d.push(['Tel: ' + CO.tel + '    E-mail: ' + CO.email]);
    d.push([]); d.push(['PAYMENT SUMMARY']); d.push(['SUPPLIER: ' + YHS_SUPPLIER]); d.push([]);
    d.push(['NO.', 'DATE', 'INVOICE NO.', 'AMOUNT', 'QUANTITY (CTN)', 'VOLUME BREAKDOWN (CTN)']);
    invoices.forEach((inv, i) => {
      const volStr = Object.keys(inv.vols || {})
        .map(Number).sort((a, b) => a - b)
        .filter(ml => inv.vols[ml])
        .map(ml => `${volLabel(ml)}: ${inv.vols[ml]}`).join(', ');
      d.push([i + 1, inv.invoice_date, inv.invoice_no, inv.amount, inv.qty, volStr]);
    });
    d.push(['TOTAL:', '', '', calc.totalAmount, calc.totalCtn, '']);
    d.push([]);
    d.push(['', 'TOTAL INVOICE AMOUNT:', '', '', calc.totalAmount]);
    d.push(['', '2% DISCOUNT:', '', '-', calc.discount2]);
    d.push(['', `TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.30):`, '', '-', calc.transport1]);
    d.push(['', `TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.20):`, '', '-', calc.transport2]);
    calc.volumes.filter(v => v.bonus > 0).forEach(v => {
      d.push(['', `${v.label} (${v.subsidyCtn} x RM${v.rate.toFixed(2)}):`, '', '-', v.bonus]);
    });
    d.push(['', 'OTHER DISCOUNT:', '', calc.otherDiscount ? '-' : '', calc.otherDiscount || '']);
    d.push(['', 'CREDIT NOTE:', '', calc.creditNote ? '-' : '', calc.creditNote || '']);
    d.push(['', 'TOTAL AMOUNT PAYABLE:', '', '', calc.payable]);
    const ws = XLSX.utils.aoa_to_sheet(d);
    ws['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 15 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, ws, 'YHS');
    XLSX.writeFile(wb, 'Payment_Summary_YHS.xlsx');
  };

  return (
    <div className="ext-root" style={{ fontFamily: F, fontSize: 16, background: '#fff', color: '#000', minHeight: '100vh' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .editable-text:hover{background:#f0f9ff;outline:1px dashed #93c5fd;outline-offset:-1px}
        .printOnly{display:none}
        @media print{
          .noP{display:none!important}
          .flag-uncertain{background:transparent!important;box-shadow:none!important;color:#000!important}
          .printOnly{display:inline!important}
          html,body{margin:0!important;padding:0!important;background:#fff}
          /* Flatten the 100vh root so it can't push a blank page in print. */
          .ext-root{min-height:0!important}
          @page{size:A4 portrait;margin:7mm 8mm}
          .wrap{max-width:100%!important;padding:0!important}
          .print-area{font-size:11px!important}
          .print-area table{font-size:10.5px!important}
          .print-area td,.print-area th{padding:3px 6px!important}
          .print-area img{max-height:64px!important}
          /* Keep rows together, but never avoid-break the whole block/table —
             that pushes the entire summary onto a blank second page. */
          .print-area tr{page-break-inside:avoid}
        }
      `}</style>

      <div className="wrap print-area" style={{ maxWidth: 860, margin: '0 auto', padding: '20px' }}>
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
              <span style={{ marginLeft: 8, color: '#bbb' }}>· Using model: <code style={{ background: '#eee', padding: '1px 4px', borderRadius: 2, fontSize: 11 }}>{AI_CFG.model}</code></span>
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
              <th style={{ ...T.th, width: 82 }}>DATE</th>
              <th style={{ ...T.th, width: 122 }}>INVOICE NO.</th>
              <th style={{ ...T.th, width: 104 }}>AMOUNT</th>
              <th style={{ ...T.th, width: 78 }}>QUANTITY (CTN)</th>
              <th style={T.th}>VOLUME BREAKDOWN</th>
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
                  <td style={{ ...T.td, fontWeight: 700, textAlign: 'left' }}>
                    <EditableAmount value={inv.amount} onCommit={v => updateField(inv.id, 'amount', v)} format={fmt} align="left" invalid={inv.uncertain?.includes('total_amount')} />
                  </td>
                  <td style={T.td}><EditableInt value={inv.qty} onCommit={v => updateField(inv.id, 'qty', v)} /></td>
                  <td style={{ ...T.td, textAlign: 'center' }}>
                    <VolCell inv={inv} volAdd={volAdd} setVolAdd={setVolAdd}
                      setInvVol={setInvVol} removeInvVol={removeInvVol} addInvVol={addInvVol} changeInvVol={changeInvVol} />
                  </td>
                </tr>
              ))}
              {/* TOTAL row */}
              <tr>
                <td colSpan={3} style={{ ...T.td, fontWeight: 700, textAlign: 'right', background: '#f0f0f0' }}>TOTAL:</td>
                <td style={{ ...T.td, fontWeight: 700, textAlign: 'left', background: '#f0f0f0', paddingLeft: 12 }}>{fmt(calc.totalAmount)}</td>
                <td style={{ ...T.td, fontWeight: 700, background: '#f0f0f0' }}>{calc.totalCtn}</td>
                <td style={{ ...T.td, background: '#f0f0f0' }}></td>
              </tr>
            </tbody>
          </table>

          {/* VOLUME SUBSIDY RATES — set each volume's RM/CTN here (screen only).
              A volume with no rate earns no subsidy and is left out of the total
              below; once you set a rate, its line appears in the deductions. */}
          {calc.volumes.length > 0 && (
            <div className="noP" style={{ marginTop: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                VOLUME SUBSIDY RATES
                <span style={{ fontWeight: 400, color: '#888', fontSize: 12, marginLeft: 8 }}>
                  set RM/CTN per volume — leave blank for no discount, and edit the CTN if only part of it qualifies
                </span>
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 500 }}>
                <thead><tr>
                  <th style={{ ...T.th, textAlign: 'left', padding: '6px 10px' }}>VOLUME</th>
                  <th style={{ ...T.th, padding: '6px 10px' }}>CTN</th>
                  <th style={{ ...T.th, padding: '6px 10px' }}>RATE (RM/CTN)</th>
                  <th style={{ ...T.th, padding: '6px 10px' }}>SUBSIDY</th>
                </tr></thead>
                <tbody>
                  {calc.volumes.map(v => (
                    <tr key={v.ml}>
                      <td style={{ ...T.td, textAlign: 'left', fontWeight: 700 }}>{v.label}</td>
                      <td style={T.td}>
                        <EditableInt value={v.subsidyCtn} onCommit={n => setVolCtnOverride(v.ml, n)} />
                        {v.overridden && v.subsidyCtn !== v.ctn && (
                          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                            of {v.ctn}
                            <span onClick={() => clearVolCtnOverride(v.ml)} title="Reset to the full carton count"
                              style={{ cursor: 'pointer', color: '#2563eb', marginLeft: 4 }}>↺</span>
                          </div>
                        )}
                      </td>
                      <td style={T.td}>
                        <NumberField value={v.rate} onCommit={r => setVolRate(v.ml, r)}
                          style={{ width: 84, border: '1px solid #bbb', borderRadius: 4, padding: '4px 6px', fontSize: 14, fontFamily: F, textAlign: 'right', boxSizing: 'border-box' }} />
                      </td>
                      <td style={{ ...T.td, textAlign: 'right', color: v.bonus ? '#000' : '#bbb' }}>{fmt(v.bonus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* SUMMARY DEDUCTIONS — right-aligned totals box (empty left is borderless),
              fixed columns so the block sits neatly under the invoice table's right side. */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col />
              <col style={{ width: '4%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <tbody>
              <SumRow label="TOTAL INVOICE AMOUNT:" value={calc.totalAmount} sign="" bold />
              <SumRow label="2% DISCOUNT:" value={calc.discount2} />
              <SumRow label={`TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.30):`} value={calc.transport1} />
              <SumRow label={`TRANSPORT SUBSIDY (${calc.totalCtn} x RM0.20):`} value={calc.transport2} />
              {/* Confirmed per-volume subsidies — only volumes given a rate above.
                  Read-only here; the rate is set in the VOLUME SUBSIDY RATES table. */}
              {calc.volumes.filter(v => v.bonus > 0).map(v => (
                <SumRow key={v.ml} label={`${v.label} (${v.subsidyCtn} x RM${v.rate.toFixed(2)}):`} value={v.bonus} />
              ))}
              {/* OTHER DISCOUNT — editable */}
              <tr>
                <td colSpan={2} style={{ border: 'none' }} />
                <td style={T.bxL}>OTHER DISCOUNT:</td>
                <td style={T.bxM}>{otherDiscount ? '-' : ''}</td>
                <td style={T.bxR}>
                  <NumberField value={otherDiscount} onCommit={setOtherDiscount}
                    style={{ width: '100%', border: '1px solid #ccc', borderRadius: 3, padding: '3px 4px', fontSize: 15, fontFamily: F, textAlign: 'right', boxSizing: 'border-box' }} />
                  <span className="printOnly">{otherDiscount ? fmt(otherDiscount) : ''}</span>
                </td>
              </tr>
              {/* CREDIT NOTE — editable */}
              <tr>
                <td colSpan={2} style={{ border: 'none' }} />
                <td style={T.bxL}>CREDIT NOTE:</td>
                <td style={T.bxM}>{creditNote ? '-' : ''}</td>
                <td style={T.bxR}>
                  <NumberField value={creditNote} onCommit={setCreditNote}
                    style={{ width: '100%', border: '1px solid #ccc', borderRadius: 3, padding: '3px 4px', fontSize: 15, fontFamily: F, textAlign: 'right', boxSizing: 'border-box' }} />
                  <span className="printOnly">{creditNote ? fmt(creditNote) : ''}</span>
                </td>
              </tr>
              <SumRow label="TOTAL AMOUNT PAYABLE:" value={calc.payable} sign="" bold highlight topBorder />
            </tbody>
          </table>

          <div className="noP" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28 }}>
            <button style={btn(0)} onClick={() => setUploading(true)}>+ Add Invoice</button>
            <button style={btn(1)} onClick={() => window.print()}>🖨 Print / Save PDF</button>
            <button style={btn(0)} onClick={downloadExcel}>↓ Excel</button>
            <button style={{ ...btn(0), color: '#c0392b', borderColor: '#e6bcbc' }}
              onClick={() => { reset(); }}>🗑 Clear all</button>
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
          <FlappyLoader label={`Extracting with ${AI_CFG.label}…${processingCount.total > 1 ? ` (${processingCount.done}/${processingCount.total})` : ''}`} />
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
              </div>
              <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Volume breakdown</div>
              <div style={{ marginTop: 6 }}>
                <VolCell inv={previewInv} volAdd={volAdd} setVolAdd={setVolAdd}
                  setInvVol={setInvVol} removeInvVol={removeInvVol} addInvVol={addInvVol} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

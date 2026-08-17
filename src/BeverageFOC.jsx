import { useState, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const LS_KEY = 'cjk_bev_foc';
const LS_DETAIL_KEY = 'cjk_bev_foc_detail';
const FOC_PRICE = 35.30;

const BEVERAGES = [
  { key: 'seasons_24s', label: 'Seasons 24s can', rate: 0.60 },
  { key: '100p_can', label: '100 Plus can 24s/28s', rate: 0.70 },
  { key: 'fn_15l', label: 'F&N 1.5L', rate: 0.70 },
  { key: '100p_15l', label: '100 Plus 1.5L/1.75L', rate: 0.70 },
  { key: 'borneo', label: 'Borneo / Ice Mountain', rate: 0.25 },
  { key: 'sunvalley', label: 'Sun Valley 1L/2L', rate: 1.50 },
  { key: 'fn_can12', label: 'F&N can 12s', rate: 0.50 },
  { key: 'seasons_250', label: 'Seasons 250ml / 1L', rate: 0.20 },
  { key: '100p_500', label: '100 Plus 500ml', rate: 0.50 },
];

const DAIRIES = [
  { key: 'dairy_48', label: '48 cans', rate: 1.00 },
  { key: 'dairy_24', label: '24 cans', rate: 0.50 },
  { key: 'dairy_1kg', label: '1kg', rate: 0.50 },
  { key: 'dairy_25kg', label: '2.5kg', rate: 0.50 },
];

const DAIRY_BONUS_THRESHOLD = 600;
const DAIRY_BONUS_CTNS = 5;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const nf = v => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function classifyItem(desc, uom) {
  const d = desc.toLowerCase();
  const u = uom.toLowerCase();
  if (/sun\s*valley/i.test(d)) return 'sunvalley';
  if (/borneo|ice\s*mountain/i.test(d)) return 'borneo';
  if (/100\s*plus/i.test(d) && /325/i.test(d)) return '100p_can';
  if (/100\s*plus/i.test(d) && /500/i.test(d)) return '100p_500';
  if (/100\s*plus/i.test(d) && /1\.5|1\.75/i.test(d)) return '100p_15l';
  if (/season/i.test(d) && /300/i.test(d)) return 'seasons_24s';
  if (/season/i.test(d) && (/250/i.test(d) || /\b1l\b|\(\s*1l\s*\)|\s1l\)/i.test(d))) return 'seasons_250';
  if (!/season/i.test(d) && !/100\s*plus/i.test(d) && /f.?n/i.test(d) && /1\.5/i.test(d)) return 'fn_15l';
  if (!/season/i.test(d) && !/100\s*plus/i.test(d) && /f.?n/i.test(d) && /325/i.test(d)) return 'fn_can12';
  if (/\(1kg\)|1kg/i.test(d)) return 'dairy_1kg';
  if (/2\.5kg/i.test(d)) return 'dairy_25kg';
  if (/48/.test(u)) return 'dairy_48';
  return 'dairy_24';
}

async function extractLines(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim()).map(i => ({
      str: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]),
    }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = items.length ? [items[0]] : [];
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].y - cur[0].y) < 4) { cur.push(items[i]); }
      else { cur.sort((a, b) => a.x - b.x); allLines.push(cur.map(c => c.str).join(' ')); cur = [items[i]]; }
    }
    if (cur.length) { cur.sort((a, b) => a.x - b.x); allLines.push(cur.map(c => c.str).join(' ')); }
  }
  return allLines;
}

function parseSummary(lines) {
  let inSummary = false;
  const totals = {};
  const details = {};
  for (const line of lines) {
    if (/final\s*summary/i.test(line)) { inSummary = true; continue; }
    if (!inSummary) continue;
    if (/^\s*total\s+[\d,]/i.test(line) || /end\s*of\s*report/i.test(line)) break;
    if (/item\s*code/i.test(line) && /uom/i.test(line)) continue;
    const m = line.match(/^(\d{7,})\s+(.+?)\s+(Ctn\d+)\s+(\d[\d,]*)\s+([\d,.]+)$/i);
    if (!m) continue;
    const desc = m[2].trim();
    const uom = m[3];
    const qty = parseInt(m[4].replace(/,/g, ''), 10);
    const cat = classifyItem(desc, uom);
    totals[cat] = (totals[cat] || 0) + qty;
    if (!details[cat]) details[cat] = [];
    details[cat].push({ desc, uom, qty });
  }
  return { totals, details };
}

export default function BeverageFOC() {
  const now = new Date();
  const prevMo = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYr = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [mo, setMo] = useState(prevMo);
  const [yr, setYr] = useState(prevYr);
  const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`;
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [allDetail, setAllDetail] = useState(() => load(LS_DETAIL_KEY, {}));
  const detail = allDetail[mk] || {};
  const [expanded, setExpanded] = useState({});

  const [allData, setAllData] = useState(() => load(LS_KEY, {}));
  const qty = allData[mk] || {};
  const setQty = (key, val) => {
    const next = { ...allData, [mk]: { ...qty, [key]: val } };
    setAllData(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };
  const bulkSet = (map) => {
    const merged = { ...qty };
    for (const [k, v] of Object.entries(map)) merged[k] = String(v);
    const next = { ...allData, [mk]: merged };
    setAllData(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };

  const changeMonth = d => {
    if (d < 0) { if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1); }
    else { if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1); }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setUploadMsg('');
    try {
      const buf = await file.arrayBuffer();
      const lines = await extractLines(buf);
      const { totals, details: det } = parseSummary(lines);
      const cats = Object.keys(totals);
      if (!cats.length) { setUploadMsg('Could not find "Final Summary By Items" in this PDF.'); return; }
      bulkSet(totals);
      const nextDetail = { ...allDetail, [mk]: det };
      setAllDetail(nextDetail);
      try { localStorage.setItem(LS_DETAIL_KEY, JSON.stringify(nextDetail)); } catch {}
      setUploadMsg(`Filled ${cats.length} categories from PDF.`);
    } catch (err) {
      setUploadMsg('Failed to read PDF: ' + (err.message || err));
    } finally {
      setUploading(false);
      setTimeout(() => setUploadMsg(''), 5000);
    }
  };

  const calc = useMemo(() => {
    let bevTotal = 0, dairyTotal = 0, dairyCtns = 0;
    const bevRows = BEVERAGES.map(b => {
      const q = parseFloat(qty[b.key]) || 0;
      const rebate = q * b.rate;
      bevTotal += rebate;
      return { ...b, qty: q, rebate };
    });
    const dairyRows = DAIRIES.map(d => {
      const q = parseFloat(qty[d.key]) || 0;
      const rebate = q * d.rate;
      dairyTotal += rebate;
      dairyCtns += q;
      return { ...d, qty: q, rebate };
    });
    const bonus = dairyCtns >= DAIRY_BONUS_THRESHOLD;
    const grandTotal = bevTotal + dairyTotal;
    const focCtns = Math.floor(grandTotal / FOC_PRICE);
    const remainder = grandTotal - focCtns * FOC_PRICE;
    const supplierFoc = remainder > 0 ? focCtns + 1 : focCtns;
    const totalFoc = supplierFoc + (bonus ? DAIRY_BONUS_CTNS : 0);
    return { bevRows, dairyRows, bevTotal, dairyTotal, dairyCtns, bonus, grandTotal, focCtns, supplierFoc, remainder, totalFoc };
  }, [qty]);

  useEffect(() => { document.title = `BEVERAGE FOC - ${MONTHS[mo].slice(0,3).toUpperCase()}'${String(yr).slice(-2)}`; }, [mo, yr]);

  const clearMonth = () => {
    if (!confirm(`Clear all quantities for ${MONTHS[mo]} ${yr}?`)) return;
    const next = { ...allData }; delete next[mk]; setAllData(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
    const nextD = { ...allDetail }; delete nextD[mk]; setAllDetail(nextD);
    try { localStorage.setItem(LS_DETAIL_KEY, JSON.stringify(nextD)); } catch {}
  };

  return (
    <div className="foc-root">
      <style>{CSS}</style>
      <div className="foc-bar no-print">
        <h1>BEVERAGE FOC CALCULATOR</h1>
        <div className="foc-mnav">
          <button className="foc-mbtn" onClick={() => changeMonth(-1)}>&#9664;</button>
          <div className="foc-mlbl">{MONTHS[mo]} {yr}</div>
          <button className="foc-mbtn" onClick={() => changeMonth(1)}>&#9654;</button>
        </div>
        <div className="foc-acts">
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleUpload} />
          <button className="foc-btn foc-btn-o" onClick={clearMonth}>Clear</button>
          <button className="foc-btn" onClick={() => window.print()}>Print</button>
          <button className="foc-btn foc-btn-upload" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Reading...' : 'Upload PDF'}
          </button>
        </div>
      </div>

      {uploadMsg && <div className="foc-toast">{uploadMsg}</div>}

      <div className="foc-body">
        <div className="foc-print-header">
          <div className="foc-print-title">F&N BEVERAGE FOC CALCULATION</div>
          <div className="foc-print-period">{MONTHS[mo]} {yr}</div>
          <div className="foc-print-co">CHAI JEE KIONG TRADING SDN BHD</div>
        </div>

        <div className="foc-tables">
          <div className="foc-section">
            <div className="foc-sec-title">Beverages</div>
            <table className="foc-tbl">
              <thead>
                <tr><th className="foc-th-cat">Category</th><th className="foc-th-rate">Rate (RM/ctn)</th><th className="foc-th-qty">Qty (ctns)</th><th className="foc-th-amt">Rebate (RM)</th></tr>
              </thead>
              <tbody>
                {calc.bevRows.map(r => {
                  const items = detail[r.key] || [];
                  const hasItems = items.length > 0;
                  const isOpen = expanded[r.key];
                  const pdfSum = items.reduce((s, it) => s + it.qty, 0);
                  const verified = hasItems && pdfSum === r.qty;
                  return (<>
                    <tr key={r.key} className={hasItems ? 'foc-expandable' : ''} onClick={() => hasItems && setExpanded(e => ({ ...e, [r.key]: !e[r.key] }))}>
                      <td>{hasItems && <span className="foc-arrow no-print">{isOpen ? '▾' : '▸'}</span>}{r.label}{verified && <span className="foc-tick"> ✓</span>}</td>
                      <td className="foc-num">{nf(r.rate)}</td>
                      <td className="foc-num"><input type="number" min="0" className="foc-in no-print" value={qty[r.key] || ''} onChange={e => { e.stopPropagation(); setQty(r.key, e.target.value); }} onClick={e => e.stopPropagation()} placeholder="-" /><span className="foc-pr">{r.qty || '-'}</span></td>
                      <td className="foc-num">{r.rebate > 0 ? nf(r.rebate) : '-'}</td>
                    </tr>
                    {items.map((it, i) => (
                      <tr key={r.key + '-' + i} className={'foc-detail' + (isOpen ? ' foc-detail-open' : '')}>
                        <td colSpan="2" className="foc-detail-desc">{it.desc} ({it.uom})</td>
                        <td className="foc-num foc-detail-qty">{it.qty}</td>
                        <td></td>
                      </tr>
                    ))}
                  </>);
                })}
                <tr className="foc-sub"><td>Subtotal</td><td></td><td></td><td className="foc-num">{nf(calc.bevTotal)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="foc-section">
            <div className="foc-sec-title">Dairies</div>
            <table className="foc-tbl">
              <thead>
                <tr><th className="foc-th-cat">Category</th><th className="foc-th-rate">Rate (RM/ctn)</th><th className="foc-th-qty">Qty (ctns)</th><th className="foc-th-amt">Rebate (RM)</th></tr>
              </thead>
              <tbody>
                {calc.dairyRows.map(r => {
                  const items = detail[r.key] || [];
                  const hasItems = items.length > 0;
                  const isOpen = expanded[r.key];
                  const pdfSum = items.reduce((s, it) => s + it.qty, 0);
                  const verified = hasItems && pdfSum === r.qty;
                  return (<>
                    <tr key={r.key} className={hasItems ? 'foc-expandable' : ''} onClick={() => hasItems && setExpanded(e => ({ ...e, [r.key]: !e[r.key] }))}>
                      <td>{hasItems && <span className="foc-arrow no-print">{isOpen ? '▾' : '▸'}</span>}{r.label}{verified && <span className="foc-tick"> ✓</span>}</td>
                      <td className="foc-num">{nf(r.rate)}</td>
                      <td className="foc-num"><input type="number" min="0" className="foc-in no-print" value={qty[r.key] || ''} onChange={e => { e.stopPropagation(); setQty(r.key, e.target.value); }} onClick={e => e.stopPropagation()} placeholder="-" /><span className="foc-pr">{r.qty || '-'}</span></td>
                      <td className="foc-num">{r.rebate > 0 ? nf(r.rebate) : '-'}</td>
                    </tr>
                    {items.map((it, i) => (
                      <tr key={r.key + '-' + i} className={'foc-detail' + (isOpen ? ' foc-detail-open' : '')}>
                        <td colSpan="2" className="foc-detail-desc">{it.desc} ({it.uom})</td>
                        <td className="foc-num foc-detail-qty">{it.qty}</td>
                        <td></td>
                      </tr>
                    ))}
                  </>);
                })}
                <tr className="foc-sub"><td>Subtotal ({Math.round(calc.dairyCtns)} ctns)</td><td></td><td></td><td className="foc-num">{nf(calc.dairyTotal)}</td></tr>
              </tbody>
            </table>
            {calc.bonus && <div className="foc-bonus">Dairies hit {DAIRY_BONUS_THRESHOLD} ctns — extra {DAIRY_BONUS_CTNS} FOC cartons!</div>}
            {!calc.bonus && calc.dairyCtns > 0 && <div className="foc-bonus-info">{DAIRY_BONUS_THRESHOLD - Math.round(calc.dairyCtns)} more dairies ctns needed for +{DAIRY_BONUS_CTNS} bonus FOC</div>}
          </div>
        </div>

        <div className="foc-result">
          <table className="foc-res-tbl">
            <tbody>
              <tr><td className="foc-res-lb">Total Rebate</td><td className="foc-res-val">RM {nf(calc.grandTotal)}</td></tr>
              <tr><td className="foc-res-lb">FOC (exact)</td><td className="foc-res-val">{calc.focCtns} cartons{calc.remainder > 0 ? ` + RM ${nf(calc.remainder)} remainder` : ''}</td></tr>
              {calc.remainder > 0 && <tr><td className="foc-res-lb">Supplier rounds up</td><td className="foc-res-val">{calc.supplierFoc} cartons</td></tr>}
              {calc.bonus && <tr><td className="foc-res-lb">Dairy bonus (+{DAIRY_BONUS_THRESHOLD} ctns)</td><td className="foc-res-val">{DAIRY_BONUS_CTNS} cartons</td></tr>}
              <tr className="foc-res-total"><td className="foc-res-lb">TOTAL FOC</td><td className="foc-res-val">{calc.totalFoc} cartons of 100 Plus 325ml</td></tr>
            </tbody>
          </table>
          <div className="foc-note">1 FOC carton = 100 Plus Original 325ml × 24 @ RM{nf(FOC_PRICE)}</div>
        </div>

        {(() => {
          const allItems = [];
          const catLabels = Object.fromEntries([...BEVERAGES, ...DAIRIES].map(c => [c.key, c.label]));
          for (const [cat, items] of Object.entries(detail)) {
            for (const it of items) allItems.push({ ...it, cat, catLabel: catLabels[cat] || cat });
          }
          if (!allItems.length) return null;
          return (
            <div className="foc-log">
              <div className="foc-log-title">PDF Import — Full Item Mapping</div>
              <table className="foc-log-tbl">
                <thead><tr><th>#</th><th>Product</th><th>UOM</th><th className="foc-num">Qty</th><th>→ Category</th></tr></thead>
                <tbody>
                  {allItems.map((it, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{it.desc}</td><td>{it.uom}</td><td className="foc-num">{it.qty}</td><td className="foc-log-cat">{it.catLabel}</td></tr>
                  ))}
                  <tr className="foc-sub"><td></td><td>Total</td><td></td><td className="foc-num">{allItems.reduce((s, it) => s + it.qty, 0)}</td><td></td></tr>
                </tbody>
              </table>
            </div>
          );
        })()}

        <div className="foc-ref no-print">
          <div className="foc-ref-title">Rebate Reference</div>
          <div className="foc-ref-note">Supplier: Signature Selection Sdn Bhd &nbsp;|&nbsp; Valid: 01/11/2025 – 28/04/2026</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.foc-root{background:#fafafa;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.foc-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.foc-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b}
.foc-mnav{display:flex;align-items:center;gap:8px}
.foc-mbtn{border:1px solid #e4e4e7;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#52525b;font-size:11px}
.foc-mlbl{font-size:13px;font-weight:600;min-width:120px;text-align:center;color:#18181b}
.foc-acts{margin-left:auto;display:flex;align-items:center;gap:10px}
.foc-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.foc-btn:hover{background:#000}
.foc-btn-o{background:#fff;color:#18181b}
.foc-btn-o:hover{background:#f4f4f5}
.foc-btn-upload{background:#059669;border-color:#059669}
.foc-btn-upload:hover{background:#047857}
.foc-btn-upload:disabled{opacity:.6;cursor:wait}

.foc-toast{position:fixed;top:68px;left:50%;transform:translateX(-50%);background:#18181b;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2)}

.foc-body{max-width:720px;margin:0 auto;padding:28px 24px 80px}
.foc-print-header{display:none}
.foc-tables{display:flex;flex-direction:column;gap:28px}
.foc-sec-title{font-size:14px;font-weight:700;color:#18181b;margin-bottom:8px;letter-spacing:.02em}

.foc-tbl{width:100%;border-collapse:collapse;font-size:13px}
.foc-tbl th{text-align:left;padding:8px 10px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#71717a;border-bottom:2px solid #666;background:#fafafa}
.foc-tbl td{padding:6px 10px;border-bottom:1px solid #999}
.foc-num{text-align:right;font-variant-numeric:tabular-nums}
.foc-th-cat{width:40%}
.foc-th-rate{width:18%;text-align:right}
.foc-th-qty{width:20%;text-align:right}
.foc-th-amt{width:22%;text-align:right}
.foc-sub td{font-weight:700;border-top:2px solid #666;border-bottom:none;padding-top:8px}
.foc-in{width:64px;text-align:right;border:1px solid #d4d4d8;border-radius:4px;padding:3px 6px;font-size:13px;font-family:inherit}
.foc-in::-webkit-inner-spin-button,.foc-in::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.foc-in{-moz-appearance:textfield}
.foc-pr{display:none}

.foc-tick{color:#059669;font-weight:700;font-size:12px}
.foc-expandable{cursor:pointer}
.foc-expandable:hover{background:#f9fafb}
.foc-arrow{display:inline-block;width:16px;font-size:10px;color:#a1a1aa}
.foc-detail{display:none}
.foc-detail.foc-detail-open{display:table-row}
.foc-detail td{padding:2px 10px 2px 26px;border-bottom:1px solid #ccc;font-size:11px;color:#71717a}
.foc-detail-desc{font-style:italic}
.foc-detail-qty{font-variant-numeric:tabular-nums}

.foc-bonus{margin-top:8px;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;font-size:12px;font-weight:600;color:#059669}
.foc-bonus-info{margin-top:6px;font-size:11px;color:#a1a1aa}

.foc-result{margin-top:32px;background:#fff;border:2px solid #18181b;border-radius:10px;padding:20px 24px}
.foc-res-tbl{width:100%;border-collapse:collapse}
.foc-res-lb{padding:6px 0;font-size:13px;color:#52525b}
.foc-res-val{padding:6px 0;text-align:right;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.foc-res-total td{font-size:18px;font-weight:800;color:#18181b;padding-top:10px;border-top:2px solid #666}
.foc-res-sm{font-size:11px!important;color:#a1a1aa!important;font-weight:400!important}
.foc-note{margin-top:12px;font-size:11px;color:#a1a1aa;text-align:center}

.foc-log{margin-top:28px}
.foc-log-title{font-size:13px;font-weight:700;color:#18181b;margin-bottom:8px}
.foc-log-tbl{width:100%;border-collapse:collapse;font-size:12px}
.foc-log-tbl th{text-align:left;padding:6px 8px;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#71717a;border-bottom:2px solid #666;background:#fafafa}
.foc-log-tbl td{padding:4px 8px;border-bottom:1px solid #e4e4e7}
.foc-log-tbl th:first-child,.foc-log-tbl td:first-child{width:30px;text-align:center;color:#a1a1aa}
.foc-log-cat{font-weight:600;color:#059669;font-size:11px}

.foc-ref{margin-top:20px;padding:12px 16px;background:#f4f4f5;border-radius:8px}
.foc-ref-title{font-size:12px;font-weight:700;color:#52525b;margin-bottom:2px}
.foc-ref-note{font-size:11px;color:#a1a1aa}

@media print{
  .no-print{display:none!important}
  .foc-root{background:#fff}
  .foc-bar{display:none}
  .foc-body{max-width:none;padding:0 4px 0 0}
  .foc-print-header{display:block;text-align:center;margin-bottom:20px}
  .foc-print-title{font-size:16px;font-weight:700}
  .foc-print-period{font-size:13px;color:#444}
  .foc-print-co{font-size:11px;color:#888;margin-top:2px}
  .foc-pr{display:inline!important}
  .foc-tbl{font-size:11px}
  .foc-tbl th{padding:5px 8px}
  .foc-tbl td{padding:4px 8px}
  .foc-tbl th{border-bottom:2px solid #333!important}
  .foc-tbl td{border-bottom:1px solid #666!important}
  .foc-sub td{border-top:2px solid #333!important}
  .foc-detail{display:table-row!important}
  .foc-detail td{padding:2px 8px 2px 20px;font-size:10px;color:#555;border-bottom:1px solid #999!important}
  .foc-sec-title{font-size:12px;margin-bottom:6px}
  .foc-tables{gap:18px}
  .foc-result{border:2px solid #000!important;border-radius:0;padding:14px 18px;margin-top:18px;margin-right:4px}
  .foc-res-total td{font-size:15px;padding-top:8px}
  .foc-res-lb,.foc-res-val{padding:3px 0;font-size:11px}
  .foc-note{margin-top:8px;font-size:9px}
  .foc-log{margin-top:14px;page-break-before:always}
  .foc-log-title{font-size:11px;margin-bottom:4px}
  .foc-log-tbl{font-size:9px}
  .foc-log-tbl th{padding:3px 6px;border-bottom:2px solid #333!important}
  .foc-log-tbl td{padding:2px 6px;border-bottom:1px solid #666!important}
  @page{size:A4 portrait;margin:15mm}
}
`;

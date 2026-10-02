import { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MON3 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function isPdf(file) {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

async function parsePdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const allRows = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim());

    const rowMap = new Map();
    for (const item of items) {
      const y = Math.round(item.transform[5] * 10) / 10;
      let matched = false;
      for (const [ky] of rowMap) {
        if (Math.abs(ky - y) < 3) { rowMap.get(ky).push(item); matched = true; break; }
      }
      if (!matched) rowMap.set(y, [item]);
    }

    const rows = [...rowMap.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items2] of rows) {
      const sorted = items2.sort((a, b) => a.transform[4] - b.transform[4]);
      allRows.push(sorted.map(i => i.str.trim()));
    }
  }

  return { name: file.name, sheets: { 'PDF': allRows }, sheetNames: ['PDF'] };
}

function parseExcel(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheets = {};
  wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name];
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  });
  return { sheets, sheetNames: wb.SheetNames };
}

function parseFile(file) {
  if (isPdf(file)) return parsePdf(file);
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => {
      try {
        const result = parseExcel(e.target.result);
        res({ name: file.name, ...result });
      } catch (err) { rej(err); }
    };
    r.onerror = () => rej(new Error('Failed to read file'));
    r.readAsArrayBuffer(file);
  });
}

function detectMonth(sheetName) {
  const s = sheetName.toLowerCase().trim();
  for (let i = 0; i < MONTHS.length; i++) {
    if (s.includes(MONTHS[i]) || s.includes(MON3[i])) return i;
  }
  const m = s.match(/\b(0?[1-9]|1[0-2])\b/);
  if (m) return parseInt(m[1]) - 1;
  return -1;
}

function findMatchingSheet(sheetNames, targetMonth) {
  for (const name of sheetNames) {
    if (detectMonth(name) === targetMonth) return name;
  }
  return null;
}

function normalizeVal(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const d = v.getDate(), m = v.getMonth() + 1, y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return String(v).trim();
}

function normalizeAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v).replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function normalizeDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return { d: v.getDate(), m: v.getMonth() + 1, y: v.getFullYear() };
  }
  const s = String(v).trim();
  const parts = s.match(/(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!parts) return null;
  let [, a, b, c] = parts.map(Number);
  if (a > 31) return { d: b, m: c > 12 ? b : c, y: a };
  if (c > 31) return { d: a <= 31 ? a : b, m: a <= 12 && b <= 31 ? a : b, y: c < 100 ? 2000 + c : c };
  return { d: a, m: b, y: c < 100 ? 2000 + c : c };
}

function datesMatch(da, db) {
  if (!da || !db) return da === db;
  if (da.d === db.d && da.m === db.m && da.y === db.y) return true;
  if (da.d === db.m && da.m === db.d && da.y === db.y) return true;
  return false;
}

function detectColumns(rows) {
  let docCol = -1, amtCol = -1, dateCols = [];
  const headerRow = rows.find(r => r.some(c => /xfer-/i.test(String(c)))) ? null : rows[0];

  for (let ri = 0; ri < Math.min(rows.length, 20); ri++) {
    const row = rows[ri];
    for (let ci = 0; ci < row.length; ci++) {
      const v = String(row[ci] || '');
      if (/xfer-/i.test(v) && docCol === -1) docCol = ci;
    }
  }

  if (docCol === -1) {
    for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
      for (let ci = 0; ci < (rows[ri] || []).length; ci++) {
        const v = String(rows[ri][ci] || '').toLowerCase();
        if (/doc|ref|number|no\.?$/i.test(v) && docCol === -1) docCol = ci;
      }
    }
  }

  for (let ri = 0; ri < Math.min(rows.length, 20); ri++) {
    const row = rows[ri];
    for (let ci = 0; ci < row.length; ci++) {
      if (ci === docCol) continue;
      const v = row[ci];
      const numV = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
      if (!isNaN(numV) && numV > 0 && numV < 1e8 && amtCol === -1 && ci !== docCol) amtCol = ci;
      if ((v instanceof Date || /\d{1,4}[/\-.]?\d{1,2}[/\-.]?\d{2,4}/.test(String(v || ''))) && ci !== docCol && ci !== amtCol) {
        if (!dateCols.includes(ci)) dateCols.push(ci);
      }
    }
  }

  if (headerRow) {
    for (let ci = 0; ci < headerRow.length; ci++) {
      const h = String(headerRow[ci] || '').toLowerCase();
      if (/amount|total|sum|rm|amt/i.test(h)) amtCol = ci;
      if (/date/i.test(h) && !dateCols.includes(ci)) dateCols.unshift(ci);
    }
  }

  return { docCol, amtCol, dateCols };
}

function extractRecords(rows, cols) {
  const records = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const docRaw = String(row[cols.docCol] || '').trim();
    if (!docRaw || !/xfer-/i.test(docRaw)) continue;
    const doc = docRaw.toLowerCase();
    const amt = normalizeAmount(row[cols.amtCol]);
    const dates = cols.dateCols.map(ci => ({ ci, raw: normalizeVal(row[ci]), parsed: normalizeDate(row[ci]) }));
    records.push({ ri, doc, amt, dates, raw: row });
  }
  return records;
}

function fmtAmt(v) {
  if (v == null) return '-';
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '-';
  return `${d.d}/${d.m}/${d.y}`;
}

export default function ExcelCompare() {
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [err, setErr] = useState('');
  const [sheetA, setSheetA] = useState('');
  const [sheetB, setSheetB] = useState('');
  const refA = useRef(null);
  const refB = useRef(null);

  const handleFile = async (file, side) => {
    try {
      setErr('');
      const parsed = await parseFile(file);
      if (side === 'a') setDataA(parsed);
      else setDataB(parsed);
    } catch (e) { setErr(`Error reading file: ${e.message}`); }
  };

  const onDrop = (e, side) => {
    e.preventDefault();
    e.currentTarget.classList.remove('xc-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f, side);
  };

  const autoMatch = useMemo(() => {
    if (!dataA || !dataB) return null;
    let sa = sheetA;
    let sb = sheetB;

    if (!sa && dataA.sheetNames.length === 1) sa = dataA.sheetNames[0];
    if (!sa) {
      for (const name of dataA.sheetNames) {
        const mo = detectMonth(name);
        if (mo >= 0) { sa = name; break; }
      }
    }
    if (!sa) sa = dataA.sheetNames[0];

    if (!sb) {
      const mo = detectMonth(sa);
      if (mo >= 0) sb = findMatchingSheet(dataB.sheetNames, mo);
      if (!sb) sb = dataB.sheetNames[0];
    }

    return { sa, sb };
  }, [dataA, dataB, sheetA, sheetB]);

  const result = useMemo(() => {
    if (!dataA || !dataB || !autoMatch) return null;
    const rowsA = dataA.sheets[autoMatch.sa] || [];
    const rowsB = dataB.sheets[autoMatch.sb] || [];

    const colsA = detectColumns(rowsA);
    const colsB = detectColumns(rowsB);

    if (colsA.docCol === -1 || colsB.docCol === -1) {
      return { error: 'Could not find document number column (xfer-...) in one or both files' };
    }

    const recsA = extractRecords(rowsA, colsA);
    const recsB = extractRecords(rowsB, colsB);

    const mapB = new Map();
    recsB.forEach(r => mapB.set(r.doc, r));

    const matched = [];
    const onlyInA = [];
    const usedB = new Set();

    for (const ra of recsA) {
      const rb = mapB.get(ra.doc);
      if (rb) {
        usedB.add(ra.doc);
        const amtMatch = ra.amt === rb.amt;
        const dateDiffs = [];
        const maxDates = Math.max(ra.dates.length, rb.dates.length);
        let dateMatch = true;
        for (let di = 0; di < maxDates; di++) {
          const da = ra.dates[di];
          const db = rb.dates[di];
          if (da && db) {
            if (!datesMatch(da.parsed, db.parsed)) {
              dateMatch = false;
              dateDiffs.push({ colA: da.ci, colB: db.ci, a: da.raw, b: db.raw, pa: da.parsed, pb: db.parsed });
            }
          }
        }
        if (!amtMatch || !dateMatch) {
          matched.push({ doc: ra.doc, a: ra, b: rb, amtMatch, dateMatch, dateDiffs });
        }
      } else {
        onlyInA.push(ra);
      }
    }

    const onlyInB = recsB.filter(r => !usedB.has(r.doc));

    return { matched, onlyInA, onlyInB, totalA: recsA.length, totalB: recsB.length, colsA, colsB };
  }, [dataA, dataB, autoMatch]);

  const clear = () => {
    setDataA(null); setDataB(null); setErr(''); setSheetA(''); setSheetB('');
    if (refA.current) refA.current.value = '';
    if (refB.current) refB.current.value = '';
  };

  const hasDiffs = result && !result.error && (result.matched.length > 0 || result.onlyInA.length > 0 || result.onlyInB.length > 0);
  const noDiffs = result && !result.error && !hasDiffs;

  return (
    <div className="xc-root">
      <style>{CSS}</style>
      <h2 className="xc-title">Excel Compare</h2>
      <p className="xc-sub">Upload two files (Excel or PDF) — matches by document number (xfer-...), compares amount & date</p>

      <div className="xc-uploads">
        <div className={'xc-drop' + (dataA ? ' xc-done' : '')}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('xc-over'); }}
          onDragLeave={e => e.currentTarget.classList.remove('xc-over')}
          onDrop={e => onDrop(e, 'a')}
          onClick={() => refA.current?.click()}>
          <input ref={refA} type="file" accept=".xlsx,.xls,.csv,.pdf" hidden onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0], 'a'); }} />
          <span className="xc-drop-icon">{dataA ? '✅' : '\u{1F4C4}'}</span>
          <span className="xc-drop-label">{dataA ? dataA.name : 'File A'}</span>
          <span className="xc-drop-hint">{dataA ? 'Click to replace' : 'Drop or click to upload'}</span>
        </div>

        <div className="xc-vs">VS</div>

        <div className={'xc-drop' + (dataB ? ' xc-done' : '')}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('xc-over'); }}
          onDragLeave={e => e.currentTarget.classList.remove('xc-over')}
          onDrop={e => onDrop(e, 'b')}
          onClick={() => refB.current?.click()}>
          <input ref={refB} type="file" accept=".xlsx,.xls,.csv,.pdf" hidden onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0], 'b'); }} />
          <span className="xc-drop-icon">{dataB ? '✅' : '\u{1F4C4}'}</span>
          <span className="xc-drop-label">{dataB ? dataB.name : 'File B'}</span>
          <span className="xc-drop-hint">{dataB ? 'Click to replace' : 'Drop or click to upload'}</span>
        </div>
      </div>

      {err && <div className="xc-err">{err}</div>}

      {autoMatch && dataA && dataB && (
        <div className="xc-sheet-pick">
          <div className="xc-sheet-sel">
            <label>File A sheet:</label>
            <select value={autoMatch.sa} onChange={e => setSheetA(e.target.value)}>
              {dataA.sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="xc-sheet-sel">
            <label>File B sheet:</label>
            <select value={autoMatch.sb} onChange={e => setSheetB(e.target.value)}>
              {dataB.sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}

      {result && result.error && <div className="xc-err">{result.error}</div>}

      {noDiffs && (
        <div className="xc-match-ok">
          All {result.totalA} documents match — no differences in amount or date
        </div>
      )}

      {hasDiffs && (
        <>
          <div className="xc-summary">
            <span className="xc-count">
              {result.matched.length > 0 && <span className="xc-tag xc-tag-warn">{result.matched.length} mismatched</span>}
              {result.onlyInA.length > 0 && <span className="xc-tag xc-tag-red">{result.onlyInA.length} only in A</span>}
              {result.onlyInB.length > 0 && <span className="xc-tag xc-tag-blue">{result.onlyInB.length} only in B</span>}
            </span>
            <button className="xc-clear-btn" onClick={clear}>Clear</button>
          </div>

          {result.matched.length > 0 && (
            <div className="xc-section">
              <h3 className="xc-sec-title">Mismatched Documents</h3>
              <div className="xc-tbl-wrap">
                <table className="xc-tbl">
                  <thead><tr><th>Document</th><th>Field</th><th>File A</th><th>File B</th></tr></thead>
                  <tbody>
                    {result.matched.map((m, i) => (
                      <>
                        {!m.amtMatch && (
                          <tr key={`${i}-amt`}>
                            <td className="xc-cell-ref">{m.doc}</td>
                            <td className="xc-field">Amount</td>
                            <td className="xc-val-a">{fmtAmt(m.a.amt)}</td>
                            <td className="xc-val-b">{fmtAmt(m.b.amt)}</td>
                          </tr>
                        )}
                        {m.dateDiffs.map((dd, di) => (
                          <tr key={`${i}-d${di}`}>
                            <td className="xc-cell-ref">{di === 0 && m.amtMatch ? m.doc : ''}</td>
                            <td className="xc-field">Date</td>
                            <td className="xc-val-a">{dd.a || '-'}</td>
                            <td className="xc-val-b">{dd.b || '-'}</td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.onlyInA.length > 0 && (
            <div className="xc-section">
              <h3 className="xc-sec-title">Only in File A (not in B)</h3>
              <div className="xc-tbl-wrap">
                <table className="xc-tbl">
                  <thead><tr><th>Document</th><th>Amount</th><th>Date</th></tr></thead>
                  <tbody>
                    {result.onlyInA.map((r, i) => (
                      <tr key={i}>
                        <td className="xc-cell-ref">{r.doc}</td>
                        <td>{fmtAmt(r.amt)}</td>
                        <td>{r.dates[0]?.raw || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.onlyInB.length > 0 && (
            <div className="xc-section">
              <h3 className="xc-sec-title">Only in File B (not in A)</h3>
              <div className="xc-tbl-wrap">
                <table className="xc-tbl">
                  <thead><tr><th>Document</th><th>Amount</th><th>Date</th></tr></thead>
                  <tbody>
                    {result.onlyInB.map((r, i) => (
                      <tr key={i}>
                        <td className="xc-cell-ref">{r.doc}</td>
                        <td>{fmtAmt(r.amt)}</td>
                        <td>{r.dates[0]?.raw || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const CSS = `
.xc-root{max-width:1000px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif}
.xc-title{font-size:22px;font-weight:700;margin:0 0 4px;color:#18181b}
.xc-sub{font-size:14px;color:#71717a;margin:0 0 24px}
.xc-uploads{display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.xc-drop{flex:1;min-width:200px;border:2px dashed #d4d4d8;border-radius:12px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:6px}
.xc-drop:hover,.xc-over{border-color:#3b82f6;background:#eff6ff}
.xc-done{border-color:#22c55e;border-style:solid;background:#f0fdf4}
.xc-drop-icon{font-size:28px}
.xc-drop-label{font-size:14px;font-weight:600;color:#18181b;word-break:break-all}
.xc-drop-hint{font-size:12px;color:#a1a1aa}
.xc-vs{font-size:18px;font-weight:700;color:#a1a1aa}
.xc-err{background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px}
.xc-sheet-pick{display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.xc-sheet-sel{display:flex;align-items:center;gap:8px;font-size:13px}
.xc-sheet-sel label{font-weight:600;color:#52525b}
.xc-sheet-sel select{padding:5px 10px;border:1px solid #d4d4d8;border-radius:6px;font-size:13px;font-family:inherit;background:#fff}
.xc-match-ok{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:8px;padding:16px;font-size:15px;font-weight:600;text-align:center}
.xc-summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.xc-count{display:flex;gap:8px;flex-wrap:wrap}
.xc-tag{padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600}
.xc-tag-warn{background:#fef3c7;color:#92400e}
.xc-tag-red{background:#fef2f2;color:#b91c1c}
.xc-tag-blue{background:#eff6ff;color:#1d4ed8}
.xc-clear-btn{padding:6px 14px;border:1px solid #fecaca;border-radius:6px;background:#fff;color:#dc2626;font-size:13px;cursor:pointer;font-family:inherit}
.xc-clear-btn:hover{background:#fef2f2}
.xc-section{margin-bottom:24px}
.xc-sec-title{font-size:15px;font-weight:700;margin:0 0 8px;color:#18181b}
.xc-tbl-wrap{max-height:50vh;overflow:auto;border:1px solid #e4e4e7;border-radius:8px}
.xc-tbl{width:100%;border-collapse:collapse;font-size:13px}
.xc-tbl th{background:#f4f4f5;padding:8px 12px;text-align:left;font-weight:600;position:sticky;top:0;border-bottom:1px solid #e4e4e7}
.xc-tbl td{padding:6px 12px;border-bottom:1px solid #f4f4f5}
.xc-cell-ref{font-weight:600;color:#18181b;font-family:monospace;white-space:nowrap;font-size:12px}
.xc-field{font-weight:600;color:#71717a;font-size:12px}
.xc-val-a{background:#fef2f2;color:#b91c1c;font-weight:600}
.xc-val-b{background:#f0fdf4;color:#15803d;font-weight:600}
`;

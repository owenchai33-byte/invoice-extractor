import { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';

const fmt = v => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v).trim();
};

function parseFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheets = {};
        wb.SheetNames.forEach(name => {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          sheets[name] = json;
        });
        res({ name: file.name, sheets, sheetNames: wb.SheetNames });
      } catch (err) { rej(err); }
    };
    r.onerror = () => rej(new Error('Failed to read file'));
    r.readAsArrayBuffer(file);
  });
}

function diffSheets(a, b) {
  const maxR = Math.max(a.length, b.length);
  const diffs = [];
  for (let r = 0; r < maxR; r++) {
    const rowA = a[r] || [];
    const rowB = b[r] || [];
    const maxC = Math.max(rowA.length, rowB.length);
    for (let c = 0; c < maxC; c++) {
      const va = fmt(rowA[c]);
      const vb = fmt(rowB[c]);
      if (va !== vb) diffs.push({ r, c, a: va, b: vb });
    }
  }
  return diffs;
}

function colLabel(c) {
  let s = '';
  let n = c;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

export default function ExcelCompare() {
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [sheet, setSheet] = useState('');
  const [err, setErr] = useState('');
  const [view, setView] = useState('diff');
  const refA = useRef(null);
  const refB = useRef(null);

  const handleFile = async (file, side) => {
    try {
      setErr('');
      const parsed = await parseFile(file);
      if (side === 'a') { setFileA(file); setDataA(parsed); }
      else { setFileB(file); setDataB(parsed); }
    } catch (e) { setErr(`Error reading file: ${e.message}`); }
  };

  const onDrop = (e, side) => {
    e.preventDefault();
    e.currentTarget.classList.remove('xc-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f, side);
  };

  const allSheets = useMemo(() => {
    if (!dataA || !dataB) return [];
    const set = new Set([...dataA.sheetNames, ...dataB.sheetNames]);
    return [...set];
  }, [dataA, dataB]);

  const activeSheet = sheet || allSheets[0] || '';

  const result = useMemo(() => {
    if (!dataA || !dataB || !activeSheet) return null;
    const a = dataA.sheets[activeSheet] || [];
    const b = dataB.sheets[activeSheet] || [];
    const diffs = diffSheets(a, b);
    const diffSet = new Set(diffs.map(d => `${d.r},${d.c}`));
    const onlyA = dataA.sheetNames.filter(s => !dataB.sheetNames.includes(s));
    const onlyB = dataB.sheetNames.filter(s => !dataA.sheetNames.includes(s));
    return { a, b, diffs, diffSet, onlyA, onlyB };
  }, [dataA, dataB, activeSheet]);

  const clear = () => {
    setFileA(null); setFileB(null); setDataA(null); setDataB(null);
    setSheet(''); setErr(''); setView('diff');
    if (refA.current) refA.current.value = '';
    if (refB.current) refB.current.value = '';
  };

  return (
    <div className="xc-root">
      <style>{CSS}</style>
      <h2 className="xc-title">Excel Compare</h2>
      <p className="xc-sub">Upload two Excel files to compare and highlight differences</p>

      <div className="xc-uploads">
        <div className={'xc-drop' + (dataA ? ' xc-done' : '')}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('xc-over'); }}
          onDragLeave={e => e.currentTarget.classList.remove('xc-over')}
          onDrop={e => onDrop(e, 'a')}
          onClick={() => refA.current?.click()}>
          <input ref={refA} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0], 'a'); }} />
          <span className="xc-drop-icon">{dataA ? '✅' : '\u{1F4C4}'}</span>
          <span className="xc-drop-label">{dataA ? dataA.name : 'File A (Original)'}</span>
          <span className="xc-drop-hint">{dataA ? 'Click to replace' : 'Drop or click to upload'}</span>
        </div>

        <div className="xc-vs">VS</div>

        <div className={'xc-drop' + (dataB ? ' xc-done' : '')}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('xc-over'); }}
          onDragLeave={e => e.currentTarget.classList.remove('xc-over')}
          onDrop={e => onDrop(e, 'b')}
          onClick={() => refB.current?.click()}>
          <input ref={refB} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0], 'b'); }} />
          <span className="xc-drop-icon">{dataB ? '✅' : '\u{1F4C4}'}</span>
          <span className="xc-drop-label">{dataB ? dataB.name : 'File B (Revised)'}</span>
          <span className="xc-drop-hint">{dataB ? 'Click to replace' : 'Drop or click to upload'}</span>
        </div>
      </div>

      {err && <div className="xc-err">{err}</div>}

      {result && (
        <>
          {allSheets.length > 1 && (
            <div className="xc-sheets">
              {allSheets.map(s => (
                <button key={s} className={'xc-sheet-btn' + (activeSheet === s ? ' xc-sheet-on' : '') + (result.onlyA.includes(s) || result.onlyB.includes(s) ? ' xc-sheet-only' : '')}
                  onClick={() => setSheet(s)}>
                  {s}
                  {result.onlyA.includes(s) && <span className="xc-badge">A only</span>}
                  {result.onlyB.includes(s) && <span className="xc-badge">B only</span>}
                </button>
              ))}
            </div>
          )}

          <div className="xc-summary">
            <span className="xc-count">{result.diffs.length === 0 ? 'No differences found' : `${result.diffs.length} difference${result.diffs.length > 1 ? 's' : ''} found`}</span>
            <div className="xc-actions">
              <button className={'xc-view-btn' + (view === 'diff' ? ' xc-view-on' : '')} onClick={() => setView('diff')}>Differences</button>
              <button className={'xc-view-btn' + (view === 'side' ? ' xc-view-on' : '')} onClick={() => setView('side')}>Side by Side</button>
              <button className="xc-clear-btn" onClick={clear}>Clear</button>
            </div>
          </div>

          {view === 'diff' && result.diffs.length > 0 && (
            <div className="xc-tbl-wrap">
              <table className="xc-tbl">
                <thead><tr><th>Cell</th><th>File A</th><th>File B</th></tr></thead>
                <tbody>
                  {result.diffs.map((d, i) => (
                    <tr key={i}>
                      <td className="xc-cell-ref">{colLabel(d.c)}{d.r + 1}</td>
                      <td className="xc-val-a">{d.a || <span className="xc-empty">(empty)</span>}</td>
                      <td className="xc-val-b">{d.b || <span className="xc-empty">(empty)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'side' && (
            <div className="xc-side">
              {['a', 'b'].map(side => {
                const rows = side === 'a' ? result.a : result.b;
                const label = side === 'a' ? (dataA?.name || 'File A') : (dataB?.name || 'File B');
                const maxC = Math.max(...rows.map(r => r.length), 0);
                return (
                  <div key={side} className="xc-side-panel">
                    <div className="xc-side-title">{label}</div>
                    <div className="xc-side-scroll">
                      <table className="xc-tbl xc-tbl-grid">
                        <thead><tr><th></th>{Array.from({ length: maxC }, (_, i) => <th key={i}>{colLabel(i)}</th>)}</tr></thead>
                        <tbody>
                          {rows.map((row, ri) => (
                            <tr key={ri}>
                              <td className="xc-row-num">{ri + 1}</td>
                              {Array.from({ length: maxC }, (_, ci) => {
                                const isDiff = result.diffSet.has(`${ri},${ci}`);
                                return <td key={ci} className={isDiff ? 'xc-hl' : ''}>{fmt(row[ci])}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const CSS = `
.xc-root{max-width:1200px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif}
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
.xc-sheets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.xc-sheet-btn{padding:6px 14px;border:1px solid #e4e4e7;border-radius:6px;background:#fff;font-size:13px;cursor:pointer;font-family:inherit}
.xc-sheet-btn:hover{background:#f4f4f5}
.xc-sheet-on{background:#18181b;color:#fff;border-color:#18181b}
.xc-sheet-only{border-color:#f59e0b}
.xc-badge{font-size:10px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px;margin-left:6px}
.xc-summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.xc-count{font-size:15px;font-weight:600;color:#18181b}
.xc-actions{display:flex;gap:6px}
.xc-view-btn{padding:6px 14px;border:1px solid #e4e4e7;border-radius:6px;background:#fff;font-size:13px;cursor:pointer;font-family:inherit}
.xc-view-btn:hover{background:#f4f4f5}
.xc-view-on{background:#18181b;color:#fff;border-color:#18181b}
.xc-clear-btn{padding:6px 14px;border:1px solid #fecaca;border-radius:6px;background:#fff;color:#dc2626;font-size:13px;cursor:pointer;font-family:inherit}
.xc-clear-btn:hover{background:#fef2f2}
.xc-tbl-wrap{max-height:60vh;overflow:auto;border:1px solid #e4e4e7;border-radius:8px}
.xc-tbl{width:100%;border-collapse:collapse;font-size:13px}
.xc-tbl th{background:#f4f4f5;padding:8px 12px;text-align:left;font-weight:600;position:sticky;top:0;border-bottom:1px solid #e4e4e7}
.xc-tbl td{padding:6px 12px;border-bottom:1px solid #f4f4f5}
.xc-cell-ref{font-weight:700;color:#3b82f6;font-family:monospace;white-space:nowrap}
.xc-val-a{background:#fef2f2;color:#b91c1c}
.xc-val-b{background:#f0fdf4;color:#15803d}
.xc-empty{color:#d4d4d8;font-style:italic}
.xc-side{display:flex;gap:16px;overflow:hidden}
.xc-side-panel{flex:1;min-width:0;display:flex;flex-direction:column}
.xc-side-title{font-size:13px;font-weight:700;padding:8px 0;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xc-side-scroll{overflow:auto;max-height:60vh;border:1px solid #e4e4e7;border-radius:8px}
.xc-tbl-grid td,.xc-tbl-grid th{padding:4px 8px;white-space:nowrap;font-size:12px;min-width:60px}
.xc-row-num{color:#a1a1aa;font-size:11px;text-align:right;min-width:30px;font-family:monospace}
.xc-hl{background:#fef9c3!important;outline:2px solid #eab308;outline-offset:-1px}
`;

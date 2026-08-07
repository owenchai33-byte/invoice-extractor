import { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

async function parsePBBStatement(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const allTxns = [];

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
    let currentDate = '';
    let pendingTxn = null;
    let attachToLast = false;

    const flushTxn = () => { if (pendingTxn) { allTxns.push(pendingTxn); pendingTxn = null; } };
    const isJunk = (s) => /computer generated statement|terima kasih|thank you for banking|privacy notice|notis privasi|excellence is our commitment|perhatian|attention/i.test(s);

    for (const [, rowItems] of rows) {
      const sorted = rowItems.sort((a, b) => a.transform[4] - b.transform[4]);
      let date = '', text = '', debit = '', credit = '', balance = '';

      for (const item of sorted) {
        const x = item.transform[4];
        const v = item.str.trim();
        if (x < 80) date = v;
        else if (x < 300) text = text ? text + ' ' + v : v;
        else if (x < 375) debit = v;
        else if (x < 460) credit = v;
        else balance = v;
      }

      if (/^(TARIKH|DATE)$/i.test(text) || /^(URUS NIAGA|TRANSACTION)$/i.test(text)) continue;
      if (/DEBIT|KREDIT|CREDIT|BAKI|BALANCE/i.test(text) && !date && !debit && !credit) continue;

      if (/balance (from last|b\/f)/i.test(text)) {
        currentDate = date || currentDate;
        attachToLast = true;
        continue;
      }
      if (/balance c\/f/i.test(text)) { flushTxn(); continue; }

      if (date && /^\d{2}\/\d{2}$/.test(date)) currentDate = date;

      const hasAmount = debit || credit;

      if (hasAmount) {
        attachToLast = false;
        flushTxn();
        const parseAmt = (s) => { if (!s) return 0; return parseFloat(s.replace(/,/g, '')) || 0; };
        pendingTxn = {
          date: currentDate,
          description: text,
          debit: parseAmt(debit),
          credit: parseAmt(credit),
          balance: balance.replace(/,/g, ''),
          page: p,
        };
      } else if (text && pendingTxn) {
        if (!isJunk(text)) pendingTxn.description += '\n' + text;
      } else if (text && !pendingTxn && attachToLast && allTxns.length > 0) {
        if (!isJunk(text)) allTxns[allTxns.length - 1].description += '\n' + text;
      }
    }
    flushTxn();
  }
  return { txns: allTxns, numPages: pdf.numPages };
}

function classifyBankTxns(txns) {
  const toKeyed = [];
  const onlineTransfers = [];
  const depCash = [];

  const TO_KEYED_PATTERNS = [/PROCESS FEE/i, /HANDLING CHARGE/i, /AUDIT CONFIRMATION/i, /AUTOMATED LOAN/i];
  const ONLINE_PATTERNS = [/DUITNOW QR CR/i, /TSFR FUND CR/i, /DUITNOW CR/i, /IBG CR/i, /IBFT CR/i, /TRSF/i];

  for (const txn of txns) {
    const desc = txn.description.split('\n')[0];

    if (TO_KEYED_PATTERNS.some(p => p.test(desc))) {
      const type = /AUTOMATED LOAN/i.test(desc) ? 'Loan Payment' : 'Bank Charge';
      toKeyed.push({ ...txn, type });
    }

    if (txn.credit > 0 && ONLINE_PATTERNS.some(p => p.test(desc))) {
      onlineTransfers.push(txn);
    }

    if (/DEP-CASH/i.test(desc) && txn.credit > 0) {
      depCash.push(txn);
    }
  }

  return { toKeyed, onlineTransfers, depCash };
}

function groupByDate(items) {
  const groups = [];
  let current = null;
  items.forEach((t, i) => {
    if (!current || current.date !== t.date) {
      current = { date: t.date, items: [] };
      groups.push(current);
    }
    current.items.push({ txn: t, idx: i });
  });
  return groups;
}

const ONLINE_STRIP = [/^DUITNOW QR CR\s*/i, /^TSFR FUND CR\s*/i, /^DUITNOW CR\s*/i, /^IBG CR\s*/i, /^IBFT CR\s*/i, /^TRSF\s*/i];
const OWN_COMPANY = /CHAI JEE KIONG TRADING\s*(SDN\.?\s*BHD\.?|SB\.?)?/i;
function cleanQR(text) {
  return text
    .replace(/\bDUITQR MCHT TRANSFER\b/gi, '')
    .replace(/\bDUITNOW QR \w+\b/gi, '')
    .replace(/\bQR PAYMENT\b/gi, '')
    .replace(/\bQR PYMT\b/gi, '')
    .replace(/\bTRANSFER\b/gi, '')
    .replace(/\bQR\b/gi, '')
    .replace(/\b0{3,}(\d+)\b/g, '$1')
    .replace(/\b0{3,}\b/g, '')
    .replace(/[\s\-]+/g, ' ')
    .trim();
}
function shortDesc(desc) {
  const lines = desc.split('\n');
  const first = lines[0];
  for (const p of ONLINE_STRIP) {
    const r = first.replace(p, '');
    if (r !== first) {
      const ref = r.trim();
      const name = lines.slice(1).map(l => l.trim()).filter(Boolean).filter(l => !OWN_COMPANY.test(l)).join(' ');
      const raw = ref && name ? ref + ' ' + name : name || ref || first;
      return cleanQR(raw) || first;
    }
  }
  return first;
}

const CSS = `
.br-root{background:#fafafa;height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.br-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.br-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b}
.br-body{margin:0;padding:24px 48px;flex:1;overflow-y:auto}
.br-upload-area{max-width:480px;margin:0 auto 24px}
.br-upload{border:2px dashed #d4d4d8;border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all .15s}
.br-upload:hover{border-color:#2563eb;background:#eff6ff}
.br-upload.drag{border-color:#2563eb;background:#eff6ff}
.br-icon{font-size:32px;margin-bottom:8px}
.br-label{font-size:13px;font-weight:600;color:#18181b}
.br-hint{font-size:11px;color:#a1a1aa;margin-top:4px}
.br-privacy{font-size:10px;color:#a1a1aa;margin-top:8px;text-align:center}
.br-summary{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between}
.br-summary-left{flex:1}
.br-summary-title{font-size:13px;font-weight:700;color:#166534;margin:0 0 8px}
.br-summary-info{font-size:12px;color:#15803d;margin:0 0 4px}
.br-upload-new{padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #d4d4d8;background:#fff;color:#18181b}
.br-upload-new:hover{background:#f4f4f5}
.br-tabs{display:flex;gap:0;border-bottom:2px solid #e4e4e7;margin-bottom:16px}
.br-tab{padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:none;color:#71717a;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
.br-tab:hover{color:#18181b;background:#f4f4f5}
.br-tab.active{color:#18181b;border-bottom-color:#18181b}
.br-tab-count{font-size:11px;color:#a1a1aa;font-weight:400;margin-left:4px}
.br-section{border:1px solid #e4e4e7;border-radius:8px;overflow:hidden}
.br-body-inner{padding:14px 16px}
.br-table{width:100%;border-collapse:collapse;font-size:11px}
.br-table th{text-align:left;padding:6px 8px;border-bottom:2px solid #d4d4d8;font-weight:700;white-space:nowrap}
.br-table td{padding:6px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top}
.br-table tr:last-child td{border-bottom:none}
.br-amt{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}
.br-total{font-weight:700;background:#f0fdf4;font-size:12px}
.br-total td{padding:8px;border-top:2px solid #15803d}
.br-check{width:14px;height:14px;cursor:pointer;accent-color:#18181b}
.br-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.br-tag.charge{background:#eff6ff;color:#2563eb}
.br-tag.loan{background:#fef2f2;color:#dc2626}
.br-desc{position:relative;max-width:340px;cursor:default}
.br-desc:hover .br-tip{display:block}
.br-tip{display:none;position:absolute;right:0;top:100%;z-index:100;background:#18181b;color:#fff;padding:8px 12px;border-radius:6px;font-size:11px;white-space:pre-line;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,.15);pointer-events:none;line-height:1.5}
.br-daily{background:#eff6ff;font-weight:700;font-size:12px;border-left:2px solid #2563eb;color:#1e40af}
.br-daily.loan{background:#fef2f2;border-left-color:#dc2626;color:#dc2626}
.br-daily.mixed{background:#f5f5f4;border-left-color:#a1a1aa}
.br-clear{padding:8px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;border:2px solid #dc2626;background:#fef2f2;color:#dc2626;margin-left:auto}
.br-clear:hover{background:#dc2626;color:#fff}
.br-page{color:#71717a;font-size:11px}
.br-count{font-size:11px;color:#71717a;font-weight:400;margin-left:6px}
.br-error{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#dc2626}
.br-loading{font-size:12px;color:#71717a;margin:12px 0}
.br-btn{padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:#18181b;color:#fff;margin-top:8px}
.br-btn:hover{background:#27272a}
.br-dh{cursor:pointer;user-select:none;border-top:2px solid #18181b}
.br-dh:first-child{border-top:none}
.br-dh:hover{background:#f4f4f5}
.br-dh td{padding:8px;font-weight:700;font-size:12px;vertical-align:middle}
.br-dh .br-arrow{display:inline-block;width:14px;font-size:10px;color:#71717a;margin-right:4px;transition:transform .15s}
.br-dh .br-arrow.open{transform:rotate(90deg)}
.br-dh-count{font-size:10px;color:#71717a;font-weight:400;margin-left:8px}
@media print{.br-root{display:none}}
`;

const LS_BR = 'br_saved';
function loadSaved() {
  try { const s = localStorage.getItem(LS_BR); if (s) return JSON.parse(s); } catch {} return null;
}

export default function BankRecon() {
  const saved = useRef(loadSaved());
  const [result, setResult] = useState(saved.current?.result || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [excluded, setExcluded] = useState(() => new Set(saved.current?.excluded || []));
  const [collapsed, setCollapsed] = useState(() => new Set(saved.current?.collapsed || []));
  const [activeTab, setActiveTab] = useState('toKeyed');
  const fileRef = useRef(null);

  useEffect(() => {
    if (result) {
      localStorage.setItem(LS_BR, JSON.stringify({ result, excluded: [...excluded], collapsed: [...collapsed] }));
    }
  }, [result, excluded, collapsed]);

  const clearAll = () => {
    localStorage.removeItem(LS_BR);
    setResult(null);
    setExcluded(new Set());
    setCollapsed(new Set());
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    setExcluded(new Set());
    setCollapsed(new Set());
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const { txns, numPages } = await parsePBBStatement(buf);
      if (!txns.length) {
        setError('No transactions found in this PDF. Make sure it is a Public Bank statement.');
      } else {
        const classified = classifyBankTxns(txns);
        setResult({ txns, ...classified, totalTxns: txns.length, totalPages: numPages });
      }
    } catch (err) {
      setError('Could not read PDF: ' + (err.message || 'unknown error'));
    }
    setLoading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const toggleExclude = (idx) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleCollapse = (dateKey) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  };

  const fmtAmt = (n) => n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  const onlineTotal = result ? result.onlineTransfers.reduce((s, t, i) => s + (excluded.has(i) ? 0 : t.credit), 0) : 0;

  return (
    <div className="br-root">
      <style>{CSS}</style>
      <div className="br-bar">
        <h1>BANK RECONCILIATION</h1>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 400 }}>Upload Public Bank statement · All processing in browser · Nothing sent to server</span>
        {result && <button className="br-clear" onClick={() => { if (window.confirm('Clear all bank recon data? This cannot be undone.')) clearAll(); }}>Clear All Data</button>}
      </div>
      <div className="br-body">
        {!result && (
          <div className="br-upload-area">
            <div
              className={`br-upload${dragging ? ' drag' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <div className="br-icon">🏦</div>
              <div className="br-label">Click to upload or drag & drop</div>
              <div className="br-hint">Public Bank statement PDF</div>
            </div>
            <div className="br-privacy">🔒 100% browser-side — your bank data never leaves this device</div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
        />

        {loading && <div className="br-loading">Reading bank statement...</div>}
        {error && <div className="br-error">{error}</div>}

        {result && (
          <>
            <div className="br-summary">
              <div className="br-summary-left">
                <div className="br-summary-title">Statement parsed</div>
                <div className="br-summary-info">{result.totalTxns} transactions across {result.totalPages} pages</div>
                <div className="br-summary-info">
                  Found: {result.toKeyed.length} to key · {result.onlineTransfers.length} POS DuitNow · {result.depCash.length} cash deposits
                </div>
              </div>
              <button className="br-upload-new" onClick={() => fileRef.current?.click()}>Upload new</button>
            </div>

            <div className="br-tabs">
              <button className={`br-tab${activeTab==='toKeyed'?' active':''}`} onClick={()=>setActiveTab('toKeyed')}>To Key<span className="br-tab-count">({result.toKeyed.length})</span></button>
              <button className={`br-tab${activeTab==='online'?' active':''}`} onClick={()=>setActiveTab('online')}>POS DuitNow<span className="br-tab-count">({result.onlineTransfers.length})</span></button>
              <button className={`br-tab${activeTab==='depCash'?' active':''}`} onClick={()=>setActiveTab('depCash')}>Cash Deposits<span className="br-tab-count">({result.depCash.length})</span></button>
            </div>

            {activeTab==='toKeyed' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.toKeyed.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No bank charges or loan payments found</div>
                  ) : (() => {
                    const _tkHelp = <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Captures DEBIT matching PROCESS FEE, HANDLING CHARGE, AUDIT CONFIRMATION, AUTOMATED LOAN. <span style={{color:'#2563eb'}}>Charges in blue</span>, <span style={{color:'#dc2626'}}>Loan in red</span>.</div>;
                    const groups = groupByDate(result.toKeyed);
                    const chargeTotal = result.toKeyed.filter(t => t.type !== 'Loan Payment').reduce((s, t) => s + (t.debit || t.credit || 0), 0);
                    const loanTotal = result.toKeyed.filter(t => t.type === 'Loan Payment').reduce((s, t) => s + (t.debit || t.credit || 0), 0);
                    return (<>
                    {_tkHelp}
                    <table className="br-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Pg</th><th className="br-amt">Debit</th><th className="br-amt">Daily Total</th></tr></thead>
                      <tbody>
                        {groups.map(g => {
                          const ck = 'tk_' + g.date;
                          const isCollapsed = collapsed.has(ck);
                          const loanAmt = g.items.filter(({txn}) => txn.type === 'Loan Payment').reduce((s, {txn}) => s + (txn.debit || txn.credit || 0), 0);
                          const chargeAmt = g.items.filter(({txn}) => txn.type !== 'Loan Payment').reduce((s, {txn}) => s + (txn.debit || txn.credit || 0), 0);
                          const hasLoan = loanAmt > 0;
                          const hasCharge = chargeAmt > 0;
                          const dailyCell = hasLoan && hasCharge ? (
                            <>
                              <div style={{color:'#dc2626',fontSize:11,lineHeight:'1.4'}}>L {fmtAmt(loanAmt)}</div>
                              <div style={{color:'#2563eb',fontSize:11,lineHeight:'1.4',borderTop:'1px dashed #d4d4d8',marginTop:2,paddingTop:2}}>C {fmtAmt(chargeAmt)}</div>
                            </>
                          ) : fmtAmt(loanAmt + chargeAmt);
                          const dailyClass = 'br-amt br-daily' + (hasLoan && hasCharge ? ' mixed' : hasLoan ? ' loan' : '');
                          return isCollapsed ? (
                            <tr key={ck} className="br-dh" onClick={() => toggleCollapse(ck)}>
                              <td><span className="br-arrow">▶</span>{g.date}</td>
                              <td colSpan={3}><span className="br-dh-count">{g.items.length} transactions</span></td>
                              <td className="br-amt">{fmtAmt(loanAmt + chargeAmt)}</td>
                              <td className={dailyClass}>{dailyCell}</td>
                            </tr>
                          ) : (
                            g.items.map(({txn: t, idx: i}, j) => {
                              const isLoan = t.type === 'Loan Payment';
                              const isMixed = hasLoan && hasCharge;
                              const isFirstOfType = j === g.items.findIndex(({txn: x}) => (x.type === 'Loan Payment') === isLoan);
                              let dtClass = 'br-amt br-daily';
                              let dtContent = null;
                              if (isMixed) {
                                dtClass += isLoan ? ' loan' : '';
                                if (isFirstOfType) dtContent = (isLoan ? 'L ' : 'C ') + fmtAmt(isLoan ? loanAmt : chargeAmt);
                              } else {
                                if (hasLoan) dtClass += ' loan';
                                if (j === 0) dtContent = fmtAmt(loanAmt + chargeAmt);
                              }
                              return (
                              <tr key={i} style={{ background: isLoan ? '#fef2f2' : '#eff6ff' }}>
                                <td style={{ whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => toggleCollapse(ck)}>{j === 0 && <span className="br-arrow open">▶</span>}{t.date}</td>
                                <td className="br-desc">{t.description}</td>
                                <td><span className={`br-tag ${isLoan ? 'loan' : 'charge'}`}>{t.type}</span></td>
                                <td className="br-page">p{t.page}</td>
                                <td className="br-amt">{fmtAmt(t.debit || t.credit)}</td>
                                <td className={dtClass}>{dtContent}</td>
                              </tr>);
                            })
                          );
                        })}
                        <tr className="br-total">
                          <td colSpan={4}>Bank Charges Total</td>
                          <td className="br-amt">{fmtAmt(chargeTotal)}</td>
                          <td></td>
                        </tr>
                        {loanTotal > 0 && <tr className="br-total">
                          <td colSpan={4}>Loan Payments Total</td>
                          <td className="br-amt">{fmtAmt(loanTotal)}</td>
                          <td></td>
                        </tr>}
                      </tbody>
                    </table></>);
                  })()}
                </div>
              </div>
            )}

            {activeTab==='online' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.onlineTransfers.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No POS DuitNow transfers found</div>
                  ) : (() => {
                    const groups = groupByDate(result.onlineTransfers);
                    return (
                    <>
                      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Extracts every CREDIT matching DUITNOW QR CR, TSFR FUND CR etc. Untick non-retail to exclude from total.</div>
                      <table className="br-table">
                        <thead><tr><th style={{ width: 28 }}>✓</th><th>Date</th><th>Description</th><th>Pg</th><th className="br-amt">Amount</th><th className="br-amt">Daily Total</th></tr></thead>
                        <tbody>
                          {groups.map(g => {
                            const ck = 'on_' + g.date;
                            const isCollapsed = collapsed.has(ck);
                            const tickedCount = g.items.filter(({idx}) => !excluded.has(idx)).length;
                            const dailyTotal = g.items.reduce((s, {txn, idx}) => s + (excluded.has(idx) ? 0 : txn.credit), 0);
                            return isCollapsed ? (
                              <tr key={ck} className="br-dh" onClick={() => toggleCollapse(ck)}>
                                <td colSpan={2}><span className="br-arrow">▶</span>{g.date}</td>
                                <td colSpan={2}><span className="br-dh-count">{tickedCount} of {g.items.length} ticked</span></td>
                                <td className="br-amt">{fmtAmt(dailyTotal)}</td>
                                <td className="br-amt br-daily">{fmtAmt(dailyTotal)}</td>
                              </tr>
                            ) : (
                              g.items.map(({txn: t, idx: i}, j) => (
                                <tr key={i} style={excluded.has(i) ? { opacity: 0.4, textDecoration: 'line-through' } : {}}>
                                  <td><input type="checkbox" className="br-check" checked={!excluded.has(i)} onChange={() => toggleExclude(i)} /></td>
                                  <td style={{ whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => toggleCollapse(ck)}>{j === 0 && <span className="br-arrow open">▶</span>}{t.date}</td>
                                  <td className="br-desc">{shortDesc(t.description)}<div className="br-tip">{t.description.split('\n').filter(l => !OWN_COMPANY.test(l)).join('\n')}</div></td>
                                  <td className="br-page">p{t.page}</td>
                                  <td className="br-amt">{fmtAmt(t.credit)}</td>
                                  <td className="br-amt br-daily">{j === 0 && fmtAmt(dailyTotal)}</td>
                                </tr>
                              ))
                            );
                          })}
                          <tr className="br-total">
                            <td colSpan={4}>Total ({result.onlineTransfers.length - excluded.size} of {result.onlineTransfers.length} included)</td>
                            <td className="br-amt">{fmtAmt(onlineTotal)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </>);
                  })()}
                </div>
              </div>
            )}

            {activeTab==='depCash' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.depCash.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No DEP-CASH entries found</div>
                  ) : (() => {
                    const groups = groupByDate(result.depCash);
                    return (<>
                    <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Captures every CREDIT matching DEP-CASH.</div>
                    <table className="br-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Pg</th><th className="br-amt">Amount</th><th className="br-amt">Daily Total</th></tr></thead>
                      <tbody>
                        {groups.map(g => {
                          const ck = 'dc_' + g.date;
                          const isCollapsed = collapsed.has(ck);
                          const dailyTotal = g.items.reduce((s, {txn}) => s + txn.credit, 0);
                          return isCollapsed ? (
                            <tr key={ck} className="br-dh" onClick={() => toggleCollapse(ck)}>
                              <td><span className="br-arrow">▶</span>{g.date}</td>
                              <td colSpan={2}><span className="br-dh-count">{g.items.length} deposits</span></td>
                              <td className="br-amt">{fmtAmt(dailyTotal)}</td>
                              <td className="br-amt br-daily">{fmtAmt(dailyTotal)}</td>
                            </tr>
                          ) : (
                            g.items.map(({txn: t, idx: i}, j) => (
                              <tr key={i}>
                                <td style={{ whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => toggleCollapse(ck)}>{j === 0 && <span className="br-arrow open">▶</span>}{t.date}</td>
                                <td className="br-desc">{t.description}</td>
                                <td className="br-page">p{t.page}</td>
                                <td className="br-amt">{fmtAmt(t.credit)}</td>
                                <td className="br-amt br-daily">{j === 0 && fmtAmt(dailyTotal)}</td>
                              </tr>
                            ))
                          );
                        })}
                        <tr className="br-total">
                          <td colSpan={3}>Total ({result.depCash.length} deposits)</td>
                          <td className="br-amt">{fmtAmt(result.depCash.reduce((s, t) => s + t.credit, 0))}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table></>);
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

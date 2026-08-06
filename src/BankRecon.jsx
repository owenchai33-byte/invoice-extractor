import { useState, useRef } from 'react';
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

    const flushTxn = () => { if (pendingTxn) { allTxns.push(pendingTxn); pendingTxn = null; } };

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
        continue;
      }
      if (/balance c\/f/i.test(text)) { flushTxn(); continue; }

      if (date && /^\d{2}\/\d{2}$/.test(date)) currentDate = date;

      const hasAmount = debit || credit;

      if (hasAmount) {
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
        if (!/computer generated statement/i.test(text)) pendingTxn.description += '\n' + text;
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
  const ONLINE_PATTERNS = [/DUITNOW QR CR/i, /TSFR FUND CR/i, /DUITNOW CR/i, /IBG CR/i, /IBFT CR/i];

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
.br-summary{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px}
.br-summary-title{font-size:13px;font-weight:700;color:#166534;margin:0 0 8px}
.br-summary-info{font-size:12px;color:#15803d;margin:0 0 4px}
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
.br-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600}
.br-tag.charge{background:#fef2f2;color:#dc2626}
.br-tag.loan{background:#eff6ff;color:#2563eb}
.br-desc{white-space:pre-line;max-width:340px}
.br-daily{background:#f8fafc;font-weight:600;vertical-align:middle!important;border-left:2px solid #e4e4e7}
.br-page{color:#71717a;font-size:10px}
.br-count{font-size:11px;color:#71717a;font-weight:400;margin-left:6px}
.br-error{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#dc2626}
.br-loading{font-size:12px;color:#71717a;margin:12px 0}
.br-btn{padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:#18181b;color:#fff;margin-top:8px}
.br-btn:hover{background:#27272a}
@media print{.br-root{display:none}}
`;

export default function BankRecon() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [excluded, setExcluded] = useState(new Set());
  const [activeTab, setActiveTab] = useState('toKeyed');
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    setExcluded(new Set());
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

  const fmtAmt = (n) => n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  const onlineTotal = result ? result.onlineTransfers.reduce((s, t, i) => s + (excluded.has(i) ? 0 : t.credit), 0) : 0;

  const dailyGroup = (items, amtFn, keyFn) => {
    const gk = keyFn || (t => t.date);
    const counts = {}, totals = {};
    items.forEach((t, i) => { const k = gk(t); counts[k] = (counts[k] || 0) + 1; totals[k] = (totals[k] || 0) + amtFn(t, i); });
    const seen = {};
    return items.map((t) => {
      const k = gk(t);
      const first = !seen[k]; seen[k] = true;
      return first ? { span: counts[k], total: totals[k] } : null;
    });
  };

  return (
    <div className="br-root">
      <style>{CSS}</style>
      <div className="br-bar">
        <h1>BANK RECONCILIATION</h1>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 400 }}>Upload Public Bank statement · All processing in browser · Nothing sent to server</span>
      </div>
      <div className="br-body">
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
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>

        {loading && <div className="br-loading">Reading bank statement...</div>}
        {error && <div className="br-error">{error}</div>}

        {result && (
          <>
            <div className="br-summary">
              <div className="br-summary-title">Statement parsed</div>
              <div className="br-summary-info">{result.totalTxns} transactions across {result.totalPages} pages</div>
              <div className="br-summary-info">
                Found: {result.toKeyed.length} to key · {result.onlineTransfers.length} online transfers · {result.depCash.length} cash deposits
              </div>
            </div>

            <div className="br-tabs">
              <button className={`br-tab${activeTab==='toKeyed'?' active':''}`} onClick={()=>setActiveTab('toKeyed')}>To Key<span className="br-tab-count">({result.toKeyed.length})</span></button>
              <button className={`br-tab${activeTab==='online'?' active':''}`} onClick={()=>setActiveTab('online')}>Online Transfers<span className="br-tab-count">({result.onlineTransfers.length})</span></button>
              <button className={`br-tab${activeTab==='depCash'?' active':''}`} onClick={()=>setActiveTab('depCash')}>Cash Deposits<span className="br-tab-count">({result.depCash.length})</span></button>
            </div>

            {activeTab==='toKeyed' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.toKeyed.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No bank charges or loan payments found</div>
                  ) : (() => {
                    const dg = dailyGroup(result.toKeyed, t => t.debit || t.credit || 0, t => t.date + '|' + t.type);
                    const chargeTotal = result.toKeyed.filter(t => t.type !== 'Loan Payment').reduce((s, t) => s + (t.debit || t.credit || 0), 0);
                    const loanTotal = result.toKeyed.filter(t => t.type === 'Loan Payment').reduce((s, t) => s + (t.debit || t.credit || 0), 0);
                    return (
                    <table className="br-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Pg</th><th className="br-amt">Debit</th><th className="br-amt">Daily Total</th></tr></thead>
                      <tbody>
                        {result.toKeyed.map((t, i) => (
                          <tr key={i} style={{ background: t.type === 'Loan Payment' ? '#fef2f2' : '#eff6ff' }}>
                            <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                            <td className="br-desc">{t.description}</td>
                            <td><span className={`br-tag ${t.type === 'Loan Payment' ? 'loan' : 'charge'}`}>{t.type}</span></td>
                            <td className="br-page">p{t.page}</td>
                            <td className="br-amt">{fmtAmt(t.debit || t.credit)}</td>
                            {dg[i] && <td rowSpan={dg[i].span} className="br-amt br-daily">{fmtAmt(dg[i].total)}</td>}
                          </tr>
                        ))}
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
                    </table>);
                  })()}
                </div>
              </div>
            )}

            {activeTab==='online' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.onlineTransfers.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No online transfers found</div>
                  ) : (() => {
                    const dg = dailyGroup(result.onlineTransfers, t => t.credit || 0);
                    return (
                    <>
                      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Uncheck items that are not retail trade to exclude from total</div>
                      <table className="br-table">
                        <thead><tr><th style={{ width: 28 }}>✓</th><th>Date</th><th>Description</th><th>Pg</th><th className="br-amt">Amount</th><th className="br-amt">Daily Total</th></tr></thead>
                        <tbody>
                          {result.onlineTransfers.map((t, i) => (
                            <tr key={i} style={excluded.has(i) ? { opacity: 0.4, textDecoration: 'line-through' } : {}}>
                              <td><input type="checkbox" className="br-check" checked={!excluded.has(i)} onChange={() => toggleExclude(i)} /></td>
                              <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                              <td className="br-desc">{t.description}</td>
                              <td className="br-page">p{t.page}</td>
                              <td className="br-amt">{fmtAmt(t.credit)}</td>
                              {dg[i] && <td rowSpan={dg[i].span} className="br-amt br-daily">{fmtAmt(dg[i].total)}</td>}
                            </tr>
                          ))}
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
                    const dg = dailyGroup(result.depCash, t => t.credit || 0);
                    return (
                    <table className="br-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Pg</th><th className="br-amt">Amount</th><th className="br-amt">Daily Total</th></tr></thead>
                      <tbody>
                        {result.depCash.map((t, i) => (
                          <tr key={i}>
                            <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                            <td className="br-desc">{t.description}</td>
                            <td className="br-page">p{t.page}</td>
                            <td className="br-amt">{fmtAmt(t.credit)}</td>
                            {dg[i] && <td rowSpan={dg[i].span} className="br-amt br-daily">{fmtAmt(dg[i].total)}</td>}
                          </tr>
                        ))}
                        <tr className="br-total">
                          <td colSpan={3}>Total ({result.depCash.length} deposits)</td>
                          <td className="br-amt">{fmtAmt(result.depCash.reduce((s, t) => s + t.credit, 0))}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>);
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

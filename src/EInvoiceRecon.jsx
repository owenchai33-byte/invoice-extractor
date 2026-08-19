import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FlappyLoader } from './InvoiceExtractor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function parseMyInvoisXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        const docs = rows.map(r => ({
          uuid: r['UUID'] || '',
          invNo: (r['e-Invoice Code / Number'] || '').trim(),
          status: (r['Status'] || '').trim(),
          dateIssued: (r['Date And Time Issued'] || '').replace(/\s*\n\s*/g, ' ').trim(),
          type: (r['Type'] || '').trim(),
          amount: parseFloat(String(r['Total Amount'] || '0').replace(/,/g, '')) || 0,
          supplier: (r['Supplier Name'] || '').trim(),
          supplierTIN: (r['Supplier TIN'] || '').trim(),
          buyer: (r['Buyer Name'] || '').trim(),
        })).filter(d => d.invNo);
        resolve(docs);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function parseAutoCountPdf(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
  const entries = [];
  let docType = 'PI';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(it => it.str.trim());

    if (p === 1) {
      const txt = items.map(it => it.str).join(' ');
      if (/credit\s*note\s*listing/i.test(txt)) docType = 'CN';
      else if (/debit\s*note\s*listing/i.test(txt)) docType = 'DN';
    }

    const rowMap = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      let ry = y;
      for (const [k] of rowMap) { if (Math.abs(k - y) <= 3) { ry = k; break; } }
      if (!rowMap.has(ry)) rowMap.set(ry, []);
      rowMap.get(ry).push({ str: it.str.trim(), x: Math.round(it.transform[4]) });
    }

    for (const [, row] of rowMap) {
      row.sort((a, b) => a.x - b.x);
      const docNo = row.find(it => it.x < 100 && /^(PI|CN|DN)[\s\-]/.test(it.str));
      if (!docNo) continue;

      const ref = row.find(it => it.x >= 100 && it.x < 180);
      const date = row.find(it => it.x >= 180 && it.x < 230 && /\d{2}\/\d{2}\/\d{4}/.test(it.str));
      const creditor = row.filter(it => it.x >= 280 && it.x < 470).map(it => it.str).join(' ');
      const amount = row.find(it => it.x >= 500 && /^[\d,]+\.\d{2}$/.test(it.str));

      if (ref && amount) {
        entries.push({
          docType: docNo.str.split(/\s/)[0],
          docNo: docNo.str,
          ref: ref.str.trim(),
          date: date ? date.str : '',
          creditor: creditor.trim(),
          amount: parseFloat(amount.str.replace(/,/g, '')) || 0,
        });
      }
    }
  }
  return { docType, entries };
}

function normalizeRef(ref) {
  return ref.replace(/[\s\-\/\.]/g, '').toUpperCase();
}

function reconcile(portalDocs, acEntries) {
  const portalByRef = new Map();
  for (const d of portalDocs) {
    const key = normalizeRef(d.invNo);
    if (!portalByRef.has(key)) portalByRef.set(key, d);
  }

  const matched = [];
  const mismatched = [];
  const notInPortal = [];
  const usedPortalKeys = new Set();

  for (const ac of acEntries) {
    const key = normalizeRef(ac.ref);
    const portal = portalByRef.get(key);
    if (portal) {
      usedPortalKeys.add(key);
      const diff = Math.abs(ac.amount - portal.amount);
      if (diff < 0.02) {
        matched.push({ ac, portal });
      } else {
        mismatched.push({ ac, portal, diff });
      }
    } else {
      notInPortal.push(ac);
    }
  }

  const extraInPortal = portalDocs.filter(d => !usedPortalKeys.has(normalizeRef(d.invNo)));

  return { matched, mismatched, notInPortal, extraInPortal };
}

const btn = { padding: '6px 14px', borderRadius: 6, border: '1px solid #d4d4d8', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const fmt = (n) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function EInvoiceRecon() {
  const [portalDocs, setPortalDocs] = useState(null);
  const [acEntries, setAcEntries] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [view, setView] = useState('summary');
  const portalRef = useRef(null);
  const acRef = useRef(null);

  const handlePortal = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading('Reading MyInvois file...');
    setError('');
    try {
      const docs = await parseMyInvoisXlsx(file);
      if (docs.length === 0) throw new Error('No documents found in the MyInvois file.');
      setPortalDocs(docs);
    } catch (err) { setError(err.message); }
    setLoading('');
  }, []);

  const handleAC = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading('Reading AutoCount file...');
    setError('');
    try {
      const allEntries = [];
      for (const file of files) {
        const { entries } = await parseAutoCountPdf(file);
        allEntries.push(...entries);
      }
      if (allEntries.length === 0) throw new Error('No invoices found in the AutoCount PDF. Make sure it\'s a PI or CN listing.');
      setAcEntries(prev => prev ? [...prev, ...allEntries] : allEntries);
    } catch (err) { setError(err.message); }
    setLoading('');
  }, []);

  const doReconcile = useCallback(() => {
    if (!portalDocs || !acEntries) return;
    setResult(reconcile(portalDocs, acEntries));
    setView('summary');
  }, [portalDocs, acEntries]);

  const clearAll = useCallback(() => {
    setPortalDocs(null);
    setAcEntries(null);
    setResult(null);
    setError('');
    setView('summary');
    if (portalRef.current) portalRef.current.value = '';
    if (acRef.current) acRef.current.value = '';
  }, []);

  const exportXls = useCallback(() => {
    if (!result) return;
    const wb = XLSX.utils.book_new();

    if (result.matched.length > 0) {
      const data = result.matched.map(({ ac, portal }) => ({
        'Ref No': ac.ref, 'e-Invoice No': portal.invNo, 'Supplier': ac.creditor,
        'AC Amount': ac.amount, 'Portal Amount': portal.amount, 'Status': 'Matched',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Matched');
    }
    if (result.mismatched.length > 0) {
      const data = result.mismatched.map(({ ac, portal, diff }) => ({
        'Ref No': ac.ref, 'e-Invoice No': portal.invNo, 'Supplier': ac.creditor,
        'AC Amount': ac.amount, 'Portal Amount': portal.amount, 'Diff': diff, 'Status': 'Amount Mismatch',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Mismatched');
    }
    if (result.notInPortal.length > 0) {
      const data = result.notInPortal.map(ac => ({
        'Ref No': ac.ref, 'Date': ac.date, 'Supplier': ac.creditor, 'Amount': ac.amount,
        'Status': 'Not in Portal',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Not in Portal');
    }
    if (result.extraInPortal.length > 0) {
      const data = result.extraInPortal.map(d => ({
        'e-Invoice No': d.invNo, 'Type': d.type, 'Supplier': d.supplier, 'Amount': d.amount,
        'Date': d.dateIssued, 'Status': 'Extra in Portal',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Extra in Portal');
    }

    XLSX.writeFile(wb, 'e-Invoice Reconciliation.xlsx');
  }, [result]);

  const totalAC = acEntries?.length || 0;
  const totalPortal = portalDocs?.length || 0;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>e-INVOICE RECONCILIATION</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {result && <button onClick={exportXls} style={{ ...btn, background: '#111', color: '#fff' }}>⬇ Export Excel</button>}
          {(portalDocs || acEntries) && <button onClick={clearAll} style={btn}>Clear All</button>}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#991b1b' }}>{error}</div>
      )}

      {loading && <FlappyLoader label={loading} />}

      {!loading && !result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <UploadCard
            title="MyInvois Portal Export"
            subtitle="XLSX from myinvois.hasil.gov.my"
            accept=".xlsx,.xls,.csv"
            inputRef={portalRef}
            onChange={handlePortal}
            loaded={portalDocs}
            count={totalPortal}
            icon="🌐"
          />
          <UploadCard
            title="AutoCount PI / CN Listing"
            subtitle="PDF from AutoCount (upload multiple for PI + CN)"
            accept=".pdf"
            inputRef={acRef}
            onChange={handleAC}
            loaded={acEntries}
            count={totalAC}
            icon="📄"
            multiple
          />
        </div>
      )}

      {!loading && !result && portalDocs && acEntries && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <button onClick={doReconcile} style={{ ...btn, padding: '12px 32px', fontSize: 15, background: '#111', color: '#fff' }}>
            🔍 Reconcile Now
          </button>
          <div style={{ fontSize: 12, color: '#71717a', marginTop: 8 }}>
            {totalPortal} portal documents × {totalAC} AutoCount entries
          </div>
        </div>
      )}

      {result && <ResultsView result={result} view={view} setView={setView} />}
    </div>
  );
}

function UploadCard({ title, subtitle, accept, inputRef, onChange, loaded, count, icon, multiple }) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      border: `2px dashed ${loaded ? '#86efac' : '#d4d4d8'}`, borderRadius: 12, padding: '36px 20px',
      cursor: 'pointer', background: loaded ? '#f0fdf4' : '#fafafa', transition: 'border-color 0.2s',
    }}>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }} onChange={onChange} />
      <div style={{ fontSize: 32, marginBottom: 8 }}>{loaded ? '✅' : icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>{title}</div>
      <div style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>{subtitle}</div>
      {loaded && <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginTop: 8 }}>{count} documents loaded</div>}
    </label>
  );
}

function ResultsView({ result, view, setView }) {
  const { matched, mismatched, notInPortal, extraInPortal } = result;
  const total = matched.length + mismatched.length + notInPortal.length;

  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'matched', label: `Matched (${matched.length})`, color: '#16a34a' },
    { id: 'mismatched', label: `Mismatch (${mismatched.length})`, color: '#dc2626' },
    { id: 'notInPortal', label: `Not in Portal (${notInPortal.length})`, color: '#ea580c' },
    { id: 'extraInPortal', label: `Extra in Portal (${extraInPortal.length})`, color: '#7c3aed' },
  ];

  const th = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#71717a', borderBottom: '2px solid #e4e4e7', whiteSpace: 'nowrap' };
  const td = { padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #f4f4f5' };
  const tdr = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            ...btn, background: view === t.id ? '#18181b' : '#fff', color: view === t.id ? '#fff' : '#18181b',
            borderColor: view === t.id ? '#18181b' : '#d4d4d8',
          }}>{t.label}</button>
        ))}
      </div>

      {view === 'summary' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <StatCard label="Matched" value={matched.length} total={total} color="#16a34a" bg="#f0fdf4" />
          <StatCard label="Amount Mismatch" value={mismatched.length} total={total} color="#dc2626" bg="#fef2f2" />
          <StatCard label="Not in Portal" value={notInPortal.length} total={total} color="#ea580c" bg="#fff7ed" />
          <StatCard label="Extra in Portal" value={extraInPortal.length} total={null} color="#7c3aed" bg="#faf5ff" />
        </div>
      )}

      {view === 'matched' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Ref No</th><th style={th}>Supplier</th><th style={{ ...th, textAlign: 'right' }}>Amount (RM)</th><th style={th}>Portal Type</th>
          </tr></thead>
          <tbody>
            {matched.map(({ ac, portal }, i) => (
              <tr key={i}><td style={td}>{ac.ref}</td><td style={td}>{ac.creditor}</td><td style={tdr}>{fmt(ac.amount)}</td><td style={td}>{portal.type}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {view === 'mismatched' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Ref No</th><th style={th}>Supplier</th><th style={{ ...th, textAlign: 'right' }}>AutoCount</th><th style={{ ...th, textAlign: 'right' }}>Portal</th><th style={{ ...th, textAlign: 'right' }}>Diff</th>
          </tr></thead>
          <tbody>
            {mismatched.map(({ ac, portal, diff }, i) => (
              <tr key={i}><td style={td}>{ac.ref}</td><td style={td}>{ac.creditor}</td><td style={tdr}>{fmt(ac.amount)}</td><td style={tdr}>{fmt(portal.amount)}</td><td style={{ ...tdr, color: '#dc2626', fontWeight: 600 }}>{fmt(diff)}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {view === 'notInPortal' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Ref No</th><th style={th}>Date</th><th style={th}>Supplier</th><th style={{ ...th, textAlign: 'right' }}>Amount (RM)</th>
          </tr></thead>
          <tbody>
            {notInPortal.map((ac, i) => (
              <tr key={i}><td style={td}>{ac.ref}</td><td style={td}>{ac.date}</td><td style={td}>{ac.creditor}</td><td style={tdr}>{fmt(ac.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {view === 'extraInPortal' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>e-Invoice No</th><th style={th}>Type</th><th style={th}>Supplier</th><th style={{ ...th, textAlign: 'right' }}>Amount (RM)</th><th style={th}>Date</th>
          </tr></thead>
          <tbody>
            {extraInPortal.map((d, i) => (
              <tr key={i}><td style={td}>{d.invNo}</td><td style={td}>{d.type}</td><td style={td}>{d.supplier}</td><td style={tdr}>{fmt(d.amount)}</td><td style={td}>{d.dateIssued}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function StatCard({ label, value, total, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 10, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#52525b', marginTop: 4 }}>{label}</div>
      {total !== null && <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>of {total} AutoCount entries</div>}
    </div>
  );
}

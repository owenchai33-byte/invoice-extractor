import { useState, useEffect } from 'react';
import InvoiceExtractor from './InvoiceExtractor';
import YHSExtractor from './YHSExtractor';

// Sub-tab wrapper for the Invoices / Payment Summary area. Each supplier that
// needs its own extraction + subsidy model gets a tab here. Choon Hua is the
// original cascading-carton model; YHS is the flat 2%/transport/ML-bonus model.
const SUB_TABS = [
  { id: 'choonhua', label: 'Choon Hua' },
  { id: 'yhs', label: 'YHS' },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------------
// BatchedSupplier — Chrome-style tabs on top of one supplier's extractor.
// Each "batch" is an independent payment-summary sheet. The batch list + active
// id persist in localStorage (namespaced by `ns`), and each batch's actual
// invoice data is kept alive by the extractor itself (also namespaced by batch
// id via the `batchId` prop). Switching / adding a tab never touches another
// tab's stored data, so old tabs keep their info.
// ---------------------------------------------------------------------------
function BatchedSupplier({ ns, Extractor }) {
  const LS_BATCHES = `${ns}_batches`;
  const LS_ACTIVE = `${ns}_active_batch`;

  const [batches, setBatches] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_BATCHES));
      if (Array.isArray(v) && v.length) return v;
    } catch {}
    return [{ id: 'default', name: 'Batch 1' }];
  });
  const [activeId, setActiveId] = useState(() => {
    try { return localStorage.getItem(LS_ACTIVE) || 'default'; } catch { return 'default'; }
  });
  const [editingId, setEditingId] = useState(null);

  useEffect(() => { try { localStorage.setItem(LS_BATCHES, JSON.stringify(batches)); } catch {} }, [batches, LS_BATCHES]);
  useEffect(() => { try { localStorage.setItem(LS_ACTIVE, activeId); } catch {} }, [activeId, LS_ACTIVE]);
  // Safety net: active id must always point at a real batch.
  useEffect(() => {
    if (batches.length && !batches.some(b => b.id === activeId)) setActiveId(batches[0].id);
  }, [batches, activeId]);

  const addBatch = () => {
    const id = uid();
    const nums = batches.map(b => { const m = /^Batch (\d+)$/.exec(b.name); return m ? +m[1] : 0; });
    const n = Math.max(0, ...nums) + 1;
    setBatches(prev => [...prev, { id, name: `Batch ${n}` }]);
    setActiveId(id);
  };

  const closeBatch = (id) => {
    const b = batches.find(x => x.id === id);
    // Wipe every stored key belonging to this batch (all end with `__<id>`).
    try {
      Object.keys(localStorage).forEach(k => { if (k.endsWith('__' + id)) localStorage.removeItem(k); });
    } catch {}
    let next = batches.filter(x => x.id !== id);
    if (!next.length) next = [{ id: uid(), name: 'Batch 1' }];
    setBatches(next);
    if (id === activeId) setActiveId(next[0].id);
  };

  const rename = (id, name) => setBatches(prev => prev.map(b => b.id === id ? { ...b, name: name.trim() || b.name } : b));

  const tab = (b) => {
    const active = b.id === activeId;
    return (
      <div
        key={b.id}
        onClick={() => setActiveId(b.id)}
        onDoubleClick={() => setEditingId(b.id)}
        title={active ? 'Double-click to rename' : b.name}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px 7px 14px',
          borderRadius: '9px 9px 0 0',
          border: '1px solid #d4d4d8',
          borderBottom: active ? '1px solid #fff' : '1px solid #d4d4d8',
          marginBottom: -1,
          background: active ? '#fff' : '#ededed',
          color: active ? '#111' : '#666',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          maxWidth: 220, minWidth: 90,
          transition: 'background 120ms',
        }}
      >
        {editingId === b.id ? (
          <input
            autoFocus
            defaultValue={b.name}
            onClick={e => e.stopPropagation()}
            onBlur={e => { rename(b.id, e.target.value); setEditingId(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { rename(b.id, e.target.value); setEditingId(null); }
              if (e.key === 'Escape') { setEditingId(null); }
            }}
            style={{ width: 100, border: '1px solid #2563eb', borderRadius: 3, padding: '1px 4px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          />
        ) : (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
        )}
        {batches.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); closeBatch(b.id); }}
            title="Close batch"
            style={{
              border: 'none', background: 'transparent', color: active ? '#888' : '#aaa',
              cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', borderRadius: 4,
            }}
          >×</button>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Chrome-style batch tab strip — hidden on print so the summary prints clean */}
      <div className="noP" style={{
        display: 'flex', alignItems: 'flex-end', gap: 3,
        padding: '10px 16px 0', borderBottom: '1px solid #d4d4d8',
        overflowX: 'auto',
      }}>
        {batches.map(tab)}
        <button
          onClick={addBatch}
          title="New batch"
          style={{
            border: '1px solid #d4d4d8', background: '#f7f7f7', color: '#555',
            borderRadius: 7, width: 30, height: 30, fontSize: 18, lineHeight: 1,
            cursor: 'pointer', marginLeft: 4, marginBottom: 4, flexShrink: 0,
          }}
        >+</button>
      </div>

      {/* key forces a fresh mount per batch so each loads its own saved data */}
      <Extractor key={activeId} batchId={activeId} />
    </div>
  );
}

export default function InvoicesWorkspace() {
  const [sub, setSub] = useState(() => {
    try { return localStorage.getItem('invoices_subtab') || 'choonhua'; }
    catch { return 'choonhua'; }
  });
  useEffect(() => {
    try { localStorage.setItem('invoices_subtab', sub); } catch {}
    const names = { choonhua: 'CJK Choon Hua Payment Summary', yhs: 'CJK YHS Payment Summary' };
    document.title = names[sub] || 'CJK Payment Summary';
  }, [sub]);

  return (
    <div>
      {/* Supplier sub-tab bar — hidden on print so the payment summary prints clean */}
      <div className="noP" style={{
        display: 'flex',
        gap: 4,
        justifyContent: 'center',
        padding: '12px 0 4px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        {SUB_TABS.map(t => {
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              style={{
                position: 'relative',
                background: active ? '#111' : 'transparent',
                color: active ? '#fff' : '#666',
                border: active ? 'none' : '1px solid #d4d4d8',
                padding: '6px 18px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 150ms',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'choonhua' && <BatchedSupplier ns="choonhua" Extractor={InvoiceExtractor} />}
      {sub === 'yhs' && <BatchedSupplier ns="yhs" Extractor={YHSExtractor} />}
    </div>
  );
}

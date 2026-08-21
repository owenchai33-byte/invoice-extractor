import { useState, useEffect, useRef, useCallback } from 'react';
import cjkLetterhead from './cjk_letterhead.png';

const LS_KEY = 'cjk_weekly_payment';

const SUPPLIERS = [
  { name: 'ADVANCED OFFSET PRINTING CO.', bank: 'PBB 3088695503' },
  { name: 'BERJAYA SOMPO INSURANCE', bank: 'MBB 511113432075' },
  { name: 'BEVERAGES MKT', bank: 'PBB 3129999908' },
  { name: 'BOSTON FOOD INDUSTRIES SDN BHD', bank: 'PBB 3149324418' },
  { name: 'CK ALLIANCE SDN BHD', bank: 'MBB 511038031516' },
  { name: 'CHUN THONG HUA SDN BHD', bank: 'MBB 561239608606' },
  { name: 'ENVIRON PEST CONTROL SDN BHD', bank: 'PBB 3160099811' },
  { name: 'GOLD LEAF MARKETING SDN BHD', bank: 'ALB 070110010002592' },
  { name: 'HAI MING MARKETING SDN BHD', bank: 'AMB 0832012008006' },
  { name: 'HAI MING PAPER MILLS SDN BHD', bank: 'AMB 0832012007974' },
  { name: 'HAPPY TRADING COMPANY', bank: 'PBB 3080767824' },
  { name: 'HUA SHAN TRADING', bank: 'HLB 09400008524' },
  { name: 'HUA YOU COMPANY', bank: 'PBB 3238397402' },
  { name: 'HUA KION SDN BHD', bank: 'PBB 3113342201' },
  { name: 'INFINITE MULTI RESOURCES SDN BHD', bank: 'PBB 3996939418' },
  { name: 'JI-FENG TRADING SDN BHD', bank: 'PBB 3192714909' },
  { name: 'KIM TECK CHEONG (BORNEO) S/B', bank: 'HSBC 392570073101' },
  { name: 'KIMYAP (KCH) SDN BHD', bank: 'PBB 3190465406' },
  { name: 'KEE HUA FOOD SDN BHD', bank: 'PBB 3186206501' },
  { name: 'KO SIONG CHEUN SDN BHD', bank: 'UOB 1843036436' },
  { name: 'KV DISTRIBUTORS SDN BHD', bank: 'PBB 3155427002' },
  { name: 'LEAVES TRADING SDN BHD', bank: 'PBB 3198765223' },
  { name: 'LI ZONG TRADING COMPANY', bank: 'PBB 3162323212' },
  { name: 'LKC FOOD (BORNEO) SDN BHD', bank: 'PBB 3249061031' },
  { name: 'MH AGENCIES SDN BHD', bank: 'PBB 3154715133' },
  { name: 'MINSIANG TRADING (KCH) SDN BHD', bank: 'PBB 3213595512' },
  { name: 'MUI HIONG MARKETING SDN BHD', bank: 'PBB 3130637908' },
  { name: 'MULTIPLY PAPER PRODUCTS COMPANY', bank: 'PBB 3182416718' },
  { name: 'NIBONG TEBAL ENTERPRISE SDN BHD', bank: 'UOB 1843025876' },
  { name: 'PTH ENTERPRISE SDN BHD', bank: 'MBI 561051245517' },
  { name: 'PUI KIAN MING SDN BHD', bank: 'OCBC 7601021166' },
  { name: 'S.G. TRADING', bank: 'PBB 3244333910' },
  { name: 'SATVA SDN BHD', bank: 'PBB 3144515426' },
  { name: 'SATRADING HOUSE SDN BHD', bank: 'MBB 011083201596' },
  { name: 'SSR TECHNOLOGY INFINITE SDN BHD', bank: 'OCBC 7601126804' },
  { name: 'STASURIA ENTERPRISE SDN BHD', bank: 'PBB 3073547510' },
  { name: 'SUNG HOE TRADING SDN BHD', bank: 'CIMB 8005076527' },
  { name: 'SUNRISE PLASTIC TRADING SDN BHD', bank: 'PBB 3172114219' },
  { name: 'SUNSHINE FOOD MANUFACTURE CO. SDN BHD', bank: 'HLB 01700025810' },
  { name: 'SYKT KION HOONG COOKING OIL MILLS S/B', bank: 'PBB 3112853124' },
  { name: 'TA YUNG FOOD INDUSTRIES SDN BHD', bank: 'PBB 3194421208' },
  { name: 'TONG SIM HIN (M) S/B', bank: 'PBB 3247161628' },
  { name: 'TEO HONG TAI SDN BHD', bank: 'PBB 3800914933' },
  { name: 'YEON FOOD INDUSTRIES SDN BHD', bank: 'HLB 02900097764' },
  { name: 'YONG HUA HENG SDN BHD', bank: 'PBB 3162114915' },
  { name: 'YOU HOW (E.M.) SDN BHD', bank: 'PBB 3112903208' },
];

const REMINDERS = [
  { period: '12 DAYS', suppliers: ['KO SIONG CHEUN'] },
  { period: '14 DAYS', suppliers: ['MULTIPLY', 'LEAVES', 'TONG SIM HIN', 'HUA SHAN', 'MINSIANG'] },
  { period: 'MID-MONTH', suppliers: ['LI ZONG', 'SSR'] },
  { period: 'END-MONTH', suppliers: ['MUI HIONG', 'SUNRISE', 'JI-FENG', 'TA YUNG', 'YEON', 'S.G.', 'PTH'] },
];

const BANK_MAP = Object.fromEntries(SUPPLIERS.map(s => [s.name, s.bank]));

const nf = v => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getNextFriday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day <= 5 ? 5 - day : 6;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatDate(d) {
  return `${d.getDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`;
}

function dateToInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}

function EditableCell({ value, onChange, type, placeholder, style, align }) {
  const [local, setLocal] = useState(value);
  const ref = useRef(null);
  useEffect(() => { setLocal(value); }, [value]);
  const commit = (val) => {
    let v = val !== undefined ? val : local;
    if (type === 'number' && v !== '' && v != null) {
      const n = parseFloat(v);
      if (!isNaN(n)) v = n.toFixed(2);
    }
    if (v !== local) setLocal(v);
    if (v !== value) onChange(v);
  };
  const focusNext = () => {
    const td = ref.current?.closest('td');
    const next = td?.nextElementSibling?.querySelector('input');
    if (next) next.focus();
  };
  return (
    <input
      ref={ref}
      type={type || 'text'}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          commit();
          focusNext();
        }
      }}
      placeholder={placeholder || ''}
      className="wp-input"
      style={{ textAlign: align || 'left', ...style }}
    />
  );
}

export default function WeeklyPayment() {
  const [allData, setAllData] = useState(load);
  const friday = getNextFriday();
  const [weekDate, setWeekDate] = useState(() => allData._currentWeek || dateToInput(friday));
  const [weekDate2, setWeekDate2] = useState(() => allData._currentWeek2 || '');
  const [activeWeek, setActiveWeek] = useState(1);

  const save = useCallback((newData) => {
    setAllData(newData);
    try { localStorage.setItem(LS_KEY, JSON.stringify(newData)); } catch {}
  }, []);

  const getWeekData = (wk) => allData[wk] || { rows: [], epayBalance: '', epayDate: '', preparedBy: 'Sabrina' };
  const data1 = getWeekData(weekDate);
  const data2 = weekDate2 ? getWeekData(weekDate2) : null;
  const rows1 = data1.rows || [];
  const rows2 = data2 ? (data2.rows || []) : [];
  const total1 = rows1.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const total2 = rows2.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const updateWeekData = useCallback((wk, weekData, patch) => {
    save({ ...allData, [wk]: { ...weekData, ...patch }, _currentWeek: weekDate, _currentWeek2: weekDate2 });
  }, [allData, weekDate, weekDate2, save]);

  const updateRow1 = useCallback((idx, patch) => {
    const newRows = rows1.map((r, i) => i === idx ? { ...r, ...patch } : r);
    updateWeekData(weekDate, data1, { rows: newRows });
  }, [rows1, weekDate, data1, updateWeekData]);

  const updateRow2 = useCallback((idx, patch) => {
    if (!weekDate2) return;
    const newRows = rows2.map((r, i) => i === idx ? { ...r, ...patch } : r);
    updateWeekData(weekDate2, data2, { rows: newRows });
  }, [rows2, weekDate2, data2, updateWeekData]);

  const removeRow1 = useCallback((idx) => {
    updateWeekData(weekDate, data1, { rows: rows1.filter((_, i) => i !== idx) });
  }, [rows1, weekDate, data1, updateWeekData]);

  const removeRow2 = useCallback((idx) => {
    if (!weekDate2) return;
    updateWeekData(weekDate2, data2, { rows: rows2.filter((_, i) => i !== idx) });
  }, [rows2, weekDate2, data2, updateWeekData]);

  const toLabel = (ds) => {
    const parts = ds.split('-');
    if (parts.length !== 3) return ds;
    return formatDate(new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
  };
  const weekLabel = toLabel(weekDate);
  const weekLabel2 = weekDate2 ? toLabel(weekDate2) : '';

  const activeRows = activeWeek === 1 ? rows1 : rows2;
  const activeWk = activeWeek === 1 ? weekDate : weekDate2;
  const activeData = activeWeek === 1 ? data1 : data2;

  const [supSearch, setSupSearch] = useState('');
  const [showSup, setShowSup] = useState(false);

  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const handleDragStart = (weekNum, idx) => setDragFrom({ week: weekNum, idx });

  const handleDragOver = (e, weekNum, idx) => {
    e.preventDefault();
    setDragOver({ week: weekNum, idx });
  };

  const handleDrop = (weekNum, idx) => {
    if (!dragFrom) return;
    const srcWk = dragFrom.week === 1 ? weekDate : weekDate2;
    const dstWk = weekNum === 1 ? weekDate : weekDate2;
    const srcData = dragFrom.week === 1 ? data1 : data2;
    const dstData = weekNum === 1 ? data1 : data2;
    const srcRows = [...(dragFrom.week === 1 ? rows1 : rows2)];
    const dstRows = dragFrom.week === weekNum ? srcRows : [...(weekNum === 1 ? rows1 : rows2)];
    const [item] = srcRows.splice(dragFrom.idx, 1);

    if (dragFrom.week === weekNum) {
      srcRows.splice(idx, 0, item);
      updateWeekData(srcWk, srcData, { rows: srcRows });
    } else {
      dstRows.splice(idx, 0, item);
      const next = { ...allData,
        [srcWk]: { ...srcData, rows: srcRows },
        [dstWk]: { ...dstData, rows: dstRows },
        _currentWeek: weekDate, _currentWeek2: weekDate2,
      };
      save(next);
    }
    setDragFrom(null);
    setDragOver(null);
  };

  const handleDragEnd = () => { setDragFrom(null); setDragOver(null); };


  const clearWeek = () => {
    const label = activeWeek === 1 ? weekLabel : weekLabel2;
    if (!confirm(`Clear all entries for week ending ${label}?`)) return;
    const next = { ...allData };
    delete next[activeWk];
    save(next);
  };

  return (
    <div className="wp-root">
      <style>{CSS}</style>
      <div className="wp-bar no-print">
        <div className="wp-acts">
          <button className="wp-btn wp-btn-sup" onClick={() => setShowSup(v => !v)}>{showSup ? '✕ Close' : '+ Supplier'}</button>
          <button className="wp-btn" onClick={() => {
            const d = weekDate.split('-');
            const prev = document.title;
            document.title = `WEEKLY PAYMENT SUMMARY ${d[2]}${d[1]}${d[0].slice(-2)}`;
            window.print();
            document.title = prev;
          }}>Print</button>
          <button className="wp-btn wp-btn-o" onClick={clearWeek}>Clear</button>
        </div>
      </div>

      <div className="wp-layout no-print">
        <div className={`wp-sidebar${showSup ? ' wp-sidebar-open' : ''}`}>
          <div className="wp-sidebar-title">ADD TO {activeWeek === 1 ? 'WEEK 1' : 'WEEK 2'}</div>
          <div style={{ padding: '6px 6px 0' }}>
            <input
              type="text"
              value={supSearch}
              onChange={e => setSupSearch(e.target.value)}
              placeholder="Search supplier..."
              className="wp-search"
            />
          </div>
          <div className="wp-sidebar-list">
            {SUPPLIERS.filter(s => !supSearch || s.name.toLowerCase().includes(supSearch.toLowerCase())).map(s => {
              const used = activeRows.some(r => r.supplier === s.name);
              return (
                <button
                  key={s.name}
                  className={'wp-sidebar-item' + (used ? ' wp-sidebar-used' : '')}
                  onClick={() => {
                    if (!activeWk) return;
                    const bank = BANK_MAP[s.name] || '';
                    const wd = activeWeek === 1 ? data1 : data2;
                    const rs = activeWeek === 1 ? rows1 : rows2;
                    updateWeekData(activeWk, wd, { rows: [...rs, { supplier: s.name, bank, amount: '', paymentFor: '', remark: '' }] });
                  }}
                >
                  {s.name}
                  {used && <span className="wp-sidebar-tick"> ✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="wp-main">
          <div className="wp-week-label" onClick={() => setActiveWeek(1)} style={{ cursor: 'pointer', background: activeWeek === 1 ? '#eff6ff' : '#f9fafb', border: activeWeek === 1 ? '1px solid #93c5fd' : '1px solid #e4e4e7', borderRadius: 6, padding: '6px 12px', marginBottom: 8, fontWeight: 700, fontSize: 13, color: activeWeek === 1 ? '#1e40af' : '#71717a' }}>
            WEEK 1 — ending <input type="date" value={weekDate} onChange={e => {
              const nd = e.target.value, od = weekDate;
              const next = { ...allData, _currentWeek: nd };
              if (od !== nd && allData[od] && !allData[nd]) { next[nd] = allData[od]; delete next[od]; }
              setWeekDate(nd); save(next);
            }} className="wp-date-input" style={{ fontSize: 12, padding: '2px 6px' }} onClick={e => e.stopPropagation()} />
          </div>
          <table className="wp-tbl">
            <thead>
              <tr>
                <th className="wp-th-no">NO.</th>
                <th className="wp-th-sup">SUPPLIER</th>
                <th className="wp-th-bank">BANK ACCOUNT</th>
                <th className="wp-th-amt">AMOUNT</th>
                <th className="wp-th-pf">PAYMENT FOR</th>
                <th className="wp-th-rmk">REMARK</th>
                <th className="wp-th-del"></th>
              </tr>
            </thead>
            <tbody>
              {rows1.map((r, i) => (
                <tr key={i} draggable onDragStart={() => handleDragStart(1, i)} onDragOver={e => handleDragOver(e, 1, i)} onDrop={() => handleDrop(1, i)} onDragEnd={handleDragEnd} className={dragOver && dragOver.week === 1 && dragOver.idx === i ? 'wp-drag-over' : ''}>
                  <td className="wp-no wp-grip" style={{ cursor: 'grab' }}>⠿</td>
                  <td className="wp-sup-name">{r.supplier || '-'}</td>
                  <td className="wp-bank">{r.bank || '-'}</td>
                  <td className="wp-amt">
                    <EditableCell value={r.amount} onChange={v => updateRow1(i, { amount: v })} type="number" placeholder="0.00" align="right" />
                  </td>
                  <td><EditableCell value={r.paymentFor} onChange={v => updateRow1(i, { paymentFor: v })} placeholder="e.g. 8/2026" /></td>
                  <td><EditableCell value={r.remark} onChange={v => updateRow1(i, { remark: v })} placeholder="" /></td>
                  <td className="wp-del-cell"><button className="wp-del" onClick={() => removeRow1(i)} title="Remove row">✕</button></td>
                </tr>
              ))}
              {rows1.length === 0 && <tr onDragOver={e => { e.preventDefault(); setDragOver({ week: 1, idx: 0 }); }} onDrop={() => handleDrop(1, 0)}><td colSpan="7" className="wp-empty">Click a supplier on the left to add</td></tr>}
            </tbody>
            <tfoot>
              <tr className="wp-total-row">
                <td></td><td className="wp-total-label">TOTAL =</td><td></td>
                <td className="wp-total-val">RM {nf(total1)}</td><td></td><td></td><td></td>
              </tr>
            </tfoot>
          </table>

          {!weekDate2 && (
            <button
              onClick={() => {
                const parts = weekDate.split('-').map(Number);
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                d.setDate(d.getDate() + 7);
                const next = dateToInput(d);
                setWeekDate2(next);
                setActiveWeek(2);
                save({ ...allData, _currentWeek2: next });
              }}
              style={{ marginTop: 20, padding: '10px 20px', border: '2px dashed #d4d4d8', borderRadius: 8, background: '#fafafa', color: '#71717a', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', textAlign: 'center' }}
            >
              + Add Week 2
            </button>
          )}

          {weekDate2 && (
            <>
              <div className="wp-week-label" onClick={() => setActiveWeek(2)} style={{ cursor: 'pointer', background: activeWeek === 2 ? '#eff6ff' : '#f9fafb', border: activeWeek === 2 ? '1px solid #93c5fd' : '1px solid #e4e4e7', borderRadius: 6, padding: '6px 12px', marginTop: 20, marginBottom: 8, fontWeight: 700, fontSize: 13, color: activeWeek === 2 ? '#1e40af' : '#71717a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>WEEK 2 — ending <input type="date" value={weekDate2} onChange={e => {
                  const nd = e.target.value, od = weekDate2;
                  const next = { ...allData, _currentWeek2: nd };
                  if (od !== nd && allData[od] && !allData[nd]) { next[nd] = allData[od]; delete next[od]; }
                  setWeekDate2(nd); save(next);
                }} className="wp-date-input" style={{ fontSize: 12, padding: '2px 6px' }} onClick={e => e.stopPropagation()} /></span>
                <button onClick={e => { e.stopPropagation(); setWeekDate2(''); setActiveWeek(1); save({ ...allData, _currentWeek2: '' }); }} style={{ border: 'none', background: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 14, padding: '0 4px' }} title="Remove Week 2">✕</button>
              </div>
              <table className="wp-tbl">
                <thead>
                  <tr>
                    <th className="wp-th-no">NO.</th>
                    <th className="wp-th-sup">SUPPLIER</th>
                    <th className="wp-th-bank">BANK ACCOUNT</th>
                    <th className="wp-th-amt">AMOUNT</th>
                    <th className="wp-th-pf">PAYMENT FOR</th>
                    <th className="wp-th-rmk">REMARK</th>
                    <th className="wp-th-del"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows2.map((r, i) => (
                    <tr key={i} draggable onDragStart={() => handleDragStart(2, i)} onDragOver={e => handleDragOver(e, 2, i)} onDrop={() => handleDrop(2, i)} onDragEnd={handleDragEnd} className={dragOver && dragOver.week === 2 && dragOver.idx === i ? 'wp-drag-over' : ''}>
                      <td className="wp-no wp-grip" style={{ cursor: 'grab' }}>⠿</td>
                      <td className="wp-sup-name">{r.supplier || '-'}</td>
                      <td className="wp-bank">{r.bank || '-'}</td>
                      <td className="wp-amt">
                        <EditableCell value={r.amount} onChange={v => updateRow2(i, { amount: v })} type="number" placeholder="0.00" align="right" />
                      </td>
                      <td><EditableCell value={r.paymentFor} onChange={v => updateRow2(i, { paymentFor: v })} placeholder="e.g. 8/2026" /></td>
                      <td><EditableCell value={r.remark} onChange={v => updateRow2(i, { remark: v })} placeholder="" /></td>
                      <td className="wp-del-cell"><button className="wp-del" onClick={() => removeRow2(i)} title="Remove row">✕</button></td>
                    </tr>
                  ))}
                  {rows2.length === 0 && <tr onDragOver={e => { e.preventDefault(); setDragOver({ week: 2, idx: 0 }); }} onDrop={() => handleDrop(2, 0)}><td colSpan="7" className="wp-empty">Click a supplier on the left to add</td></tr>}
                </tbody>
                <tfoot>
                  <tr className="wp-total-row">
                    <td></td><td className="wp-total-label">TOTAL =</td><td></td>
                    <td className="wp-total-val">RM {nf(total2)}</td><td></td><td></td><td></td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}

          <div className="wp-footer">
            <div className="wp-epay">
              <span className="wp-epay-star">*</span>
              <span className="wp-epay-label">EPAY BALANCE: RM</span>
              <input
                className="wp-epay-input"
                type="number"
                value={data1.epayBalance}
                onChange={e => {
                  const patch = { epayBalance: e.target.value };
                  if (e.target.value && !data1.epayDate) {
                    patch.epayDate = new Date().toLocaleString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
                  }
                  updateWeekData(weekDate, data1, patch);
                }}
                placeholder="0.00"
              />
              {data1.epayDate && <span className="wp-epay-ts">{data1.epayDate}</span>}
            </div>
            <div className="wp-prepared">
              <div>
                <span className="wp-prepared-label">Prepared by </span>
                <input
                  className="wp-prepared-input"
                  type="text"
                  value={data1.preparedBy || 'Sabrina'}
                  onChange={e => updateWeekData(weekDate, data1, { preparedBy: e.target.value })}
                />
              </div>
              <div className="wp-prepared-date-row">
                <span className="wp-prepared-date-val">{formatDate(new Date())}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom Reference Bar ─── */}
      <div className="wp-ref-bar no-print">
        <div className="wp-ref-inner">
          {REMINDERS.map(r => (
            <div key={r.period} className="wp-ref-group">
              <span className="wp-ref-period">{r.period}</span>
              {r.suppliers.map(s => (
                <span key={s} className="wp-ref-chip">{s}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Print-only version (no sidebar layout) */}
      <div className="wp-print-body">
        <div className="wp-print-header">
          <img src={cjkLetterhead} alt="CHAI JEE KIONG TRADING SDN. BHD." className="wp-letterhead" />
          <div className="wp-print-title">Weekly Payment Summary</div>
          <div className="wp-print-week">Week Ending {weekLabel}</div>
        </div>
        <table className="wp-tbl">
          <thead><tr><th className="wp-th-no">NO.</th><th className="wp-th-sup">SUPPLIER</th><th className="wp-th-bank">BANK ACCOUNT</th><th className="wp-th-amt">AMOUNT</th><th className="wp-th-pf">PAYMENT FOR</th><th className="wp-th-rmk">REMARK</th></tr></thead>
          <tbody>
            {rows1.map((r, i) => (
              <tr key={i}><td className="wp-no">{i + 1}</td><td className="wp-sup-cell"><span>{r.supplier}</span></td><td className="wp-bank">{r.bank || '-'}</td><td className="wp-amt"><span className="wp-amt-val">{r.amount ? nf(r.amount) : '-'}</span></td><td>{r.paymentFor || ''}</td><td>{r.remark || ''}</td></tr>
            ))}
          </tbody>
          <tfoot><tr className="wp-total-row"><td></td><td className="wp-total-label">TOTAL =</td><td></td><td className="wp-total-val">RM {nf(total1)}</td><td></td><td></td></tr></tfoot>
        </table>

        {weekDate2 && rows2.length > 0 && (
          <>
            <div style={{ marginTop: 24, fontWeight: 700, fontSize: 14, textAlign: 'center', color: '#000' }}>Week Ending {weekLabel2}</div>
            <table className="wp-tbl" style={{ marginTop: 8 }}>
              <thead><tr><th className="wp-th-no">NO.</th><th className="wp-th-sup">SUPPLIER</th><th className="wp-th-bank">BANK ACCOUNT</th><th className="wp-th-amt">AMOUNT</th><th className="wp-th-pf">PAYMENT FOR</th><th className="wp-th-rmk">REMARK</th></tr></thead>
              <tbody>
                {rows2.map((r, i) => (
                  <tr key={i}><td className="wp-no">{i + 1}</td><td className="wp-sup-cell"><span>{r.supplier}</span></td><td className="wp-bank">{r.bank || '-'}</td><td className="wp-amt"><span className="wp-amt-val">{r.amount ? nf(r.amount) : '-'}</span></td><td>{r.paymentFor || ''}</td><td>{r.remark || ''}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="wp-total-row"><td></td><td className="wp-total-label">TOTAL =</td><td></td><td className="wp-total-val">RM {nf(total2)}</td><td></td><td></td></tr></tfoot>
            </table>
          </>
        )}

        <div className="wp-footer">
          <div className="wp-epay">
            <span className="wp-epay-star">*</span>
            <span>EPAY BALANCE: RM</span>
            <span className="wp-epay-fv">{data1.epayBalance ? nf(data1.epayBalance) : ''}</span>
            {data1.epayDate && <span className="wp-epay-fd">({data1.epayDate})</span>}
          </div>
          <div className="wp-prepared">
            <div><span className="wp-prepared-label">Prepared by </span><span className="wp-prepared-fv">{data1.preparedBy || 'Sabrina'}</span></div>
            <div className="wp-prepared-date-val">{formatDate(new Date())}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.wp-root{background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wp-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:48px}
.wp-acts{margin-left:auto;display:flex;align-items:center;gap:10px}
.wp-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.wp-btn:hover{background:#000}
.wp-btn-o{background:#fff;color:#18181b}
.wp-btn-o:hover{background:#f4f4f5}
.wp-btn-add{background:#2563eb;border-color:#2563eb}
.wp-btn-add:hover{background:#1d4ed8}
.wp-date-label{font-size:12px;font-weight:600;color:#52525b;display:flex;align-items:center;gap:6px}
.wp-date-input{border:1px solid #d4d4d8;border-radius:6px;padding:5px 8px;font-size:13px;font-family:inherit;color:#18181b}
.wp-date-clear{border:none;background:none;color:#a1a1aa;cursor:pointer;font-size:14px;padding:0 2px;line-height:1}
.wp-date-clear:hover{color:#dc2626}

.wp-layout{display:flex;gap:16px;max-width:1400px;margin:0 auto;padding:28px 24px 100px;align-items:flex-start}
.wp-main{flex:1;min-width:0}
.wp-sidebar{width:210px;flex-shrink:0;position:sticky;top:72px;max-height:calc(100vh - 90px);overflow-y:auto;background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:8px 0}
.wp-sidebar-title{font-size:11px;font-weight:700;color:#71717a;padding:4px 12px 6px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e4e4e7}
.wp-search{width:100%;border:1px solid #d4d4d8;border-radius:6px;padding:6px 10px;font-size:12px;font-family:inherit;color:#18181b;background:#fff;box-sizing:border-box}
.wp-search:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.wp-search::placeholder{color:#a1a1aa}
.wp-sidebar-list{padding:4px 0;display:flex;flex-direction:column;gap:2px}
.wp-sidebar-item{font-size:11px;padding:5px 10px;margin:0 6px;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid #e4e4e7;border-radius:6px;background:#fff;cursor:pointer;text-align:left;font-family:inherit;width:calc(100% - 12px)}
.wp-sidebar-item:hover{background:#eff6ff;border-color:#93c5fd}
.wp-sidebar-used{background:#f0fdf4;border-color:#86efac;color:#166534}
.wp-sidebar-tick{color:#16a34a;font-weight:700}
.wp-print-body{display:none}

.wp-ref-bar{position:fixed;bottom:0;left:0;right:0;z-index:50;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-top:1px solid #e4e4e7;padding:8px 24px;box-shadow:0 -2px 8px rgba(0,0,0,.06)}
.wp-ref-inner{display:flex;gap:20px;justify-content:center;align-items:center;flex-wrap:wrap}
.wp-ref-group{display:flex;align-items:center;gap:4px}
.wp-ref-period{font-size:10px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.04em;margin-right:2px}
.wp-ref-chip{font-size:10px;padding:1px 6px;background:#eff6ff;color:#1e40af;border-radius:3px;font-weight:500}

.wp-print-header{display:none}
.wp-letterhead{width:100%;max-width:580px;display:block;margin:0 auto 12px}

.wp-tbl{width:100%;border-collapse:collapse;font-size:13px}
.wp-tbl thead th{text-align:left;padding:10px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#52525b;border-bottom:2px solid #666;background:#fafafa}
.wp-th-no{width:28px;text-align:center}
.wp-th-sup{white-space:nowrap}
.wp-th-bank{width:22%}
.wp-th-amt{width:14%;text-align:right}
.wp-th-pf{width:12%}
.wp-th-rmk{width:14%}
.wp-th-del{width:30px}

.wp-tbl tbody td{padding:4px 10px;border-bottom:1px solid #e4e4e7;vertical-align:middle}
.wp-no{text-align:center;color:#71717a;font-weight:600;font-size:12px}
.wp-bank{font-size:12px;color:#18181b;font-variant-numeric:tabular-nums;font-weight:700}

.wp-sup-name{font-size:12px;color:#18181b;font-weight:700;white-space:nowrap}

.wp-input{width:100%;border:1px solid #e4e4e7;border-radius:4px;padding:5px 6px;font-size:12px;font-family:inherit;color:#18181b;background:#fff;font-weight:700}
.wp-input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.wp-input::-webkit-inner-spin-button,.wp-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.wp-input{-moz-appearance:textfield}
.wp-del-cell{text-align:center}
.wp-del{background:none;border:none;color:#d4d4d8;font-size:14px;cursor:pointer;padding:4px;border-radius:4px;line-height:1}
.wp-del:hover{color:#dc2626;background:#fef2f2}

.wp-empty{text-align:center;color:#a1a1aa;font-size:13px;padding:32px 10px!important;font-style:italic}

.wp-total-row td{border-top:2px solid #666;border-bottom:none;padding:10px 10px;font-weight:700}
.wp-total-label{text-align:right;font-size:13px;color:#18181b}
.wp-total-val{text-align:right;font-size:15px;color:#18181b;font-variant-numeric:tabular-nums}

.wp-footer{display:flex;justify-content:space-between;align-items:flex-start;margin-top:16px;padding:0 4px}
.wp-epay{display:flex;align-items:center;gap:4px;font-size:12px;color:#52525b}
.wp-epay-star{font-weight:700;color:#18181b}
.wp-epay-label{font-weight:600}
.wp-epay-input{width:100px;border:1px solid #d4d4d8;border-radius:4px;padding:4px 6px;font-size:12px;text-align:right;font-family:inherit}
.wp-epay-input::-webkit-inner-spin-button,.wp-epay-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.wp-epay-input{-moz-appearance:textfield}
.wp-epay-ts{font-size:11px;color:#71717a;margin-left:6px}
.wp-epay-fv{font-weight:600}
.wp-epay-fd{margin-left:4px;font-size:11px;color:#555}

.wp-prepared{font-size:12px;color:#52525b;text-align:right}
.wp-prepared-label{font-weight:500}
.wp-prepared-input{width:90px;border:1px solid #d4d4d8;border-radius:4px;padding:4px 6px;font-size:12px;font-family:inherit}
.wp-prepared-fv{font-weight:600}
.wp-prepared-date-row{margin-top:2px}
.wp-prepared-date-val{font-size:12px;color:#52525b}


.wp-amt-val{font-variant-numeric:tabular-nums;font-weight:600}

.wp-tbl tbody tr[draggable]{cursor:grab}
.wp-tbl tbody tr[draggable]:active{cursor:grabbing}
.wp-drag-over{background:#dbeafe!important}
.wp-drag-over td{border-bottom:2px solid #2563eb!important}
.wp-grip{color:#a1a1aa;font-size:10px;letter-spacing:-1px;user-select:none}

.wp-btn-sup{display:none}
@media (max-width: 768px) {
  .wp-btn-sup{display:inline-block}
  .wp-layout{flex-direction:column;padding:12px 8px 100px}
  .wp-sidebar{display:none;width:100%;position:static;max-height:50vh}
  .wp-sidebar.wp-sidebar-open{display:block}
  .wp-main{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .wp-tbl{min-width:700px}
  .wp-bar{padding:0 12px}
}
@media print{
  .no-print,.noP{display:none!important}
  .wp-root{background:#fff;min-height:0!important}
  .wp-bar{display:none}
  .wp-layout{display:none!important}
  .wp-print-body{display:block!important;padding:0}
  .wp-print-header{display:block!important;text-align:center;margin-bottom:20px}
  .wp-print-title{font-size:16px;font-weight:700;color:#000}
  .wp-print-week{font-size:14px;font-weight:700;color:#000;margin-top:2px}
  .wp-tbl{font-size:12px}
  .wp-tbl thead th{padding:8px 10px;border-bottom:2px solid #333!important;background:#fff}
  .wp-tbl tbody td{padding:6px 10px;border-bottom:1px solid #666!important}
  .wp-total-row td{border-top:2px solid #333!important}
  .wp-total-val{font-size:14px}
  .wp-footer{margin-top:12px}
  @page{size:A4 portrait;margin:10mm 8mm}
}
`;

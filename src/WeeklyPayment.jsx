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
  const commit = () => { if (local !== value) onChange(local); };
  return (
    <input
      ref={ref}
      type={type || 'text'}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { commit(); ref.current?.blur(); } }}
      placeholder={placeholder || ''}
      className="wp-input"
      style={{ textAlign: align || 'left', ...style }}
    />
  );
}

export default function WeeklyPayment() {
  const [allData, setAllData] = useState(load);
  const friday = getNextFriday();
  const [weekDate, setWeekDate] = useState(() => {
    const saved = allData._currentWeek;
    return saved || dateToInput(friday);
  });
  const wk = weekDate;
  const data = allData[wk] || { rows: [], epayBalance: '', epayDate: '', preparedBy: 'Sabrina', preparedDate: '' };
  const rows = data.rows || [];

  const save = useCallback((newData) => {
    setAllData(newData);
    try { localStorage.setItem(LS_KEY, JSON.stringify(newData)); } catch {}
  }, []);

  const updateData = useCallback((patch) => {
    const next = { ...allData, [wk]: { ...data, ...patch }, _currentWeek: wk };
    save(next);
  }, [allData, wk, data, save]);

  const updateRow = useCallback((idx, patch) => {
    const newRows = rows.map((r, i) => i === idx ? { ...r, ...patch } : r);
    updateData({ rows: newRows });
  }, [rows, updateData]);

  const addRow = useCallback(() => {
    updateData({ rows: [...rows, { supplier: '', bank: '', amount: '', paymentFor: '', remark: '' }] });
  }, [rows, updateData]);

  const removeRow = useCallback((idx) => {
    updateData({ rows: rows.filter((_, i) => i !== idx) });
  }, [rows, updateData]);

  const selectSupplier = useCallback((idx, name) => {
    const bank = BANK_MAP[name] || '';
    updateRow(idx, { supplier: name, bank });
  }, [updateRow]);

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const weekLabel = (() => {
    const parts = weekDate.split('-');
    if (parts.length !== 3) return weekDate;
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return formatDate(d);
  })();

  useEffect(() => {
    document.title = `Weekly Payment Summary`;
  }, []);

  const clearWeek = () => {
    if (!confirm(`Clear all entries for week ending ${weekLabel}?`)) return;
    const next = { ...allData };
    delete next[wk];
    save(next);
  };

  return (
    <div className="wp-root">
      <style>{CSS}</style>
      <div className="wp-bar no-print">
        <h1>WEEKLY PAYMENT SUMMARY</h1>
        <div className="wp-acts">
          <label className="wp-date-label">
            Week ending:
            <input type="date" value={weekDate} onChange={e => { setWeekDate(e.target.value); const next = { ...allData, _currentWeek: e.target.value }; save(next); }} className="wp-date-input" />
          </label>
          <button className="wp-btn wp-btn-add" onClick={addRow}>+ Add Row</button>
          <button className="wp-btn wp-btn-o" onClick={clearWeek}>Clear</button>
          <button className="wp-btn" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="wp-layout no-print">
        <div className="wp-main">
          <div className="wp-print-header">
            <img src={cjkLetterhead} alt="CHAI JEE KIONG TRADING SDN. BHD." className="wp-letterhead" />
            <div className="wp-print-title">Weekly Payment Summary</div>
            <div className="wp-print-week">(Week Ending {weekLabel})</div>
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
                <th className="wp-th-del no-print"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="wp-no">{i + 1}</td>
                  <td className="wp-sup-cell">
                    <select
                      className="wp-select no-print"
                      value={r.supplier}
                      onChange={e => selectSupplier(i, e.target.value)}
                    >
                      <option value="">— Select supplier —</option>
                      {SUPPLIERS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                    <span className="wp-sup-print">{r.supplier}</span>
                  </td>
                  <td className="wp-bank">{r.bank || '-'}</td>
                  <td className="wp-amt">
                    <EditableCell
                      value={r.amount}
                      onChange={v => updateRow(i, { amount: v })}
                      type="number"
                      placeholder="0.00"
                      align="right"
                    />
                    <span className="wp-amt-print">{r.amount ? nf(r.amount) : '-'}</span>
                  </td>
                  <td>
                    <EditableCell
                      value={r.paymentFor}
                      onChange={v => updateRow(i, { paymentFor: v })}
                      placeholder="e.g. 8/2026"
                    />
                    <span className="wp-pf-print">{r.paymentFor || ''}</span>
                  </td>
                  <td>
                    <EditableCell
                      value={r.remark}
                      onChange={v => updateRow(i, { remark: v })}
                      placeholder=""
                    />
                    <span className="wp-rmk-print">{r.remark || ''}</span>
                  </td>
                  <td className="wp-del-cell no-print">
                    <button className="wp-del" onClick={() => removeRow(i)} title="Remove row">✕</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan="7" className="wp-empty">No entries yet — click "+ Add Row" to start</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="wp-total-row">
                <td></td>
                <td className="wp-total-label">TOTAL AMOUNT PAYABLE =</td>
                <td></td>
                <td className="wp-total-val">RM {nf(total)}</td>
                <td></td>
                <td></td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </table>

          <div className="wp-footer">
            <div className="wp-epay">
              <span className="wp-epay-star">*</span>
              <span className="wp-epay-label no-print">EPAY BALANCE: RM</span>
              <span className="wp-epay-label-print">EPAY BALANCE: RM</span>
              <input
                className="wp-epay-input no-print"
                type="number"
                value={data.epayBalance}
                onChange={e => updateData({ epayBalance: e.target.value })}
                placeholder="0.00"
              />
              <span className="wp-epay-val-print">{data.epayBalance ? nf(data.epayBalance) : ''}</span>
              {data.epayDate && <span className="wp-epay-date-print">({data.epayDate})</span>}
              <input
                className="wp-epay-date no-print"
                type="text"
                value={data.epayDate || ''}
                onChange={e => updateData({ epayDate: e.target.value })}
                placeholder="date/time"
              />
            </div>
            <div className="wp-prepared">
              <div>
                <span className="wp-prepared-label">Prepared by </span>
                <input
                  className="wp-prepared-input no-print"
                  type="text"
                  value={data.preparedBy || 'Sabrina'}
                  onChange={e => updateData({ preparedBy: e.target.value })}
                />
                <span className="wp-prepared-print">{data.preparedBy || 'Sabrina'}</span>
              </div>
              <div className="wp-prepared-date-row">
                <input
                  className="wp-prepared-date no-print"
                  type="date"
                  value={data.preparedDate || ''}
                  onChange={e => updateData({ preparedDate: e.target.value })}
                />
                <span className="wp-prepared-date-print">{data.preparedDate ? formatDate(new Date(data.preparedDate + 'T00:00:00')) : ''}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="wp-sidebar">
          <div className="wp-reminder">
            <div className="wp-reminder-title">Payment Schedule Reference</div>
            {REMINDERS.map(r => (
              <div key={r.period} className="wp-reminder-group">
                <div className="wp-reminder-period">{r.period}</div>
                <div className="wp-reminder-list">
                  {r.suppliers.map(s => (
                    <span key={s} className="wp-reminder-chip">{s}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Print-only version (no sidebar layout) */}
      <div className="wp-print-body">
        <div className="wp-print-header">
          <div className="wp-print-title">Weekly Payment Summary</div>
          <div className="wp-print-week">(Week Ending {weekLabel})</div>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="wp-no">{i + 1}</td>
                <td className="wp-sup-cell"><span>{r.supplier}</span></td>
                <td className="wp-bank">{r.bank || '-'}</td>
                <td className="wp-amt"><span className="wp-amt-val">{r.amount ? nf(r.amount) : '-'}</span></td>
                <td>{r.paymentFor || ''}</td>
                <td>{r.remark || ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="wp-total-row">
              <td></td>
              <td className="wp-total-label">TOTAL AMOUNT PAYABLE =</td>
              <td></td>
              <td className="wp-total-val">RM {nf(total)}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="wp-footer">
          <div className="wp-epay">
            <span className="wp-epay-star">*</span>
            <span>EPAY BALANCE: RM</span>
            <span className="wp-epay-fv">{data.epayBalance ? nf(data.epayBalance) : ''}</span>
            {data.epayDate && <span className="wp-epay-fd">({data.epayDate})</span>}
          </div>
          <div className="wp-prepared">
            <div><span className="wp-prepared-label">Prepared by </span><span className="wp-prepared-fv">{data.preparedBy || 'Sabrina'}</span></div>
            <div className="wp-prepared-date-print">{data.preparedDate ? formatDate(new Date(data.preparedDate + 'T00:00:00')) : ''}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.wp-root{background:#fafafa;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wp-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.wp-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b;white-space:nowrap}
.wp-acts{margin-left:auto;display:flex;align-items:center;gap:10px}
.wp-btn{border:1px solid #18181b;background:#18181b;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.wp-btn:hover{background:#000}
.wp-btn-o{background:#fff;color:#18181b}
.wp-btn-o:hover{background:#f4f4f5}
.wp-btn-add{background:#2563eb;border-color:#2563eb}
.wp-btn-add:hover{background:#1d4ed8}
.wp-date-label{font-size:12px;font-weight:600;color:#52525b;display:flex;align-items:center;gap:6px}
.wp-date-input{border:1px solid #d4d4d8;border-radius:6px;padding:5px 8px;font-size:13px;font-family:inherit;color:#18181b}

.wp-layout{display:flex;gap:20px;max-width:1300px;margin:0 auto;padding:28px 24px 80px;align-items:flex-start}
.wp-main{flex:1;min-width:0}
.wp-sidebar{width:220px;flex-shrink:0;position:sticky;top:72px}
.wp-print-body{display:none}

.wp-print-header{display:none}
.wp-letterhead{width:100%;max-width:580px;display:block;margin:0 auto 12px}

.wp-tbl{width:100%;border-collapse:collapse;font-size:13px}
.wp-tbl thead th{text-align:left;padding:10px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#52525b;border-bottom:2px solid #666;background:#fafafa}
.wp-th-no{width:40px;text-align:center}
.wp-th-sup{width:28%}
.wp-th-bank{width:22%}
.wp-th-amt{width:14%;text-align:right}
.wp-th-pf{width:12%}
.wp-th-rmk{width:14%}
.wp-th-del{width:30px}

.wp-tbl tbody td{padding:4px 10px;border-bottom:1px solid #e4e4e7;vertical-align:middle}
.wp-no{text-align:center;color:#71717a;font-weight:600;font-size:12px}
.wp-bank{font-size:12px;color:#18181b;font-variant-numeric:tabular-nums;font-weight:500}

.wp-select{width:100%;border:1px solid #d4d4d8;border-radius:5px;padding:5px 6px;font-size:12px;font-family:inherit;background:#fff;color:#18181b;cursor:pointer}
.wp-select:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.wp-sup-print{display:none}

.wp-input{width:100%;border:1px solid #e4e4e7;border-radius:4px;padding:5px 6px;font-size:12px;font-family:inherit;color:#18181b;background:#fff}
.wp-input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.wp-input::-webkit-inner-spin-button,.wp-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.wp-input{-moz-appearance:textfield}
.wp-amt-print,.wp-pf-print,.wp-rmk-print{display:none}

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
.wp-epay-label-print{display:none;font-weight:600}
.wp-epay-input{width:100px;border:1px solid #d4d4d8;border-radius:4px;padding:4px 6px;font-size:12px;text-align:right;font-family:inherit}
.wp-epay-input::-webkit-inner-spin-button,.wp-epay-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.wp-epay-input{-moz-appearance:textfield}
.wp-epay-date{width:130px;border:1px solid #d4d4d8;border-radius:4px;padding:4px 6px;font-size:11px;font-family:inherit;margin-left:4px}
.wp-epay-val-print{display:none}
.wp-epay-date-print{display:none}
.wp-epay-fv{font-weight:600}
.wp-epay-fd{margin-left:4px;font-size:11px;color:#555}

.wp-prepared{font-size:12px;color:#52525b;text-align:right}
.wp-prepared-label{font-weight:500}
.wp-prepared-input{width:90px;border:1px solid #d4d4d8;border-radius:4px;padding:4px 6px;font-size:12px;font-family:inherit}
.wp-prepared-print{display:none}
.wp-prepared-fv{font-weight:600}
.wp-prepared-date-row{margin-top:2px}
.wp-prepared-date{border:1px solid #d4d4d8;border-radius:4px;padding:4px 6px;font-size:12px;font-family:inherit}
.wp-prepared-date-print{display:none;font-size:12px;color:#333;margin-top:2px}

.wp-reminder{padding:16px;background:#f4f4f5;border-radius:10px}
.wp-reminder-title{font-size:13px;font-weight:700;color:#18181b;margin-bottom:12px;letter-spacing:.02em}
.wp-reminder-group{background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #e4e4e7;margin-bottom:8px}
.wp-reminder-group:last-child{margin-bottom:0}
.wp-reminder-period{font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.wp-reminder-list{display:flex;flex-wrap:wrap;gap:4px}
.wp-reminder-chip{font-size:11px;padding:2px 8px;background:#eff6ff;color:#1e40af;border-radius:4px;font-weight:500}

.wp-amt-val{font-variant-numeric:tabular-nums;font-weight:600}

@media print{
  .no-print{display:none!important}
  .wp-root{background:#fff}
  .wp-bar{display:none}
  .wp-layout{display:none!important}
  .wp-print-body{display:block!important;padding:0}
  .wp-print-header{display:block!important;text-align:center;margin-bottom:20px}
  .wp-print-title{font-size:16px;font-weight:700;color:#000}
  .wp-print-week{font-size:13px;color:#333;margin-top:2px}
  .wp-tbl{font-size:12px}
  .wp-tbl thead th{padding:8px 10px;border-bottom:2px solid #333!important;background:#fff}
  .wp-tbl tbody td{padding:6px 10px;border-bottom:1px solid #666!important}
  .wp-total-row td{border-top:2px solid #333!important}
  .wp-total-val{font-size:14px}
  .wp-footer{margin-top:12px}
  .wp-prepared-date-print{display:block!important}
  @page{size:A4 portrait;margin:15mm}
}
`;

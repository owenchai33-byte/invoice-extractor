import { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { computeStaffMonth, fmt, LS_S, LS_P, LS_H, LS_SB } from './Payroll';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function loadJ(k, f) { try { return JSON.parse(localStorage.getItem(k)) || f; } catch { return f; } }
function pad(n) { return String(n).padStart(2, '0'); }

export default function StatutorySummary() {
  const now = new Date();
  const [mo, setMo] = useState(() => { try { const v = localStorage.getItem('cjk_ep_mo'); return v !== null ? Number(v) : now.getMonth(); } catch { return now.getMonth(); } });
  const [yr, setYr] = useState(() => { try { const v = localStorage.getItem('cjk_ep_yr'); return v !== null ? Number(v) : now.getFullYear(); } catch { return now.getFullYear(); } });
  const atMin = mo === 6 && yr === 2026;
  const mk = `${yr}-${pad(mo + 1)}`;
  const ref = new Date(yr, mo, 15);

  const staff = useMemo(() => loadJ(LS_S, []), []);
  const pd = useMemo(() => loadJ(LS_P, {}), []);
  const hidden = useMemo(() => loadJ(LS_H, {}), []);
  const sb = useMemo(() => { try { const v = localStorage.getItem(LS_SB); return v === null ? true : JSON.parse(v); } catch { return true; } }, []);

  const visible = useMemo(() => {
    const hSet = new Set(hidden[mk] || []);
    return staff.filter(s => !hSet.has(s.id));
  }, [staff, hidden, mk]);

  const rows = useMemo(() => visible.map(s => computeStaffMonth(s, pd[mk]?.[s.id], ref, sb)), [visible, pd, mk, ref, sb]);

  const totals = useMemo(() => {
    const t = { epfM: 0, epfP: 0, socsoM: 0, socsoP: 0, eisM: 0, eisP: 0 };
    rows.forEach(r => {
      t.epfM += r.epfM; t.epfP += r.epfP;
      t.socsoM += r.socsoM; t.socsoP += r.socsoP;
      t.eisM += r.eisE; t.eisP += r.eisE;
    });
    Object.keys(t).forEach(k => t[k] = Math.round(t[k] * 100) / 100);
    return t;
  }, [rows]);

  const changeMonth = useCallback((d) => {
    if (d < 0) {
      if (mo === 6 && yr === 2026) return;
      if (mo === 0) { setMo(11); setYr(y => y - 1); } else setMo(m => m - 1);
    } else {
      if (mo === 11) { setMo(0); setYr(y => y + 1); } else setMo(m => m + 1);
    }
  }, [mo, yr]);

  const exportXls = useCallback(() => {
    const header = ['NO', 'NAME', 'IC NO', 'EPF (M)', 'EPF (P)', 'JUMLAH EPF', 'SOCSO (M)', 'SOCSO (P)', 'JUMLAH SOCSO', 'EIS (M)', 'EIS (P)', 'JUMLAH EIS'];
    const data = rows.map((r, i) => [
      i + 1, r.name, r.ic,
      r.epfM, r.epfP, r.epfM + r.epfP,
      r.socsoM, r.socsoP, r.socsoM + r.socsoP,
      r.eisE, r.eisE, r.eisE * 2,
    ]);
    data.push([
      '', 'TOTAL', '',
      totals.epfM, totals.epfP, Math.round((totals.epfM + totals.epfP) * 100) / 100,
      totals.socsoM, totals.socsoP, Math.round((totals.socsoM + totals.socsoP) * 100) / 100,
      totals.eisM, totals.eisP, Math.round((totals.eisM + totals.eisP) * 100) / 100,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statutory');
    XLSX.writeFile(wb, `Statutory Summary - ${MONTHS[mo]} ${yr}.xlsx`);
  }, [rows, totals, mo, yr]);

  const th = { padding: '8px 10px', fontSize: 12, fontWeight: 700, textAlign: 'center', borderBottom: '2px solid #e4e4e7', whiteSpace: 'nowrap', color: '#18181b' };
  const td = { padding: '7px 10px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid #f4f4f5', color: '#18181b', fontFamily: 'monospace' };
  const tdName = { ...td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500 };
  const btn = { padding: '6px 14px', borderRadius: 7, border: '1px solid #e4e4e7', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 };

  return (
    <div style={{ padding: '20px 24px', fontFamily: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif` }}>
      <div className="noP" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button disabled={atMin} onClick={() => changeMonth(-1)} style={{ ...btn, width: 28, height: 28, padding: 0, opacity: atMin ? 0.4 : 1, cursor: atMin ? 'default' : 'pointer' }}>&#9664;</button>
          <div style={{ fontSize: 14, fontWeight: 700, minWidth: 140, textAlign: 'center', color: '#18181b' }}>
            {MONTHS[mo]} {yr}
          </div>
          <button onClick={() => changeMonth(1)} style={{ ...btn, width: 28, height: 28, padding: 0 }}>&#9654;</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportXls} style={{ ...btn, background: '#111', color: '#fff' }}>⬇ Export Excel</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#a1a1aa', padding: 60, fontSize: 14 }}>No payroll data for this month</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ ...th, textAlign: 'center', width: 40 }}>NO</th>
                <th style={{ ...th, textAlign: 'left', minWidth: 180 }}>NAME</th>
                <th colSpan={3} style={{ ...th, background: '#eff6ff', borderBottom: '2px solid #bfdbfe' }}>EPF</th>
                <th colSpan={3} style={{ ...th, background: '#f0fdf4', borderBottom: '2px solid #bbf7d0' }}>SOCSO</th>
                <th colSpan={3} style={{ ...th, background: '#fefce8', borderBottom: '2px solid #fef08a' }}>EIS</th>
              </tr>
              <tr style={{ background: '#fafafa' }}>
                <th style={th} />
                <th style={th} />
                <th style={{ ...th, background: '#eff6ff', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: '#eff6ff', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: '#eff6ff', fontSize: 11 }}>Jumlah</th>
                <th style={{ ...th, background: '#f0fdf4', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: '#f0fdf4', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: '#f0fdf4', fontSize: 11 }}>Jumlah</th>
                <th style={{ ...th, background: '#fefce8', fontSize: 11 }}>Majikan</th>
                <th style={{ ...th, background: '#fefce8', fontSize: 11 }}>Pekerja</th>
                <th style={{ ...th, background: '#fefce8', fontSize: 11 }}>Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
                  <td style={{ ...td, textAlign: 'center', fontFamily: 'inherit', color: '#71717a' }}>{i + 1}</td>
                  <td style={tdName}>{r.name}</td>
                  <td style={td}>{fmt(r.epfM)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(r.epfP)}</td>
                  <td style={{ ...td, color: '#2563eb' }}>{fmt(r.epfM + r.epfP)}</td>
                  <td style={td}>{fmt(r.socsoM)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(r.socsoP)}</td>
                  <td style={{ ...td, color: '#16a34a' }}>{fmt(r.socsoM + r.socsoP)}</td>
                  <td style={td}>{fmt(r.eisE)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(r.eisE)}</td>
                  <td style={{ ...td, color: '#ca8a04' }}>{fmt(r.eisE * 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f4f4f5', fontWeight: 700 }}>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none' }} />
                <td style={{ ...tdName, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700 }}>TOTAL</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none' }}>{fmt(totals.epfM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700 }}>{fmt(totals.epfP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#2563eb', fontSize: 13 }}>{fmt(Math.round((totals.epfM + totals.epfP) * 100) / 100)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none' }}>{fmt(totals.socsoM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700 }}>{fmt(totals.socsoP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#16a34a', fontSize: 13 }}>{fmt(Math.round((totals.socsoM + totals.socsoP) * 100) / 100)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none' }}>{fmt(totals.eisM)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', fontWeight: 700 }}>{fmt(totals.eisP)}</td>
                <td style={{ ...td, borderTop: '2px solid #d4d4d8', borderBottom: 'none', color: '#ca8a04', fontSize: 13 }}>{fmt(Math.round((totals.eisM + totals.eisP) * 100) / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

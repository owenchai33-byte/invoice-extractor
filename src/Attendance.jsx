import { useState, useRef, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SARAWAK_HOLIDAYS = {
  2026: {
    '01-01': "New Year's Day",
    '02-17': 'Chinese New Year',
    '02-18': 'Chinese New Year',
    '03-20': 'Hari Raya Aidilfitri',
    '03-21': 'Hari Raya Aidilfitri',
    '03-23': 'Hari Raya Aidilfitri',
    '04-03': 'Good Friday',
    '05-01': 'Labour Day',
    '05-27': 'Hari Raya Haji',
    '06-01': 'Gawai Dayak',
    '06-02': 'Gawai Dayak',
    '06-03': 'Wesak Day (in lieu)',
    '06-04': 'Gawai Dayak (in lieu)',
    '06-17': 'Awal Muharram',
    '07-22': 'Sarawak Day',
    '08-25': 'Maulidur Rasul',
    '08-31': 'National Day',
    '09-16': 'Malaysia Day',
    '10-10': "TYT Birthday",
    '12-25': 'Christmas Day',
  },
};

const START_MIN = 8 * 60;
const END_WD = 16 * 60 + 45;
const END_SAT = 15 * 60 + 10;
const BREAK_ALLOW = 45;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(s) { return s ? `${pad(s.h)}:${pad(s.m)}` : '-'; }
function toMin(s) { return s.h * 60 + s.m; }

function parseLocalDate(str) {
  const [y, m, d] = str.replace(/\//g, '-').split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getHoliday(dk) {
  const y = parseInt(dk.substring(0, 4));
  const mmdd = dk.substring(5);
  return (SARAWAK_HOLIDAYS[y] || {})[mmdd] || null;
}

function inBreakWindow(s) {
  const m = toMin(s);
  return m >= 11 * 60 && m <= 14 * 60 + 45;
}

async function parsePDF(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const records = [];
  let from = '', to = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim());

    const rowMap = new Map();
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      let key = null;
      for (const [k] of rowMap) {
        if (Math.abs(k - y) < 5) { key = k; break; }
      }
      if (key !== null) rowMap.get(key).push(item);
      else rowMap.set(y, [item]);
    }

    for (const [, ri] of [...rowMap.entries()].sort((a, b) => b[0] - a[0])) {
      const text = ri.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str.trim()).join(' ');

      const pm = text.match(/From\s+(\d{4}\/\d{2}\/\d{2})\s+to\s+(\d{4}\/\d{2}\/\d{2})/i);
      if (pm) { from = pm[1]; to = pm[2]; continue; }

      const m = text.match(/^(\d+)\s+(.+?)\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+Check/i);
      if (m) {
        records.push({ id: parseInt(m[1]), name: m[2].trim(), date: m[3], time: m[4] });
      }
    }
  }

  return { records, from: from.replace(/\//g, '-'), to: to.replace(/\//g, '-') };
}

function parseExcel(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  const records = [];
  let from = '', to = '', headerFound = false;

  for (const row of rows) {
    if (!row || !row.length) continue;
    const text = row.join(' ');

    const pm = text.match(/From\s+(\d{4}\/\d{2}\/\d{2})\s+to\s+(\d{4}\/\d{2}\/\d{2})/i);
    if (pm) { from = pm[1]; to = pm[2]; continue; }

    if (/Employee\s*Staff\s*ID/i.test(text)) { headerFound = true; continue; }

    if (headerFound && row.length >= 3) {
      const id = parseInt(row[0]);
      if (!id) continue;
      const name = String(row[1] || '');
      const dt = String(row[2] || '');
      const dtm = dt.match(/(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})/);
      if (dtm) {
        records.push({ id, name: name.trim(), date: dtm[1], time: dtm[2] });
      }
    }
  }

  return { records, from: from.replace(/\//g, '-'), to: to.replace(/\//g, '-') };
}

function processRecords({ records, from, to }) {
  const emps = {};
  for (const r of records) {
    if (!emps[r.id]) emps[r.id] = { id: r.id, name: r.name, scans: {} };
    const dk = r.date.replace(/\//g, '-');
    if (!emps[r.id].scans[dk]) emps[r.id].scans[dk] = [];
    const [h, m] = r.time.split(':').map(Number);
    emps[r.id].scans[dk].push({ h, m });
  }

  if (!from || !to) {
    const allDates = records.map(r => r.date.replace(/\//g, '-')).sort();
    if (allDates.length) { from = allDates[0]; to = allDates[allDates.length - 1]; }
    else return {};
  }

  const results = {};

  for (const [eid, emp] of Object.entries(emps)) {
    for (const scans of Object.values(emp.scans)) {
      scans.sort((a, b) => toMin(a) - toMin(b));
    }

    const days = [];
    const start = parseLocalDate(from);
    const end = parseLocalDate(to);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dk = dateKey(d);
      const dow = d.getDay();
      const isSun = dow === 0;
      const isSat = dow === 6;
      const holiday = getHoliday(dk);
      const scans = emp.scans[dk] || [];

      const day = {
        date: dk,
        dateShort: `${d.getDate()}/${d.getMonth() + 1}`,
        day: DAY_NAMES[dow],
        holiday,
        scans,
        clockIn: null, clockOut: null,
        breakOut: null, breakIn: null,
        extras: [],
        lateIn: 0, breakExcess: 0, earlyOut: 0, otRef: 0,
        type: 'absent',
        remarks: [],
      };

      if (isSun || holiday) {
        day.type = isSun ? 'off' : 'holiday';
        if (scans.length) {
          day.clockIn = scans[0];
          if (scans.length > 1) day.clockOut = scans[scans.length - 1];
          day.remarks.push(isSun ? 'Worked on Sunday' : `Worked on ${holiday}`);
        }
        days.push(day);
        continue;
      }

      if (!scans.length) { days.push(day); continue; }

      day.clockIn = scans[0];
      if (scans.length > 1) day.clockOut = scans[scans.length - 1];

      const endMin = isSat ? END_SAT : END_WD;

      if (scans.length === 1) {
        day.type = 'incomplete';
        day.remarks.push('Single scan');
      } else if (scans.length === 2) {
        const firstMorning = scans[0].h < 11;
        const lastAfternoon = toMin(scans[1]) >= 14 * 60;
        if (firstMorning && lastAfternoon) {
          day.type = 'full';
          day.remarks.push('No break scan');
        } else if (firstMorning) {
          day.type = 'half-am';
        } else {
          day.type = 'half-pm';
        }
      } else {
        let firstMorning = scans[0].h < 11;
        const lastAfternoon = toMin(scans[scans.length - 1]) >= 14 * 60;

        if (firstMorning) {
          const wouldBeLate = toMin(scans[0]) - START_MIN;
          const gapToSecond = toMin(scans[1]) - toMin(scans[0]);
          if (wouldBeLate > 50 && gapToSecond >= 20 && gapToSecond <= 70) {
            firstMorning = false;
          }
        }

        if (!firstMorning) day.clockIn = null;
        if (!lastAfternoon) day.clockOut = null;

        const midStart = firstMorning ? 1 : 0;
        const midEnd = lastAfternoon ? scans.length - 1 : scans.length;
        const middle = scans.slice(midStart, midEnd);

        let foundBO = null, foundBI = null;
        if (middle.length >= 2) {
          let bestDist = Infinity;
          for (let j = 1; j < middle.length; j++) {
            if (!inBreakWindow(middle[j])) continue;
            for (let i = 0; i < j; i++) {
              if (!inBreakWindow(middle[i])) continue;
              const gap = toMin(middle[j]) - toMin(middle[i]);
              if (gap >= 20 && gap <= 70) {
                const dist = Math.abs(gap - BREAK_ALLOW);
                if (dist < bestDist) { bestDist = dist; foundBO = middle[i]; foundBI = middle[j]; }
              }
            }
          }
          if (!foundBO) {
            bestDist = Infinity;
            for (let j = 1; j < middle.length; j++) {
              for (let i = 0; i < j; i++) {
                const gap = toMin(middle[j]) - toMin(middle[i]);
                if (gap >= 20 && gap <= 70) {
                  const dist = Math.abs(gap - BREAK_ALLOW);
                  if (dist < bestDist) { bestDist = dist; foundBO = middle[i]; foundBI = middle[j]; }
                }
              }
            }
          }
        }

        if (foundBO) {
          day.breakOut = foundBO;
          day.breakIn = foundBI;
          day.extras = middle.filter(s => s !== foundBO && s !== foundBI);
        } else if (middle.length === 1) {
          day.breakOut = middle[0];
          day.remarks.push('Single break scan');
        } else if (middle.length === 0) {
          if (firstMorning && lastAfternoon) day.remarks.push('No break scan');
        } else {
          day.extras = middle;
          day.remarks.push('Break not detected');
        }

        if (firstMorning && lastAfternoon) {
          day.type = 'full';
        } else if (firstMorning) {
          day.type = 'half-am';
          day.remarks.push('No clock out');
        } else if (lastAfternoon) {
          day.type = 'half-pm';
          day.remarks.push('No clock in');
        } else {
          day.type = 'incomplete';
          day.remarks.push('No AM/PM scan');
        }
      }

      if (day.type === 'full') {
        const inM = toMin(day.clockIn);
        if (inM > START_MIN) day.lateIn = inM - START_MIN;

        if (day.breakOut && day.breakIn) {
          const dur = toMin(day.breakIn) - toMin(day.breakOut);
          if (dur > BREAK_ALLOW) day.breakExcess = dur - BREAK_ALLOW;
        }

        if (day.clockOut) {
          const outM = toMin(day.clockOut);
          if (outM < endMin) {
            day.earlyOut = endMin - outM;
          } else if (outM > endMin) {
            const net = (outM - endMin) - day.lateIn - day.breakExcess;
            if (net > 0) day.otRef = net;
          }
        }
      }

      if (day.type === 'half-am' || day.type === 'half-pm') {
        let workedMin = toMin(scans[scans.length - 1]) - toMin(scans[0]);
        if (day.breakOut && day.breakIn) {
          workedMin -= (toMin(day.breakIn) - toMin(day.breakOut));
        }
        const hrs = Math.floor(workedMin / 60);
        const mins = workedMin % 60;
        day.remarks.push(`Worked ${hrs}h ${pad(mins)}m`);
      }

      days.push(day);
    }

    const working = days.filter(d => d.type !== 'off' && d.type !== 'holiday');
    const present = working.filter(d => d.scans.length > 0);
    const absent = working.filter(d => d.type === 'absent');
    const half = days.filter(d => d.type === 'half-am' || d.type === 'half-pm');

    results[eid] = {
      ...emp, days, period: { from, to },
      summary: {
        working: working.length,
        present: present.length,
        absent: absent.length,
        half: half.length,
        lateIn: days.reduce((s, d) => s + d.lateIn, 0),
        breakExcess: days.reduce((s, d) => s + d.breakExcess, 0),
        earlyOut: days.reduce((s, d) => s + d.earlyOut, 0),
      },
    };
  }

  return results;
}

function Remarks({ d }) {
  const parts = [];
  if (d.type === 'off') parts.push({ text: d.scans.length ? 'Sunday (worked)' : 'Sunday' });
  else if (d.type === 'holiday') parts.push({ text: d.holiday + (d.scans.length ? ' (worked)' : '') });
  else if (d.type === 'absent') parts.push({ text: 'Absent', bold: true });
  else if (d.type === 'half-am') parts.push({ text: 'Half day (AM)', bold: true });
  else if (d.type === 'half-pm') parts.push({ text: 'Half day (PM)', bold: true });
  else if (d.type === 'incomplete') parts.push({ text: 'Incomplete' });
  d.remarks.forEach(r => parts.push({ text: r }));
  return parts.map((p, i) => (
    <span key={i}>{i > 0 ? ' · ' : ''}{p.bold ? <strong>{p.text}</strong> : p.text}</span>
  ));
}

const th = {
  padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: '#52525b', borderBottom: '2px solid #e4e4e7', whiteSpace: 'nowrap',
};
const td = {
  padding: '6px 10px', borderBottom: '1px solid #f4f4f5', whiteSpace: 'nowrap',
};
const btn = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid #d4d4d8',
  background: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'inherit',
};

function getPayrollOrder() {
  try {
    const staff = JSON.parse(localStorage.getItem('cjk_payroll_staff_v3') || '[]');
    return staff.map(s => s.name.toUpperCase().trim());
  } catch { return []; }
}

function sortByPayroll(data) {
  const order = getPayrollOrder();
  return Object.keys(data).sort((a, b) => {
    const nameA = data[a].name.toUpperCase().trim();
    const nameB = data[b].name.toUpperCase().trim();
    const idxA = order.indexOf(nameA);
    const idxB = order.indexOf(nameB);
    if (idxA === -1 && idxB === -1) return parseInt(a) - parseInt(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
}

function StatCard({ label, value, warn }) {
  return (
    <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: warn ? '#dc2626' : '#18181b' }}>{value}</div>
    </div>
  );
}

const ATT_DATA_KEY = 'cjk_attendance_v1';
const ATT_SEL_KEY = 'cjk_attendance_sel_v1';

export default function Attendance() {
  const [data, setData] = useState(() => {
    try { const s = localStorage.getItem(ATT_DATA_KEY); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(ATT_SEL_KEY) || null; }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (data) localStorage.setItem(ATT_DATA_KEY, JSON.stringify(data));
    else localStorage.removeItem(ATT_DATA_KEY);
  }, [data]);

  useEffect(() => {
    if (selected) localStorage.setItem(ATT_SEL_KEY, selected);
    else localStorage.removeItem(ATT_SEL_KEY);
  }, [selected]);

  const handleFile = useCallback(async (file) => {
    setLoading(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const parsed = file.name.endsWith('.pdf') ? await parsePDF(buf) : parseExcel(buf);
      if (!parsed.records.length) throw new Error('No attendance records found in file');
      const results = processRecords(parsed);
      setData(results);
      setSelected(sortByPayroll(results)[0]);
    } catch (e) {
      setError(e.message || 'Failed to parse file');
    }
    setLoading(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.style.borderColor = '#d4d4d8';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const emp = data && selected ? data[selected] : null;
  const empIds = data ? sortByPayroll(data) : [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

      {/* ─── Upload ─── */}
      {!data && (
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onDragEnter={e => { e.currentTarget.style.borderColor = '#18181b'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = '#d4d4d8'; }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: '2px dashed #d4d4d8', borderRadius: 12, padding: '80px 40px',
            textAlign: 'center', cursor: 'pointer', background: '#fafafa',
            transition: 'border-color 200ms',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#18181b', marginBottom: 4 }}>
            Upload Attendance Records
          </div>
          <div style={{ fontSize: 13, color: '#71717a', marginBottom: 16 }}>
            Drag & drop or click to browse — PDF or Excel from face scan system
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
          {loading && <div style={{ fontSize: 13, color: '#71717a' }}>Processing...</div>}
          {error && <div style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {/* ─── Results ─── */}
      {emp && (
        <>
          {/* Screen header */}
          <div className="att-no-print" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
          }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#18181b' }}>
                Attendance Report
              </h2>
              <div style={{ fontSize: 13, color: '#71717a', marginTop: 2 }}>
                {emp.period.from} to {emp.period.to}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => window.print()} style={btn}>🖨 Print</button>
              <button onClick={() => { setData(null); setSelected(null); localStorage.removeItem(ATT_DATA_KEY); localStorage.removeItem(ATT_SEL_KEY); }} style={btn}>Upload New</button>
            </div>
          </div>

          {/* Employee tabs */}
          {empIds.length > 1 && (
            <div className="att-no-print" style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
              {empIds.map(id => (
                <button
                  key={id}
                  onClick={() => setSelected(id)}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    fontFamily: 'inherit',
                    border: selected === id ? '1.5px solid #18181b' : '1px solid #d4d4d8',
                    background: selected === id ? '#18181b' : '#fff',
                    color: selected === id ? '#fff' : '#18181b',
                    fontWeight: selected === id ? 600 : 500,
                  }}
                >
                  {data[id].name} (ID: {id})
                </button>
              ))}
            </div>
          )}

          {/* Print header */}
          <div className="att-print-only" style={{ display: 'none' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>CHAI JEE KIONG TRADING SDN BHD</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Attendance Report</div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                Period: {emp.period.from} to {emp.period.to}
              </div>
            </div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              <strong>Employee:</strong> {emp.name} &emsp; <strong>Staff ID:</strong> {emp.id}
            </div>
          </div>

          {/* Employee info (screen) */}
          <div className="att-no-print" style={{
            padding: '12px 16px', background: '#fff', border: '1px solid #e4e4e7',
            borderRadius: 8, marginBottom: 16, display: 'flex', gap: 24, fontSize: 13,
          }}>
            <div><span style={{ color: '#71717a' }}>Employee:</span> <strong>{emp.name}</strong></div>
            <div><span style={{ color: '#71717a' }}>Staff ID:</span> <strong>{emp.id}</strong></div>
            <div><span style={{ color: '#71717a' }}>Period:</span> <strong>{emp.period.from} to {emp.period.to}</strong></div>
          </div>

          {/* ─── Table ─── */}
          <div style={{ overflowX: 'auto' }}>
            <table className="att-table" style={{
              width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff',
              border: '1px solid #e4e4e7',
            }}>
              <thead>
                <tr style={{ background: '#f4f4f5' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Day</th>
                  <th style={th}>In</th>
                  <th style={th}>Break Out</th>
                  <th style={th}>Break In</th>
                  <th style={th}>Out</th>
                  <th style={th}>Extra</th>
                  <th style={{ ...th, color: '#dc2626' }}>Late In</th>
                  <th style={{ ...th, color: '#dc2626' }}>Break +</th>
                  <th style={{ ...th, color: '#dc2626' }}>Early Out</th>
                  <th style={{ ...th, borderLeft: '1px solid #e4e4e7' }}>Remarks</th>
                  <th style={{ ...th, minWidth: 120 }}>Reason / Notes</th>
                </tr>
              </thead>
              <tbody>
                {emp.days.map(d => {
                  const isOff = d.type === 'off' || d.type === 'holiday';
                  const isAbsent = d.type === 'absent';
                  const isHalf = d.type === 'half-am' || d.type === 'half-pm';
                  const bg = isOff ? '#f9fafb' : isAbsent ? '#fef3c7' : isHalf ? '#eff6ff' : '#fff';

                  if (isOff && !d.scans.length) {
                    const label = d.type === 'off' ? 'Sunday' : d.holiday;
                    return (
                      <tr key={d.date} style={{ background: bg }}>
                        <td style={{ ...td, fontWeight: 500 }}>{d.dateShort}</td>
                        <td style={td}>{d.day}</td>
                        <td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a3a3a3', fontStyle: 'italic' }}>
                          {label}
                        </td>
                        <td style={{ ...td, minWidth: 120, borderLeft: '1px solid #e4e4e7' }}>&nbsp;</td>
                      </tr>
                    );
                  }

                  const valStyle = (v) => ({
                    ...td,
                    color: v > 0 ? '#dc2626' : '#a3a3a3',
                    fontWeight: v > 0 ? 600 : 400,
                  });

                  return (
                    <tr key={d.date} style={{ background: bg }}>
                      <td style={{ ...td, fontWeight: 500 }}>{d.dateShort}</td>
                      <td style={td}>{d.day}</td>
                      <td style={td}>{fmtTime(d.clockIn)}</td>
                      <td style={td}>{fmtTime(d.breakOut)}</td>
                      <td style={td}>{fmtTime(d.breakIn)}</td>
                      <td style={td}>{fmtTime(d.clockOut)}</td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {d.extras?.length ? d.extras.map((s, i) => <div key={i}>{fmtTime(s)}</div>) : '-'}
                      </td>
                      <td style={valStyle(d.lateIn)}>{d.lateIn ? `${d.lateIn}m` : '-'}</td>
                      <td style={valStyle(d.breakExcess)}>{d.breakExcess ? `${d.breakExcess}m` : '-'}</td>
                      <td style={valStyle(d.earlyOut)}>{d.earlyOut ? `${d.earlyOut}m` : '-'}</td>
                      <td style={{ ...td, fontSize: 11, color: '#71717a', maxWidth: 200, borderLeft: '1px solid #e4e4e7' }}><Remarks d={d} /></td>
                      <td style={{ ...td, minWidth: 120, borderLeft: '1px solid #e4e4e7' }}>&nbsp;</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ─── Summary ─── */}
          <div style={{
            marginTop: 20, padding: '16px 20px', background: '#fff',
            border: '1px solid #e4e4e7', borderRadius: 8,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#18181b' }}>Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <StatCard label="Working Days" value={emp.summary.working} />
              <StatCard label="Present" value={emp.summary.present} />
              <StatCard label="Absent" value={emp.summary.absent} warn={emp.summary.absent > 0} />
              <StatCard label="Half Days" value={emp.summary.half} />
              <StatCard label="Total Late In" value={emp.summary.lateIn ? `${emp.summary.lateIn} min` : '0'} warn={emp.summary.lateIn > 0} />
              <StatCard label="Total Break Excess" value={emp.summary.breakExcess ? `${emp.summary.breakExcess} min` : '0'} warn={emp.summary.breakExcess > 0} />
              <StatCard label="Total Early Out" value={emp.summary.earlyOut ? `${emp.summary.earlyOut} min` : '0'} warn={emp.summary.earlyOut > 0} />
            </div>
          </div>

          {/* ─── Signature (print only) ─── */}
          <div className="att-print-only" style={{ display: 'none', marginTop: 48 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 40 }}>
              <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                Staff Signature
              </div>
              <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                Verified By
              </div>
              <div style={{ borderTop: '1px solid #000', width: 120, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                Date
              </div>
            </div>
          </div>

          {/* ─── Styles ─── */}
          <style>{`
            @media print {
              .att-no-print { display: none !important; }
              .att-print-only { display: block !important; }
              .att-table { font-size: 8px !important; }
              .att-table th, .att-table td { padding: 2px 3px !important; }
              .att-table th:last-child, .att-table td:last-child { min-width: 80px !important; }
              body { margin: 0 !important; padding: 8mm !important; }
              @page { size: portrait; margin: 0; }
            }
          `}</style>
        </>
      )}
    </div>
  );
}

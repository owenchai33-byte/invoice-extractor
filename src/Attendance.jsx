import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SARAWAK_HOLIDAYS = {
  2026: {
    '01-01': "New Year's Day",
    '02-17': 'Chinese New Year',
    '02-18': 'Chinese New Year Holiday',
    '03-20': 'Hari Raya Aidilfitri Holiday',
    '03-21': 'Hari Raya Aidilfitri',
    '03-23': 'Hari Raya Aidilfitri Holiday',
    '04-03': 'Good Friday',
    '05-01': 'Labour Day',
    '05-27': 'Hari Raya Haji',
    '06-01': 'Hari Gawai',
    '06-02': 'Hari Gawai Holiday',
    '06-03': 'Wesak Day Holiday',
    '06-04': 'Hari Gawai Holiday',
    '06-17': 'Awal Muharram',
    '07-22': 'Sarawak Day',
    '08-25': "Prophet Muhammad's Birthday",
    '08-31': 'Merdeka Day',
    '09-16': 'Malaysia Day',
    '10-10': "Sarawak Governor's Birthday",
    '12-25': 'Christmas Day',
  },
};

const START_MIN = 8 * 60;
const END_WD = 16 * 60 + 45;
const END_SAT = 15 * 60 + 10;
const BREAK_ALLOW = 45;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function getPrintTitle(period, name, half) {
  const [y, m] = period.from.split('-').map(Number);
  const tag = `${MONTH_NAMES[m - 1]}'${String(y).slice(-2)}`;
  const suffix = half === 'first' ? ' (1-15)' : half === 'second' ? ' (16+)' : '';
  if (name) return `${name} ATTENDANCE REPORT - ${tag}${suffix}`;
  return `CJK HQ ATTENDANCE REPORT - ${tag}${suffix}`;
}
function getOverviewTitle(period) {
  const [y, m] = period.from.split('-').map(Number);
  const tag = `${MONTH_FULL[m - 1]} ${y}`;
  return `STAFF ATTENDANCE OVERVIEW ${tag}`;
}

function getHalfDays(days, half) {
  if (!half) return days;
  return days.filter(d => {
    const day = parseInt(d.date.split('-')[2]);
    return half === 'first' ? day <= 15 : day >= 16;
  });
}

function calcHalfSummary(days) {
  const working = days.filter(d => d.type !== 'off' && d.type !== 'holiday');
  return {
    working: working.length,
    present: working.filter(d => d.scans.length > 0).length,
    absent: working.filter(d => d.type === 'absent').length,
    half: days.filter(d => d.type === 'half-am' || d.type === 'half-pm').length,
    lateIn: days.reduce((s, d) => s + d.lateIn, 0),
    breakExcess: days.reduce((s, d) => s + d.breakExcess, 0),
    earlyOut: days.reduce((s, d) => s + d.earlyOut, 0),
  };
}

function getHalfPeriod(period, half) {
  if (!half) return period;
  const [y, m] = period.from.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  if (half === 'first') return { from: period.from, to: `${y}-${mm}-15` };
  return { from: `${y}-${mm}-16`, to: period.to };
}

function collapseDateRanges(dates) {
  if (!dates.length) return '-';
  const nums = dates.map(d => { const [day, mon] = d.split('/').map(Number); return { day, mon, short: d }; });
  nums.sort((a, b) => a.mon - b.mon || a.day - b.day);
  const ranges = [];
  let start = nums[0], end = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i].day === end.day + 1 && nums[i].mon === end.mon) {
      end = nums[i];
    } else {
      ranges.push(start === end ? start.short : `${start.short}-${end.short}`);
      start = end = nums[i];
    }
  }
  ranges.push(start === end ? start.short : `${start.short}-${end.short}`);
  return ranges.join(', ');
}

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
          if (day.clockIn === null && scans.length > 0) {
            day.clockIn = scans[0];
            day.extras = day.extras.filter(s => s !== scans[0]);
          }
        }

        if (firstMorning && lastAfternoon) {
          day.type = 'full';
        } else if (firstMorning) {
          day.type = 'half-am';
        } else if (lastAfternoon) {
          day.type = 'half-pm';
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

      if (scans.length > 4) day.remarks.push(`${scans.length} scans`);

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

  const suspectPH = [];
  const eids = Object.keys(results);
  if (eids.length > 1) {
    const firstDays = results[eids[0]].days;
    for (let i = 0; i < firstDays.length; i++) {
      const d0 = firstDays[i];
      if (d0.type !== 'absent') continue;
      const allAbsent = eids.every(eid => results[eid].days[i]?.type === 'absent');
      if (allAbsent) suspectPH.push(d0.date);
    }
  }

  return { data: results, suspectPH };
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
  color: '#52525b', borderBottom: '2px solid #666', borderRight: '1px solid #666',
  whiteSpace: 'nowrap',
};
const td = {
  padding: '6px 10px', borderBottom: '1px solid #666', borderRight: '1px solid #666',
  whiteSpace: 'nowrap',
};
const btn = {
  padding: '8px 14px', borderRadius: 7, border: '1px solid #d4d4d8',
  background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
};

function AttTableHeader() {
  return (
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
        <th style={th}>Remarks</th>
      </tr>
    </thead>
  );
}

function groupDaysForTable(days) {
  const groups = [];
  let i = 0;
  while (i < days.length) {
    const d = days[i];
    const isAbsentNoScan = d.type === 'absent' && !d.scans.length;
    if (isAbsentNoScan) {
      const start = i;
      let absentCount = 1;
      let j = i + 1;
      while (j < days.length) {
        const dj = days[j];
        const off = dj.type === 'off' || dj.type === 'holiday';
        const absentJ = dj.type === 'absent' && !dj.scans.length;
        if (off || absentJ) {
          if (absentJ) absentCount++;
          j++;
        } else break;
      }
      if (absentCount >= 2) {
        groups.push({ type: 'merged-absent', days: days.slice(start, j), absentCount });
        i = j;
      } else {
        groups.push({ type: 'single', day: d });
        i++;
      }
    } else {
      groups.push({ type: 'single', day: d });
      i++;
    }
  }
  return groups;
}

function AttTableBody({ days }) {
  const groups = groupDaysForTable(days);
  return (
    <tbody>
      {groups.map(g => {
        if (g.type === 'merged-absent') {
          const first = g.days[0], last = g.days[g.days.length - 1];
          return (
            <tr key={first.date} style={{ background: '#fef3c7' }}>
              <td style={{ ...td, fontWeight: 700 }}>{first.dateShort}</td>
              <td style={{ ...td, fontWeight: 700 }}>{last.dateShort}</td>
              <td colSpan={9} style={{ ...td, textAlign: 'center', color: '#b45309', fontStyle: 'italic', fontWeight: 700 }}>
                Absent ({g.absentCount} days) — No attendance recorded
              </td>
            </tr>
          );
        }
        const d = g.day;
        const isOff = d.type === 'off' || d.type === 'holiday';
        const isAbsent = d.type === 'absent';
        const isHalf = d.type === 'half-am' || d.type === 'half-pm';
        const bg = isOff ? '#f9fafb' : isAbsent ? '#fef3c7' : isHalf ? '#eff6ff' : '#fff';

        if ((isOff || isAbsent) && !d.scans.length) {
          const label = isAbsent ? 'Absent' : d.type === 'off' ? 'Sunday' : d.holiday;
          return (
            <tr key={d.date} style={{ background: bg }}>
              <td style={{ ...td, fontWeight: 700 }}>{d.dateShort}</td>
              <td style={{ ...td, fontWeight: 700 }}>{d.day}</td>
              <td colSpan={9} style={{ ...td, textAlign: 'center', color: isAbsent ? '#b45309' : '#a3a3a3', fontStyle: 'italic', fontWeight: isAbsent ? 700 : 400 }}>
                {label}
              </td>
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
            <td style={{ ...td, fontWeight: 700 }}>{d.dateShort}</td>
            <td style={{ ...td, fontWeight: 700 }}>{d.day}</td>
            <td style={td}>{fmtTime(d.clockIn)}</td>
            <td style={td}>{fmtTime(d.breakOut)}</td>
            <td style={td}>{fmtTime(d.breakIn)}</td>
            <td style={td}>{fmtTime(d.clockOut)}</td>
            <td style={td}>
              {d.extras?.length ? d.extras.map((s, i) => <div key={i}>{fmtTime(s)}</div>) : '-'}
            </td>
            <td style={valStyle(d.lateIn)}>{d.lateIn ? `${d.lateIn}m` : '-'}</td>
            <td style={valStyle(d.breakExcess)}>{d.breakExcess ? `${d.breakExcess}m` : '-'}</td>
            <td style={valStyle(d.earlyOut)}>{d.earlyOut ? `${d.earlyOut}m` : '-'}</td>
            <td style={{ ...td, color: '#71717a' }}><Remarks d={d} /></td>
          </tr>
        );
      })}
    </tbody>
  );
}

function AttNotesBox({ days, empId, dismissedHalfDays, onToggleHalfDay }) {
  const notes = days.filter(d => d.type === 'absent' || d.type === 'half-am' || d.type === 'half-pm');
  if (!notes.length) return null;
  const nth = { padding: '4px 10px', textAlign: 'left', borderBottom: '1px solid #666', borderRight: '1px solid #666' };
  const ntd = { padding: '4px 10px', borderBottom: '1px solid #666', borderRight: '1px solid #666' };
  const isHalf = (d) => d.type === 'half-am' || d.type === 'half-pm';
  return (
    <div className="att-notes-box" style={{ marginTop: 12, border: '1px solid #666', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', background: '#f4f4f5', fontWeight: 600, fontSize: 11 }}>
        Absence / Half Day Notes
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: '#fafafa' }}>
            <th style={{ ...nth, width: 60 }}>Date</th>
            <th style={{ ...nth, width: 80 }}>Type</th>
            <th style={nth}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const rows = [];
            let ni = 0;
            while (ni < notes.length) {
              const d = notes[ni];
              if (d.type === 'absent') {
                const start = ni;
                while (ni + 1 < notes.length && notes[ni + 1].type === 'absent') {
                  const curIdx = days.indexOf(notes[ni]);
                  const nextIdx = days.indexOf(notes[ni + 1]);
                  let consecutive = true;
                  for (let k = curIdx + 1; k < nextIdx; k++) {
                    const dk = days[k];
                    if (dk.type !== 'off' && dk.type !== 'holiday' && dk.type !== 'absent') {
                      consecutive = false;
                      break;
                    }
                  }
                  if (!consecutive) break;
                  ni++;
                }
                const run = notes.slice(start, ni + 1);
                if (run.length >= 2) {
                  rows.push(
                    <tr key={run[0].date}>
                      <td style={{ ...ntd, fontWeight: 500 }}>{run[0].dateShort} – {run[run.length - 1].dateShort}</td>
                      <td style={ntd}>Absent ({run.length} days)</td>
                      <td style={{ ...ntd, color: '#71717a', fontStyle: 'italic' }}>No attendance recorded</td>
                    </tr>
                  );
                } else {
                  run.forEach(rd => rows.push(
                    <tr key={rd.date}>
                      <td style={{ ...ntd, fontWeight: 500 }}>{rd.dateShort}</td>
                      <td style={ntd}>Absent</td>
                      <td style={ntd}>{' '}</td>
                    </tr>
                  ));
                }
              } else {
                const key = `${empId}-${d.date}`;
                const dismissed = isHalf(d) && dismissedHalfDays?.has(key);
                rows.push(
                  <tr key={d.date} className={dismissed ? 'att-dismissed-row' : undefined}>
                    <td style={{ ...ntd, fontWeight: 500 }}>{d.dateShort}</td>
                    <td style={ntd}>{d.type === 'half-am' ? 'Half Day (AM)' : 'Half Day (PM)'}</td>
                    <td style={{ ...ntd, minHeight: 20 }}>
                      {onToggleHalfDay ? (<>
                        <label className="att-no-print" style={{ cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="checkbox" checked={!dismissed} onChange={() => onToggleHalfDay(key)} />
                          {dismissed ? 'Forgot scan / Machine issue' : 'Confirmed'}
                        </label>
                        <span className="att-print-only" style={{ display: 'none', fontSize: 10 }}>{dismissed ? 'Forgot scan / Machine issue' : ' '}</span>
                      </>) : ' '}
                    </td>
                  </tr>
                );
              }
              ni++;
            }
            return rows;
          })()}
        </tbody>
      </table>
    </div>
  );
}

function getPayrollOrder() {
  try {
    const staff = JSON.parse(localStorage.getItem('cjk_payroll_staff_v3') || '[]');
    return staff.map(s => s.name.toUpperCase().trim());
  } catch { return []; }
}

function fuzzyMatch(attName, payrollNames) {
  const exact = payrollNames.indexOf(attName);
  if (exact !== -1) return exact;
  const attWords = attName.split(/\s+/);
  let bestIdx = -1, bestCount = 0;
  for (let i = 0; i < payrollNames.length; i++) {
    const pWords = payrollNames[i].split(/\s+/);
    const count = attWords.filter(w => pWords.includes(w)).length;
    if (count >= 2 && count > bestCount) { bestCount = count; bestIdx = i; }
  }
  return bestIdx;
}

function sortByPayroll(data) {
  const order = getPayrollOrder();
  return Object.keys(data).sort((a, b) => {
    const nameA = data[a].name.toUpperCase().trim();
    const nameB = data[b].name.toUpperCase().trim();
    const idxA = fuzzyMatch(nameA, order);
    const idxB = fuzzyMatch(nameB, order);
    if (idxA === -1 && idxB === -1) return parseInt(a) - parseInt(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
}

function StatCard({ label, value, warn }) {
  return (
    <div className="att-stat-card" style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6 }}>
      <div className="att-stat-label" style={{ fontSize: 11, color: '#71717a', marginBottom: 2 }}>{label}</div>
      <div className="att-stat-value" style={{ fontSize: 18, fontWeight: 700, color: warn ? '#dc2626' : '#18181b' }}>{value}</div>
    </div>
  );
}

const ATT_DATA_PREFIX = 'cjk_attendance_';
const ATT_SEL_PREFIX = 'cjk_att_sel_';
const ATT_OLD_KEY = 'cjk_attendance_v1';
const ATT_OLD_SEL = 'cjk_attendance_sel_v1';

function attKey(yr, mo) { return `${ATT_DATA_PREFIX}${yr}-${pad(mo + 1)}`; }
function attSelKey(yr, mo) { return `${ATT_SEL_PREFIX}${yr}-${pad(mo + 1)}`; }
function attDismissedKey(yr, mo) { return `cjk_att_dismissed_${yr}-${pad(mo + 1)}`; }

function mergeAttData(existing, incoming) {
  if (!existing) return incoming;
  const merged = {};
  const allIds = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  for (const eid of allIds) {
    const old = existing[eid], inc = incoming[eid];
    if (!old) { merged[eid] = inc; continue; }
    if (!inc) { merged[eid] = old; continue; }
    const dayMap = {};
    for (const d of old.days) dayMap[d.date] = d;
    for (const d of inc.days) dayMap[d.date] = d;
    const allDays = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
    const from = old.period.from < inc.period.from ? old.period.from : inc.period.from;
    const to = old.period.to > inc.period.to ? old.period.to : inc.period.to;
    const working = allDays.filter(d => d.type !== 'off' && d.type !== 'holiday');
    merged[eid] = {
      ...old, ...inc, days: allDays, period: { from, to },
      summary: {
        working: working.length,
        present: working.filter(d => d.scans.length > 0).length,
        absent: working.filter(d => d.type === 'absent').length,
        half: allDays.filter(d => d.type === 'half-am' || d.type === 'half-pm').length,
        lateIn: allDays.reduce((s, d) => s + d.lateIn, 0),
        breakExcess: allDays.reduce((s, d) => s + d.breakExcess, 0),
        earlyOut: allDays.reduce((s, d) => s + d.earlyOut, 0),
      },
    };
  }
  return merged;
}

function migrateOldAttendance() {
  try {
    const old = localStorage.getItem(ATT_OLD_KEY);
    if (!old) return;
    const parsed = JSON.parse(old);
    const firstEmp = Object.values(parsed)[0];
    if (!firstEmp?.period?.from) return;
    const [y, m] = firstEmp.period.from.split('-').map(Number);
    const newKey = `${ATT_DATA_PREFIX}${y}-${pad(m)}`;
    if (!localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, old);
    }
    const oldSel = localStorage.getItem(ATT_OLD_SEL);
    if (oldSel) {
      const selKey = `${ATT_SEL_PREFIX}${y}-${pad(m)}`;
      if (!localStorage.getItem(selKey)) localStorage.setItem(selKey, oldSel);
    }
    localStorage.removeItem(ATT_OLD_KEY);
    localStorage.removeItem(ATT_OLD_SEL);
  } catch {}
}

export default function Attendance() {
  useState(() => migrateOldAttendance());
  const now = new Date();
  const [mo, setMo] = useState(() => { try { const v = localStorage.getItem('cjk_att_mo'); return v !== null ? Number(v) : now.getMonth(); } catch { return now.getMonth(); } });
  const [yr, setYr] = useState(() => { try { const v = localStorage.getItem('cjk_att_yr'); return v !== null ? Number(v) : now.getFullYear(); } catch { return now.getFullYear(); } });
  useEffect(() => { try { localStorage.setItem('cjk_att_mo', mo); localStorage.setItem('cjk_att_yr', yr); } catch {} }, [mo, yr]);
  const dataKey = attKey(yr, mo);
  const selKey = attSelKey(yr, mo);

  const [data, setData] = useState(() => {
    try { const s = localStorage.getItem(dataKey); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(selKey) || null; }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [printAll, setPrintAll] = useState(false);
  const [printOverview, setPrintOverview] = useState(false);
  const [printHalf, setPrintHalf] = useState(null);
  const [dismissedHalfDays, setDismissedHalfDays] = useState(new Set());
  const [lastOverviewEdit, setLastOverviewEdit] = useState(null);
  const [suspectPH, setSuspectPH] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toLocaleString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }));
  const [empTimestamps, setEmpTimestamps] = useState({});
  const [confirmedPH, setConfirmedPH] = useState(new Set());
  const [verifiedPH, setVerifiedPH] = useState({});
  const [showMech, setShowMech] = useState(false);
  const fileRef = useRef(null);
  const addFileRef = useRef(null);
  const uploadModeRef = useRef('merge');
  const origTitle = useRef(document.title);

  const effectiveData = useMemo(() => {
    if (!data || !confirmedPH.size) return data;
    const out = {};
    for (const [eid, emp] of Object.entries(data)) {
      const days = emp.days.map(d => confirmedPH.has(d.date) ? { ...d, type: 'holiday', holiday: verifiedPH[d.date] || 'Public Holiday (confirmed)' } : d);
      const working = days.filter(d => d.type !== 'off' && d.type !== 'holiday');
      out[eid] = {
        ...emp, days,
        summary: {
          ...emp.summary,
          working: working.length,
          absent: working.filter(d => d.type === 'absent').length,
          present: working.filter(d => d.scans.length > 0).length,
          half: days.filter(d => d.type === 'half-am' || d.type === 'half-pm').length,
        },
      };
    }
    return out;
  }, [data, confirmedPH, verifiedPH]);

  const emp = effectiveData && selected ? effectiveData[selected] : null;
  const empIds = effectiveData ? sortByPayroll(effectiveData) : [];
  const viewDays = emp ? getHalfDays(emp.days, printHalf) : [];
  const viewPeriod = emp ? getHalfPeriod(emp.period, printHalf) : null;

  const halfSplitVh = useMemo(() => {
    if (!effectiveData || !empIds.length) return 50;
    let maxRows = 0;
    for (const id of empIds) {
      const firstDays = getHalfDays(effectiveData[id].days, 'first');
      const groups = groupDaysForTable(firstDays);
      if (groups.length > maxRows) maxRows = groups.length;
    }
    const headerPx = 70;
    const rowPx = 18;
    const totalPx = headerPx + (maxRows + 1) * rowPx;
    const pagePx = 970;
    return Math.ceil((totalPx / pagePx) * 100) + 2;
  }, [effectiveData, empIds]);

  const toggleHalfDay = useCallback((key) => {
    setDismissedHalfDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(attDismissedKey(yr, mo), JSON.stringify([...next])); } catch {}
      return next;
    });
    setLastOverviewEdit(new Date());
    const empId = key.split('-')[0];
    const ts = new Date().toLocaleString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    setEmpTimestamps(prev => ({ ...prev, [empId]: ts }));
  }, [yr, mo]);

  const dataKeyRef = useRef(dataKey);
  const selKeyRef = useRef(selKey);
  dataKeyRef.current = dataKey;
  selKeyRef.current = selKey;

  useEffect(() => {
    if (data) localStorage.setItem(dataKeyRef.current, JSON.stringify(data));
    else localStorage.removeItem(dataKeyRef.current);
  }, [data]);

  useEffect(() => {
    if (selected) localStorage.setItem(selKeyRef.current, selected);
    else localStorage.removeItem(selKeyRef.current);
  }, [selected]);

  const attMin = mo === 7 && yr === 2026;

  const changeMonth = useCallback((dir) => {
    if (dir < 0) {
      if (mo === 7 && yr === 2026) return;
      if (mo === 0) { setMo(11); setYr(y => y - 1); }
      else setMo(m => m - 1);
    } else {
      if (mo === 11) { setMo(0); setYr(y => y + 1); }
      else setMo(m => m + 1);
    }
  }, [mo, yr]);

  useEffect(() => {
    try {
      const s = localStorage.getItem(dataKey);
      setData(s ? JSON.parse(s) : null);
    } catch { setData(null); }
    try {
      setSelected(localStorage.getItem(selKey) || null);
    } catch { setSelected(null); }
    try { const d = localStorage.getItem(attDismissedKey(yr, mo)); setDismissedHalfDays(d ? new Set(JSON.parse(d)) : new Set()); }
    catch { setDismissedHalfDays(new Set()); }
    setConfirmedPH(new Set());
    setVerifiedPH({});
    setSuspectPH([]);
    setLastOverviewEdit(null);
    setEmpTimestamps({});
    setPrintAll(false);
    setPrintOverview(false);
    setPrintHalf(null);
  }, [dataKey, selKey]);

  useEffect(() => {
    if (!suspectPH.length) return;
    const year = suspectPH[0].substring(0, 4);
    fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/MY`)
      .then(r => r.ok ? r.json() : [])
      .then(holidays => {
        const matched = {};
        const autoConfirm = new Set();
        for (const date of suspectPH) {
          const h = holidays.find(h => h.date === date);
          if (h) {
            matched[date] = h.localName || h.name;
            autoConfirm.add(date);
          }
        }
        if (autoConfirm.size) {
          setVerifiedPH(matched);
          setConfirmedPH(prev => new Set([...prev, ...autoConfirm]));
        }
      })
      .catch(() => {});
  }, [suspectPH]);

  useEffect(() => {
    const reset = () => {
      setPrintAll(false);
      setPrintOverview(false);
      document.title = origTitle.current;
    };
    window.addEventListener('afterprint', reset);
    return () => window.removeEventListener('afterprint', reset);
  }, []);

  useEffect(() => {
    if (printAll && emp) {
      origTitle.current = document.title;
      document.title = getPrintTitle(emp.period, null, printHalf);
      const timer = setTimeout(() => window.print(), 150);
      return () => clearTimeout(timer);
    }
  }, [printAll, emp, printHalf]);

  useEffect(() => {
    if (printOverview && emp) {
      origTitle.current = document.title;
      document.title = getOverviewTitle(emp.period);
      const timer = setTimeout(() => window.print(), 150);
      return () => clearTimeout(timer);
    }
  }, [printOverview, emp]);

  const handleFile = useCallback(async (file) => {
    setLoading(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const parsed = file.name.endsWith('.pdf') ? await parsePDF(buf) : parseExcel(buf);
      if (!parsed.records.length) throw new Error('No attendance records found in file');
      const { data: results, suspectPH: suspects } = processRecords(parsed);
      const firstEmp = Object.values(results)[0];
      let targetYr = yr, targetMo = mo;
      if (firstEmp?.period?.from) {
        const [fy, fm] = firstEmp.period.from.split('-').map(Number);
        targetYr = fy; targetMo = fm - 1;
        if (fy !== yr || fm - 1 !== mo) { setYr(fy); setMo(fm - 1); }
      }
      const tk = attKey(targetYr, targetMo);
      let existing = null;
      if (uploadModeRef.current === 'merge') {
        try { const s = localStorage.getItem(tk); if (s) existing = JSON.parse(s); } catch {}
      }
      const merged = mergeAttData(existing, results);
      localStorage.setItem(tk, JSON.stringify(merged));
      const tsk = attSelKey(targetYr, targetMo);
      const firstSel = sortByPayroll(merged)[0];
      if (firstSel) localStorage.setItem(tsk, firstSel);
      setData(merged);
      setSuspectPH(suspects);
      setConfirmedPH(new Set());
      setDismissedHalfDays(new Set());
      try { localStorage.removeItem(attDismissedKey(targetYr, targetMo)); } catch {}
      setLastOverviewEdit(null);
      setGeneratedAt(new Date().toLocaleString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }));
      setEmpTimestamps({});
      setSelected(firstSel || null);
    } catch (e) {
      setError(e.message || 'Failed to parse file');
    }
    setLoading(false);
  }, [yr, mo]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.style.borderColor = '#d4d4d8';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePrintAll = () => setPrintAll(true);

  return (
    <div className={`att-root${printAll ? ' att-print-all' : ''}${printOverview ? ' att-print-overview' : ''}${printHalf === 'first' ? ' att-half-first' : ''}${printHalf === 'second' ? ' att-half-second' : ''}`} style={{ maxWidth: 1600, margin: '0 auto', padding: '16px 24px', '--half-split': `${halfSplitVh}vh` }}>

      {/* ─── Header Bar ─── */}
      <div className="att-no-print" style={{
        background: '#fff', borderBottom: '1px solid #e4e4e7', padding: '0 24px',
        display: 'flex', alignItems: 'center', gap: 12, height: 56,
        marginBottom: 16, borderRadius: 0,
        marginLeft: -24, marginRight: -24, marginTop: -16, flexWrap: 'nowrap',
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 800, letterSpacing: '.04em', margin: 0, color: '#18181b', whiteSpace: 'nowrap' }}>
          ATTENDANCE REPORT
        </h1>
        <button onClick={() => setShowMech(v => !v)} style={{ border: '1px solid #e4e4e7', background: showMech ? '#f0f9ff' : '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>
          {showMech ? '▾ Mechanism' : '▸ Mechanism'}
        </button>
        <div style={{ width: 1, height: 24, background: '#e4e4e7' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button disabled={attMin} onClick={() => changeMonth(-1)} style={{ border: '1px solid #e4e4e7', background: '#fff', borderRadius: 6, width: 28, height: 28, cursor: attMin ? 'default' : 'pointer', color: '#52525b', fontSize: 11, opacity: attMin ? 0.4 : 1 }}>&#9664;</button>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 120, textAlign: 'center', color: '#18181b' }}>
            {MONTH_FULL[mo]} {yr}
          </div>
          <button onClick={() => changeMonth(1)} style={{ border: '1px solid #e4e4e7', background: '#fff', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: '#52525b', fontSize: 11 }}>&#9654;</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {emp && (
            <>
              <select value={printHalf || ''} onChange={e => setPrintHalf(e.target.value || null)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #d4d4d8', fontSize: 13, background: '#fff' }}>
                <option value="">Full Month</option>
                <option value="first">1st Half (1-15)</option>
                <option value="second">2nd Half (16+)</option>
              </select>
              <button onClick={() => setPrintOverview(true)} style={btn}>📊 Overview</button>
              <button onClick={() => { origTitle.current = document.title; document.title = getPrintTitle(emp.period, emp.name, printHalf); window.print(); }} style={btn}>🖨 Print</button>
              <button onClick={handlePrintAll} style={{ ...btn, background: '#18181b', color: '#fff', border: '1px solid #18181b' }}>🖨 Print All</button>
              <button onClick={() => { uploadModeRef.current = 'merge'; addFileRef.current?.click(); }} style={{ ...btn, background: '#059669', color: '#fff', border: '1px solid #059669' }}>+ Upload More</button>
              <button onClick={() => { uploadModeRef.current = 'replace'; addFileRef.current?.click(); }} style={{ ...btn, background: '#d97706', color: '#fff', border: '1px solid #d97706' }}>🔄 Upload Revised</button>
              <input ref={addFileRef} type="file" accept=".pdf,.xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
            </>
          )}
          <span style={{ fontSize: 12, color: '#71717a', whiteSpace: 'nowrap' }}>
            {data ? `${Object.keys(data).length} employee(s) loaded` : 'No data — upload to start'}
          </span>
        </div>
      </div>

      {showMech && (
        <div className="att-no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px', marginBottom: 16, fontSize: 12, color: '#334155', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#0f172a' }}>ATTENDANCE MECHANISM</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>Working Hours</div>
              <div>Weekday: 8:00 AM – 4:45 PM</div>
              <div>Saturday: 8:00 AM – 3:10 PM</div>
              <div>Sunday: Off day</div>
              <div>Break allowance: 45 min</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>4 Scans (Normal)</div>
              <div>In → Break Out → Break In → Out</div>
              <div>Tracks: late-in, break excess, early-out, OT</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>3 Scans</div>
              <div>Detects which scan is missing (break or clock out)</div>
              <div>Morning + afternoon present → full day</div>
              <div>Otherwise → half day</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>2 Scans</div>
              <div>Morning + afternoon → full day (no break recorded)</div>
              <div>Otherwise → half day AM or PM</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>1 Scan</div>
              <div>Marked as incomplete</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>5+ Scans</div>
              <div>First = in, last = out, middle scans searched for best break pair (20–70 min gap, closest to 45 min)</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>Public Holidays</div>
              <div>Sarawak PH list (updated yearly)</div>
              <div>Work on PH flagged</div>
              <div>All staff absent on non-holiday weekday → "Subject to Review"</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>Half Days</div>
              <div>Subject to review — staff may have missed a scan</div>
              <div>Verify after printing (twice a month: 1–15, 16+)</div>
              <div>Overview updated after manual review</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Upload ─── */}
      {!data && (
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onDragEnter={e => { e.currentTarget.style.borderColor = '#18181b'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = '#d4d4d8'; }}
          onClick={() => { uploadModeRef.current = 'merge'; fileRef.current?.click(); }}
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
          {suspectPH.filter(d => !confirmedPH.has(d)).length > 0 && (
            <div className="att-no-print" style={{
              padding: '10px 14px', marginBottom: 12, background: '#fef3c7', border: '1px solid #f59e0b',
              borderRadius: 8, fontSize: 12,
            }}>
              <strong>Possible public holidays detected</strong> (all staff absent):
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {suspectPH.filter(d => !confirmedPH.has(d)).map(date => {
                  const dt = parseLocalDate(date);
                  const label = `${dt.getDate()}/${dt.getMonth() + 1} (${DAY_NAMES[dt.getDay()]})`;
                  return (
                    <button key={date} onClick={() => setConfirmedPH(prev => new Set([...prev, date]))} style={{
                      padding: '4px 10px', fontSize: 11, background: '#fff', border: '1px solid #d4d4d8',
                      borderRadius: 4, cursor: 'pointer',
                    }}>
                      ✓ Confirm {label} as PH
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ Layout: Sidebar + Content ═══ */}
          <div className="att-layout" style={{ display: 'flex', gap: 16 }}>
          {empIds.length > 1 && (
            <div className="att-no-print att-sidebar" style={{
              width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2,
              maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', position: 'sticky', top: 16,
              padding: '8px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e4e4e7',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', padding: '4px 8px', marginBottom: 4 }}>Employees</div>
              {empIds.map(id => (
                <button
                  key={id}
                  onClick={() => setSelected(id)}
                  style={{
                    padding: '6px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left', width: '100%',
                    border: selected === id ? '1.5px solid #18181b' : '1px solid transparent',
                    background: selected === id ? '#18181b' : 'transparent',
                    color: selected === id ? '#fff' : '#18181b',
                    fontWeight: selected === id ? 600 : 400,
                  }}
                >
                  {effectiveData[id].name}
                </button>
              ))}
            </div>
          )}

          {/* ═══ Single Employee View (screen + print current) ═══ */}
          <div className="att-single-view" style={{ flex: 1, minWidth: 0 }}>
            <div className="att-emp-page">
              <div className="att-emp-content">
                {/* Print header — hidden for 2nd half (already on paper from 1st half) */}
                {printHalf !== 'second' && <div className="att-print-only" style={{ display: 'none' }}>
                  <div className="att-print-header" style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div className="att-h1" style={{ fontSize: 16, fontWeight: 700 }}>CHAI JEE KIONG TRADING SDN BHD (HQ)</div>
                    <div className="att-h2" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>ATTENDANCE REPORT {MONTH_FULL[parseInt(emp.period.from.split('-')[1]) - 1]} {emp.period.from.split('-')[0]}</div>
                    <div className="att-emp-name" style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>Employee: {emp.name}</div>
                    <div className="att-h3" style={{ fontSize: 11, color: '#555', marginTop: 2, fontWeight: 700 }}>
                      Staff ID: {emp.id} &nbsp;|&nbsp; Period: {emp.period.from} to {emp.period.to}
                    </div>
                  </div>
                </div>}

                {/* Employee info (screen) */}
                <div className="att-no-print" style={{
                  padding: '12px 16px', background: '#fff', border: '1px solid #e4e4e7',
                  borderRadius: 8, marginBottom: 16, display: 'flex', gap: 24, fontSize: 13,
                }}>
                  <div><span style={{ color: '#71717a' }}>Employee:</span> <strong>{emp.name}</strong></div>
                  <div><span style={{ color: '#71717a' }}>Staff ID:</span> <strong>{emp.id}</strong></div>
                  <div><span style={{ color: '#71717a' }}>Period:</span> <strong>{viewPeriod.from} to {viewPeriod.to}</strong></div>
                </div>

                {/* Table + Summary side-by-side on screen */}
                <div className="att-table-summary-row" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="att-table-scroll" style={{ overflowX: 'auto' }}>
                      <table className="att-table" style={{
                        width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff',
                        border: '1px solid #e4e4e7',
                      }}>
                        <AttTableHeader />
                        <AttTableBody days={viewDays} />
                      </table>
                    </div>
                    {printHalf !== 'first' && <AttNotesBox days={emp.days} empId={selected} dismissedHalfDays={dismissedHalfDays} onToggleHalfDay={toggleHalfDay} />}
                  </div>

                  {/* Summary — vertical sidebar on screen, below table in print */}
                  {printHalf !== 'first' && <div className="att-summary-box" style={{
                    width: 190, flexShrink: 0, padding: '14px 16px', background: '#fff',
                    border: '1px solid #e4e4e7', borderRadius: 8, position: 'sticky', top: 60,
                  }}>
                    <div className="att-stat-title" style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: '#18181b' }}>Summary</div>
                    <div className="att-stat-grid" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(() => { const adjHalf = emp.days.filter(d => (d.type === 'half-am' || d.type === 'half-pm') && !dismissedHalfDays.has(`${selected}-${d.date}`)).length; return <>
                      <StatCard label="Working Days" value={`${emp.summary.working} days`} />
                      <StatCard label="Present" value={`${emp.summary.present} days`} />
                      <StatCard label="Absent" value={`${emp.summary.absent} days`} warn={emp.summary.absent > 0} />
                      <StatCard label="Half Days" value={`${adjHalf} days`} />
                      <StatCard label="Total Late In" value={emp.summary.lateIn ? `${emp.summary.lateIn} min` : '0'} warn={emp.summary.lateIn > 0} />
                      <StatCard label="Total Break +" value={emp.summary.breakExcess ? `${emp.summary.breakExcess} min` : '0'} warn={emp.summary.breakExcess > 0} />
                      <StatCard label="Total Early Out" value={emp.summary.earlyOut ? `${emp.summary.earlyOut} min` : '0'} warn={emp.summary.earlyOut > 0} />
                      </>; })()}
                    </div>
                  </div>}
                </div>
              {printHalf !== 'first' && <div className="att-report-timestamp" style={{ marginTop: 10, fontSize: 10, color: '#a3a3a3', fontStyle: 'italic' }}>
                Generated: {empTimestamps[selected] || generatedAt}
              </div>}
              </div>{/* close att-emp-content */}

              {/* Signature (print only) */}
              <div className="att-print-only att-signature" style={{ display: 'none', paddingTop: 48 }}>
                <div style={{ display: 'flex', gap: 60 }}>
                  <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                    Verified By
                  </div>
                  <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                    Staff Signature
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>{/* close att-layout */}

          {/* ═══ All Employees Print View (always in DOM, shown only in print-all) ═══ */}
          <div className="att-all-view" style={{ display: 'none' }}>
            {empIds.map((id, idx) => {
              const e = effectiveData[id];
              const s = e.summary;
              const eDays = getHalfDays(e.days, printHalf);
              const ePeriod = getHalfPeriod(e.period, printHalf);
              return (
                <div key={id} className={`att-emp-page${idx > 0 ? ' att-page-break' : ''}`}>
                  <div className="att-emp-content">
                    {printHalf !== 'second' && <div className="att-print-header" style={{ textAlign: 'center', marginBottom: 16 }}>
                      <div className="att-h1" style={{ fontSize: 16, fontWeight: 700 }}>CHAI JEE KIONG TRADING SDN BHD (HQ)</div>
                      <div className="att-h2" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>ATTENDANCE REPORT {MONTH_FULL[parseInt(e.period.from.split('-')[1]) - 1]} {e.period.from.split('-')[0]}</div>
                      <div className="att-emp-name" style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>Employee: {e.name}</div>
                      <div className="att-h3" style={{ fontSize: 11, color: '#555', marginTop: 2, fontWeight: 700 }}>
                        Staff ID: {e.id} &nbsp;|&nbsp; Period: {e.period.from} to {e.period.to}
                      </div>
                    </div>}
                    <table className="att-table" style={{
                      width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff',
                      border: '1px solid #e4e4e7',
                    }}>
                      <AttTableHeader />
                      <AttTableBody days={eDays} />
                    </table>
                    {printHalf !== 'first' && <AttNotesBox days={e.days} empId={id} dismissedHalfDays={dismissedHalfDays} onToggleHalfDay={toggleHalfDay} />}
                    {printHalf !== 'first' && <div className="att-summary-box" style={{
                      marginTop: 20, padding: '16px 20px', background: '#fff',
                      border: '1px solid #e4e4e7', borderRadius: 8,
                    }}>
                      <div className="att-stat-title" style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#18181b' }}>Summary</div>
                      <div className="att-stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                        {(() => { const adjHalf = e.days.filter(d => (d.type === 'half-am' || d.type === 'half-pm') && !dismissedHalfDays.has(`${id}-${d.date}`)).length; return <>
                        <StatCard label="Working Days" value={`${s.working} days`} />
                        <StatCard label="Present" value={`${s.present} days`} />
                        <StatCard label="Absent" value={`${s.absent} days`} warn={s.absent > 0} />
                        <StatCard label="Half Days" value={`${adjHalf} days`} />
                        <StatCard label="Total Late In" value={s.lateIn ? `${s.lateIn} min` : '0'} warn={s.lateIn > 0} />
                        <StatCard label="Total Break +" value={s.breakExcess ? `${s.breakExcess} min` : '0'} warn={s.breakExcess > 0} />
                        <StatCard label="Total Early Out" value={s.earlyOut ? `${s.earlyOut} min` : '0'} warn={s.earlyOut > 0} />
                        </>; })()}
                      </div>
                    </div>}
                  {printHalf !== 'first' && <div className="att-report-timestamp" style={{ marginTop: 10, fontSize: 8, color: '#a3a3a3', fontStyle: 'italic' }}>
                    Generated: {empTimestamps[id] || generatedAt}
                  </div>}
                  </div>{/* close att-emp-content */}
                  <div className="att-signature" style={{ paddingTop: 48 }}>
                    <div style={{ display: 'flex', gap: 60 }}>
                      <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                        Verified By
                      </div>
                      <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>
                        Staff Signature
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

          </div>

          {/* ═══ Overview (standalone, shown in print-all as last page + print-overview mode) ═══ */}
          <div className="att-overview-view" style={{ display: 'none' }}>
            <div className="att-emp-page">
              <div className="att-emp-content">
                <div className="att-print-header" style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div className="att-h1" style={{ fontSize: 16, fontWeight: 700 }}>CHAI JEE KIONG TRADING SDN BHD (HQ)</div>
                  <div className="att-h2" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                    {getOverviewTitle(effectiveData[empIds[0]].period)}
                  </div>
                  <div className="att-h3" style={{ fontSize: 11, color: '#555', marginTop: 2, fontWeight: 700 }}>
                    Period: {effectiveData[empIds[0]].period.from} to {effectiveData[empIds[0]].period.to} &nbsp;|&nbsp; Working Days: {effectiveData[empIds[0]].summary.working}
                  </div>
                </div>
                <table className="att-table" style={{
                  width: '100%', borderCollapse: 'collapse', fontSize: 11, background: '#fff',
                  border: '1px solid #666',
                }}>
                  <thead>
                    <tr style={{ background: '#f4f4f5' }}>
                      <th style={{ ...th, textAlign: 'center', width: 30 }}>#</th>
                      <th style={th}>Employee</th>
                      <th style={{ ...th, textAlign: 'center' }}>Present (day)</th>
                      <th style={{ ...th, textAlign: 'center', borderLeft: '2px solid #666', borderTop: '2px solid #666', borderBottom: '2px solid #666', borderRight: '2px solid #666' }}>Total Penalty</th>
                      <th style={{ ...th, borderLeft: '2px solid #666', borderTop: '2px solid #666', borderBottom: '2px solid #666' }}>Absent (day)</th>
                      <th style={{ ...th, borderTop: '2px solid #666', borderBottom: '2px solid #666' }}>Half Days (day)</th>
                      <th style={{ ...th, textAlign: 'center', borderRight: '2px solid #666', borderTop: '2px solid #666', borderBottom: '2px solid #666' }}>Total Leave (day)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const gb = '2px solid #666';
                      return empIds.map((id, idx) => {
                      const e = effectiveData[id];
                      const s = e.summary;
                      const total = s.lateIn + s.breakExcess + s.earlyOut;
                      const absentDates = e.days.filter(d => d.type === 'absent').map(d => d.dateShort);
                      const confirmedHalf = e.days.filter(d => (d.type === 'half-am' || d.type === 'half-pm') && !dismissedHalfDays.has(`${id}-${d.date}`));
                      const halfCount = confirmedHalf.length;
                      const halfDates = confirmedHalf.map(d => d.dateShort);
                      const hasPenalty = total > 0 || s.absent > 0 || halfCount > 0;
                      const isLast = idx === empIds.length - 1;
                      const bb = isLast ? gb : td.borderBottom;
                      return (
                        <tr key={id} style={{ background: hasPenalty ? '#fef3c7' : '#fff' }}>
                          <td style={{ ...td, textAlign: 'center' }}>{idx + 1}</td>
                          <td style={{ ...td, fontWeight: 500 }}>{e.name}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{s.present}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 700, borderLeft: gb, borderRight: gb, borderBottom: bb }}>
                            {`${total}m`}
                          </td>
                          <td style={{
                            ...td,
                            fontWeight: s.absent > 0 ? 700 : 400,
                            color: s.absent > 0 ? '#18181b' : '#a3a3a3',
                            borderLeft: gb, borderBottom: bb,
                          }}>{s.absent > 0 ? `${s.absent} (${collapseDateRanges(absentDates)})` : '-'}</td>
                          <td style={{ ...td, color: halfCount > 0 ? '#18181b' : '#a3a3a3', borderBottom: bb }}>
                            {halfCount > 0 ? `${halfCount} (${confirmedHalf.map(d => {
                              const worked = d.remarks.find(r => r.startsWith('Worked '));
                              return `${d.dateShort} ${worked ? worked.replace('Worked ', '') : ''}`;
                            }).join(', ')})` : '-'}
                          </td>
                          {(() => {
                            const totalLeave = s.absent + halfCount * 0.5;
                            const whole = Math.floor(totalLeave);
                            const hasHalf = totalLeave % 1 !== 0;
                            const label = totalLeave === 0 ? '-' : whole > 0 && hasHalf ? `${whole} 1/2` : hasHalf ? '1/2' : `${whole}`;
                            return (
                              <td style={{ ...td, textAlign: 'center', fontWeight: totalLeave > 0 ? 700 : 400, color: totalLeave > 0 ? '#18181b' : '#a3a3a3', borderRight: gb, borderBottom: bb }}>
                                {label}
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    });
                    })()}
                  </tbody>
                </table>
                <div style={{ marginTop: 8, fontSize: 10, color: '#71717a', fontStyle: 'italic' }}>
                  {lastOverviewEdit
                    ? `Last updated: ${lastOverviewEdit.toLocaleString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`
                    : `Generated: ${generatedAt}`}
                </div>
              </div>
              <div className="att-signature" style={{ paddingTop: 48 }}>
                <div style={{ display: 'flex', gap: 60 }}>
                  <div style={{ borderTop: '1px solid #000', width: 200, textAlign: 'center', paddingTop: 4, fontSize: 11 }}>Verified By</div>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Styles ─── */}
          <style>{`
            @media (max-width: 768px) {
              .att-root { padding: 12px 10px !important; }
              .att-root > .att-no-print:first-child {
                flex-wrap: wrap !important; height: auto !important;
                padding: 8px 12px !important; gap: 8px !important;
                margin-left: -10px !important; margin-right: -10px !important;
              }
              .att-layout { flex-direction: column !important; }
              .att-sidebar {
                width: 100% !important; flex-direction: row !important;
                flex-wrap: wrap !important; max-height: none !important;
                position: static !important; overflow-y: visible !important;
              }
              .att-sidebar > div:first-child { width: 100%; }
              .att-sidebar button { font-size: 10px !important; padding: 4px 8px !important; }
              .att-table-summary-row { flex-direction: column !important; }
              .att-summary-box { position: static !important; width: 100% !important; }
            }
            .att-dismissed-row { opacity: 0.5; text-decoration: line-through; }
            @page { margin: 6mm; }
            @media print {
              .att-dismissed-row { opacity: 0.5 !important; }
              .att-no-print { display: none !important; }
              .att-print-only { display: block !important; }
              .att-root { padding: 0 !important; max-width: none !important; margin: 0 !important; }
              .att-layout { display: block !important; }
              .att-sidebar { display: none !important; }
              .att-table-scroll { overflow: visible !important; }
              .att-table { font-size: 10px !important; table-layout: fixed !important; width: 100% !important; border: none !important; border-collapse: collapse !important; }
              .att-table th, .att-table td { padding: 2px 3px !important; font-size: 10px !important; white-space: nowrap !important; overflow: hidden !important; border-bottom: 1px solid #666 !important; border-right: 1px solid #666 !important; border-top: none !important; border-left: none !important; }
              .att-table thead th { border-top: 1px solid #666 !important; }
              .att-table th:first-child, .att-table td:first-child { border-left: 1px solid #666 !important; }
              .att-table th { white-space: normal !important; overflow: visible !important; line-height: 1.1 !important; }
              .att-table th:nth-child(1), .att-table td:nth-child(1) { width: 5% !important; }
              .att-table th:nth-child(2), .att-table td:nth-child(2) { width: 4% !important; }
              .att-table th:nth-child(n+3):nth-child(-n+10), .att-table td:nth-child(n+3):nth-child(-n+10) { width: 8% !important; text-align: center !important; }
              .att-table th:last-child, .att-table td:last-child { width: auto !important; white-space: normal !important; }
              .att-page-break { page-break-before: always; }
              .att-emp-page { min-height: 100vh; box-sizing: border-box; padding: 0 2mm 3mm; display: flex !important; flex-direction: column; }
              .att-emp-content { flex: 1; }
              .att-print-header { margin-bottom: 3px !important; }
              .att-print-header .att-h1 { font-size: 12px !important; }
              .att-print-header .att-h2 { font-size: 12px !important; margin-top: 0px !important; }
              .att-print-header .att-h3 { font-size: 10px !important; margin-top: 0px !important; }
              .att-print-emp-info { display: none !important; }
              .att-emp-name { font-size: 12px !important; font-weight: 700 !important; margin-top: 2px !important; }
              .att-print-all .att-single-view { display: none !important; }
              .att-print-all .att-all-view { display: block !important; }
              .att-print-all .att-overview-view { display: block !important; }
              .att-print-overview .att-single-view { display: none !important; }
              .att-print-overview .att-overview-view { display: block !important; }
              .att-overview-view { padding: 0 !important; }
              .att-overview-view .att-emp-content { flex: none !important; }
              .att-overview-view .att-table { table-layout: fixed !important; }
              .att-overview-view .att-table td, .att-overview-view .att-table th { white-space: normal !important; overflow: visible !important; }
              .att-overview-view .att-table th:nth-child(1), .att-overview-view .att-table td:nth-child(1) { width: 4% !important; text-align: center !important; }
              .att-overview-view .att-table th:nth-child(2), .att-overview-view .att-table td:nth-child(2) { width: 20% !important; }
              .att-overview-view .att-table th:nth-child(3), .att-overview-view .att-table td:nth-child(3) { width: 7% !important; text-align: center !important; }
              .att-overview-view .att-table th:nth-child(4), .att-overview-view .att-table td:nth-child(4) { width: 7% !important; text-align: center !important; }
              .att-overview-view .att-table th:nth-child(5), .att-overview-view .att-table td:nth-child(5) { width: 24% !important; }
              .att-overview-view .att-table th:nth-child(6), .att-overview-view .att-table td:nth-child(6) { width: 24% !important; }
              .att-overview-view .att-table th:nth-child(7), .att-overview-view .att-table td:nth-child(7) { width: 7% !important; text-align: center !important; }
              .att-notes-box { margin-top: 4px !important; overflow: visible !important; width: 100% !important; border-radius: 0 !important; box-sizing: border-box !important; border: 1px solid #999 !important; }
              .att-notes-box div:first-child { padding: 3px 8px !important; font-size: 10.5px !important; border-bottom: 1px solid #999 !important; }
              .att-notes-box table { font-size: 10.5px !important; width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; }
              .att-notes-box th, .att-notes-box td { padding: 2px 6px !important; font-size: 10.5px !important; }
              .att-notes-box table th:nth-child(1), .att-notes-box table td:nth-child(1) { width: 12% !important; }
              .att-notes-box table th:nth-child(2), .att-notes-box table td:nth-child(2) { width: 18% !important; }
              .att-signature { page-break-inside: avoid !important; padding-top: 0 !important; margin-top: auto !important; }
              .att-signature > div { justify-content: center !important; }
              .att-table-summary-row { display: block !important; }
              .att-summary-box { margin-top: 4px !important; padding: 4px 6px !important; width: auto !important; position: static !important; }
              .att-stat-grid { display: grid !important; grid-template-columns: repeat(7, 1fr) !important; gap: 2px !important; }
              .att-stat-card { padding: 2px 4px !important; border-radius: 3px !important; }
              .att-stat-title { font-size: 12px !important; font-weight: 700 !important; margin-bottom: 1px !important; }
              .att-stat-label { font-size: 12px !important; font-weight: 700 !important; margin-bottom: 0 !important; }
              .att-stat-value { font-size: 12px !important; font-weight: 700 !important; }
              .att-half-first .att-single-view .att-emp-page,
              .att-half-first .att-all-view .att-emp-page { min-height: auto !important; }
              .att-half-first .att-single-view .att-signature,
              .att-half-first .att-all-view .att-signature { display: none !important; }
              .att-half-second .att-single-view .att-emp-page,
              .att-half-second .att-all-view .att-emp-page { padding-top: var(--half-split, 50vh) !important; }
              .att-half-second .att-single-view .att-table thead th,
              .att-half-second .att-all-view .att-table thead th {
                height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important;
                border-top-width: 0 !important; border-bottom-width: 0 !important;
                font-size: 0 !important; line-height: 0 !important; color: transparent !important;
                overflow: hidden !important;
              }
              .att-print-all.att-half-first .att-overview-view,
              .att-print-all.att-half-second .att-overview-view { display: none !important; }
              .att-summary-box { border-color: #666 !important; }
              .att-table { border-color: #666 !important; }
            }
          `}</style>
        </>
      )}
    </div>
  );
}

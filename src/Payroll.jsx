import { useState, useEffect, useMemo, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════
// STATUTORY TABLES — 2026 Malaysia (KWSP / PERKESO / EIS)
// ═══════════════════════════════════════════════════════════════

// SOCSO Category 1 — Under 60, [maxWage, employer, employee]
const SOCSO_CAT1 = [
  [30,0.40,0.10],[50,0.70,0.20],[70,1.10,0.30],[100,1.50,0.40],
  [140,2.10,0.60],[200,2.95,0.85],[300,4.35,1.25],[400,6.15,1.75],
  [500,7.85,2.25],[600,9.65,2.75],[700,11.35,3.25],[800,13.15,3.75],
  [900,14.85,4.25],[1000,16.65,4.75],[1100,18.35,5.25],[1200,20.15,5.75],
  [1300,21.85,6.25],[1400,23.65,6.75],[1500,25.35,7.25],[1600,27.15,7.75],
  [1700,28.85,8.25],[1800,30.65,8.75],[1900,32.35,9.25],[2000,34.15,9.75],
  [2100,35.85,10.25],[2200,37.65,10.75],[2300,39.35,11.25],[2400,41.15,11.75],
  [2500,42.85,12.25],[2600,44.65,12.75],[2700,46.35,13.25],[2800,48.15,13.75],
  [2900,49.85,14.25],[3000,51.65,14.75],[3100,53.35,15.25],[3200,55.15,15.75],
  [3300,56.85,16.25],[3400,58.65,16.75],[3500,60.35,17.25],[3600,62.15,17.75],
  [3700,63.85,18.25],[3800,65.65,18.75],[3900,67.35,19.25],[4000,69.15,19.75],
  [4100,70.85,20.25],[4200,72.65,20.75],[4300,74.35,21.25],[4400,76.15,21.75],
  [4500,77.85,22.25],[4600,79.65,22.75],[4700,81.35,23.25],[4800,83.15,23.75],
  [4900,84.85,24.25],[5000,86.65,24.75],[5100,88.35,25.25],[5200,90.15,25.75],
  [5300,91.85,26.25],[5400,93.65,26.75],[5500,95.35,27.25],[5600,97.15,27.75],
  [5700,98.85,28.25],[5800,100.65,28.75],[5900,102.35,29.25],
  [6000,104.65,29.90],[Infinity,104.65,29.90]
];

// SOCSO Category 2 — Age 60+, employer only [maxWage, employer]
const SOCSO_CAT2 = [
  [30,0.30],[50,0.50],[70,0.80],[100,1.10],[140,1.50],[200,2.10],
  [300,3.10],[400,4.40],[500,5.60],[600,6.90],[700,8.10],[800,9.40],
  [900,10.60],[1000,11.90],[1100,13.10],[1200,14.40],[1300,15.60],
  [1400,16.90],[1500,18.10],[1700,20.60],[1900,23.10],[2000,24.40],
  [2200,26.90],[2500,30.60],[2800,34.40],[3000,36.90],[3300,40.60],
  [3500,43.10],[3800,46.90],[4000,49.40],[4300,53.10],[4500,55.60],
  [4800,59.40],[5000,61.90],[5300,65.60],[5600,69.40],[5900,73.10],
  [6000,74.40],[Infinity,74.40]
];

// EIS — 0.2% each side, [maxWage, amount] (same for employer & employee)
const EIS_TABLE = [
  [30,0.05],[50,0.10],[100,0.20],[200,0.30],[300,0.50],[400,0.70],
  [500,0.90],[600,1.10],[700,1.30],[800,1.50],[900,1.70],[1000,1.90],
  [1100,2.10],[1200,2.30],[1300,2.50],[1400,2.70],[1500,2.90],
  [1600,3.10],[1700,3.30],[1800,3.50],[1900,3.70],[2000,3.90],
  [2100,4.10],[2200,4.30],[2300,4.50],[2400,4.70],[2500,4.90],
  [2600,5.10],[2700,5.30],[2800,5.50],[2900,5.70],[3000,5.90],
  [3100,6.10],[3200,6.30],[3300,6.50],[3400,6.70],[3500,6.90],
  [3600,7.10],[3700,7.30],[3800,7.50],[3900,7.70],[4000,7.90],
  [4100,8.10],[4200,8.30],[4300,8.50],[4400,8.70],[4500,8.90],
  [4600,9.10],[4700,9.30],[4800,9.50],[4900,9.70],[5000,9.90],
  [5200,10.30],[5400,10.70],[5600,11.10],[5800,11.50],
  [6000,11.90],[Infinity,11.90]
];

// ═══════════════════════════════════════════════════════════════
// CALCULATION HELPERS
// ═══════════════════════════════════════════════════════════════

function getAgeFromIC(ic, refDate) {
  if (!ic || ic.length < 6) return null;
  const clean = ic.replace(/-/g, '');
  const yy = parseInt(clean.substring(0, 2));
  const mm = parseInt(clean.substring(2, 4)) - 1;
  const dd = parseInt(clean.substring(4, 6));
  const year = yy <= 30 ? 2000 + yy : 1900 + yy;
  const dob = new Date(year, mm, dd);
  const ref = refDate || new Date();
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) age--;
  return age;
}

function lookupBand(table, wage) {
  for (const row of table) {
    if (wage <= row[0]) return row;
  }
  return table[table.length - 1];
}

function calcEPF(salary, age) {
  if (age >= 60) {
    return { employer: Math.round(salary * 0.065), employee: Math.round(salary * 0.055) };
  }
  const employerRate = salary <= 5000 ? 0.13 : 0.12;
  return { employer: Math.round(salary * employerRate), employee: Math.round(salary * 0.11) };
}

function calcSOCSO(salary, age) {
  if (age >= 60) {
    const band = lookupBand(SOCSO_CAT2, salary);
    return { employer: band[1], employee: 0 };
  }
  const band = lookupBand(SOCSO_CAT1, salary);
  return { employer: band[1], employee: band[2] };
}

function calcEIS(salary, age) {
  if (age < 18 || age >= 60) return { employer: 0, employee: 0 };
  const band = lookupBand(EIS_TABLE, salary);
  return { employer: band[1], employee: band[1] };
}

function calcAll(salary, age) {
  const epf = calcEPF(salary, age);
  const socso = calcSOCSO(salary, age);
  const eis = calcEIS(salary, age);
  return { epf, socso, eis };
}

// ═══════════════════════════════════════════════════════════════
// LOCALSTORAGE HELPERS
// ═══════════════════════════════════════════════════════════════

const LS_STAFF = 'cjk_payroll_staff';
const LS_PAYROLL = 'cjk_payroll_data';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}
function saveJSON(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

// ═══════════════════════════════════════════════════════════════
// SAMPLE STAFF (pre-loaded from Owen's Excel)
// ═══════════════════════════════════════════════════════════════

const SAMPLE_STAFF = [
  { id:'s1', name:'JENNY KUEH MIAW SIN', ic:'940921-13-5170', position:'ADMIN INV. CLERK', salary:1700, method:'bank', status:'permanent' },
  { id:'s2', name:'JANET KUEH NEO PEI', ic:'971020-13-5220', position:'ASST. SUPERVISOR', salary:1700, method:'bank', status:'permanent' },
  { id:'s3', name:'LO HUI TIN', ic:'961122-13-5142', position:'PJ EXEC. OPERATIONS SUPERVISOR', salary:1700, method:'bank', status:'permanent' },
  { id:'s4', name:'JEE SUK HUI', ic:'981109-13-5330', position:'KC MERCHANDISER', salary:1700, method:'bank', status:'permanent' },
  { id:'s5', name:'VOON SUK YIN', ic:'001028-13-1446', position:'GENERAL CLERK', salary:1700, method:'cash', status:'permanent' },
  { id:'s6', name:'CHAI WAN NEE', ic:'011227-13-0648', position:'HEAD CASHIER', salary:1700, method:'cash', status:'permanent' },
  { id:'s7', name:'SIMON ANG TECK HOCK', ic:'740202-13-5485', position:'DRIVER', salary:1700, method:'cash', status:'permanent' },
  { id:'s8', name:'BONG SOON SIONG', ic:'840805-13-5159', position:'DRIVER', salary:1700, method:'cash', status:'permanent' },
  { id:'s9', name:'BONG SOON LEONG', ic:'000407-13-0385', position:'DRIVER ASSISTANT', salary:1700, method:'cash', status:'permanent' },
  { id:'s10', name:'LEE KIAN HOW', ic:'020812-13-0555', position:'DRIVER ASSISTANT', salary:1700, method:'cash', status:'permanent' },
  { id:'s11', name:"JAMBLIN ANAK E'IEH", ic:'841130-13-5189', position:'STOREKEEPER', salary:1700, method:'cash', status:'permanent' },
  { id:'s12', name:'HII KING HUI', ic:'840927-13-5595', position:'GENERAL WORKER', salary:1700, method:'cash', status:'permanent' },
  { id:'s13', name:'TAN SIAW CHIANG', ic:'841016-13-5505', position:'DRIVER', salary:1700, method:'cash', status:'permanent' },
  { id:'s14', name:'MUHAMMAD HAZIQ AKMAL BIN MARIKAN', ic:'001005-13-0467', position:'GENERAL WORKER', salary:1700, method:'cash', status:'permanent' },
  { id:'s15', name:'RALLY ANAK WILLIAM', ic:'020707-13-0721', position:'GENERAL WORKER', salary:1700, method:'cash', status:'permanent' },
  { id:'s16', name:'HAM KING PING', ic:'950110-13-5707', position:'GENERAL WORKER', salary:1700, method:'cash', status:'permanent' },
  { id:'s17', name:'MUHAMMAD RAMDZANI BIN WET', ic:'031118-13-0145', position:'GENERAL WORKER', salary:1700, method:'cash', status:'permanent' },
  { id:'s18', name:'KUA JAK HUN', ic:'790127-13-5746', position:'MERCHANDISER', salary:1700, method:'cash', status:'permanent' },
  { id:'s19', name:'AZNAN BIN ZAHIDI', ic:'870907-13-5413', position:'DRIVER', salary:1700, method:'cash', status:'permanent' },
  { id:'s20', name:'DANIELL SHAH RIEZAL BIN ROSLI', ic:'080705-13-0773', position:'GENERAL WORKER', salary:1700, method:'cash', status:'probationary' },
  { id:'s21', name:'JEE SWEE EN', ic:'060310-13-0180', position:'CASHIER', salary:1700, method:'cash', status:'probationary' },
  { id:'s22', name:'JANET SOON PEI YEE', ic:'020627-13-0836', position:'CASHIER', salary:1700, method:'cash', status:'probationary' },
];

const SAMPLE_PARTTIME = [
  { id:'p1', name:'TAN WEI HOW', ic:'071210-13-0507', position:'', wagePerDay:0, status:'part-time' },
];

// ═══════════════════════════════════════════════════════════════
// MONTHS
// ═══════════════════════════════════════════════════════════════

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

// ═══════════════════════════════════════════════════════════════
// EXCEL EXPORT (SheetJS)
// ═══════════════════════════════════════════════════════════════

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function exportPayrollExcel(month, year, bankRows, cashRows, bankTotals, cashTotals, grandTotals, partTimeRows, partTimeTotals, notes) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const ws = {};
  const merge = [];

  const monthName = MONTHS[month];
  const colW = [5,35,18,32,14,12,14,10,10,12,10,10,14,10,12,10,12];

  // Helper to set cell
  function sc(r, c, v, fmt) {
    const addr = XLSX.utils.encode_cell({r,c});
    ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's' };
    if (fmt) ws[addr].s = fmt;
  }

  const bold = { font: { bold: true } };
  const center = { alignment: { horizontal: 'center' } };
  const boldCenter = { font: { bold: true }, alignment: { horizontal: 'center' } };
  const yellow = { fill: { fgColor: { rgb: 'FFFF00' } }, font: { bold: true } };
  const num2 = { numFmt: '#,##0.00' };

  // Row 0: Company name
  sc(0, 0, 'C.J.K. CHAI JEE KIONG TRADING SDN BHD', boldCenter);
  merge.push({ s:{r:0,c:0}, e:{r:0,c:16} });

  // Row 1: Payroll title
  sc(1, 0, `HQ STAFF PAYROLL ${monthName} ${year}`, boldCenter);
  merge.push({ s:{r:1,c:0}, e:{r:1,c:16} });

  // Row 2: FULL-TIME STAFF
  sc(2, 0, 'FULL-TIME STAFF', boldCenter);
  merge.push({ s:{r:2,c:0}, e:{r:2,c:16} });

  // Row 3: Category headers
  sc(3, 4, 'EARNINGS (+)', boldCenter);
  merge.push({ s:{r:3,c:4}, e:{r:3,c:5} });
  sc(3, 7, 'DEDUCTIONS (-)', boldCenter);
  merge.push({ s:{r:3,c:7}, e:{r:3,c:15} });
  sc(3, 16, 'NET PAY', boldCenter);
  merge.push({ s:{r:3,c:16}, e:{r:4,c:16} });

  // Row 4: Column headers
  const headers = ['NO','NAME','IC NO','POSITION','BASIC SALARY','INCENTIVE','GAWAI BONUS',
    'EPF (M)','EPF (P)','JUMLAH EPF','SOCSO (M)','SOCSO (P)','JUMLAH SOCSO','EIS (M/P)','JUMLAH EIS','ADVANCE'];
  headers.forEach((h, i) => sc(4, i, h, bold));

  let row = 5;
  let staffNum = 1;

  // Bank Transfer staff
  bankRows.forEach(s => {
    sc(row, 0, staffNum);
    sc(row, 1, s.name);
    sc(row, 2, s.ic);
    sc(row, 3, s.position);
    sc(row, 4, s.salary);
    sc(row, 5, s.incentive || 0);
    sc(row, 6, s.bonus || 0);
    sc(row, 7, s.epfM);
    sc(row, 8, s.epfP);
    sc(row, 9, s.epfM + s.epfP);
    sc(row, 10, s.socsoM);
    sc(row, 11, s.socsoP);
    sc(row, 12, s.socsoM + s.socsoP);
    sc(row, 13, s.eisE);
    sc(row, 14, s.eisE * 2);
    sc(row, 15, s.advance || 0);
    sc(row, 16, s.netPay);
    staffNum++;
    row++;
  });

  // Bank transfer subtotal
  sc(row, 0, 'BANK TRANSFER:', bold);
  merge.push({ s:{r:row,c:0}, e:{r:row,c:3} });
  [4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c => sc(row, c, bankTotals[c] || 0, bold));
  row++;

  // Cash staff (permanent first, then probationary)
  const permanentCash = cashRows.filter(s => s.status === 'permanent');
  const probCash = cashRows.filter(s => s.status === 'probationary');

  permanentCash.forEach(s => {
    sc(row, 0, staffNum);
    sc(row, 1, s.name);
    sc(row, 2, s.ic);
    sc(row, 3, s.position);
    sc(row, 4, s.salary);
    sc(row, 5, s.incentive || 0);
    sc(row, 6, s.bonus || 0);
    sc(row, 7, s.epfM);
    sc(row, 8, s.epfP);
    sc(row, 9, s.epfM + s.epfP);
    sc(row, 10, s.socsoM);
    sc(row, 11, s.socsoP);
    sc(row, 12, s.socsoM + s.socsoP);
    sc(row, 13, s.eisE);
    sc(row, 14, s.eisE * 2);
    sc(row, 15, s.advance || 0);
    sc(row, 16, s.netPay);
    staffNum++;
    row++;
  });

  if (probCash.length > 0) {
    sc(row, 0, 'PROBATIONARY > PERMANENT', boldCenter);
    merge.push({ s:{r:row,c:0}, e:{r:row,c:16} });
    row++;

    probCash.forEach(s => {
      sc(row, 0, staffNum);
      sc(row, 1, s.name);
      sc(row, 2, s.ic);
      sc(row, 3, s.position);
      sc(row, 4, s.salary);
      sc(row, 5, s.incentive || 0);
      sc(row, 6, s.bonus || 0);
      sc(row, 7, s.epfM);
      sc(row, 8, s.epfP);
      sc(row, 9, s.epfM + s.epfP);
      sc(row, 10, s.socsoM);
      sc(row, 11, s.socsoP);
      sc(row, 12, s.socsoM + s.socsoP);
      sc(row, 13, s.eisE);
      sc(row, 14, s.eisE * 2);
      sc(row, 15, s.advance || 0);
      sc(row, 16, s.netPay);
      staffNum++;
      row++;
    });
  }

  // Cash subtotal
  sc(row, 0, 'CASH:', bold);
  merge.push({ s:{r:row,c:0}, e:{r:row,c:3} });
  [4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c => sc(row, c, cashTotals[c] || 0, bold));
  row++;

  // Grand total
  sc(row, 0, 'TOTAL:', bold);
  merge.push({ s:{r:row,c:0}, e:{r:row,c:3} });
  [4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c => sc(row, c, grandTotals[c] || 0, { ...bold, ...yellow }));
  row++;

  // Notes
  notes.forEach(n => {
    sc(row, 0, n);
    merge.push({ s:{r:row,c:0}, e:{r:row,c:16} });
    row++;
  });

  // Part-time section
  row++;
  sc(row, 0, 'PART-TIME STAFF', boldCenter);
  merge.push({ s:{r:row,c:0}, e:{r:row,c:16} });
  row++;

  sc(row, 4, 'WAGES/ DAY', bold);
  sc(row, 5, 'DAY', bold);
  sc(row, 15, 'ADVANCE', bold);
  sc(row, 16, 'NET PAY', bold);
  row++;

  partTimeRows.forEach((s, i) => {
    sc(row, 0, i + 1);
    sc(row, 1, s.name);
    sc(row, 2, s.ic);
    sc(row, 4, s.wagePerDay || 0);
    sc(row, 5, s.daysWorked || 0);
    sc(row, 15, s.advance || 0);
    sc(row, 16, s.netPay || 0);
    row++;
  });

  sc(row, 0, 'TOTAL:', bold);
  merge.push({ s:{r:row,c:0}, e:{r:row,c:3} });
  sc(row, 15, partTimeTotals.advance || 0, bold);
  sc(row, 16, partTimeTotals.netPay || 0, bold);

  // Finalize
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:row,c:16} });
  ws['!merges'] = merge;
  ws['!cols'] = colW.map(w => ({ wch: w }));

  XLSX.utils.book_append_sheet(wb, ws, monthName.substring(0, 3));
  XLSX.writeFile(wb, `HQ_STAFF_PAYROLL_${year}_${monthName}.xlsx`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function Payroll() {
  const now = new Date();
  const [view, setView] = useState('payroll'); // 'payroll' | 'staff'
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [staff, setStaff] = useState(() => loadJSON(LS_STAFF, SAMPLE_STAFF));
  const [partTime, setPartTime] = useState(() => loadJSON('cjk_payroll_parttime', SAMPLE_PARTTIME));
  const [payrollData, setPayrollData] = useState(() => loadJSON(LS_PAYROLL, {}));
  const [bonusLabel, setBonusLabel] = useState('GAWAI BONUS');

  // Staff form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name:'', ic:'', position:'', salary:1700, method:'cash', status:'permanent' });

  // Part-time form
  const [showPTForm, setShowPTForm] = useState(false);
  const [ptForm, setPtForm] = useState({ name:'', ic:'', position:'', wagePerDay:0 });

  useEffect(() => { saveJSON(LS_STAFF, staff); }, [staff]);
  useEffect(() => { saveJSON('cjk_payroll_parttime', partTime); }, [partTime]);
  useEffect(() => { saveJSON(LS_PAYROLL, payrollData); }, [payrollData]);

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const refDate = new Date(year, month, 15);

  // Get/set per-staff monthly data
  const getMonthly = useCallback((staffId) => {
    return payrollData[monthKey]?.[staffId] || { incentive: 0, bonus: 0, advance: 0, wagePerDay: 0, daysWorked: 0 };
  }, [payrollData, monthKey]);

  const setMonthly = useCallback((staffId, field, value) => {
    setPayrollData(prev => {
      const next = { ...prev };
      if (!next[monthKey]) next[monthKey] = {};
      if (!next[monthKey][staffId]) next[monthKey][staffId] = { incentive: 0, bonus: 0, advance: 0, wagePerDay: 0, daysWorked: 0 };
      next[monthKey][staffId] = { ...next[monthKey][staffId], [field]: parseFloat(value) || 0 };
      return next;
    });
  }, [monthKey]);

  // Compute payroll rows
  const computeRow = useCallback((s) => {
    const age = getAgeFromIC(s.ic, refDate);
    const monthly = getMonthly(s.id);
    const { epf, socso, eis } = calcAll(s.salary, age);
    const netPay = s.salary + (monthly.incentive || 0) + (monthly.bonus || 0)
      - epf.employee - socso.employee - eis.employee - (monthly.advance || 0);
    return {
      ...s,
      age,
      incentive: monthly.incentive || 0,
      bonus: monthly.bonus || 0,
      advance: monthly.advance || 0,
      epfM: epf.employer, epfP: epf.employee,
      socsoM: socso.employer, socsoP: socso.employee,
      eisE: eis.employee,
      netPay: Math.round(netPay * 100) / 100,
      underAge: age < 18,
    };
  }, [refDate, getMonthly]);

  const bankStaff = useMemo(() => staff.filter(s => s.method === 'bank').map(computeRow), [staff, computeRow]);
  const cashStaff = useMemo(() => staff.filter(s => s.method === 'cash').map(computeRow), [staff, computeRow]);

  // Part-time computed
  const ptRows = useMemo(() => partTime.map(s => {
    const m = getMonthly(s.id);
    const wage = m.wagePerDay || s.wagePerDay || 0;
    const days = m.daysWorked || 0;
    const adv = m.advance || 0;
    return { ...s, wagePerDay: wage, daysWorked: days, advance: adv, netPay: Math.round((wage * days - adv) * 100) / 100 };
  }), [partTime, getMonthly]);

  // Totals helper
  function sumRows(rows) {
    const t = {};
    [4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c => t[c] = 0);
    rows.forEach(r => {
      t[4] += r.salary; t[5] += r.incentive; t[6] += r.bonus;
      t[7] += r.epfM; t[8] += r.epfP; t[9] += r.epfM + r.epfP;
      t[10] += r.socsoM; t[11] += r.socsoP; t[12] += r.socsoM + r.socsoP;
      t[13] += r.eisE; t[14] += r.eisE * 2; t[15] += r.advance;
      t[16] += r.netPay;
    });
    Object.keys(t).forEach(k => t[k] = Math.round(t[k] * 100) / 100);
    return t;
  }

  const bankTotals = useMemo(() => sumRows(bankStaff), [bankStaff]);
  const cashTotals = useMemo(() => sumRows(cashStaff), [cashStaff]);
  const grandTotals = useMemo(() => {
    const t = {};
    Object.keys(bankTotals).forEach(k => t[k] = Math.round((bankTotals[k] + cashTotals[k]) * 100) / 100);
    return t;
  }, [bankTotals, cashTotals]);
  const ptTotals = useMemo(() => ({
    advance: ptRows.reduce((s, r) => s + r.advance, 0),
    netPay: ptRows.reduce((s, r) => s + r.netPay, 0),
  }), [ptRows]);

  // Notes (auto-generated)
  const notes = useMemo(() => {
    const n = [];
    const underAge = [...bankStaff, ...cashStaff].filter(r => r.underAge);
    underAge.forEach(r => n.push(`* ${r.name.split(' ')[0].toUpperCase()}: below 18 years old is not subject to EIS deduction as per PERKESO requirements.`));
    return n;
  }, [bankStaff, cashStaff]);

  // Staff CRUD
  function addStaff() {
    const id = 's' + Date.now();
    setStaff(prev => [...prev, { id, ...form }]);
    setForm({ name:'', ic:'', position:'', salary:1700, method:'cash', status:'permanent' });
    setShowForm(false);
  }
  function updateStaff() {
    setStaff(prev => prev.map(s => s.id === editId ? { ...s, ...form } : s));
    setEditId(null);
    setForm({ name:'', ic:'', position:'', salary:1700, method:'cash', status:'permanent' });
    setShowForm(false);
  }
  function deleteStaff(id) {
    if (confirm('Remove this staff member?')) setStaff(prev => prev.filter(s => s.id !== id));
  }
  function editStaff(s) {
    setEditId(s.id);
    setForm({ name: s.name, ic: s.ic, position: s.position, salary: s.salary, method: s.method, status: s.status });
    setShowForm(true);
  }

  // Part-time CRUD
  function addPartTime() {
    const id = 'p' + Date.now();
    setPartTime(prev => [...prev, { id, ...ptForm, status: 'part-time' }]);
    setPtForm({ name:'', ic:'', position:'', wagePerDay:0 });
    setShowPTForm(false);
  }
  function deletePartTime(id) {
    if (confirm('Remove this part-time staff?')) setPartTime(prev => prev.filter(s => s.id !== id));
  }

  // Export
  async function handleExport() {
    await exportPayrollExcel(month, year, bankStaff, cashStaff, bankTotals, cashTotals, grandTotals, ptRows, ptTotals, notes);
  }

  // Print
  function handlePrint() { window.print(); }

  // Navigate months
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  // Format number
  const fmt = (n) => n === 0 ? '0' : n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ─── Render ───
  const inputStyle = "w-full border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-black";
  const btnPrimary = "bg-black text-white px-4 py-2 text-sm font-medium hover:bg-gray-800 transition-colors";
  const btnOutline = "border border-black px-4 py-2 text-sm font-medium hover:bg-gray-100 transition-colors";

  function PayrollTable({ rows, label, totals, showEditable = true }) {
    const permanentRows = rows.filter(r => r.status !== 'probationary');
    const probRows = rows.filter(r => r.status === 'probationary');
    let num = label === 'BANK TRANSFER' ? 1 : bankStaff.length + 1;

    function renderRow(r, idx) {
      const currentNum = num++;
      return (
        <tr key={r.id} className="border-b border-gray-200 hover:bg-gray-50">
          <td className="py-1.5 px-2 text-center text-sm">{currentNum}</td>
          <td className="py-1.5 px-2 text-sm font-medium whitespace-nowrap">{r.name}</td>
          <td className="py-1.5 px-2 text-sm text-gray-600">{r.ic}</td>
          <td className="py-1.5 px-2 text-sm text-gray-600">{r.position}</td>
          <td className="py-1.5 px-2 text-right text-sm">{fmt(r.salary)}</td>
          <td className="py-1.5 px-1 text-right">
            {showEditable ? (
              <input type="number" value={r.incentive || ''} placeholder="0"
                onChange={e => setMonthly(r.id, 'incentive', e.target.value)}
                className="w-16 text-right text-sm border-b border-dashed border-gray-300 focus:outline-none focus:border-black bg-transparent py-0.5" />
            ) : <span className="text-sm">{fmt(r.incentive)}</span>}
          </td>
          <td className="py-1.5 px-1 text-right">
            {showEditable ? (
              <input type="number" value={r.bonus || ''} placeholder="0"
                onChange={e => setMonthly(r.id, 'bonus', e.target.value)}
                className="w-16 text-right text-sm border-b border-dashed border-gray-300 focus:outline-none focus:border-black bg-transparent py-0.5" />
            ) : <span className="text-sm">{fmt(r.bonus)}</span>}
          </td>
          <td className="py-1.5 px-2 text-right text-sm text-gray-500">{fmt(r.epfM)}</td>
          <td className="py-1.5 px-2 text-right text-sm text-gray-500">{fmt(r.epfP)}</td>
          <td className="py-1.5 px-2 text-right text-sm font-medium">{fmt(r.epfM + r.epfP)}</td>
          <td className="py-1.5 px-2 text-right text-sm text-gray-500">{fmt(r.socsoM)}</td>
          <td className="py-1.5 px-2 text-right text-sm text-gray-500">{fmt(r.socsoP)}</td>
          <td className="py-1.5 px-2 text-right text-sm font-medium">{fmt(r.socsoM + r.socsoP)}</td>
          <td className="py-1.5 px-2 text-right text-sm text-gray-500">{fmt(r.eisE)}</td>
          <td className="py-1.5 px-2 text-right text-sm font-medium">{fmt(r.eisE * 2)}</td>
          <td className="py-1.5 px-1 text-right">
            {showEditable ? (
              <input type="number" value={r.advance || ''} placeholder="0"
                onChange={e => setMonthly(r.id, 'advance', e.target.value)}
                className="w-16 text-right text-sm border-b border-dashed border-gray-300 focus:outline-none focus:border-black bg-transparent py-0.5" />
            ) : <span className="text-sm">{fmt(r.advance)}</span>}
          </td>
          <td className="py-1.5 px-2 text-right text-sm font-bold">{fmt(r.netPay)}</td>
        </tr>
      );
    }

    function TotalRow({ lbl, t, highlight }) {
      return (
        <tr className={`border-b-2 border-black font-bold ${highlight ? 'bg-yellow-100' : 'bg-gray-100'}`}>
          <td colSpan={4} className="py-2 px-2 text-sm">{lbl}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[4])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[5])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[6])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[7])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[8])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[9])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[10])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[11])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[12])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[13])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[14])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[15])}</td>
          <td className="py-2 px-2 text-right text-sm">{fmt(t[16])}</td>
        </tr>
      );
    }

    return (
      <>
        {permanentRows.map(renderRow)}
        {label === 'CASH' && probRows.length > 0 && (
          <>
            <tr className="bg-gray-50"><td colSpan={17} className="py-1.5 px-2 text-sm font-semibold tracking-wide text-gray-700">PROBATIONARY → PERMANENT</td></tr>
            {probRows.map(renderRow)}
          </>
        )}
        <TotalRow lbl={`${label}:`} t={totals} />
      </>
    );
  }

  // ─── STAFF MANAGEMENT VIEW ───
  if (view === 'staff') {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold tracking-tight">STAFF MANAGEMENT — HQ</h1>
          <button onClick={() => setView('payroll')} className={btnOutline}>← Back to Payroll</button>
        </div>

        {/* Full-time staff */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Full-Time Staff ({staff.length})</h2>
          <button onClick={() => { setEditId(null); setForm({ name:'', ic:'', position:'', salary:1700, method:'cash', status:'permanent' }); setShowForm(true); }} className={btnPrimary}>+ Add Staff</button>
        </div>

        {showForm && (
          <div className="border border-gray-300 p-4 mb-4 bg-gray-50">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">NAME</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value.toUpperCase()}))} className={inputStyle} placeholder="Full name (uppercase)" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">IC NO</label>
                <input value={form.ic} onChange={e => setForm(f => ({...f, ic: e.target.value}))} className={inputStyle} placeholder="YYMMDD-SS-NNNN" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">POSITION</label>
                <input value={form.position} onChange={e => setForm(f => ({...f, position: e.target.value.toUpperCase()}))} className={inputStyle} placeholder="Job title" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">BASIC SALARY (RM)</label>
                <input type="number" value={form.salary} onChange={e => setForm(f => ({...f, salary: parseFloat(e.target.value) || 0}))} className={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">PAYMENT METHOD</label>
                <select value={form.method} onChange={e => setForm(f => ({...f, method: e.target.value}))} className={inputStyle}>
                  <option value="bank">Bank Transfer</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">STATUS</label>
                <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))} className={inputStyle}>
                  <option value="permanent">Permanent</option>
                  <option value="probationary">Probationary</option>
                </select>
              </div>
            </div>
            {form.ic && getAgeFromIC(form.ic, new Date()) !== null && (
              <p className="text-xs text-gray-500 mb-3">
                Age: {getAgeFromIC(form.ic, new Date())} years old
                {getAgeFromIC(form.ic, new Date()) < 18 && <span className="text-red-600 font-medium"> — Under 18, EIS exempt</span>}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={editId ? updateStaff : addStaff} className={btnPrimary}>{editId ? 'Update' : 'Add'}</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className={btnOutline}>Cancel</button>
            </div>
          </div>
        )}

        <table className="w-full text-sm border-collapse mb-8">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 px-2 w-8">#</th>
              <th className="py-2 px-2">Name</th>
              <th className="py-2 px-2">IC</th>
              <th className="py-2 px-2">Position</th>
              <th className="py-2 px-2 text-right">Salary</th>
              <th className="py-2 px-2">Method</th>
              <th className="py-2 px-2">Status</th>
              <th className="py-2 px-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s, i) => (
              <tr key={s.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="py-1.5 px-2 text-gray-400">{i + 1}</td>
                <td className="py-1.5 px-2 font-medium">{s.name}</td>
                <td className="py-1.5 px-2 text-gray-600">{s.ic}</td>
                <td className="py-1.5 px-2 text-gray-600">{s.position}</td>
                <td className="py-1.5 px-2 text-right">{fmt(s.salary)}</td>
                <td className="py-1.5 px-2">
                  <span className={`text-xs px-2 py-0.5 ${s.method === 'bank' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                    {s.method === 'bank' ? 'BANK' : 'CASH'}
                  </span>
                </td>
                <td className="py-1.5 px-2">
                  <span className={`text-xs px-2 py-0.5 ${s.status === 'probationary' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100'}`}>
                    {s.status.toUpperCase()}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right">
                  <button onClick={() => editStaff(s)} className="text-xs text-gray-500 hover:text-black mr-2">Edit</button>
                  <button onClick={() => deleteStaff(s.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Part-time staff */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Part-Time Staff ({partTime.length})</h2>
          <button onClick={() => setShowPTForm(true)} className={btnPrimary}>+ Add Part-Time</button>
        </div>

        {showPTForm && (
          <div className="border border-gray-300 p-4 mb-4 bg-gray-50">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">NAME</label>
                <input value={ptForm.name} onChange={e => setPtForm(f => ({...f, name: e.target.value.toUpperCase()}))} className={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">IC NO</label>
                <input value={ptForm.ic} onChange={e => setPtForm(f => ({...f, ic: e.target.value}))} className={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">DEFAULT WAGE/DAY (RM)</label>
                <input type="number" value={ptForm.wagePerDay} onChange={e => setPtForm(f => ({...f, wagePerDay: parseFloat(e.target.value) || 0}))} className={inputStyle} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addPartTime} className={btnPrimary}>Add</button>
              <button onClick={() => setShowPTForm(false)} className={btnOutline}>Cancel</button>
            </div>
          </div>
        )}

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 px-2 w-8">#</th>
              <th className="py-2 px-2">Name</th>
              <th className="py-2 px-2">IC</th>
              <th className="py-2 px-2 text-right">Wage/Day</th>
              <th className="py-2 px-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {partTime.map((s, i) => (
              <tr key={s.id} className="border-b border-gray-200">
                <td className="py-1.5 px-2 text-gray-400">{i + 1}</td>
                <td className="py-1.5 px-2 font-medium">{s.name}</td>
                <td className="py-1.5 px-2 text-gray-600">{s.ic}</td>
                <td className="py-1.5 px-2 text-right">{fmt(s.wagePerDay)}</td>
                <td className="py-1.5 px-2 text-right">
                  <button onClick={() => deletePartTime(s.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ─── PAYROLL VIEW ───
  return (
    <div className="w-full">
      {/* Top bar */}
      <div className="max-w-[1400px] mx-auto px-4 py-4 flex items-center justify-between no-print">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold tracking-tight">CJK PAYROLL</h1>
          <button onClick={() => setView('staff')} className="text-sm text-gray-500 hover:text-black transition-colors">
            Manage Staff →
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="px-3 py-1.5 border border-gray-300 text-sm hover:bg-gray-100">◀</button>
          <div className="px-4 py-1.5 text-sm font-semibold min-w-[160px] text-center">
            {MONTHS[month]} {year}
          </div>
          <button onClick={nextMonth} className="px-3 py-1.5 border border-gray-300 text-sm hover:bg-gray-100">▶</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-2">
            <label className="text-xs text-gray-400">Bonus Label:</label>
            <input value={bonusLabel} onChange={e => setBonusLabel(e.target.value.toUpperCase())}
              className="w-28 text-xs border-b border-dashed border-gray-300 focus:outline-none focus:border-black py-0.5 text-center bg-transparent" />
          </div>
          <button onClick={handleExport} className={btnPrimary}>↓ Excel</button>
          <button onClick={handlePrint} className={btnOutline}>⎙ Print</button>
        </div>
      </div>

      {/* Payroll document */}
      <div className="max-w-[1400px] mx-auto px-4 pb-8 print-area">
        {/* Header */}
        <div className="text-center mb-4 border-b-2 border-black pb-3">
          <h2 className="text-base font-bold tracking-wide">C.J.K. CHAI JEE KIONG TRADING SDN BHD</h2>
          <h3 className="text-sm font-semibold mt-1">HQ STAFF PAYROLL {MONTHS[month]} {year}</h3>
        </div>

        {/* Full-time table */}
        <div className="text-xs font-semibold tracking-wider text-gray-600 mb-2">FULL-TIME STAFF</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[1200px]">
            <thead>
              <tr className="border-b border-gray-300">
                <th colSpan={4}></th>
                <th colSpan={3} className="text-center text-xs font-semibold py-1 text-green-800 bg-green-50">EARNINGS (+)</th>
                <th colSpan={9} className="text-center text-xs font-semibold py-1 text-red-800 bg-red-50">DEDUCTIONS (−)</th>
                <th className="text-center text-xs font-semibold py-1 bg-gray-100">NET PAY</th>
              </tr>
              <tr className="border-b-2 border-black text-xs text-gray-600">
                <th className="py-2 px-2 text-left w-8">NO</th>
                <th className="py-2 px-2 text-left">NAME</th>
                <th className="py-2 px-2 text-left">IC NO</th>
                <th className="py-2 px-2 text-left">POSITION</th>
                <th className="py-2 px-2 text-right">BASIC<br/>SALARY</th>
                <th className="py-2 px-1 text-right">INCENTIVE</th>
                <th className="py-2 px-1 text-right">{bonusLabel}</th>
                <th className="py-2 px-2 text-right">EPF<br/>(M)</th>
                <th className="py-2 px-2 text-right">EPF<br/>(P)</th>
                <th className="py-2 px-2 text-right">JUMLAH<br/>EPF</th>
                <th className="py-2 px-2 text-right">SOCSO<br/>(M)</th>
                <th className="py-2 px-2 text-right">SOCSO<br/>(P)</th>
                <th className="py-2 px-2 text-right">JUMLAH<br/>SOCSO</th>
                <th className="py-2 px-2 text-right">EIS<br/>(M/P)</th>
                <th className="py-2 px-2 text-right">JUMLAH<br/>EIS</th>
                <th className="py-2 px-1 text-right">ADVANCE</th>
                <th className="py-2 px-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              <PayrollTable rows={bankStaff} label="BANK TRANSFER" totals={bankTotals} />
              <PayrollTable rows={cashStaff} label="CASH" totals={cashTotals} />
              {/* Grand total */}
              <tr className="bg-yellow-100 border-b-2 border-black font-bold">
                <td colSpan={4} className="py-2 px-2 text-sm">TOTAL:</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[4])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[5])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[6])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[7])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[8])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[9])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[10])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[11])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[12])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[13])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[14])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[15])}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(grandTotals[16])}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Notes */}
        {notes.length > 0 && (
          <div className="mt-3 mb-4">
            {notes.map((n, i) => <p key={i} className="text-xs text-gray-600 italic">{n}</p>)}
          </div>
        )}

        {/* Part-time section */}
        <div className="text-xs font-semibold tracking-wider text-gray-600 mt-6 mb-2">PART-TIME STAFF</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-black text-xs text-gray-600">
                <th className="py-2 px-2 text-left w-8">NO</th>
                <th className="py-2 px-2 text-left">NAME</th>
                <th className="py-2 px-2 text-left">IC NO</th>
                <th className="py-2 px-2 text-left">POSITION</th>
                <th className="py-2 px-2 text-right">WAGES/DAY</th>
                <th className="py-2 px-2 text-right">DAY</th>
                <th className="py-2 px-2 text-right">ADVANCE</th>
                <th className="py-2 px-2 text-right">NET PAY</th>
              </tr>
            </thead>
            <tbody>
              {ptRows.map((r, i) => (
                <tr key={r.id} className="border-b border-gray-200">
                  <td className="py-1.5 px-2 text-center">{i + 1}</td>
                  <td className="py-1.5 px-2 font-medium">{r.name}</td>
                  <td className="py-1.5 px-2 text-gray-600">{r.ic}</td>
                  <td className="py-1.5 px-2 text-gray-600">{r.position}</td>
                  <td className="py-1.5 px-1 text-right">
                    <input type="number" value={r.wagePerDay || ''} placeholder="0"
                      onChange={e => setMonthly(r.id, 'wagePerDay', e.target.value)}
                      className="w-16 text-right text-sm border-b border-dashed border-gray-300 focus:outline-none focus:border-black bg-transparent py-0.5 no-print-border" />
                  </td>
                  <td className="py-1.5 px-1 text-right">
                    <input type="number" value={r.daysWorked || ''} placeholder="0"
                      onChange={e => setMonthly(r.id, 'daysWorked', e.target.value)}
                      className="w-12 text-right text-sm border-b border-dashed border-gray-300 focus:outline-none focus:border-black bg-transparent py-0.5 no-print-border" />
                  </td>
                  <td className="py-1.5 px-1 text-right">
                    <input type="number" value={r.advance || ''} placeholder="0"
                      onChange={e => setMonthly(r.id, 'advance', e.target.value)}
                      className="w-16 text-right text-sm border-b border-dashed border-gray-300 focus:outline-none focus:border-black bg-transparent py-0.5 no-print-border" />
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold">{fmt(r.netPay)}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-bold border-b-2 border-black">
                <td colSpan={6} className="py-2 px-2">TOTAL:</td>
                <td className="py-2 px-2 text-right">{fmt(ptTotals.advance)}</td>
                <td className="py-2 px-2 text-right">{fmt(ptTotals.netPay)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
          .print-area { padding: 12mm !important; max-width: 100% !important; }
          table { font-size: 9pt !important; }
          input { border: none !important; background: transparent !important; }
          .no-print-border { border: none !important; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      `}</style>
    </div>
  );
}

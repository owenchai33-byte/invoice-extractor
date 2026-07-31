import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSXStyle from 'xlsx-js-style';   // styled Excel export (borders, bold, fills)
// ═══════════════════════════════════════════════════════════════
// STATUTORY TABLES — Malaysia
// Sources: PERKESO SOCSO+SKBBK (June 2026), PERKESO EIS Akta 800
// (Oct 2024), KWSP EPF Jadual Ketiga (effective Oct 2025).
// All three tables share the same 65 wage bands:
// 30, 50, 70, 100, 140, 200, 300, 400, then +100 up to 6,000, then ceiling.
// ═══════════════════════════════════════════════════════════════

// SOCSO Category 1 — under 60. [maxWage, employer, employee_invalidity, employee_SKBBK]
// employee total = invalidity + SKBBK (Non-Employment Injury, aka Lindung 24 Jam).
export const SOCSO_CAT1 = [
  [30,0.40,0.10,0.20],[50,0.70,0.20,0.30],[70,1.10,0.30,0.50],[100,1.50,0.40,0.65],
  [140,2.10,0.60,0.90],[200,2.95,0.85,1.25],[300,4.35,1.25,1.85],[400,6.15,1.75,2.65],
  [500,7.85,2.25,3.35],[600,9.65,2.75,4.15],[700,11.35,3.25,4.85],[800,13.15,3.75,5.65],
  [900,14.85,4.25,6.35],[1000,16.65,4.75,7.15],[1100,18.35,5.25,7.85],[1200,20.15,5.75,8.65],
  [1300,21.85,6.25,9.35],[1400,23.65,6.75,10.15],[1500,25.35,7.25,10.85],[1600,27.15,7.75,11.65],
  [1700,28.85,8.25,12.35],[1800,30.65,8.75,13.15],[1900,32.35,9.25,13.85],[2000,34.15,9.75,14.65],
  [2100,35.85,10.25,15.35],[2200,37.65,10.75,16.15],[2300,39.35,11.25,16.85],[2400,41.15,11.75,17.65],
  [2500,42.85,12.25,18.35],[2600,44.65,12.75,19.15],[2700,46.35,13.25,19.85],[2800,48.15,13.75,20.65],
  [2900,49.85,14.25,21.35],[3000,51.65,14.75,22.15],[3100,53.35,15.25,22.85],[3200,55.15,15.75,23.65],
  [3300,56.85,16.25,24.35],[3400,58.65,16.75,25.15],[3500,60.35,17.25,25.85],[3600,62.15,17.75,26.65],
  [3700,63.85,18.25,27.35],[3800,65.65,18.75,28.15],[3900,67.35,19.25,28.85],[4000,69.15,19.75,29.65],
  [4100,70.85,20.25,30.35],[4200,72.65,20.75,31.15],[4300,74.35,21.25,31.85],[4400,76.15,21.75,32.65],
  [4500,77.85,22.25,33.35],[4600,79.65,22.75,34.15],[4700,81.35,23.25,34.85],[4800,83.15,23.75,35.65],
  [4900,84.85,24.25,36.35],[5000,86.65,24.75,37.15],[5100,88.35,25.25,37.85],[5200,90.15,25.75,38.65],
  [5300,91.85,26.25,39.35],[5400,93.65,26.75,40.15],[5500,95.35,27.25,40.85],[5600,97.15,27.75,41.65],
  [5700,98.85,28.25,42.35],[5800,100.65,28.75,43.15],[5900,102.35,29.25,43.85],
  [6000,104.15,29.75,44.65],[Infinity,104.15,29.75,44.65]
];

// SOCSO Category 2 — age 60+. [maxWage, employer, employee_SKBBK]
// Employee SKBBK column added per June 2026 PERKESO update (previously employer-only).
export const SOCSO_CAT2 = [
  [30,0.30,0.20],[50,0.50,0.30],[70,0.80,0.50],[100,1.10,0.65],
  [140,1.50,0.90],[200,2.10,1.25],[300,3.10,1.85],[400,4.40,2.65],
  [500,5.60,3.35],[600,6.90,4.15],[700,8.10,4.85],[800,9.40,5.65],
  [900,10.60,6.35],[1000,11.90,7.15],[1100,13.10,7.85],[1200,14.40,8.65],
  [1300,15.60,9.35],[1400,16.90,10.15],[1500,18.10,10.85],[1600,19.40,11.65],
  [1700,20.60,12.35],[1800,21.90,13.15],[1900,23.10,13.85],[2000,24.40,14.65],
  [2100,25.60,15.35],[2200,26.90,16.15],[2300,28.10,16.85],[2400,29.40,17.65],
  [2500,30.60,18.35],[2600,31.90,19.15],[2700,33.10,19.85],[2800,34.40,20.65],
  [2900,35.60,21.35],[3000,36.90,22.15],[3100,38.10,22.85],[3200,39.40,23.65],
  [3300,40.60,24.35],[3400,41.90,25.15],[3500,43.10,25.85],[3600,44.40,26.65],
  [3700,45.60,27.35],[3800,46.90,28.15],[3900,48.10,28.85],[4000,49.40,29.65],
  [4100,50.60,30.35],[4200,51.90,31.15],[4300,53.10,31.85],[4400,54.40,32.65],
  [4500,55.60,33.35],[4600,56.90,34.15],[4700,58.10,34.85],[4800,59.40,35.65],
  [4900,60.60,36.35],[5000,61.90,37.15],[5100,63.10,37.85],[5200,64.40,38.65],
  [5300,65.60,39.35],[5400,66.90,40.15],[5500,68.10,40.85],[5600,69.40,41.65],
  [5700,70.60,42.35],[5800,71.90,43.15],[5900,73.10,43.85],
  [6000,74.40,44.65],[Infinity,74.40,44.65]
];

// EIS — same 65 bands as SOCSO. Employer and employee pay the same amount.
export const EIS_TABLE = [
  [30,0.05],[50,0.10],[70,0.15],[100,0.20],[140,0.25],[200,0.35],
  [300,0.50],[400,0.70],[500,0.90],[600,1.10],[700,1.30],[800,1.50],
  [900,1.70],[1000,1.90],[1100,2.10],[1200,2.30],[1300,2.50],[1400,2.70],
  [1500,2.90],[1600,3.10],[1700,3.30],[1800,3.50],[1900,3.70],[2000,3.90],
  [2100,4.10],[2200,4.30],[2300,4.50],[2400,4.70],[2500,4.90],[2600,5.10],
  [2700,5.30],[2800,5.50],[2900,5.70],[3000,5.90],[3100,6.10],[3200,6.30],
  [3300,6.50],[3400,6.70],[3500,6.90],[3600,7.10],[3700,7.30],[3800,7.50],
  [3900,7.70],[4000,7.90],[4100,8.10],[4200,8.30],[4300,8.50],[4400,8.70],
  [4500,8.90],[4600,9.10],[4700,9.30],[4800,9.50],[4900,9.70],[5000,9.90],
  [5100,10.10],[5200,10.30],[5300,10.50],[5400,10.70],[5500,10.90],[5600,11.10],
  [5700,11.30],[5800,11.50],[5900,11.70],[6000,11.90],[Infinity,11.90]
];
export function getAgeFromIC(ic, refDate) {
  if (!ic || ic.length < 6) return null;
  const c = ic.replace(/-/g, '');
  const yy = parseInt(c.substring(0,2));
  const mm = parseInt(c.substring(2,4)) - 1;
  const dd = parseInt(c.substring(4,6));
  // Defensive: garbage strings (e.g. "abcdef") parse to NaN. Return null so
  // downstream calcs don't silently treat NaN age as under-60.
  if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null;
  const yr = yy <= 30 ? 2000+yy : 1900+yy, dob = new Date(yr,mm,dd), ref = refDate||new Date();
  let age = ref.getFullYear()-dob.getFullYear(); const m = ref.getMonth()-dob.getMonth();
  if (m<0||(m===0&&ref.getDate()<dob.getDate())) age--; return age;
}
export function lookupBand(t,w){for(const r of t){if(w<=r[0])return r;}return t[t.length-1];}
// EPF — KWSP Jadual Ketiga (Third Schedule).
// For monthly wages up to RM5,000, contributions are calculated using RM20 wage bands.
// Within each band, the contribution is calculated on the UPPER EDGE of the band and
// rounded UP to the nearest ringgit. This is why a wage of 2550 produces 333/282
// (band 2540.01–2560.00, upper edge 2560 × 13%/11% rounded up) — not 332/281 (flat %).
// Above RM5,000, percentage applies directly without banding.
// Note: for age 60+ Malaysian citizens, KWSP changed rates in 2024 to 0% employee /
// 4% employer. Old rate (6.5/5.5) preserved here — verify with accountant before relying.
// EPF — KWSP Jadual Ketiga (effective 1 October 2025).
// Wages ≤ RM5,000: RM20 wage bands, contribution on upper edge, ceiling-rounded.
// Wages > RM5,000: RM100 wage bands (same banding rule, contribution on upper edge).
// Rates depend on age + citizenship. We assume Malaysian citizens (CJK is
// all-Malaysian) — Part A under 60, Part E at 60+. If a PR or foreigner-
// elected-pre-1998 is hired, add a citizenship flag and switch to Part C rates
// (6.5%/5.5%). Foreign workers (Part F) are 2%/2% flat.
export function calcEPF(s, a){
  // Defensive guard: invalid/blank/negative wages → zero deductions.
  if (!s || !isFinite(s) || s <= 0) return { employer: 0, employee: 0 };
  const banded = s <= 5000 ? Math.ceil(s / 20) * 20 : Math.ceil(s / 100) * 100;

  if (a >= 60) {
    // Part E — Malaysian citizens 60+: employer 4%, employee 0%.
    return {
      employer: Math.ceil(banded * 0.04),
      employee: 0,
    };
  }

  // Part A — under 60: 11% employee, 13% employer (≤5K) or 12% employer (>5K).
  const employerRate = s <= 5000 ? 0.13 : 0.12;
  return {
    employer: Math.ceil(banded * employerRate),
    employee: Math.ceil(banded * 0.11),
  };
}
export function calcSOCSO(s,a){
  // Defensive guard: invalid/blank/negative wages → zero deductions.
  // Critical: without this, NaN/undefined would fall through lookupBand's loop
  // and return the LAST band (max contribution at RM6,000 ceiling), silently
  // over-charging the employee at max rate.
  if (!s || !isFinite(s) || s <= 0) return { employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 };
  if(a>=60){
    // Cat 2 (age 60+): employer + employee SKBBK (Non-Employment Injury).
    // Employer covers employment-injury only; employee pays SKBBK contribution
    // per June 2026 PERKESO update.
    const b=lookupBand(SOCSO_CAT2,s);
    return{employer:b[1],employee:b[2],employeeInv:0,employeeNEI:b[2]};
  }
  const b=lookupBand(SOCSO_CAT1,s);
  // b[1]=employer, b[2]=employee invalidity, b[3]=employee SKBBK/NEI
  return{employer:b[1],employee:Math.round((b[2]+b[3])*100)/100,employeeInv:b[2],employeeNEI:b[3]};
}
export function calcEIS(s,a){
  // Defensive guard: invalid/blank/negative wages → zero deductions.
  // Same falls-through-to-max-band issue as SOCSO without this guard.
  if (!s || !isFinite(s) || s <= 0) return { employer: 0, employee: 0 };
  if(a<18||a>=60)return{employer:0,employee:0};
  const b=lookupBand(EIS_TABLE,s);
  return{employer:b[1],employee:b[1]};
}
// Format a number as Malaysian-style currency (e.g. 1,489.10).
// Defensive: null/undefined/NaN/non-finite values render as "0.00" rather than
// crashing the whole row.
export function fmt(n){
  if(n==null || !isFinite(n)) return '0.00';
  return n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
}
// Compute one staff's figures for a month. Single source of truth shared by the
// Payroll table and the Payslip generator so their numbers can never drift.
// `monthly` = pd[mk]?.[staff.id] (per-month override object or undefined).
export function computeStaffMonth(s, monthly, ref, showBonus=true){
  const a=getAgeFromIC(s.ic,ref), m=monthly||{};
  const inc = monthly && 'incentive' in monthly ? (m.incentive||0) : (s.defIncentive||0);
  const bon = showBonus ? (monthly && 'bonus' in monthly ? (m.bonus||0) : (s.defBonus||0)) : 0;
  const adv = monthly && 'advance' in monthly ? (m.advance||0) : (s.defAdvance||0);
  const epfWage = s.salary + inc + bon;      // bonus + incentive raise EPF base
  const socsoEisWage = s.salary + inc;        // only incentive raises SOCSO/EIS base
  const epf=calcEPF(epfWage,a), socso=calcSOCSO(socsoEisWage,a), eis=calcEIS(socsoEisWage,a);
  const net=s.salary+inc+bon-epf.employee-socso.employee-eis.employee-adv;
  return{...s,age:a,incentive:inc,bonus:bon,advance:adv,epfM:epf.employer,epfP:epf.employee,socsoM:socso.employer,socsoP:socso.employee,socsoInv:socso.employeeInv,socsoSkbbk:socso.employeeNEI,eisE:eis.employee,netPay:Math.round(net*100)/100,underAge:a<18};
}
// LS_S bumped to _v3: adds defIncentive per staff so each new month
// auto-fills with the June 2026 Excel's recurring incentive amounts.
// LS_PT still _v2 (part-time list is empty, no change).
// LS_P kept as-is so per-month advance/bonus history is preserved.
export const LS_S='cjk_payroll_staff_v3',LS_P='cjk_payroll_data',LS_PT='cjk_pt_v2',LS_SB='cjk_payroll_showbonus',LS_R='cjk_payroll_remarks';
function loadJ(k,f){try{return JSON.parse(localStorage.getItem(k))||f;}catch{return f;}}
function saveJ(k,d){localStorage.setItem(k,JSON.stringify(d));}
// defIncentive per staff seeded from the June 2026 Excel — recurring monthly
// incentive that auto-fills each new month. Owen can override per-month via
// the payroll table. Gawai bonus and advance are month-specific, entered
// manually — not seeded here.
export const SAMPLE_STAFF=[
  {id:'s1',name:'JENNY KUEH MIAW SIN',ic:'940921-13-5170',position:'ADMIN INV. CLERK',salary:2450,method:'bank',status:'permanent',defIncentive:275,bankAcc:'PBB 6367244508'},
  {id:'s2',name:'JANET KUEH NEO PEI',ic:'971020-13-5220',position:'ASST. SUPERVISOR',salary:2250,method:'bank',status:'permanent',defIncentive:250,bankAcc:'PBB 5012974626'},
  {id:'s3',name:'LO HUI TIN',ic:'961122-13-5142',position:'PJ EXEC. OPERATIONS SUPERVISOR',salary:2450,method:'bank',status:'permanent',defIncentive:275},
  {id:'s4',name:'JEE SUK HUI',ic:'981109-13-5330',position:'KC ASST. SUPERVISOR',salary:2000,method:'bank',status:'permanent',defIncentive:75},
  {id:'s5',name:'VOON SUK YIN',ic:'001028-13-1446',position:'INVOICING CLERK',salary:1950,method:'cash',status:'permanent',defIncentive:150},
  {id:'s6',name:'CHAI WAN NEE',ic:'011227-13-0648',position:'ASST. CASHIER SUPERVISOR',salary:1950,method:'cash',status:'permanent',defIncentive:150},
  {id:'s7',name:'SIMON ANG TECK HOCK',ic:'740202-13-5485',position:'DRIVER',salary:2250,method:'cash',status:'permanent',defIncentive:300},
  {id:'s8',name:'BONG SOON SIONG',ic:'840805-13-5159',position:'DRIVER',salary:2200,method:'cash',status:'permanent',defIncentive:250},
  {id:'s9',name:'BONG SOON LEONG',ic:'000407-13-0385',position:'DRIVER ASSISTANT',salary:1850,method:'cash',status:'permanent',defIncentive:150},
  {id:'s10',name:'LEE KIAN HOW',ic:'020812-13-0555',position:'DRIVER ASSISTANT',salary:1850,method:'cash',status:'permanent',defIncentive:125},
  {id:'s11',name:"JAMBLIN ANAK E'IEH",ic:'841130-13-5189',position:'STOREKEEPER',salary:1800,method:'cash',status:'permanent',defIncentive:125},
  {id:'s12',name:'HII KING HUI',ic:'840927-13-5595',position:'GENERAL WORKER',salary:1800,method:'cash',status:'permanent',defIncentive:75},
  {id:'s13',name:'TAN SIAW CHIANG',ic:'841016-13-5505',position:'DRIVER',salary:1850,method:'cash',status:'permanent',defIncentive:100},
  {id:'s14',name:'MUHAMMAD HAZIQ AKMAL BIN MARIKAN',ic:'001005-13-0467',position:'GENERAL WORKER',salary:1725,method:'cash',status:'permanent',defIncentive:50},
  {id:'s15',name:'RALLY ANAK WILLIAM',ic:'020707-13-0721',position:'GENERAL WORKER',salary:1725,method:'cash',status:'permanent',defIncentive:50},
  {id:'s16',name:'HAM KING PING',ic:'950110-13-5707',position:'GENERAL WORKER',salary:1750,method:'cash',status:'permanent',defIncentive:50},
  {id:'s17',name:'MUHAMMAD RAMDZANI BIN WET',ic:'031118-13-0145',position:'GENERAL WORKER',salary:1725,method:'cash',status:'permanent',defIncentive:50},
  {id:'s18',name:'KUA JAK HUN',ic:'790127-13-5746',position:'MERCHANDISER',salary:1800,method:'cash',status:'permanent',defIncentive:50},
  {id:'s19',name:'AZNAN BIN ZAHIDI',ic:'870907-13-5413',position:'DRIVER',salary:1825,method:'cash',status:'permanent',defIncentive:75},
  {id:'s20',name:'DANIELL SHAH RIEZAL BIN ROSLI',ic:'080705-13-0773',position:'GENERAL WORKER',salary:1700,method:'cash',status:'permanent'},
  {id:'s21',name:'JEE SWEE EN',ic:'060310-13-0180',position:'CASHIER',salary:1700,method:'cash',status:'permanent'},
  {id:'s22',name:'JANET SOON PEI YEE',ic:'020627-13-0836',position:'CASHIER',salary:1700,method:'cash',status:'permanent'},
  {id:'s23',name:'TAN WEI HOW',ic:'071210-13-0507',position:'GENERAL WORKER',salary:1700,method:'cash',status:'probationary'},
  {id:'s24',name:'ERRA ERYCA NORY ANAK LASUMDER @ LASUNDER JUING',ic:'980125-13-6128',position:'ADMIN CLERK',salary:1800,method:'cash',status:'probationary'},
];
const SAMPLE_PT=[];
const MONTHS=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const MON_S=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
async function loadXLSX(){if(window.XLSX)return window.XLSX;return new Promise((r,j)=>{const s=document.createElement('script');s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';s.onload=()=>r(window.XLSX);s.onerror=j;document.head.appendChild(s);});}
async function exportExcel(mo,yr,bR,cR,bT,cT,gT,ptR,ptT,notes,bL,sb=true){
  const X=XLSXStyle,wb=X.utils.book_new(),ws={},mg=[];const mn=MONTHS[mo];
  // When the bonus column is hidden (sb=false) it is dropped from logical col 6
  // and every column to its right shifts one to the left. mc() maps a logical
  // column (the always-with-bonus layout) to its physical position; L is net pay.
  const mc=c=>sb?c:(c>6?c-1:c),L=mc(16);
  const A1=(r,c)=>X.utils.encode_cell({r,c:mc(c)});   // physical A1 ref for a logical column
  function sc(r,c,v,f){if(!sb&&c===6)return;const cell={v,t:typeof v==='number'?'n':'s'};if(typeof v==='number'&&c>=4)cell.z='#,##0.00';if(f)cell.f=f;ws[X.utils.encode_cell({r,c:mc(c)})]=cell;}
  sc(0,0,'C.J.K. CHAI JEE KIONG TRADING SDN BHD');mg.push({s:{r:0,c:0},e:{r:0,c:L}});
  sc(1,0,`HQ STAFF PAYROLL ${mn} ${yr}`);mg.push({s:{r:1,c:0},e:{r:1,c:L}});
  sc(2,0,'FULL-TIME STAFF');mg.push({s:{r:2,c:0},e:{r:2,c:L}});
  sc(3,4,'EARNINGS (+)');mg.push({s:{r:3,c:4},e:{r:3,c:5}});sc(3,7,'DEDUCTIONS (-)');mg.push({s:{r:3,c:mc(7)},e:{r:3,c:mc(15)}});
  sc(3,16,'NET PAY');mg.push({s:{r:3,c:L},e:{r:4,c:L}});
  ['NO','NAME','IC NO','POSITION','BASIC SALARY','INCENTIVE',bL,'EPF (M)','EPF (P)','JUMLAH EPF','SOCSO (M)','SOCSO (P)','JUMLAH SOCSO','EIS (M/P)','JUMLAH EIS','ADVANCE'].forEach((h,i)=>sc(4,i,h));
  let row=5,sn=1;
  const wR=rows=>{rows.forEach(s=>{sc(row,0,sn);sc(row,1,s.name);sc(row,2,s.ic);sc(row,3,s.position);sc(row,4,s.salary);sc(row,5,s.incentive||0);sc(row,6,s.bonus||0);sc(row,7,s.epfM);sc(row,8,s.epfP);sc(row,9,s.epfM+s.epfP,`${A1(row,7)}+${A1(row,8)}`);sc(row,10,s.socsoM);sc(row,11,s.socsoP);sc(row,12,s.socsoM+s.socsoP,`${A1(row,10)}+${A1(row,11)}`);sc(row,13,s.eisE);sc(row,14,s.eisE*2,`${A1(row,13)}*2`);sc(row,15,s.advance||0);sc(row,16,s.netPay,`${A1(row,4)}+${A1(row,5)}${sb?'+'+A1(row,6):''}-${A1(row,8)}-${A1(row,11)}-${A1(row,13)}-${A1(row,15)}`);sn++;row++;});};
  // BANK TRANSFER / CASH subtotals = SUM of their staff block; TOTAL = bank + cash (live formulas)
  const tR=(l,t,opt)=>{sc(row,0,l);mg.push({s:{r:row,c:0},e:{r:row,c:3}});[4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c=>{let f;if(opt&&opt.sum&&opt.sum[1]>=opt.sum[0])f=`SUM(${A1(opt.sum[0],c)}:${A1(opt.sum[1],c)})`;else if(opt&&opt.add)f=`${A1(opt.add[0],c)}+${A1(opt.add[1],c)}`;sc(row,c,t[c]||0,f);});row++;};
  const bankStart=row;wR(bR);const bankEnd=row-1;tR('BANK TRANSFER:',bT,{sum:[bankStart,bankEnd]});const bankSub=row-1;
  const pc=cR.filter(s=>s.status==='permanent'),pb=cR.filter(s=>s.status==='probationary');
  const cashStart=row;wR(pc);if(pb.length){sc(row,0,'PROBATIONARY STAFF');mg.push({s:{r:row,c:0},e:{r:row,c:L}});row++;wR(pb);}const cashEnd=row-1;
  tR('CASH:',cT,{sum:[cashStart,cashEnd]});const cashSub=row-1;
  tR('TOTAL:',gT,{add:[bankSub,cashSub]});
  notes.forEach(n=>{sc(row,0,n);mg.push({s:{r:row,c:0},e:{r:row,c:L}});row++;});
  row++;sc(row,0,'PART-TIME STAFF');mg.push({s:{r:row,c:0},e:{r:row,c:L}});row++;
  sc(row,4,'WAGES/ DAY');sc(row,5,'DAY');sc(row,15,'ADVANCE');sc(row,16,'NET PAY');row++;
  const ptStart=row;
  ptR.forEach((s,i)=>{sc(row,0,i+1);sc(row,1,s.name);sc(row,2,s.ic);sc(row,4,s.wagePerDay||0);sc(row,5,s.daysWorked||0);sc(row,15,s.advance||0);sc(row,16,s.netPay||0,`${A1(row,4)}*${A1(row,5)}-${A1(row,15)}`);row++;});
  const ptEnd=row-1;
  sc(row,0,'TOTAL:');mg.push({s:{r:row,c:0},e:{r:row,c:3}});sc(row,15,ptT.advance||0,ptEnd>=ptStart?`SUM(${A1(ptStart,15)}:${A1(ptEnd,15)})`:undefined);sc(row,16,ptT.netPay||0,ptEnd>=ptStart?`SUM(${A1(ptStart,16)}:${A1(ptEnd,16)})`:undefined);
  ws['!ref']=X.utils.encode_range({s:{r:0,c:0},e:{r:row,c:L}});ws['!merges']=mg;
  // ── Styling: borders on every cell, bold shaded headers, shaded subtotal/total rows ──
  const _thin={style:'thin',color:{rgb:'AAAAAA'}}, _bd={top:_thin,bottom:_thin,left:_thin,right:_thin};
  const _rng=X.utils.decode_range(ws['!ref']);
  for(let R=_rng.s.r;R<=_rng.e.r;R++){
    for(let C=_rng.s.c;C<=_rng.e.c;C++){
      const a=X.utils.encode_cell({r:R,c:C}); let cell=ws[a]; if(!cell){cell={t:'s',v:''};ws[a]=cell;}
      const st={border:_bd,alignment:{vertical:'center',wrapText:R===4}};
      if(R<=4){ st.font={bold:true,sz:R===0?12:R===1?11:10}; st.alignment.horizontal='center'; if(R>=2) st.fill={fgColor:{rgb:'E9E9E9'}}; }
      else {
        st.alignment.horizontal = C>=4 ? 'right' : (C===1||C===3 ? 'left' : 'center');
        const c0=ws[X.utils.encode_cell({r:R,c:0})]; const t0=(c0&&typeof c0.v==='string')?c0.v.trim():'';
        if(/^TOTAL/i.test(t0)){ st.font={bold:true}; st.fill={fgColor:{rgb:'FFF0A6'}}; }
        else if(/:$/.test(t0)){ st.font={bold:true}; st.fill={fgColor:{rgb:'EFEFEF'}}; }
        else if(t0==='FULL-TIME STAFF'||t0==='PART-TIME STAFF'||t0==='PROBATIONARY STAFF'){ st.font={bold:true}; st.fill={fgColor:{rgb:'E9E9E9'}}; st.alignment.horizontal='left'; }
      }
      if(cell.z) st.numFmt=cell.z;
      cell.s=st;
    }
  }
  const cols=[5,35,18,32,14,12,14,10,10,12,10,10,14,10,12,10,12];if(!sb)cols.splice(6,1);
  ws['!cols']=cols.map(w=>({wch:w}));
  X.utils.book_append_sheet(wb,ws,MON_S[mo]);X.writeFile(wb,`HQ_STAFF_PAYROLL_${yr}_${mn}.xlsx`);
}
// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const CSS=`
*{box-sizing:border-box}
.pr{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#18181b;background:#f4f4f5;min-height:100vh}
.bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0}
.mnav{display:flex;align-items:center;gap:4px;margin-left:auto}
.mbtn{width:32px;height:32px;border:1px solid #d4d4d8;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;color:#71717a}
.mbtn:hover{background:#f4f4f5}
.mlbl{font-size:14px;font-weight:600;min-width:140px;text-align:center}
.acts{display:flex;gap:8px;margin-left:16px}
.b{padding:7px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.b:active{transform:scale(.97)}
.bd{background:#18181b;color:#fff}.bd:hover{background:#27272a}
.bo{background:#fff;color:#3f3f46;border:1px solid #d4d4d8}.bo:hover{background:#fafafa;border-color:#a1a1aa}
.bg{background:transparent;color:#71717a}.bg:hover{color:#18181b;background:#f4f4f5}
.br{color:#dc2626;background:transparent}.br:hover{background:#fef2f2}
.body{max-width:100%;margin:0 auto;padding:12px;padding-bottom:30px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.st{background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #e4e4e7}
.stl{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;margin-bottom:3px}
.stv{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.sec{background:#fff;border-radius:8px;border:1px solid #e4e4e7;overflow:hidden;margin-bottom:12px}
.sh{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f4f4f5}
.sht{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.tw{overflow-x:auto}
.t{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums;table-layout:fixed}
/* Full-time payroll table keeps a readable minimum width and scrolls sideways in
   narrow / half-screen windows, instead of shrinking the figures to fit. */
.t.ft{min-width:1320px}
.t th{padding:5px 3px;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;color:#71717a;background:#fafafa;border-bottom:1px solid #e4e4e7;white-space:normal;word-break:break-word;line-height:1.15;vertical-align:bottom}
.t th.r{text-align:center}
.t th.l{text-align:left}
.t td{padding:4px 3px;border-bottom:1px solid #f4f4f5;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Name / IC / Position wrap on screen too (like print) so long names aren't cut off */
.t td:nth-child(2),.t td:nth-child(3),.t td:nth-child(4){white-space:normal;word-break:break-word;line-height:1.2}
.t td.r{text-align:center}
.t tr:hover{background:#fafafa}
.t .gh{background:#e5e7eb;color:#18181b;font-size:10px;font-weight:700;letter-spacing:.05em}
.t .gh td{padding:4px 8px;border:none;white-space:nowrap;overflow:visible;color:#18181b}
.t .ph{background:#fef3c7}.t .ph td{padding:3px 8px;border-bottom:1px solid #fcd34d;font-size:10px;font-weight:700;color:#92400e;overflow:visible}
.t .tr td{font-weight:700;background:#f0fdf4;border-top:2px solid #18181b;border-bottom:2px solid #18181b;font-size:12px}
.t .gr td{font-weight:700;background:#fef9c3;border-top:2px solid #18181b;border-bottom:2px solid #18181b;font-size:12px}
.t .tcell{font-size:9.5px;padding-left:1px;padding-right:1px;letter-spacing:-0.02em}
.drag-handle:hover{background:#f4f4f5}
.drag-handle:hover span:first-child{color:#71717a!important}
.drag-handle:active{cursor:grabbing!important}
.t .eh{background:#f0fdf4}
.t .dh{background:#fef2f2}
.t .nh{background:#eff6ff}
.i{width:50px;text-align:center;border:none;border-bottom:1px dashed #d4d4d8;background:transparent;font-size:10.5px;font-family:inherit;font-variant-numeric:tabular-nums;padding:1px 2px;outline:none;transition:border-color .15s}
.i:focus{border-color:#2563eb;border-style:solid}
.i::placeholder{color:#d4d4d8}
/* Remove spinner arrows from number inputs - allow direct typing */
input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=number]{-moz-appearance:textfield;appearance:textfield}
.tag{display:inline-block;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:.04em}
.tgb{background:#dbeafe;color:#1e40af}
.tgc{background:#d1fae5;color:#065f46}
.tgp{background:#fef3c7;color:#92400e}
.notes{padding:8px 14px;background:#fffbeb;border-top:1px solid #fcd34d}
.notes p{margin:0 0 3px;font-size:11px;color:#92400e;font-style:italic}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:80}
.pn{position:fixed;top:0;right:0;bottom:0;width:460px;max-width:100vw;background:#fff;z-index:90;overflow-y:auto;box-shadow:-8px 0 24px rgba(0,0,0,.1)}
.pnh{padding:20px 24px;border-bottom:1px solid #e4e4e7;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2}
.pnb{padding:16px 24px}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.ff{grid-column:1/-1}
.fl{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin-bottom:4px}
.fi{width:100%;border:1px solid #d4d4d8;border-radius:6px;padding:8px 12px;font-size:14px;font-family:inherit;outline:none;transition:border-color .15s}
.fi:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.fs{width:100%;border:1px solid #d4d4d8;border-radius:6px;padding:8px 12px;font-size:14px;font-family:inherit;background:#fff;outline:none;cursor:pointer}
.si{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f4f4f5}
.sif{flex:1;min-width:0}
.sin{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sim{font-size:11px;color:#a1a1aa}
@media print{
  .np{display:none!important}
  .no-print{display:none!important}
  .dgs{display:none!important}   /* hide drag ⋮⋮ handle on print */
  .pr{background:#fff}
  .body{max-width:100%;padding:0;margin:0}
  .sec{border:none;border-radius:0;margin-bottom:6px;box-shadow:none}
  .sh{padding:4px 0;border:none}
  .sht{font-size:10pt;font-weight:700}
  .stats{display:none!important}
  .t{font-size:6.5pt;table-layout:fixed!important;width:100%;min-width:0!important}
  /* Explicit print column widths — sum = 100%. With bonus column (17 cols). */
  .t:not(.nb) col:nth-child(1){width:1.8%!important}   /* # */
  .t:not(.nb) col:nth-child(2){width:19%!important}    /* Name */
  .t:not(.nb) col:nth-child(3){width:7%!important}   /* IC */
  .t:not(.nb) col:nth-child(4){width:12%!important}    /* Position */
  .t:not(.nb) col:nth-child(5){width:5%!important}     /* Salary */
  .t:not(.nb) col:nth-child(6){width:4%!important}     /* Incent */
  .t:not(.nb) col:nth-child(7){width:4%!important}     /* Bonus */
  .t:not(.nb) col:nth-child(8){width:4.3%!important}   /* EPF(M) */
  .t:not(.nb) col:nth-child(9){width:4.3%!important}   /* EPF(P) */
  .t:not(.nb) col:nth-child(10){width:4.5%!important}  /* Jml EPF */
  .t:not(.nb) col:nth-child(11){width:4.3%!important}  /* SOC(M) */
  .t:not(.nb) col:nth-child(12){width:4.3%!important}  /* SOC(P) */
  .t:not(.nb) col:nth-child(13){width:4.5%!important}  /* Jml SOC */
  .t:not(.nb) col:nth-child(14){width:3.5%!important}  /* EIS */
  .t:not(.nb) col:nth-child(15){width:4%!important}    /* Jml EIS */
  .t:not(.nb) col:nth-child(16){width:4%!important}    /* Adv */
  .t:not(.nb) col:nth-child(17){width:6%!important}    /* Net Pay */
  /* Same widths with the bonus column hidden (16 cols) — everything after Incent shifts left one. */
  .t.nb col:nth-child(1){width:1.8%!important}   /* # */
  .t.nb col:nth-child(2){width:19%!important}    /* Name */
  .t.nb col:nth-child(3){width:7%!important}   /* IC */
  .t.nb col:nth-child(4){width:12%!important}    /* Position */
  .t.nb col:nth-child(5){width:5%!important}     /* Salary */
  .t.nb col:nth-child(6){width:4%!important}     /* Incent */
  .t.nb col:nth-child(7){width:4.3%!important}   /* EPF(M) */
  .t.nb col:nth-child(8){width:4.3%!important}   /* EPF(P) */
  .t.nb col:nth-child(9){width:4.5%!important}   /* Jml EPF */
  .t.nb col:nth-child(10){width:4.3%!important}  /* SOC(M) */
  .t.nb col:nth-child(11){width:4.3%!important}  /* SOC(P) */
  .t.nb col:nth-child(12){width:4.5%!important}  /* Jml SOC */
  .t.nb col:nth-child(13){width:3.5%!important}  /* EIS */
  .t.nb col:nth-child(14){width:4%!important}    /* Jml EIS */
  .t.nb col:nth-child(15){width:4%!important}    /* Adv */
  .t.nb col:nth-child(16){width:6%!important}    /* Net Pay */
  .t th{position:static;padding:2px 2px;font-size:6pt;background:#f0f0f0!important;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;white-space:normal!important;word-wrap:break-word;overflow:hidden;line-height:1.1}
  .t td{padding:2px 2px;font-size:6.5pt;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* Allow name, IC, position to wrap so nothing gets cut off */
  .t td:nth-child(2),.t td:nth-child(3),.t td:nth-child(4){white-space:normal!important;word-break:break-word;line-height:1.15}
  .t .gh{display:none!important}
  .t .ph{background:#fef3c7!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .ph td{padding:2px 4px;font-size:6.5pt;font-weight:700;color:#92400e;overflow:visible}
  .t .tr td{background:#f0fdf4!important;font-size:7.5pt;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .gr td{background:#fef9c3!important;font-size:7.5pt;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .eh{background:#f0fdf4!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .dh{background:#fef2f2!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .nh{background:#eff6ff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .i{border:none!important;font-size:6.5pt;width:100%!important;padding:0!important;background:transparent!important;text-align:right}
  .tw{overflow:hidden!important}
  .notes{background:#fffbeb!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:5px 10px}
  .notes p{font-size:6.5pt}
  @page{size:A4 landscape;margin:5mm}
}
.po{display:none}
@media print{.po{display:block!important;text-align:center;margin-bottom:4px}.po div:first-child{font-size:11pt!important;font-weight:700}.po div:nth-child(2){font-size:9.5pt!important;font-weight:600}.po div:nth-child(3){font-size:8pt!important;font-weight:700;text-align:left}}
.fbar{position:sticky;top:78px;z-index:40;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:8px 12px;margin-bottom:12px;min-height:22px;box-shadow:0 2px 6px rgba(0,0,0,.08)}
.fxbadge{flex:none;font-family:Georgia,serif;font-style:italic;font-weight:700;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:5px;padding:2px 8px;font-size:13px}
.fxtxt{font-size:12.5px;color:#18181b;line-height:1.4}
.fxhint{font-size:12.5px;color:#a1a1aa}
.fxc{cursor:pointer}
.fxc:hover{background:#eff6ff;outline:1px solid #bfdbfe}
/* Sticky horizontal scrollbar pinned to the viewport bottom, synced to the payroll table */
.hbar{position:fixed;bottom:0;left:13px;right:13px;height:16px;overflow-x:auto;overflow-y:hidden;z-index:60;background:#fff;border-top:1px solid #e4e4e7;box-shadow:0 -1px 3px rgba(0,0,0,.06)}
.hbar::-webkit-scrollbar{height:14px}
.hbar::-webkit-scrollbar-thumb{background:#c4c4cc;border-radius:7px;border:3px solid #fff}
@media print{.hbar{display:none!important}}
/* Editable remarks below the table */
.remsec{padding:10px 14px;border-top:1px solid #e4e4e7}
.remhd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.remrow{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.reminput{flex:1;border:1px solid #e4e4e7;border-radius:6px;padding:6px 10px;font-size:13px;color:#18181b}
.reminput:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}
.remdel{flex:none;border:none;background:#f4f4f5;color:#71717a;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:12px}
.remdel:hover{background:#fee2e2;color:#dc2626}
.print-only{display:none}
@media print{.print-only{display:block!important}}
/* Keyboard-nav selected cell */
.selc{outline:2px solid #2563eb!important;outline-offset:-2px;background:#dbeafe!important}
@media print{.selc{outline:none!important;background:transparent!important}}
`;
const disp = (v, dec) => v ? (dec ? Number(v).toFixed(2) : String(v)) : '';
function EditableCell({value, onCommit, placeholder='0', width=50, dec=false}) {
  const ref = useRef(null);
  const [local, setLocal] = useState(disp(value, dec));
  const lastExternal = useRef(value);
  useEffect(() => {
    if (lastExternal.current !== value && document.activeElement !== ref.current) {
      setLocal(disp(value, dec));
    }
    lastExternal.current = value;
  }, [value, dec]);
  const commit = () => {
    const n = parseFloat(local) || 0;
    if (n !== (value || 0)) onCommit(n);
  };
  return (
    <input ref={ref} className="i" type="text" inputMode="decimal" value={local} placeholder={placeholder}
      onChange={e => setLocal(e.target.value.replace(/[^0-9.-]/g,''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); ref.current?.blur(); }
        if (e.key === 'Escape') { setLocal(disp(value, dec)); ref.current?.blur(); }
      }}
      style={{width}}
    />
  );
}

export default function Payroll(){
  const now=new Date();
  const[mo,setMo]=useState(now.getMonth()),[yr,setYr]=useState(now.getFullYear());
  const[staff,setStaff]=useState(()=>loadJ(LS_S,SAMPLE_STAFF));
  const[pt,setPt]=useState(()=>loadJ(LS_PT,SAMPLE_PT));
  const[pd,setPd]=useState(()=>loadJ(LS_P,{}));
  const[bl,setBl]=useState('GAWAI BONUS');
  // Show/hide the bonus column. Defaults ON (preserves prior behavior); when OFF
  // the column is dropped everywhere and bonus is treated as 0 in EPF/net.
  const[sb,setSb]=useState(()=>{try{const v=localStorage.getItem(LS_SB);return v===null?true:JSON.parse(v);}catch{return true;}});
  const[pan,setPan]=useState(false),[eid,setEid]=useState(null);
  const[dragId,setDragId]=useState(null);
  const[dragOverId,setDragOverId]=useState(null);
  const[fm,setFm]=useState({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});
  const[ptf,setPtf]=useState(false),[ptfm,setPtfm]=useState({name:'',ic:'',wagePerDay:0});
  const[eidPT,setEidPT]=useState(null);  // tracks which part-time staff is being edited
  const[sel,setSel]=useState(null);      // formula-bar: currently clicked cell {who,label,formula,value}
  const[cur,setCur]=useState(null);      // keyboard-nav: selected cell coordinate {ri,ci} (Excel-style arrows)
  // Sticky horizontal scrollbar: lets the wide payroll table scroll left/right from any
  // vertical position, instead of forcing a scroll to the very bottom to reach the native bar.
  const twRef=useRef(null),hbRef=useRef(null);
  const[hbW,setHbW]=useState(0),[hbShow,setHbShow]=useState(false);
  useEffect(()=>{
    const el=twRef.current;if(!el)return;
    const measure=()=>{setHbW(el.scrollWidth);setHbShow(el.scrollWidth>el.clientWidth+2);};
    measure();window.addEventListener('resize',measure);
    const id=setTimeout(measure,100); // re-measure after layout settles
    return()=>{window.removeEventListener('resize',measure);clearTimeout(id);};
  });
  const onTwScroll=()=>{if(hbRef.current&&twRef.current)hbRef.current.scrollLeft=twRef.current.scrollLeft;};
  const onHbScroll=()=>{if(hbRef.current&&twRef.current)twRef.current.scrollLeft=hbRef.current.scrollLeft;};
  // Editable remarks below the table, saved per month. Defaults to one empty row;
  // "+ Add row" appends more. Empty rows are dropped from print + Excel so no wasted space.
  const[remAll,setRemAll]=useState(()=>loadJ(LS_R,{}));
  useEffect(()=>{saveJ(LS_R,remAll);},[remAll]);
  useEffect(()=>{document.title=`CJK Payroll - ${MONTHS[mo]} ${yr}`;},[mo,yr]);
  useEffect(()=>{saveJ(LS_S,staff);},[staff]);
  useEffect(()=>{saveJ(LS_PT,pt);},[pt]);
  useEffect(()=>{saveJ(LS_P,pd);},[pd]);
  useEffect(()=>{saveJ(LS_SB,sb);},[sb]);
  const mk=`${yr}-${String(mo+1).padStart(2,'0')}`,ref=new Date(yr,mo,15);
  // Per-month editable remarks (defined here because they key off `mk`).
  const remarks=remAll[mk]||[''];
  const setRemark=(i,v)=>setRemAll(p=>{const c=[...(p[mk]||[''])];c[i]=v;return{...p,[mk]:c};});
  const addRemark=()=>setRemAll(p=>({...p,[mk]:[...(p[mk]||['']),'']}));
  const delRemark=i=>setRemAll(p=>{const c=[...(p[mk]||[''])];c.splice(i,1);return{...p,[mk]:c.length?c:['']};});
  const remFilled=remarks.filter(r=>(r||'').trim());
  const gM=useCallback(sid=>pd[mk]?.[sid]||{incentive:0,bonus:0,advance:0,wagePerDay:0,daysWorked:0},[pd,mk]);
  const sM=useCallback((sid,f,v)=>{setPd(p=>{const n={...p};if(!n[mk])n[mk]={};if(!n[mk][sid])n[mk][sid]={incentive:0,bonus:0,advance:0,wagePerDay:0,daysWorked:0};n[mk][sid]={...n[mk][sid],[f]:parseFloat(v)||0};return n;});},[mk]);
  const comp=useCallback(s=>computeStaffMonth(s, pd[mk]?.[s.id], ref, sb),[ref,pd,mk,sb]);
  const bS=useMemo(()=>staff.filter(s=>s.method==='bank').map(comp),[staff,comp]);
  const cS=useMemo(()=>staff.filter(s=>s.method==='cash').map(comp),[staff,comp]);
  const ptR=useMemo(()=>pt.map(s=>{const m=gM(s.id),w=m.wagePerDay||s.wagePerDay||0,d=m.daysWorked||0,a=m.advance||0;return{...s,wagePerDay:w,daysWorked:d,advance:a,netPay:Math.round((w*d-a)*100)/100};}),[pt,gM]);
  function sumR(rows){const t={};[4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c=>t[c]=0);rows.forEach(r=>{t[4]+=r.salary;t[5]+=r.incentive;t[6]+=r.bonus;t[7]+=r.epfM;t[8]+=r.epfP;t[9]+=r.epfM+r.epfP;t[10]+=r.socsoM;t[11]+=r.socsoP;t[12]+=r.socsoM+r.socsoP;t[13]+=r.eisE;t[14]+=r.eisE*2;t[15]+=r.advance;t[16]+=r.netPay;});Object.keys(t).forEach(k=>t[k]=Math.round(t[k]*100)/100);return t;}
  const bT=useMemo(()=>sumR(bS),[bS]),cT=useMemo(()=>sumR(cS),[cS]);
  const gT=useMemo(()=>{const t={};Object.keys(bT).forEach(k=>t[k]=Math.round((bT[k]+cT[k])*100)/100);return t;},[bT,cT]);
  const ptT=useMemo(()=>({advance:ptR.reduce((s,r)=>s+r.advance,0),netPay:ptR.reduce((s,r)=>s+r.netPay,0)}),[ptR]);
  const notes=useMemo(()=>[...bS,...cS].filter(r=>r.underAge).map(r=>{
    const firstName = (r.name||'(unnamed)').split(' ')[0];
    return `${firstName}: below 18 years old, not subject to EIS deduction per PERKESO.`;
  }),[bS,cS]);
  const addS=()=>{setStaff(p=>[...p,{id:'s'+Date.now(),...fm,name:(fm.name||'').toUpperCase(),position:(fm.position||'').toUpperCase()}]);setFm({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});setEid(null);};
  const updS=()=>{setStaff(p=>p.map(s=>s.id===eid?{...s,...fm,name:(fm.name||'').toUpperCase(),position:(fm.position||'').toUpperCase()}:s));setEid(null);setFm({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});};
  const delS=id=>{setStaff(p=>p.filter(s=>s.id!==id));};
  // Inline update of staff salary from the payroll table
  const updateSalary=(sid,v)=>{setStaff(p=>p.map(s=>s.id===sid?{...s,salary:parseFloat(v)||0}:s));};
  // Reorder staff via drag and drop.
  // Dragging a probationary member onto a non-probationary (upper-section) row
  // promotes them to permanent — the PROB tag drops and they join the permanent
  // list at that spot. Payroll doesn't track the 3-month rule; promotion is manual.
  const reorderStaff=(fromId,toId)=>{
    if(fromId===toId) return;
    setStaff(p=>{
      const arr=[...p];
      const fromIdx=arr.findIndex(s=>s.id===fromId);
      const toIdx=arr.findIndex(s=>s.id===toId);
      if(fromIdx<0||toIdx<0) return p;
      const target=arr[toIdx];
      const[picked]=arr.splice(fromIdx,1);
      const moved=(picked.status==='probationary'&&target.status!=='probationary')
        ?{...picked,status:'permanent'}:picked;
      arr.splice(toIdx,0,moved);
      return arr;
    });
  };
  const edS=s=>{setEid(s.id);setFm({name:s.name,ic:s.ic,position:s.position,salary:s.salary,method:s.method,status:s.status,defIncentive:s.defIncentive||0,defBonus:s.defBonus||0,defAdvance:s.defAdvance||0});};
  const addPT=()=>{setPt(p=>[...p,{id:'p'+Date.now(),...ptfm,name:(ptfm.name||'').toUpperCase(),status:'part-time'}]);setPtfm({name:'',ic:'',wagePerDay:0});setPtf(false);setEidPT(null);};
  const delPT=id=>{setPt(p=>p.filter(s=>s.id!==id));};

  // Edit existing part-time staff — opens the PT form prefilled.
  const edPT=s=>{setEidPT(s.id);setPtfm({name:s.name,ic:s.ic,wagePerDay:s.wagePerDay||0});setPtf(true);};

  // Save edits to existing part-time staff.
  const updPT=()=>{
    setPt(p=>p.map(s=>s.id===eidPT?{...s,name:(ptfm.name||'').toUpperCase(),ic:ptfm.ic,wagePerDay:ptfm.wagePerDay}:s));
    setEidPT(null);
    setPtfm({name:'',ic:'',wagePerDay:0});
    setPtf(false);
  };

  // Convert a part-time staff member to full-time.
  // Creates a new FT record with defaults (salary 1700, cash, permanent) and opens the FT edit form
  // so the user can fix salary/method/etc immediately.
  const convertPTtoFT=s=>{
    const newFT={
      id:'s'+Date.now(),
      name:s.name,
      ic:s.ic,
      position:s.position||'',
      salary:1700,
      method:'cash',
      status:'permanent',
      defIncentive:0,defBonus:0,defAdvance:0,
    };
    setStaff(p=>[...p,newFT]);
    setPt(p=>p.filter(x=>x.id!==s.id));
    // Prefill the FT edit form with the new record so user can adjust immediately
    setEid(newFT.id);
    setFm({name:newFT.name,ic:newFT.ic,position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});
    // Close the PT edit form if it was open
    setEidPT(null);
    setPtf(false);
  };

  // Convert a full-time staff member to part-time.
  // Drops salary/method/status and adds wagePerDay=0; opens the PT edit form.
  const convertFTtoPT=s=>{
    const newPT={
      id:'p'+Date.now(),
      name:s.name,
      ic:s.ic,
      position:s.position||'',
      wagePerDay:0,
      status:'part-time',
    };
    setPt(p=>[...p,newPT]);
    setStaff(p=>p.filter(x=>x.id!==s.id));
    setEidPT(newPT.id);
    setPtfm({name:newPT.name,ic:newPT.ic,wagePerDay:0});
    setPtf(true);
    // Close the FT edit form if it was open
    setEid(null);
    setFm({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});
  };
  // Drag manager — uses refs for live state during drag (no React lag)
  const dragRef = useRef({ id: null, overId: null });
  const startDrag = (id, e) => {
    e.preventDefault();
    dragRef.current.id = id;
    setDragId(id);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const x = ev.clientX, y = ev.clientY;
      // Find the row under the pointer
      const el = document.elementFromPoint(x, y);
      const tr = el?.closest('tr[data-sid]');
      const overId = tr?.getAttribute('data-sid') || null;
      if (overId !== dragRef.current.overId) {
        dragRef.current.overId = overId;
        setDragOverId(overId);
      }
    };
    const onUp = () => {
      const fromId = dragRef.current.id;
      const toId = dragRef.current.overId;
      if (fromId && toId && fromId !== toId) reorderStaff(fromId, toId);
      dragRef.current.id = null;
      dragRef.current.overId = null;
      setDragId(null);
      setDragOverId(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };
  // Formula bar: describe a clicked full-time cell (label + human-readable formula + value)
  const selFT=(r,key)=>{
    const sal=r.salary||0,inc=r.incentive||0,bon=r.bonus||0,adv=r.advance||0,bn=bl||'Bonus';
    const M={
      epfM:['EPF (Majikan)',`Statutory KWSP table · EPF wage ${fmt(sal+inc+bon)}`,r.epfM],
      epfP:['EPF (Pekerja)',`Statutory KWSP table · EPF wage ${fmt(sal+inc+bon)}`,r.epfP],
      jepf:['Jumlah EPF',`EPF(M) + EPF(P) = ${fmt(r.epfM)} + ${fmt(r.epfP)}`,r.epfM+r.epfP],
      socsoM:['SOCSO (Majikan)',`Statutory PERKESO table · wage ${fmt(sal+inc)}`,r.socsoM],
      socsoP:['SOCSO (Pekerja)',`Keilatan + SKBBK  =  ${fmt(r.socsoInv)} + ${fmt(r.socsoSkbbk)}`,r.socsoP],
      jsocso:['Jumlah SOCSO',`SOCSO(M) + SOCSO(P) = ${fmt(r.socsoM)} + ${fmt(r.socsoP)}`,r.socsoM+r.socsoP],
      eis:['EIS',`Statutory EIS table · wage ${fmt(sal+inc)} (age 18–60 only)`,r.eisE],
      jeis:['Jumlah EIS',`EIS × 2 = ${fmt(r.eisE)} × 2`,r.eisE*2],
      net:['Net Pay',`Salary + Incentive${sb?' + '+bn:''} − EPF(P) − SOCSO(P) − EIS − Advance  =  ${fmt(sal)} + ${fmt(inc)}${sb?' + '+fmt(bon):''} − ${fmt(r.epfP)} − ${fmt(r.socsoP)} − ${fmt(r.eisE)} − ${fmt(adv)}`,r.netPay],
    };
    const m=M[key];if(m)setSel({who:r.name,label:m[0],formula:m[1],value:m[2]});
  };
  // Formula bar for the Bank Transfer / Cash / TOTAL subtotal rows — shows the SUM.
  const COLNM={4:'Basic Salary',5:'Incentive',6:bl||'Bonus',7:'EPF (Majikan)',8:'EPF (Pekerja)',9:'Jumlah EPF',10:'SOCSO (Majikan)',11:'SOCSO (Pekerja)',12:'Jumlah SOCSO',13:'EIS',14:'Jumlah EIS',15:'Advance',16:'Net Pay'};
  const selSum=(l,c,v)=>{
    const nm=COLNM[c]||'';
    const f = /total/i.test(l) ? `Bank Transfer + Cash — ${nm} (column total)` : `SUM of every ${l} staff's ${nm}`;
    setSel({who:l,label:nm,formula:f,value:v});
  };
  let gn=0;
  const Row=({r})=>{gn++;const n=gn;
    const isDragging=dragId===r.id;
    const isDragOver=dragOverId===r.id&&dragId!==r.id;
    const ri=riOf.get(r.id);
    const hl=ci=>(cur&&cur.ri===ri&&cur.ci===ci)?' selc':'';   // highlight arrow-selected cell
    return(
    <tr
      data-sid={r.id}
      style={{
        opacity:isDragging?0.35:1,
        background:isDragOver?'#eff6ff':undefined,
        boxShadow:isDragOver?'inset 0 2px 0 #2563eb':undefined,
        transition:'opacity 100ms',
      }}
    >
      <td className="r drag-handle" style={{color:'#a1a1aa',cursor:'grab',userSelect:'none',touchAction:'none'}}
        onPointerDown={e=>startDrag(r.id,e)}
        title="Drag to reorder"
      >
        <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
          <span className="dgs" style={{color:'#d4d4d8',fontSize:11,lineHeight:1,letterSpacing:-1}}>⋮⋮</span>
          {n}
        </span>
      </td>
      <td style={{fontWeight:600,color:'#000'}} title={r.name}>{r.name}</td>
      <td style={{color:'#000',fontSize:10}} title={r.ic}>{r.ic}</td>
      <td style={{color:'#000',fontSize:10}} title={r.position}>{r.position}</td>
      <td className={"r"+hl(4)} style={{color:'#000'}} onClick={()=>applySel(ri,4)}><EditableCell value={r.salary} onCommit={v=>updateSalary(r.id,v)} width={60} dec/></td>
      <td className={"r"+hl(5)} style={{color:'#000'}} onClick={()=>applySel(ri,5)}><EditableCell value={r.incentive} onCommit={v=>sM(r.id,'incentive',v)} dec/></td>
      {sb&&<td className={"r"+hl(6)} style={{color:'#000'}} onClick={()=>applySel(ri,6)}><EditableCell value={r.bonus} onCommit={v=>sM(r.id,'bonus',v)}/></td>}
      <td className={"r fxc"+hl(7)} style={{color:'#000'}} onClick={()=>applySel(ri,7)}>{fmt(r.epfM)}</td>
      <td className={"r fxc"+hl(8)} style={{color:'#000',fontWeight:700}} onClick={()=>applySel(ri,8)}>{fmt(r.epfP)}</td>
      <td className={"r fxc"+hl(9)} style={{color:'#000'}} onClick={()=>applySel(ri,9)}>{fmt(r.epfM+r.epfP)}</td>
      <td className={"r fxc"+hl(10)} style={{color:'#000'}} onClick={()=>applySel(ri,10)}>{fmt(r.socsoM)}</td>
      <td className={"r fxc"+hl(11)} style={{color:'#000',fontWeight:700}} onClick={()=>applySel(ri,11)}>{fmt(r.socsoP)}</td>
      <td className={"r fxc"+hl(12)} style={{color:'#000'}} onClick={()=>applySel(ri,12)}>{fmt(r.socsoM+r.socsoP)}</td>
      <td className={"r fxc"+hl(13)} style={{color:'#000',fontWeight:700}} onClick={()=>applySel(ri,13)}>{fmt(r.eisE)}</td>
      <td className={"r fxc"+hl(14)} style={{color:'#000'}} onClick={()=>applySel(ri,14)}>{fmt(r.eisE*2)}</td>
      <td className={"r"+hl(15)} style={{color:'#000'}} onClick={()=>applySel(ri,15)}><EditableCell value={r.advance} onCommit={v=>sM(r.id,'advance',v)} dec/></td>
      <td className={"r fxc"+hl(16)} style={{fontWeight:700,fontSize:11,whiteSpace:'nowrap',color:'#000'}} onClick={()=>applySel(ri,16)}>{fmt(r.netPay)}</td>
    </tr>
  );};
  const TR=({l,t,c})=>{
    const ri=totRi[l];
    const hl=ci=>(cur&&cur.ri===ri&&cur.ci===ci)?' selc':'';
    const cell=ci=><td className={"r tcell fxc"+hl(ci)} onClick={()=>applySel(ri,ci)}>{fmt(t[ci])}</td>;
    return(
    <tr className={c}>
      <td colSpan={4} style={{fontWeight:700}}>{l}</td>
      {cell(4)}{cell(5)}{sb&&cell(6)}
      {cell(7)}{cell(8)}{cell(9)}
      {cell(10)}{cell(11)}{cell(12)}
      {cell(13)}{cell(14)}{cell(15)}
      {cell(16)}
    </tr>
  );};
  gn=0;
  const pc=cS.filter(r=>r.status==='permanent'),pb=cS.filter(r=>r.status==='probationary');
  // ── Keyboard navigation grid (Excel-style arrow keys) ──
  // navRows = every navigable row in display order (staff + the 3 subtotal/total rows).
  const navRows=[];
  bS.forEach(r=>navRows.push({kind:'ft',r}));
  navRows.push({kind:'tot',l:'BANK TRANSFER:',t:bT});
  pc.forEach(r=>navRows.push({kind:'ft',r}));
  pb.forEach(r=>navRows.push({kind:'ft',r}));
  navRows.push({kind:'tot',l:'CASH:',t:cT});
  navRows.push({kind:'tot',l:'TOTAL:',t:gT});
  const riOf=new Map(),totRi={};
  navRows.forEach((nr,i)=>{if(nr.kind==='ft')riOf.set(nr.r.id,i);else totRi[nr.l]=i;});
  const NAVCOLS=sb?[4,5,6,7,8,9,10,11,12,13,14,15,16]:[4,5,7,8,9,10,11,12,13,14,15,16];
  const CKEY={7:'epfM',8:'epfP',9:'jepf',10:'socsoM',11:'socsoP',12:'jsocso',13:'eis',14:'jeis',16:'net'};
  const INPUTNM={4:'Basic Salary',5:'Incentive',6:bl||'Bonus',15:'Advance'};
  const applySel=(ri,ci)=>{
    const nr=navRows[ri];if(!nr)return;setCur({ri,ci});
    if(nr.kind==='tot'){selSum(nr.l,ci,nr.t[ci]);return;}
    const r=nr.r;
    if(CKEY[ci])selFT(r,CKEY[ci]);
    else setSel({who:r.name,label:INPUTNM[ci],formula:'Manual input (type to edit)',value:({4:r.salary,5:r.incentive,6:r.bonus,15:r.advance}[ci])||0});
  };
  const onGridKey=e=>{
    if(!cur)return;
    const tag=(e.target&&e.target.tagName)||'';
    if(/INPUT|TEXTAREA|SELECT/.test(tag))return; // let arrows move the caret while editing
    const k=e.key;if(!/^Arrow(Up|Down|Left|Right)$/.test(k))return;
    e.preventDefault();
    let{ri,ci}=cur;const idx=NAVCOLS.indexOf(ci);
    if(k==='ArrowDown')ri=Math.min(navRows.length-1,ri+1);
    else if(k==='ArrowUp')ri=Math.max(0,ri-1);
    else if(k==='ArrowRight')ci=NAVCOLS[Math.min(NAVCOLS.length-1,idx+1)];
    else if(k==='ArrowLeft')ci=NAVCOLS[Math.max(0,idx-1)];
    applySel(ri,ci);
  };
  useEffect(()=>{window.addEventListener('keydown',onGridKey);return()=>window.removeEventListener('keydown',onGridKey);});
  useEffect(()=>{if(cur){const el=document.querySelector('.selc');if(el)el.scrollIntoView({block:'nearest',inline:'nearest'});}},[cur]);
  return(
    <div className="pr">
      <style>{CSS}</style>
      <div className="bar np">
        <h1>HQ PAYROLL</h1>
        <div className="mnav">
          <button className="mbtn" onClick={()=>{if(mo===0){setMo(11);setYr(y=>y-1);}else setMo(m=>m-1);}}>&#9664;</button>
          <div className="mlbl">{MONTHS[mo]} {yr}</div>
          <button className="mbtn" onClick={()=>{if(mo===11){setMo(0);setYr(y=>y+1);}else setMo(m=>m+1);}}>&#9654;</button>
        </div>
        <div className="acts">
          <button className="b bo" onClick={()=>setPan(true)}>Manage Staff</button>
          <button className="b bd" onClick={()=>exportExcel(mo,yr,bS,cS,bT,cT,gT,ptR,ptT,[...notes,...remFilled],bl,sb)}>Download Excel</button>
          <button className="b bo" onClick={()=>window.print()}>Print</button>
        </div>
      </div>
      <div className="body">
        <div className="fbar no-print">
          <span className="fxbadge">fx</span>
          {sel ? (
            <span className="fxtxt"><b>{sel.who} · {sel.label}</b>&nbsp;&nbsp;=&nbsp;&nbsp;{sel.formula}&nbsp;&nbsp;=&nbsp;&nbsp;<b>{fmt(sel.value)}</b></span>
          ) : (
            <span className="fxhint">Click any EPF / SOCSO / EIS / Jumlah / Net Pay cell to see how it's calculated…</span>
          )}
        </div>
        <div className="stats np">
          <div className="st"><div className="stl">Total Staff</div><div className="stv">{staff.length}</div></div>
          <div className="st"><div className="stl">Total Earnings</div><div className="stv" style={{color:'#059669'}}>RM {fmt(gT[4]+(gT[5]||0)+(gT[6]||0))}</div></div>
          <div className="st"><div className="stl">Total Deductions</div><div className="stv" style={{color:'#dc2626'}}>RM {fmt((gT[8]||0)+(gT[11]||0)+(gT[13]||0)+(gT[15]||0))}</div></div>
          <div className="st"><div className="stl">Net Payroll</div><div className="stv">RM {fmt(gT[16]||0)}</div></div>
        </div>
        <div className="po" style={{textAlign:'center',marginBottom:6}}>
          <div style={{fontSize:16,fontWeight:700,fontStyle:'italic'}}>C.J.K. CHAI JEE KIONG TRADING SDN BHD</div>
          <div style={{fontSize:14,fontWeight:600}}>HQ STAFF PAYROLL {MONTHS[mo]} {yr}</div>
          <div style={{textAlign:'left',fontSize:10,fontWeight:700,marginTop:6}}>FULL-TIME STAFF</div>
        </div>
        <div className="sec">
          <div className="sh np">
            <div className="sht">Full-Time Staff</div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <label className="np" style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#71717a',cursor:'pointer',userSelect:'none'}}>
                <input type="checkbox" checked={sb} onChange={e=>setSb(e.target.checked)}/>
                Show bonus column
              </label>
              {sb&&<div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:11,color:'#a1a1aa'}}>Bonus label:</span>
                <input value={bl} onChange={e=>setBl(e.target.value)} onBlur={()=>setBl(b=>(b||'').toUpperCase())} style={{width:120,fontSize:12,border:'1px solid #e4e4e7',borderRadius:4,padding:'4px 8px',textAlign:'center',fontWeight:600,textTransform:'uppercase'}}/>
              </div>}
            </div>
          </div>
          <div className="tw" ref={twRef} onScroll={onTwScroll}>
            <table className={sb?"t ft":"t ft nb"}>
              <colgroup>
                <col style={{width:'2.5%'}}/>
                <col style={{width:'19%'}}/>
                <col style={{width:'7%'}}/>
                <col style={{width:'11%'}}/>
                <col style={{width:'5.5%'}}/>
                <col style={{width:'4.5%'}}/>
                {sb&&<col style={{width:'4.5%'}}/>}
                <col style={{width:'4%'}}/>
                <col style={{width:'4%'}}/>
                <col style={{width:'4.5%'}}/>
                <col style={{width:'4%'}}/>
                <col style={{width:'4%'}}/>
                <col style={{width:'4.5%'}}/>
                <col style={{width:'3.5%'}}/>
                <col style={{width:'4%'}}/>
                <col style={{width:'4%'}}/>
                <col style={{width:'7.5%'}}/>
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={4}></th>
                  <th colSpan={sb?3:2} className="eh" style={{textAlign:'center'}}>EARNINGS (+)</th>
                  <th colSpan={9} className="dh" style={{textAlign:'center'}}>DEDUCTIONS (-)</th>
                  <th className="nh" style={{textAlign:'center'}}>NET PAY</th>
                </tr>
                <tr>
                  <th className="r">#</th><th className="l">Name</th><th className="l">IC No</th><th className="l">Position</th>
                  <th className="r eh">Salary</th><th className="r eh">Incentive</th>{sb&&<th className="r eh">{bl}</th>}
                  <th className="r dh">EPF(M)</th><th className="r dh">EPF(P)</th><th className="r dh">Jumlah EPF</th>
                  <th className="r dh">SOCSO(M)</th><th className="r dh">SOCSO(P)</th><th className="r dh">Jumlah SOCSO</th>
                  <th className="r dh">EIS</th><th className="r dh">Jumlah EIS</th><th className="r dh">Advance</th>
                  <th className="r nh">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                <tr className="gh"><td colSpan={sb?17:16}>Bank Transfer</td></tr>
                {bS.map(r=><Row key={r.id} r={r}/>)}
                <TR l="BANK TRANSFER:" t={bT} c="tr"/>
                <tr className="gh"><td colSpan={sb?17:16}>Cash</td></tr>
                {pc.map(r=><Row key={r.id} r={r}/>)}
                {pb.length>0&&<><tr className="ph"><td colSpan={sb?17:16}>PROBATIONARY {'>'} PERMANENT</td></tr>{pb.map(r=><Row key={r.id} r={r}/>)}</>}
                <TR l="CASH:" t={cT} c="tr"/>
                <TR l="TOTAL:" t={gT} c="gr"/>
              </tbody>
            </table>
          </div>
          {notes.length>0&&<div className="notes">{notes.map((n,i)=><p key={i}>{n}</p>)}</div>}
          {/* Editable remarks (screen only) */}
          <div className="remsec no-print">
            <div className="remhd"><span className="sht">Remarks</span><button className="b bo" onClick={addRemark}>+ Add row</button></div>
            {remarks.map((r,i)=>(
              <div className="remrow" key={i}>
                <input className="reminput" value={r} onChange={e=>setRemark(i,e.target.value)} placeholder="Write a remark (leave blank if none)…"/>
                {remarks.length>1&&<button className="remdel" title="Remove row" onClick={()=>delRemark(i)}>✕</button>}
              </div>
            ))}
          </div>
          {/* Print-only: only non-empty remarks, so blank rows never waste space */}
          {remFilled.length>0&&<div className="notes print-only">{remFilled.map((r,i)=><p key={i}>{r}</p>)}</div>}
        </div>
        {hbShow && (
          <div className="hbar no-print" ref={hbRef} onScroll={onHbScroll} title="Scroll the table left / right">
            <div style={{width:hbW,height:1}}/>
          </div>
        )}
        {pt.length>0 && (
        <div className="sec">
          <div className="sh"><div className="sht">Part-Time Staff</div></div>
          <div className="tw">
            <table className="t">
              <thead><tr><th className="r" style={{width:32}}>#</th><th>Name</th><th>IC No</th><th className="r">Wages/Day</th><th className="r">Days</th><th className="r">Advance</th><th className="r" style={{width:90}}>Net Pay</th></tr></thead>
              <tbody>
                {ptR.map((r,i)=><tr key={r.id}><td className="r" style={{color:'#a1a1aa'}}>{i+1}</td><td style={{fontWeight:600}}>{r.name}</td><td style={{color:'#71717a',fontSize:12}}>{r.ic}</td><td className="r"><EditableCell value={r.wagePerDay} onCommit={v=>sM(r.id,'wagePerDay',v)}/></td><td className="r"><EditableCell value={r.daysWorked} onCommit={v=>sM(r.id,'daysWorked',v)} width={36}/></td><td className="r"><EditableCell value={r.advance} onCommit={v=>sM(r.id,'advance',v)} dec/></td><td className="r" style={{fontWeight:700,fontSize:14}}>{fmt(r.netPay)}</td></tr>)}
                <tr className="tr"><td colSpan={5} style={{fontWeight:700}}>TOTAL</td><td className="r">{fmt(ptT.advance)}</td><td className="r">{fmt(ptT.netPay)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>)}
      </div>
      {pan&&<>
        <div className="ov np" onClick={()=>setPan(false)}/>
        <div className="pn np">
          <div className="pnh"><h2 style={{margin:0,fontSize:16,fontWeight:700}}>Staff Management</h2><button className="b bg" onClick={()=>setPan(false)} style={{fontSize:18,padding:'4px 8px'}}>&#10005;</button></div>
          <div className="pnb">
            <div style={{background:'#fafafa',borderRadius:8,padding:16,marginBottom:20,border:'1px solid #e4e4e7'}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:12,textTransform:'uppercase',letterSpacing:'.05em',color:'#71717a'}}>{eid?'Edit Staff':'Add New Staff'}</div>
              <div className="fg">
                <div className="ff"><label className="fl">Full Name</label><input className="fi" style={{textTransform:'uppercase'}} value={fm.name} onChange={e=>setFm(f=>({...f,name:e.target.value}))} onBlur={()=>setFm(f=>({...f,name:(f.name||'').toUpperCase()}))} placeholder="FULL NAME"/></div>
                <div><label className="fl">IC Number</label><input className="fi" value={fm.ic} onChange={e=>setFm(f=>({...f,ic:e.target.value}))} placeholder="YYMMDD-SS-NNNN"/></div>
                <div><label className="fl">Salary (RM)</label><input className="fi" type="number" value={fm.salary} onChange={e=>setFm(f=>({...f,salary:parseFloat(e.target.value)||0}))}/></div>
                <div className="ff"><label className="fl">Position</label><input className="fi" style={{textTransform:'uppercase'}} value={fm.position} onChange={e=>setFm(f=>({...f,position:e.target.value}))} onBlur={()=>setFm(f=>({...f,position:(f.position||'').toUpperCase()}))} placeholder="JOB TITLE"/></div>
                <div><label className="fl">Payment</label><select className="fs" value={fm.method} onChange={e=>setFm(f=>({...f,method:e.target.value}))}><option value="bank">Bank Transfer</option><option value="cash">Cash</option></select></div>
                <div><label className="fl">Status</label><select className="fs" value={fm.status} onChange={e=>setFm(f=>({...f,status:e.target.value}))}><option value="permanent">Permanent</option><option value="probationary">Probationary</option></select></div>
                <div className="ff" style={{borderTop:'1px solid #e4e4e7',paddingTop:12,marginTop:4}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'#a1a1aa',marginBottom:8}}>Default Monthly Values</div>
                  <div style={{fontSize:11,color:'#a1a1aa',marginBottom:10}}>Auto-fills each new month. You can still override per month in the payroll table.</div>
                </div>
                <div><label className="fl">Default Incentive (RM)</label><input className="fi" type="number" value={fm.defIncentive||''} placeholder="0" onChange={e=>setFm(f=>({...f,defIncentive:parseFloat(e.target.value)||0}))}/></div>
                <div><label className="fl">Default Bonus (RM)</label><input className="fi" type="number" value={fm.defBonus||''} placeholder="0" onChange={e=>setFm(f=>({...f,defBonus:parseFloat(e.target.value)||0}))}/></div>
                <div className="ff"><label className="fl">Default Advance (RM)</label><input className="fi" type="number" value={fm.defAdvance||''} placeholder="0" onChange={e=>setFm(f=>({...f,defAdvance:parseFloat(e.target.value)||0}))}/></div>
              </div>
              {fm.ic&&getAgeFromIC(fm.ic,new Date())!==null&&<div style={{fontSize:12,color:getAgeFromIC(fm.ic,new Date())<18?'#dc2626':'#71717a',marginBottom:12}}>Age: {getAgeFromIC(fm.ic,new Date())} {getAgeFromIC(fm.ic,new Date())<18&&'— EIS exempt (under 18)'}</div>}
              <div style={{display:'flex',gap:8}}>
                <button className="b bd" onClick={eid?updS:addS}>{eid?'Update':'Add Staff'}</button>
                {eid&&<button className="b bo" onClick={()=>{setEid(null);setFm({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});}}>Cancel</button>}
              </div>
            </div>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8,textTransform:'uppercase',letterSpacing:'.05em',color:'#71717a'}}>Full-Time ({staff.length})</div>
            {staff.map(s=><div className="si" key={s.id}><div className="sif"><div className="sin">{s.name}</div><div className="sim">{s.position} &middot; RM{s.salary}</div></div><span className={`tag ${s.method==='bank'?'tgb':'tgc'}`}>{s.method==='bank'?'BANK':'CASH'}</span>{s.status==='probationary'&&<span className="tag tgp">PROB</span>}<button className="b bg" style={{padding:'4px 8px',fontSize:12}} onClick={()=>edS(s)}>Edit</button><button className="b bg" style={{padding:'4px 8px',fontSize:12,color:'#92400e'}} onClick={()=>convertFTtoPT(s)} title="Move to Part-Time">→ PT</button><button className="b br" style={{padding:'4px 8px',fontSize:12}} onClick={()=>delS(s.id)}>Del</button></div>)}
            <div style={{fontSize:12,fontWeight:700,margin:'20px 0 8px',textTransform:'uppercase',letterSpacing:'.05em',color:'#71717a'}}>Part-Time ({pt.length})<button className="b bg" style={{marginLeft:8,fontSize:11}} onClick={()=>setPtf(!ptf)}>+ Add</button></div>
            {ptf&&<div style={{background:'#fafafa',borderRadius:8,padding:12,marginBottom:12,border:'1px solid #e4e4e7'}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:10,textTransform:'uppercase',letterSpacing:'.05em',color:'#71717a'}}>{eidPT?'Edit Part-Time':'Add Part-Time'}</div>
              <div className="fg">
                <div><label className="fl">Name</label><input className="fi" style={{textTransform:'uppercase'}} value={ptfm.name} onChange={e=>setPtfm(f=>({...f,name:e.target.value}))} onBlur={()=>setPtfm(f=>({...f,name:(f.name||'').toUpperCase()}))}/></div>
                <div><label className="fl">IC</label><input className="fi" value={ptfm.ic} onChange={e=>setPtfm(f=>({...f,ic:e.target.value}))}/></div>
                <div className="ff"><label className="fl">Default Wage/Day (RM)</label><input className="fi" type="number" value={ptfm.wagePerDay||''} placeholder="0" onChange={e=>setPtfm(f=>({...f,wagePerDay:parseFloat(e.target.value)||0}))}/></div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:8}}>
                <button className="b bd" onClick={eidPT?updPT:addPT}>{eidPT?'Update':'Add'}</button>
                <button className="b bo" onClick={()=>{setPtf(false);setEidPT(null);setPtfm({name:'',ic:'',wagePerDay:0});}}>Cancel</button>
              </div>
            </div>}
            {pt.map(s=>(
              <div className="si" key={s.id}>
                <div className="sif">
                  <div className="sin">{s.name}</div>
                  <div className="sim">{s.ic}{s.wagePerDay?` · RM${s.wagePerDay}/day`:''}</div>
                </div>
                <button className="b bg" style={{padding:'4px 8px',fontSize:12}} onClick={()=>edPT(s)}>Edit</button>
                <button className="b bg" style={{padding:'4px 8px',fontSize:12,color:'#1e40af'}} onClick={()=>convertPTtoFT(s)} title="Move to Full-Time">→ FT</button>
                <button className="b br" style={{padding:'4px 8px',fontSize:12}} onClick={()=>delPT(s.id)}>Del</button>
              </div>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}

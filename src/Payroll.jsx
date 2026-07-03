import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
// ═══════════════════════════════════════════════════════════════
// STATUTORY TABLES — 2026 Malaysia (KWSP / PERKESO / EIS)
// ═══════════════════════════════════════════════════════════════
// SOCSO Category 1 — Under 60, Updated June 2026
// [maxWage, employer, employee_invalidity, employee_non_emp_injury]
// Includes Lindung 24 Jam (Non-Employment Injury Scheme) — employee-only contribution
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
  [6000,104.65,29.90,44.55],[Infinity,104.65,29.90,44.55]
];
export const SOCSO_CAT2 = [
  [30,0.30],[50,0.50],[70,0.80],[100,1.10],[140,1.50],[200,2.10],
  [300,3.10],[400,4.40],[500,5.60],[600,6.90],[700,8.10],[800,9.40],
  [900,10.60],[1000,11.90],[1100,13.10],[1200,14.40],[1300,15.60],
  [1400,16.90],[1500,18.10],[1700,20.60],[1900,23.10],[2000,24.40],
  [2200,26.90],[2500,30.60],[2800,34.40],[3000,36.90],[3300,40.60],
  [3500,43.10],[3800,46.90],[4000,49.40],[4300,53.10],[4500,55.60],
  [4800,59.40],[5000,61.90],[5300,65.60],[5600,69.40],[5900,73.10],
  [6000,74.40],[Infinity,74.40]
];
export const EIS_TABLE = [
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
export function calcEPF(s, a){
  // Defensive guard: invalid/blank/negative wages → zero deductions.
  // Without this, NaN/undefined would propagate or produce nonsense values.
  if (!s || !isFinite(s) || s <= 0) return { employer: 0, employee: 0 };
  // Banding helper: round wage UP to nearest RM20 (upper edge of band).
  // For wages > RM5,000, no banding — flat percentage on actual wage.
  const banded = s <= 5000 ? Math.ceil(s / 20) * 20 : s;

  if (a >= 60) {
    // Age 60+ legacy rate: 6.5% employer / 5.5% employee.
    // TODO: verify current 2026 KWSP rate for 60+ citizens (likely 4%/0%).
    return {
      employer: Math.ceil(banded * 0.065),
      employee: Math.ceil(banded * 0.055),
    };
  }

  // Under 60: 11% employee / 13% employer (≤5K) or 12% employer (>5K)
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
  if(a>=60){const b=lookupBand(SOCSO_CAT2,s);return{employer:b[1],employee:0,employeeInv:0,employeeNEI:0};}
  const b=lookupBand(SOCSO_CAT1,s);
  // b[1]=employer, b[2]=employee invalidity, b[3]=employee non-employment injury
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
// LS_S / LS_PT bumped to _v2 in the 2026-07 update to force existing users
// onto the refreshed SAMPLE_STAFF (new salaries, positions, and 2 new staff).
// LS_P kept as-is so per-month advance/incentive/bonus history is preserved.
const LS_S='cjk_payroll_staff_v2',LS_P='cjk_payroll_data',LS_PT='cjk_pt_v2';
function loadJ(k,f){try{return JSON.parse(localStorage.getItem(k))||f;}catch{return f;}}
function saveJ(k,d){localStorage.setItem(k,JSON.stringify(d));}
const SAMPLE_STAFF=[
  {id:'s1',name:'JENNY KUEH MIAW SIN',ic:'940921-13-5170',position:'ADMIN INV. CLERK',salary:2450,method:'bank',status:'permanent'},
  {id:'s2',name:'JANET KUEH NEO PEI',ic:'971020-13-5220',position:'ASST. SUPERVISOR',salary:2250,method:'bank',status:'permanent'},
  {id:'s3',name:'LO HUI TIN',ic:'961122-13-5142',position:'PJ EXEC. OPERATIONS SUPERVISOR',salary:2450,method:'bank',status:'permanent'},
  {id:'s4',name:'JEE SUK HUI',ic:'981109-13-5330',position:'KC ASST. SUPERVISOR',salary:2000,method:'bank',status:'permanent'},
  {id:'s5',name:'VOON SUK YIN',ic:'001028-13-1446',position:'INVOICING CLERK',salary:1950,method:'cash',status:'permanent'},
  {id:'s6',name:'CHAI WAN NEE',ic:'011227-13-0648',position:'ASST. CASHIER SUPERVISOR',salary:1950,method:'cash',status:'permanent'},
  {id:'s7',name:'SIMON ANG TECK HOCK',ic:'740202-13-5485',position:'DRIVER',salary:2250,method:'cash',status:'permanent'},
  {id:'s8',name:'BONG SOON SIONG',ic:'840805-13-5159',position:'DRIVER',salary:2200,method:'cash',status:'permanent'},
  {id:'s9',name:'BONG SOON LEONG',ic:'000407-13-0385',position:'DRIVER ASSISTANT',salary:1850,method:'cash',status:'permanent'},
  {id:'s10',name:'LEE KIAN HOW',ic:'020812-13-0555',position:'DRIVER ASSISTANT',salary:1850,method:'cash',status:'permanent'},
  {id:'s11',name:"JAMBLIN ANAK E'IEH",ic:'841130-13-5189',position:'STOREKEEPER',salary:1800,method:'cash',status:'permanent'},
  {id:'s12',name:'HII KING HUI',ic:'840927-13-5595',position:'GENERAL WORKER',salary:1800,method:'cash',status:'permanent'},
  {id:'s13',name:'TAN SIAW CHIANG',ic:'841016-13-5505',position:'DRIVER',salary:1850,method:'cash',status:'permanent'},
  {id:'s14',name:'MUHAMMAD HAZIQ AKMAL BIN MARIKAN',ic:'001005-13-0467',position:'GENERAL WORKER',salary:1725,method:'cash',status:'permanent'},
  {id:'s15',name:'RALLY ANAK WILLIAM',ic:'020707-13-0721',position:'GENERAL WORKER',salary:1725,method:'cash',status:'permanent'},
  {id:'s16',name:'HAM KING PING',ic:'950110-13-5707',position:'GENERAL WORKER',salary:1750,method:'cash',status:'permanent'},
  {id:'s17',name:'MUHAMMAD RAMDZANI BIN WET',ic:'031118-13-0145',position:'GENERAL WORKER',salary:1725,method:'cash',status:'permanent'},
  {id:'s18',name:'KUA JAK HUN',ic:'790127-13-5746',position:'MERCHANDISER',salary:1800,method:'cash',status:'permanent'},
  {id:'s19',name:'AZNAN BIN ZAHIDI',ic:'870907-13-5413',position:'DRIVER',salary:1825,method:'cash',status:'permanent'},
  {id:'s20',name:'DANIELL SHAH RIEZAL BIN ROSLI',ic:'080705-13-0773',position:'GENERAL WORKER',salary:1700,method:'cash',status:'permanent'},
  {id:'s21',name:'JEE SWEE EN',ic:'060310-13-0180',position:'CASHIER',salary:1700,method:'cash',status:'permanent'},
  {id:'s22',name:'JANET SOON PEI YEE',ic:'020627-13-0836',position:'CASHIER',salary:1700,method:'cash',status:'permanent'},
  {id:'s23',name:'TAN WEI HOW',ic:'071210-13-0507',position:'GENERAL WORKER',salary:1700,method:'cash',status:'probationary'},
  {id:'s24',name:'ERRA ERYCA NORY ANAK LASU',ic:'980125-13-6128',position:'ADMIN CLERK',salary:1800,method:'cash',status:'probationary'},
];
const SAMPLE_PT=[];
const MONTHS=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const MON_S=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
async function loadXLSX(){if(window.XLSX)return window.XLSX;return new Promise((r,j)=>{const s=document.createElement('script');s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';s.onload=()=>r(window.XLSX);s.onerror=j;document.head.appendChild(s);});}
async function exportExcel(mo,yr,bR,cR,bT,cT,gT,ptR,ptT,notes,bL){
  const X=await loadXLSX(),wb=X.utils.book_new(),ws={},mg=[];const mn=MONTHS[mo];
  function sc(r,c,v){ws[X.utils.encode_cell({r,c})]={v,t:typeof v==='number'?'n':'s'};}
  sc(0,0,'C.J.K. CHAI JEE KIONG TRADING SDN BHD');mg.push({s:{r:0,c:0},e:{r:0,c:16}});
  sc(1,0,`HQ STAFF PAYROLL ${mn} ${yr}`);mg.push({s:{r:1,c:0},e:{r:1,c:16}});
  sc(2,0,'FULL-TIME STAFF');mg.push({s:{r:2,c:0},e:{r:2,c:16}});
  sc(3,4,'EARNINGS (+)');mg.push({s:{r:3,c:4},e:{r:3,c:5}});sc(3,7,'DEDUCTIONS (-)');mg.push({s:{r:3,c:7},e:{r:3,c:15}});
  sc(3,16,'NET PAY');mg.push({s:{r:3,c:16},e:{r:4,c:16}});
  ['NO','NAME','IC NO','POSITION','BASIC SALARY','INCENTIVE',bL,'EPF (M)','EPF (P)','JUMLAH EPF','SOCSO (M)','SOCSO (P)','JUMLAH SOCSO','EIS (M/P)','JUMLAH EIS','ADVANCE'].forEach((h,i)=>sc(4,i,h));
  let row=5,sn=1;
  const wR=rows=>{rows.forEach(s=>{sc(row,0,sn);sc(row,1,s.name);sc(row,2,s.ic);sc(row,3,s.position);sc(row,4,s.salary);sc(row,5,s.incentive||0);sc(row,6,s.bonus||0);sc(row,7,s.epfM);sc(row,8,s.epfP);sc(row,9,s.epfM+s.epfP);sc(row,10,s.socsoM);sc(row,11,s.socsoP);sc(row,12,s.socsoM+s.socsoP);sc(row,13,s.eisE);sc(row,14,s.eisE*2);sc(row,15,s.advance||0);sc(row,16,s.netPay);sn++;row++;});};
  const tR=(l,t)=>{sc(row,0,l);mg.push({s:{r:row,c:0},e:{r:row,c:3}});[4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(c=>sc(row,c,t[c]||0));row++;};
  wR(bR);tR('BANK TRANSFER:',bT);const pc=cR.filter(s=>s.status==='permanent'),pb=cR.filter(s=>s.status==='probationary');
  wR(pc);if(pb.length){sc(row,0,'PROBATIONARY > PERMANENT');mg.push({s:{r:row,c:0},e:{r:row,c:16}});row++;wR(pb);}
  tR('CASH:',cT);tR('TOTAL:',gT);
  notes.forEach(n=>{sc(row,0,n);mg.push({s:{r:row,c:0},e:{r:row,c:16}});row++;});
  row++;sc(row,0,'PART-TIME STAFF');mg.push({s:{r:row,c:0},e:{r:row,c:16}});row++;
  sc(row,4,'WAGES/ DAY');sc(row,5,'DAY');sc(row,15,'ADVANCE');sc(row,16,'NET PAY');row++;
  ptR.forEach((s,i)=>{sc(row,0,i+1);sc(row,1,s.name);sc(row,2,s.ic);sc(row,4,s.wagePerDay||0);sc(row,5,s.daysWorked||0);sc(row,15,s.advance||0);sc(row,16,s.netPay||0);row++;});
  sc(row,0,'TOTAL:');mg.push({s:{r:row,c:0},e:{r:row,c:3}});sc(row,15,ptT.advance||0);sc(row,16,ptT.netPay||0);
  ws['!ref']=X.utils.encode_range({s:{r:0,c:0},e:{r:row,c:16}});ws['!merges']=mg;
  ws['!cols']=[5,35,18,32,14,12,14,10,10,12,10,10,14,10,12,10,12].map(w=>({wch:w}));
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
.body{max-width:100%;margin:0 auto;padding:12px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.st{background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #e4e4e7}
.stl{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;margin-bottom:3px}
.stv{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.sec{background:#fff;border-radius:8px;border:1px solid #e4e4e7;overflow:hidden;margin-bottom:12px}
.sh{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f4f4f5}
.sht{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.tw{overflow-x:visible}
.t{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums;table-layout:fixed}
.t th{padding:5px 3px;text-align:center;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;color:#71717a;background:#fafafa;border-bottom:1px solid #e4e4e7;white-space:normal;word-break:break-word;line-height:1.15;vertical-align:bottom}
.t th.r{text-align:center}
.t th.l{text-align:left}
.t td{padding:4px 3px;border-bottom:1px solid #f4f4f5;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t td.r{text-align:center}
.t tr:hover{background:#fafafa}
.t .gh{background:#e5e7eb;color:#18181b;font-size:10px;font-weight:700;letter-spacing:.05em}
.t .gh td{padding:4px 8px;border:none;white-space:nowrap;overflow:visible;color:#18181b}
.t .ph{background:#fef3c7}.t .ph td{padding:3px 8px;border-bottom:1px solid #fcd34d;font-size:10px;font-weight:700;color:#92400e;overflow:visible}
.t .tr td{font-weight:700;background:#f0fdf4;border-top:2px solid #18181b;border-bottom:2px solid #18181b}
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
  .pr{background:#fff}
  .body{max-width:100%;padding:0;margin:0}
  .sec{border:none;border-radius:0;margin-bottom:6px;box-shadow:none}
  .sh{padding:4px 0;border:none}
  .sht{font-size:10pt;font-weight:700}
  .stats{display:none!important}
  .t{font-size:6.5pt;table-layout:fixed!important;width:100%}
  /* Explicit print column widths — sum = 100% */
  .t col:nth-child(1){width:1.8%!important}   /* # */
  .t col:nth-child(2){width:15%!important}    /* Name */
  .t col:nth-child(3){width:9.5%!important}   /* IC */
  .t col:nth-child(4){width:12%!important}    /* Position */
  .t col:nth-child(5){width:5%!important}     /* Salary */
  .t col:nth-child(6){width:4%!important}     /* Incent */
  .t col:nth-child(7){width:4%!important}     /* Bonus */
  .t col:nth-child(8){width:4.3%!important}   /* EPF(M) */
  .t col:nth-child(9){width:4.3%!important}   /* EPF(P) */
  .t col:nth-child(10){width:4.5%!important}  /* Jml EPF */
  .t col:nth-child(11){width:4.3%!important}  /* SOC(M) */
  .t col:nth-child(12){width:4.3%!important}  /* SOC(P) */
  .t col:nth-child(13){width:4.5%!important}  /* Jml SOC */
  .t col:nth-child(14){width:3.5%!important}  /* EIS */
  .t col:nth-child(15){width:4%!important}    /* Jml EIS */
  .t col:nth-child(16){width:4%!important}    /* Adv */
  .t col:nth-child(17){width:6%!important}    /* Net Pay */
  .t th{position:static;padding:3px 2px;font-size:6pt;background:#f0f0f0!important;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;white-space:normal!important;word-wrap:break-word;overflow:hidden;line-height:1.1}
  .t td{padding:2px 2px;font-size:6.5pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* Allow name, IC, position to wrap so nothing gets cut off */
  .t td:nth-child(2),.t td:nth-child(3),.t td:nth-child(4){white-space:normal!important;word-break:break-word;line-height:1.15}
  .t .gh{background:#e5e7eb!important;color:#18181b!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .gh td{padding:2px 4px;font-size:7pt;font-weight:700;overflow:visible}
  .t .ph{background:#fef3c7!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .ph td{padding:2px 4px;font-size:6.5pt;font-weight:700;color:#92400e;overflow:visible}
  .t .tr td{background:#f0fdf4!important;font-size:6.5pt;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .gr td{background:#fef9c3!important;font-size:7.5pt;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .eh{background:#f0fdf4!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .dh{background:#fef2f2!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .t .nh{background:#eff6ff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .i{border:none!important;font-size:6.5pt;width:100%!important;padding:0!important;background:transparent!important;text-align:right}
  .tw{overflow:hidden!important}
  .notes{background:#fffbeb!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:5px 10px}
  .notes p{font-size:6.5pt}
  @page{size:A4 landscape;margin:6mm}
}
.po{display:none}
@media print{.po{display:block!important;text-align:center;margin-bottom:6px}.po div:first-child{font-size:11pt!important;font-weight:700}.po div:last-child{font-size:9.5pt!important;font-weight:600}}
`;
export default function Payroll(){
  const now=new Date();
  const[mo,setMo]=useState(now.getMonth()),[yr,setYr]=useState(now.getFullYear());
  const[staff,setStaff]=useState(()=>loadJ(LS_S,SAMPLE_STAFF));
  const[pt,setPt]=useState(()=>loadJ(LS_PT,SAMPLE_PT));
  const[pd,setPd]=useState(()=>loadJ(LS_P,{}));
  const[bl,setBl]=useState('GAWAI BONUS');
  const[pan,setPan]=useState(false),[eid,setEid]=useState(null);
  const[dragId,setDragId]=useState(null);
  const[dragOverId,setDragOverId]=useState(null);
  const[fm,setFm]=useState({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});
  const[ptf,setPtf]=useState(false),[ptfm,setPtfm]=useState({name:'',ic:'',wagePerDay:0});
  const[eidPT,setEidPT]=useState(null);  // tracks which part-time staff is being edited
  useEffect(()=>{saveJ(LS_S,staff);},[staff]);
  useEffect(()=>{saveJ(LS_PT,pt);},[pt]);
  useEffect(()=>{saveJ(LS_P,pd);},[pd]);
  const mk=`${yr}-${String(mo+1).padStart(2,'0')}`,ref=new Date(yr,mo,15);
  const gM=useCallback(sid=>pd[mk]?.[sid]||{incentive:0,bonus:0,advance:0,wagePerDay:0,daysWorked:0},[pd,mk]);
  const sM=useCallback((sid,f,v)=>{setPd(p=>{const n={...p};if(!n[mk])n[mk]={};if(!n[mk][sid])n[mk][sid]={incentive:0,bonus:0,advance:0,wagePerDay:0,daysWorked:0};n[mk][sid]={...n[mk][sid],[f]:parseFloat(v)||0};return n;});},[mk]);
  const comp=useCallback(s=>{
    const a=getAgeFromIC(s.ic,ref),m=gM(s.id);
    // Use monthly override if exists, otherwise fall back to staff default
    const hasMonthly = pd[mk]?.[s.id];
    const inc = hasMonthly && 'incentive' in hasMonthly ? (m.incentive||0) : (s.defIncentive||0);
    const bon = hasMonthly && 'bonus' in hasMonthly ? (m.bonus||0) : (s.defBonus||0);
    const adv = hasMonthly && 'advance' in hasMonthly ? (m.advance||0) : (s.defAdvance||0);
    // Per KWSP/PERKESO 2026 guidelines:
    // - Incentive is treated as wages → subject to EPF + SOCSO + EIS (recalc bands)
    // - Bonus → subject to EPF only (recalc EPF band with bonus added)
    const epfWage = s.salary + inc + bon;          // bonus + incentive both raise EPF base
    const socsoEisWage = s.salary + inc;            // only incentive raises SOCSO/EIS base
    const epf=calcEPF(epfWage,a);
    const socso=calcSOCSO(socsoEisWage,a);
    const eis=calcEIS(socsoEisWage,a);
    const net=s.salary+inc+bon-epf.employee-socso.employee-eis.employee-adv;
    return{...s,age:a,incentive:inc,bonus:bon,advance:adv,epfM:epf.employer,epfP:epf.employee,socsoM:socso.employer,socsoP:socso.employee,eisE:eis.employee,netPay:Math.round(net*100)/100,underAge:a<18};
  },[ref,gM,pd,mk]);
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
  const addS=()=>{setStaff(p=>[...p,{id:'s'+Date.now(),...fm}]);setFm({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});setEid(null);};
  const updS=()=>{setStaff(p=>p.map(s=>s.id===eid?{...s,...fm}:s));setEid(null);setFm({name:'',ic:'',position:'',salary:1700,method:'cash',status:'permanent',defIncentive:0,defBonus:0,defAdvance:0});};
  const delS=id=>{if(confirm('Remove this staff?'))setStaff(p=>p.filter(s=>s.id!==id));};
  // Inline update of staff salary from the payroll table
  const updateSalary=(sid,v)=>{setStaff(p=>p.map(s=>s.id===sid?{...s,salary:parseFloat(v)||0}:s));};
  // Reorder staff via drag and drop
  const reorderStaff=(fromId,toId)=>{
    if(fromId===toId) return;
    setStaff(p=>{
      const arr=[...p];
      const fromIdx=arr.findIndex(s=>s.id===fromId);
      const toIdx=arr.findIndex(s=>s.id===toId);
      if(fromIdx<0||toIdx<0) return p;
      const[moved]=arr.splice(fromIdx,1);
      arr.splice(toIdx,0,moved);
      return arr;
    });
  };
  const edS=s=>{setEid(s.id);setFm({name:s.name,ic:s.ic,position:s.position,salary:s.salary,method:s.method,status:s.status,defIncentive:s.defIncentive||0,defBonus:s.defBonus||0,defAdvance:s.defAdvance||0});};
  const addPT=()=>{setPt(p=>[...p,{id:'p'+Date.now(),...ptfm,status:'part-time'}]);setPtfm({name:'',ic:'',wagePerDay:0});setPtf(false);setEidPT(null);};
  const delPT=id=>{if(confirm('Remove?'))setPt(p=>p.filter(s=>s.id!==id));};

  // Edit existing part-time staff — opens the PT form prefilled.
  const edPT=s=>{setEidPT(s.id);setPtfm({name:s.name,ic:s.ic,wagePerDay:s.wagePerDay||0});setPtf(true);};

  // Save edits to existing part-time staff.
  const updPT=()=>{
    setPt(p=>p.map(s=>s.id===eidPT?{...s,name:ptfm.name,ic:ptfm.ic,wagePerDay:ptfm.wagePerDay}:s));
    setEidPT(null);
    setPtfm({name:'',ic:'',wagePerDay:0});
    setPtf(false);
  };

  // Convert a part-time staff member to full-time.
  // Creates a new FT record with defaults (salary 1700, cash, permanent) and opens the FT edit form
  // so the user can fix salary/method/etc immediately.
  const convertPTtoFT=s=>{
    if(!confirm(`Move ${s.name} to Full-Time?\n\nDefaults: Salary RM1,700, Cash payment, Permanent status. You can edit these right after.`))return;
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
    if(!confirm(`Move ${s.name} to Part-Time?\n\nFull-time salary and defaults will be removed. You'll set wages per day in the part-time form.`))return;
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
  // EditableCell — uncontrolled input that holds local state during typing,
  // commits to global state only on blur/Enter so focus never jumps
  const EditableCell = ({value, onCommit, placeholder='0', width=50}) => {
    const ref = useRef(null);
    const [local, setLocal] = useState(value ? String(value) : '');
    const lastExternal = useRef(value);
    // Sync from external only when external changes AND user isn't typing
    useEffect(() => {
      if (lastExternal.current !== value && document.activeElement !== ref.current) {
        setLocal(value ? String(value) : '');
      }
      lastExternal.current = value;
    }, [value]);
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
          if (e.key === 'Escape') { setLocal(value ? String(value) : ''); ref.current?.blur(); }
        }}
        style={{width}}
      />
    );
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
  let gn=0;
  const Row=({r})=>{gn++;const n=gn;
    const isDragging=dragId===r.id;
    const isDragOver=dragOverId===r.id&&dragId!==r.id;
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
          <span style={{color:'#d4d4d8',fontSize:11,lineHeight:1,letterSpacing:-1}}>⋮⋮</span>
          {n}
        </span>
      </td>
      <td style={{fontWeight:600,color:'#000'}} title={r.name}>{r.name}</td>
      <td style={{color:'#000',fontSize:10}} title={r.ic}>{r.ic}</td>
      <td style={{color:'#000',fontSize:10}} title={r.position}>{r.position}</td>
      <td className="r" style={{color:'#000'}}><EditableCell value={r.salary} onCommit={v=>updateSalary(r.id,v)} width={60}/></td>
      <td className="r" style={{color:'#000'}}><EditableCell value={r.incentive} onCommit={v=>sM(r.id,'incentive',v)}/></td>
      <td className="r" style={{color:'#000'}}><EditableCell value={r.bonus} onCommit={v=>sM(r.id,'bonus',v)}/></td>
      <td className="r" style={{color:'#000'}}>{fmt(r.epfM)}</td>
      <td className="r" style={{color:'#000',fontWeight:700}}>{fmt(r.epfP)}</td>
      <td className="r" style={{color:'#000'}}>{fmt(r.epfM+r.epfP)}</td>
      <td className="r" style={{color:'#000'}}>{fmt(r.socsoM)}</td>
      <td className="r" style={{color:'#000',fontWeight:700}}>{fmt(r.socsoP)}</td>
      <td className="r" style={{color:'#000'}}>{fmt(r.socsoM+r.socsoP)}</td>
      <td className="r" style={{color:'#000'}}>{fmt(r.eisE)}</td>
      <td className="r" style={{color:'#000'}}>{fmt(r.eisE*2)}</td>
      <td className="r" style={{color:'#000'}}><EditableCell value={r.advance} onCommit={v=>sM(r.id,'advance',v)}/></td>
      <td className="r" style={{fontWeight:700,fontSize:11,whiteSpace:'nowrap',color:'#000'}}>{fmt(r.netPay)}</td>
    </tr>
  );};
  const TR=({l,t,c})=>(
    <tr className={c}>
      <td colSpan={4} style={{fontWeight:700}}>{l}</td>
      <td className="r tcell">{fmt(t[4])}</td><td className="r tcell">{fmt(t[5])}</td><td className="r tcell">{fmt(t[6])}</td>
      <td className="r tcell">{fmt(t[7])}</td><td className="r tcell">{fmt(t[8])}</td><td className="r tcell">{fmt(t[9])}</td>
      <td className="r tcell">{fmt(t[10])}</td><td className="r tcell">{fmt(t[11])}</td><td className="r tcell">{fmt(t[12])}</td>
      <td className="r tcell">{fmt(t[13])}</td><td className="r tcell">{fmt(t[14])}</td><td className="r tcell">{fmt(t[15])}</td>
      <td className="r tcell">{fmt(t[16])}</td>
    </tr>
  );
  gn=0;
  const pc=cS.filter(r=>r.status==='permanent'),pb=cS.filter(r=>r.status==='probationary');
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
          <button className="b bd" onClick={()=>exportExcel(mo,yr,bS,cS,bT,cT,gT,ptR,ptT,notes,bl)}>Download Excel</button>
          <button className="b bo" onClick={()=>window.print()}>Print</button>
        </div>
      </div>
      <div className="body">
        <div className="stats np">
          <div className="st"><div className="stl">Total Staff</div><div className="stv">{staff.length}</div></div>
          <div className="st"><div className="stl">Total Earnings</div><div className="stv" style={{color:'#059669'}}>RM {fmt(gT[4]+(gT[5]||0)+(gT[6]||0))}</div></div>
          <div className="st"><div className="stl">Total Deductions</div><div className="stv" style={{color:'#dc2626'}}>RM {fmt((gT[8]||0)+(gT[11]||0)+(gT[13]||0)+(gT[15]||0))}</div></div>
          <div className="st"><div className="stl">Net Payroll</div><div className="stv">RM {fmt(gT[16]||0)}</div></div>
        </div>
        <div className="po" style={{textAlign:'center',marginBottom:12}}>
          <div style={{fontSize:16,fontWeight:700}}>C.J.K. CHAI JEE KIONG TRADING SDN BHD</div>
          <div style={{fontSize:14,fontWeight:600}}>HQ STAFF PAYROLL {MONTHS[mo]} {yr}</div>
        </div>
        <div className="sec">
          <div className="sh np">
            <div className="sht">Full-Time Staff</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:11,color:'#a1a1aa'}}>Bonus label:</span>
              <input value={bl} onChange={e=>setBl(e.target.value.toUpperCase())} style={{width:120,fontSize:12,border:'1px solid #e4e4e7',borderRadius:4,padding:'4px 8px',textAlign:'center',fontWeight:600}}/>
            </div>
          </div>
          <div className="tw">
            <table className="t">
              <colgroup>
                <col style={{width:'2.5%'}}/>
                <col style={{width:'14%'}}/>
                <col style={{width:'10%'}}/>
                <col style={{width:'11%'}}/>
                <col style={{width:'5.5%'}}/>
                <col style={{width:'4.5%'}}/>
                <col style={{width:'4.5%'}}/>
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
                  <th colSpan={3} className="eh" style={{textAlign:'center'}}>EARNINGS (+)</th>
                  <th colSpan={9} className="dh" style={{textAlign:'center'}}>DEDUCTIONS (-)</th>
                  <th className="nh" style={{textAlign:'center'}}>NET PAY</th>
                </tr>
                <tr>
                  <th className="r">#</th><th className="l">Name</th><th className="l">IC No</th><th className="l">Position</th>
                  <th className="r eh">Salary</th><th className="r eh">Incentive</th><th className="r eh">{bl}</th>
                  <th className="r dh">EPF(M)</th><th className="r dh">EPF(P)</th><th className="r dh">Jumlah EPF</th>
                  <th className="r dh">SOCSO(M)</th><th className="r dh">SOCSO(P)</th><th className="r dh">Jumlah SOCSO</th>
                  <th className="r dh">EIS</th><th className="r dh">Jumlah EIS</th><th className="r dh">Advance</th>
                  <th className="r nh">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                <tr className="gh"><td colSpan={17}>Bank Transfer</td></tr>
                {bS.map(r=><Row key={r.id} r={r}/>)}
                <TR l="Bank Transfer" t={bT} c="tr"/>
                <tr className="gh"><td colSpan={17}>Cash</td></tr>
                {pc.map(r=><Row key={r.id} r={r}/>)}
                {pb.length>0&&<><tr className="ph"><td colSpan={17}>Probationary &rarr; Permanent</td></tr>{pb.map(r=><Row key={r.id} r={r}/>)}</>}
                <TR l="Cash" t={cT} c="tr"/>
                <TR l="TOTAL" t={gT} c="gr"/>
              </tbody>
            </table>
          </div>
          {notes.length>0&&<div className="notes">{notes.map((n,i)=><p key={i}>{n}</p>)}</div>}
        </div>
        <div className="sec">
          <div className="sh"><div className="sht">Part-Time Staff</div></div>
          <div className="tw">
            <table className="t">
              <thead><tr><th className="r" style={{width:32}}>#</th><th>Name</th><th>IC No</th><th className="r">Wages/Day</th><th className="r">Days</th><th className="r">Advance</th><th className="r" style={{width:90}}>Net Pay</th></tr></thead>
              <tbody>
                {ptR.map((r,i)=><tr key={r.id}><td className="r" style={{color:'#a1a1aa'}}>{i+1}</td><td style={{fontWeight:600}}>{r.name}</td><td style={{color:'#71717a',fontSize:12}}>{r.ic}</td><td className="r"><EditableCell value={r.wagePerDay} onCommit={v=>sM(r.id,'wagePerDay',v)}/></td><td className="r"><EditableCell value={r.daysWorked} onCommit={v=>sM(r.id,'daysWorked',v)} width={36}/></td><td className="r"><EditableCell value={r.advance} onCommit={v=>sM(r.id,'advance',v)}/></td><td className="r" style={{fontWeight:700,fontSize:14}}>{fmt(r.netPay)}</td></tr>)}
                <tr className="tr"><td colSpan={5} style={{fontWeight:700}}>TOTAL</td><td className="r">{fmt(ptT.advance)}</td><td className="r">{fmt(ptT.netPay)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {pan&&<>
        <div className="ov np" onClick={()=>setPan(false)}/>
        <div className="pn np">
          <div className="pnh"><h2 style={{margin:0,fontSize:16,fontWeight:700}}>Staff Management</h2><button className="b bg" onClick={()=>setPan(false)} style={{fontSize:18,padding:'4px 8px'}}>&#10005;</button></div>
          <div className="pnb">
            <div style={{background:'#fafafa',borderRadius:8,padding:16,marginBottom:20,border:'1px solid #e4e4e7'}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:12,textTransform:'uppercase',letterSpacing:'.05em',color:'#71717a'}}>{eid?'Edit Staff':'Add New Staff'}</div>
              <div className="fg">
                <div className="ff"><label className="fl">Full Name</label><input className="fi" value={fm.name} onChange={e=>setFm(f=>({...f,name:e.target.value.toUpperCase()}))} placeholder="FULL NAME"/></div>
                <div><label className="fl">IC Number</label><input className="fi" value={fm.ic} onChange={e=>setFm(f=>({...f,ic:e.target.value}))} placeholder="YYMMDD-SS-NNNN"/></div>
                <div><label className="fl">Salary (RM)</label><input className="fi" type="number" value={fm.salary} onChange={e=>setFm(f=>({...f,salary:parseFloat(e.target.value)||0}))}/></div>
                <div className="ff"><label className="fl">Position</label><input className="fi" value={fm.position} onChange={e=>setFm(f=>({...f,position:e.target.value.toUpperCase()}))} placeholder="JOB TITLE"/></div>
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
                <div><label className="fl">Name</label><input className="fi" value={ptfm.name} onChange={e=>setPtfm(f=>({...f,name:e.target.value.toUpperCase()}))}/></div>
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

import { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

async function parsePBBStatement(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const allTxns = [];
  let currentDate = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim());

    const rowMap = new Map();
    for (const item of items) {
      const y = Math.round(item.transform[5] * 10) / 10;
      let matched = false;
      for (const [ky] of rowMap) {
        if (Math.abs(ky - y) < 3) { rowMap.get(ky).push(item); matched = true; break; }
      }
      if (!matched) rowMap.set(y, [item]);
    }

    const rows = [...rowMap.entries()].sort((a, b) => b[0] - a[0]);
    let pendingTxn = null;
    let pastHeader = false;

    const flushTxn = () => { if (pendingTxn) { allTxns.push(pendingTxn); pendingTxn = null; } };
    const isJunk = (s) => /computer generated statement|terima kasih|thank you for banking|privacy notice|notis privasi|excellence is our commitment|perhatian|attention/i.test(s);

    for (const [, rowItems] of rows) {
      const sorted = rowItems.sort((a, b) => a.transform[4] - b.transform[4]);
      let date = '', text = '', debit = '', credit = '', balance = '';

      for (const item of sorted) {
        const x = item.transform[4];
        const v = item.str.trim();
        if (x < 80) date = v;
        else if (x < 300) text = text ? text + ' ' + v : v;
        else if (x < 375) debit = v;
        else if (x < 460) credit = v;
        else balance = v;
      }

      if (/^(TARIKH|DATE)$/i.test(text) || /^(URUS NIAGA|TRANSACTION)$/i.test(text)) { pastHeader = true; continue; }
      if (/DEBIT|KREDIT|CREDIT|BAKI|BALANCE/i.test(text) && !date && !debit && !credit) { pastHeader = true; continue; }
      if (!pastHeader) continue;

      if (/bal(ance)?\s*(from last|b\/f|brought\s*forward)/i.test(text) || /baki\s*(dari|b\/f)/i.test(text)) {
        currentDate = date || currentDate;
        const extra = text.replace(/bal(ance)?\s*(from last|b\/f|brought\s*forward)/gi, '').replace(/baki\s*(dari|b\/f)/gi, '').replace(/statement/gi, '').trim();
        if (extra && !isJunk(extra) && allTxns.length > 0) {
          allTxns[allTxns.length - 1].description += '\n' + extra;
        }
        continue;
      }
      if (/bal(ance)?\s*c\/f/i.test(text) || /baki\s*(c\/f|ke\s*hadapan)/i.test(text)) { flushTxn(); continue; }

      if (date && /^\d{2}\/\d{2}$/.test(date)) currentDate = date;

      const parseAmt = (s) => { if (!s) return 0; return parseFloat(s.replace(/,/g, '')) || 0; };
      const dVal = parseAmt(debit);
      const cVal = parseAmt(credit);

      if (dVal > 0 || cVal > 0) {
        flushTxn();
        pendingTxn = {
          date: currentDate,
          description: text,
          debit: dVal,
          credit: cVal,
          balance: balance.replace(/,/g, ''),
          page: p,
        };
      } else if (text && !isJunk(text)) {
        if (pendingTxn) {
          pendingTxn.description += '\n' + text;
        } else if (allTxns.length > 0) {
          allTxns[allTxns.length - 1].description += '\n' + text;
        }
      }
    }
    flushTxn();
  }
  return { txns: allTxns, numPages: pdf.numPages };
}

function classifyBankTxns(txns) {
  const toKeyed = [];
  const onlineTransfers = [];
  const depCash = [];

  const TO_KEYED_PATTERNS = [/PROCESS FEE/i, /HANDLING CHARGE/i, /AUDIT CONFIRMATION/i, /AUTOMATED LOAN/i];
  const ONLINE_PATTERNS = [/DUITNOW QR CR/i, /DUITNOW TRSF CR/i, /DUITNOW TRSF/i, /TSFR FUND CR/i, /DUITNOW CR/i, /IBG CR/i, /IBFT CR/i, /TRSF/i, /ATM\/EFT/i];

  for (const txn of txns) {
    const desc = txn.description.split('\n')[0];

    if (TO_KEYED_PATTERNS.some(p => p.test(desc))) {
      const type = /AUTOMATED LOAN/i.test(desc) ? 'Loan Payment' : 'Bank Charge';
      toKeyed.push({ ...txn, type });
    }

    if (txn.credit > 0 && ONLINE_PATTERNS.some(p => p.test(desc))) {
      onlineTransfers.push(txn);
    }

    if (/DEP-CASH/i.test(desc) && txn.credit > 0) {
      depCash.push(txn);
    }
  }

  return { toKeyed, onlineTransfers, depCash };
}

function groupByDate(items) {
  const groups = [];
  let current = null;
  items.forEach((t, i) => {
    if (!current || current.date !== t.date) {
      current = { date: t.date, items: [] };
      groups.push(current);
    }
    current.items.push({ txn: t, idx: i });
  });
  return groups;
}

const CP_BANK_IDS = ['162259', '162250', '162260', '162249'];

function matchBankCredits(txns) {
  const matched = { spay: {}, cardpay: {}, mykasih: {} };
  for (const t of txns) {
    if (t.credit <= 0) continue;
    const desc = t.description.toUpperCase();
    if (desc.includes('SILICONNET')) {
      matched.spay[t.date] = (matched.spay[t.date] || 0) + t.credit;
    } else if (desc.includes('GHL') && CP_BANK_IDS.some(id => desc.includes(id))) {
      matched.cardpay[t.date] = (matched.cardpay[t.date] || 0) + t.credit;
    } else if (desc.includes('MYKASIH FOUNDATION')) {
      matched.mykasih[t.date] = (matched.mykasih[t.date] || 0) + t.credit;
    }
  }
  return matched;
}

function findBatchMatches(posDailies, bankDailies) {
  const dateCmp = (a, b) => {
    const [da, ma] = a.split('/').map(Number);
    const [db, mb] = b.split('/').map(Number);
    return (ma - mb) || (da - db);
  };
  const allDates = [...new Set([...Object.keys(posDailies), ...Object.keys(bankDailies)])].sort(dateCmp);
  const usedPOS = new Set();
  const usedBank = new Set();
  const batches = [];
  for (const bankDate of allDates) {
    if ((bankDailies[bankDate] || 0) <= 0 || (posDailies[bankDate] || 0) > 0) continue;
    if (usedBank.has(bankDate)) continue;
    const bankAmt = bankDailies[bankDate];
    const bankIdx = allDates.indexOf(bankDate);
    let sum = 0;
    const candidates = [];
    for (let i = bankIdx - 1; i >= 0; i--) {
      const d = allDates[i];
      if ((posDailies[d] || 0) <= 0 || (bankDailies[d] || 0) > 0 || usedPOS.has(d)) break;
      candidates.unshift(d);
      sum += posDailies[d];
      if (Math.abs(sum - bankAmt) < 0.02) {
        batches.push({ posDates: [...candidates], bankDate });
        candidates.forEach(pd => usedPOS.add(pd));
        usedBank.add(bankDate);
        break;
      }
      if (sum > bankAmt) break;
    }
  }
  const lookup = {};
  for (const b of batches) {
    for (const d of b.posDates) lookup[d] = { type: 'pos', bankDate: b.bankDate, posDates: b.posDates };
    lookup[b.bankDate] = { type: 'bank', posDates: b.posDates };
  }
  return lookup;
}

function sumPOSOutlets(typeData) {
  const totals = {};
  if (!typeData) return totals;
  for (const outletData of Object.values(typeData)) {
    for (const [date, amt] of Object.entries(outletData)) {
      totals[date] = (totals[date] || 0) + amt;
    }
  }
  return totals;
}

function savePOSDailiesBR(type, outlet, dailies) {
  let data = {};
  try { const s = localStorage.getItem('br_pos_daily'); if (s) data = JSON.parse(s); } catch {}
  if (!data[type]) data[type] = {};
  data[type][outlet] = dailies;
  localStorage.setItem('br_pos_daily', JSON.stringify(data));
}

async function parseSpayOutputPDF(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  let dateColX = null, amtColX = null, refundColX = null;
  const dailies = {};
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim()).map(i => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    const rowMap = new Map();
    for (const i of items) {
      const y = Math.round(i.y);
      let ky = null;
      for (const k of rowMap.keys()) { if (Math.abs(k - y) < 4) { ky = k; break; } }
      if (ky !== null) rowMap.get(ky).push(i);
      else rowMap.set(y, [i]);
    }
    if (dateColX === null) {
      let headerY = null;
      for (const [y, ri] of rowMap) {
        if (ri.filter(i => /settlement|merchant|serial|transaction|amount|fee|status/i.test(i.str)).length >= 4) {
          headerY = y; break;
        }
      }
      if (headerY === null) continue;
      const headerBand = items.filter(i => Math.abs(i.y - headerY) < 15);
      const colGroups = new Map();
      for (const i of headerBand) {
        let matched = false;
        for (const [kx, gi] of colGroups) { if (Math.abs(kx - i.x) < 15) { gi.push(i); matched = true; break; } }
        if (!matched) colGroups.set(i.x, [i]);
      }
      for (const [x, gi] of colGroups) {
        const t = gi.map(i => i.str).join(' ');
        if (/settlement.*date/i.test(t)) dateColX = x;
        if (/settlement.*amount/i.test(t)) amtColX = x;
        if (/refund.*amount/i.test(t)) refundColX = x;
      }
      if (dateColX === null || amtColX === null) { dateColX = null; amtColX = null; refundColX = null; continue; }
    }
    for (const [, ri] of rowMap) {
      let rowDate = null;
      for (const i of ri) { if (/^\d{4}-\d{2}-\d{2}$/.test(i.str)) { rowDate = i.str; break; } }
      if (!rowDate) continue;
      let bestAmt = 0, bestX = -Infinity;
      for (const i of ri) {
        const n = parseFloat(i.str.replace(/,/g, ''));
        if (!isNaN(n) && n > 0 && Math.abs(i.x - amtColX) < 60) {
          if (i.x > bestX) { bestX = i.x; bestAmt = n; }
        }
      }
      if (bestAmt > 0) {
        const m = rowDate.match(/(\d{4})-(\d{2})-(\d{2})/);
        const k = `${m[3]}/${m[2]}`;
        dailies[k] = (dailies[k] || 0) + bestAmt;
      }
    }
  }
  return dailies;
}

async function parseCardpayOutputPDF(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const dailies = {};
  let isMonthly = null;
  let lastDate = null;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim());
    items.sort((a, b) => { const dy = b.transform[5] - a.transform[5]; return Math.abs(dy) > 3 ? dy : a.transform[4] - b.transform[4]; });
    const text = items.map(i => i.str.trim()).join(' ');
    if (isMonthly === null) isMonthly = /MONTHLY\s+STATEMENT/i.test(text);
    if (isMonthly) {
      const re = /(\d{2})\/(\d{2})\/\d{4}\s+\S+\s+NORMAL\s+PAYMENT\s+[\d,]+\.\d{2}\s+\([\d,]+\.\d{2}\)\s+[\d,]+\.\d{2}\s+([\d,]+\.\d{2})/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const date = `${m[1]}/${m[2]}`;
        const net = parseFloat(m[3].replace(/,/g, ''));
        if (net > 0) dailies[date] = (dailies[date] || 0) + net;
      }
    } else {
      const dm = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dm) lastDate = `${dm[3]}/${dm[2]}`;
      if (!lastDate) { const dm2 = text.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (dm2) lastDate = `${dm2[1]}/${dm2[2]}`; }
      const nm = text.match(/Total\s+Net\s+Amount\s*:?\s*([\d,]+\.\d{2})/i);
      if (nm && lastDate) {
        const amt = parseFloat(nm[1].replace(/,/g, ''));
        if (amt > 0) dailies[lastDate] = (dailies[lastDate] || 0) + amt;
      }
    }
  }
  return dailies;
}

async function parseMyKasihOutputPDF(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const dailies = {};
  let currentDate = null;
  let isActivity = null;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str.trim());
    items.sort((a, b) => { const dy = b.transform[5] - a.transform[5]; return Math.abs(dy) > 3 ? dy : a.transform[4] - b.transform[4]; });
    const text = items.map(i => i.str.trim()).join(' ');
    if (isActivity === null) isActivity = /TERMINAL\s+ACTIVITY\s+REPORT/i.test(text);
    if (isActivity) {
      const re = /SETTLEMENT\s+DATE\s+\d{2}\/\d{2}\/\d{4}\s*-\s*(\d{2})\/(\d{2})\/\d{4}|TOTAL\s+NET\s+AMT?\s*([\d,]+\.\d{2})/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[1]) {
          currentDate = `${m[1]}/${m[2]}`;
        } else if (m[3] && currentDate) {
          const amt = parseFloat(m[3].replace(/,/g, ''));
          if (amt > 0) dailies[currentDate] = (dailies[currentDate] || 0) + amt;
        }
      }
    } else {
      const dm = text.match(/SETTLEMENT\s+DATE\s+(\d{2})-(\d{2})-(\d{4})/i);
      if (dm) currentDate = `${dm[1]}/${dm[2]}`;
      const nm = text.match(/TOTAL\s+NET\s+AMT?\s*([\d,]+\.\d{2})/i);
      if (nm && currentDate) {
        const amt = parseFloat(nm[1].replace(/,/g, ''));
        if (amt > 0) dailies[currentDate] = (dailies[currentDate] || 0) + amt;
      }
    }
  }
  return dailies;
}

const OWN_COMPANY = /CHAI JEE KIONG(\s+TRADING)?\s*(SDN\.?\s*BHD\.?|SB\.?)?/i;
const TYPE_MAP = [
  { pattern: /^DUITNOW QR CR\s*/i, label: 'DUITNOW QR' },
  { pattern: /^DUITNOW TRSF CR\s*/i, label: 'DUITNOW TRSF' },
  { pattern: /^DUITNOW TRSF\s*/i, label: 'DUITNOW TRSF' },
  { pattern: /^DUITNOW CR\s*/i, label: 'DUITNOW' },
  { pattern: /^TSFR FUND CR[-\s]*(ATM\/EFT\s*)?/i, label: 'TSFR FUND' },
  { pattern: /^TRSF FUND CR[-\s]*(ATM\/EFT\s*)?/i, label: 'TRSF FUND' },
  { pattern: /^IBG CR\s*/i, label: 'IBG' },
  { pattern: /^IBFT CR\s*/i, label: 'IBFT' },
  { pattern: /^TRSF\s*/i, label: 'TRSF' },
  { pattern: /^ATM\/EFT\s*/i, label: 'ATM/EFT' },
];
function nameSignal(s) {
  if (/\b(MR|MRS|MS|MISS|MADAM|MDM|ENCIK|EN|PUAN|CIK|DR|DATO|DATIN|DATUK|TUNKU|TENGKU)\b/i.test(s)) return true;
  if (/\bTAN\s+SRI\b/i.test(s)) return true;
  if (/\b(BIN|BINTI|BT)\b/i.test(s)) return true;
  if (/\b[ASD]\/[LPO]\b/i.test(s)) return true;
  if (/\b(SDN|BHD|ENTERPRISE|TRADING|COMPANY|CORP|MOTOR|INDUSTRIES)\b/i.test(s)) return true;
  if (/\b(PERSATUAN|PERTUBUHAN|SYARIKAT|KOPERASI)\b/i.test(s)) return true;
  if (/\bS\/B\b/i.test(s)) return true;
  if (/\b(MUHAMMAD|MOHD|MOHAMAD|AHMAD|ABDUL|ABU|SITI|NUR|NURUL|NOOR|WAN|CHE|NIK)\b/i.test(s)) return true;
  if (/\b(TAN|LIM|LEE|WONG|CHAN|CHEN|NG|ONG|GOH|TEO|TEOH|LAU|CHIN|CHONG|SIM|YONG|FOO|KOH|CHIENG|TIONG|CHAI|LING|HENG|SIA|LOH|LO|HO|TAY|YEO|YEW|TOH|ANG|SOO|LIEW|PHANG|PANG|KONG|CHANG|CHEW|CHUA|KHOO|KHO|YAP|LEONG|LOKE|FONG|CHEAH|CHOO|CHU|BONG|NGAN|QUEK|SIEW|SOH|TENG|WEE|YEOH|YII|CHUNG|KANG|MAH|MOK|POH|TANG|THAM|TONG|YU|KUEH|LENG|WANG|LI|SAW|SONG|SU|HUNG|LAM|LOW|LIONG|NEO|SEOW|SOON|PEH|OOI|KUA|KOO|PHUA|LAI|CHIA|SEAH|LOK|KWOK|SNG|CHIU|CHOW|DING|ENG|SUNG|TAI|TAM|MAK)\b/i.test(s)) return true;
  if (/\b(RAJA|KUMAR|DEVI|NAIR|PILLAI|MUTHU|RAJAN|KRISHNAN)\b/i.test(s)) return true;
  return false;
}
function findName(remainder, contLines) {
  const candidates = [];
  if (remainder) {
    let cleaned = remainder.replace(/\bQR\s*(PAYMENT|PYMT)\b/gi, '').replace(/\bQR\b/gi, '').replace(/^\d+\s*/, '').trim();
    cleaned = cleaned.replace(OWN_COMPANY, '').trim();
    if (cleaned && hasName(cleaned)) candidates.push(cleaned);
  }
  for (let i = 0; i < contLines.length; i++) {
    let l = contLines[i].trim();
    if (!l || /^\d+$/.test(l)) continue;
    l = l.replace(OWN_COMPANY, '').trim();
    l = l.replace(/^QR\s*REF\s*NO:\s*\S*/i, '').trim();
    if (!l) continue;
    if (/^\d*\s*(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d*$/i.test(l)) continue;
    if (/^\d{8}[A-Z]{4}/.test(l)) continue;
    if (/^[0-9A-Fa-f]{10,}/.test(l)) continue;
    l = l.replace(/^[\dX]{6,}\s+/i, '').trim();
    l = l.replace(/\s+[\dX]{6,}$/i, '').trim();
    if (!l) continue;
    const alphaOnly = l.replace(/[^A-Za-z\s]/g, '').trim();
    if (!/\s/.test(alphaOnly) && /\d{6,}/.test(contLines[i])) continue;
    if (hasName(l)) candidates.push(l);
  }
  if (candidates.length === 0) return '';
  const signaled = candidates.find(c => nameSignal(c));
  return signaled || candidates[0];
}
function shortDesc(desc) {
  const lines = desc.split('\n');
  const first = lines[0];
  for (const { pattern, label } of TYPE_MAP) {
    const r = first.replace(pattern, '');
    if (r !== first) {
      const name = findName(r.trim(), lines.slice(1));
      return name ? label + ' ' + name : label;
    }
  }
  const contNames = lines.slice(1).map(l => l.trim()).filter(Boolean)
    .filter(l => !OWN_COMPANY.test(l)).filter(l => /[A-Za-z]{2,}/.test(l));
  if (contNames.length > 0) return first + ' ' + contNames[0];
  return first;
}
function hasName(short) {
  const stripped = short.replace(/\b(DUITNOW|DUITQR|QR|CR|DR|TSFR|FUND|IBG|IBFT|TRSF|PAYMENT|TRANSFER|MCHT|REF|NO|DEP|CASH|PYMT|ATM|EFT|CASA|TRF|CHEQUE|CHQ|CHOQ|PROCESS|PROCESSING|FEE|FEES|CHARGE|CHARGES|SST|SRS|COMMISSION|COMM|INTEREST|TAX|STAMP|DUTY|SERVICE|CLEARING|SETTLEMENT|GIRO|AUTOPAY|MANDATE|INSTALMENT|INST|PENALTY|REVERSAL|REFUND|REBATE|DIVIDEND|SALARY|INSURANCE|STANDING|INSTRUCTION|DEBIT|CREDIT|BALANCE|BAL|ACCOUNT|ACCT|ACC|TRANSACTION|TXN|ADJ|ADJUSTMENT)\d*/gi, '');
  const alpha = stripped.replace(/[^A-Za-z]/g, '');
  return alpha.length >= 2;
}

const CSS = `
.br-root{background:#fafafa;height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.br-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.br-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b}
.br-body{margin:0;padding:24px 48px;flex:1;overflow-y:auto}
.br-upload-area{max-width:480px;margin:0 auto 24px}
.br-upload{border:2px dashed #d4d4d8;border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all .15s}
.br-upload:hover{border-color:#2563eb;background:#eff6ff}
.br-upload.drag{border-color:#2563eb;background:#eff6ff}
.br-icon{font-size:32px;margin-bottom:8px}
.br-label{font-size:13px;font-weight:600;color:#18181b}
.br-hint{font-size:11px;color:#a1a1aa;margin-top:4px}
.br-privacy{font-size:10px;color:#a1a1aa;margin-top:8px;text-align:center}
.br-summary{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between}
.br-summary-left{flex:1}
.br-summary-title{font-size:13px;font-weight:700;color:#166534;margin:0 0 8px}
.br-summary-info{font-size:12px;color:#15803d;margin:0 0 4px}
.br-upload-new{padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #d4d4d8;background:#fff;color:#18181b}
.br-upload-new:hover{background:#f4f4f5}
.br-tabs{display:flex;gap:0;border-bottom:2px solid #e4e4e7;margin-bottom:16px}
.br-tab{padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:none;color:#71717a;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
.br-tab:hover{color:#18181b;background:#f4f4f5}
.br-tab.active{color:#18181b;border-bottom-color:#18181b}
.br-tab-count{font-size:11px;color:#a1a1aa;font-weight:400;margin-left:4px}
.br-section{border:1px solid #e4e4e7;border-radius:8px;overflow:hidden}
.br-body-inner{padding:14px 16px}
.br-table{width:100%;border-collapse:collapse;font-size:11px}
.br-table th{text-align:left;padding:6px 8px;border-bottom:2px solid #d4d4d8;font-weight:700;white-space:nowrap}
.br-table td{padding:6px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top}
.br-table tr:last-child td{border-bottom:none}
.br-dfirst td{border-top:2px solid #18181b}
.br-amt{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}
.br-total{font-weight:700;background:#f0fdf4;font-size:12px}
.br-total td{padding:8px;border-top:2px solid #15803d}
.br-check{width:14px;height:14px;cursor:pointer;accent-color:#18181b}
.br-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.br-tag.charge{background:#eff6ff;color:#2563eb}
.br-tag.loan{background:#fef2f2;color:#dc2626}
.br-desc{position:relative;max-width:340px;cursor:default}
.br-noname{color:#dc2626;font-weight:600;font-size:10px;margin-left:6px}
.br-desc:hover .br-tip{display:block}
.br-tip{display:none;position:absolute;right:0;top:100%;z-index:100;background:#18181b;color:#fff;padding:8px 12px;border-radius:6px;font-size:11px;white-space:pre-line;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,.15);pointer-events:none;line-height:1.5}
.br-daily{background:#eff6ff;font-weight:700;font-size:12px;border-left:2px solid #2563eb;color:#1e40af}
.br-daily.loan{background:#fef2f2;border-left-color:#dc2626;color:#dc2626}
.br-daily.mixed{background:#f5f5f4;border-left-color:#a1a1aa}
.br-clear{padding:8px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;border:2px solid #dc2626;background:#fef2f2;color:#dc2626;margin-left:auto}
.br-clear:hover{background:#dc2626;color:#fff}
.br-page{color:#71717a;font-size:11px}
.br-count{font-size:11px;color:#71717a;font-weight:400;margin-left:6px}
.br-error{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#dc2626}
.br-loading{font-size:12px;color:#71717a;margin:12px 0}
.br-btn{padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:#18181b;color:#fff;margin-top:8px}
.br-btn:hover{background:#27272a}
.br-dh{cursor:pointer;user-select:none;border-top:2px solid #18181b}
.br-dh:first-child{border-top:none}
.br-dh:hover{background:#f4f4f5}
.br-dh td{padding:8px;font-weight:700;font-size:12px;vertical-align:middle}
.br-dh .br-arrow{display:inline-block;width:14px;font-size:10px;color:#71717a;margin-right:4px;transition:transform .15s}
.br-dh .br-arrow.open{transform:rotate(90deg)}
.br-dh-count{font-size:10px;color:#71717a;font-weight:400;margin-left:8px}
@media print{.br-root{display:none}}
`;

const BR_VER = 14;
const LS_BR = 'br_saved';
function loadSaved() {
  try {
    const s = localStorage.getItem(LS_BR);
    if (s) { const d = JSON.parse(s); if (d && d.v === BR_VER) return d; }
    localStorage.removeItem(LS_BR);
  } catch {} return null;
}

export default function BankRecon() {
  const saved = useRef(loadSaved());
  const [result, setResult] = useState(saved.current?.result || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [excluded, setExcluded] = useState(() => new Set(saved.current?.excluded || []));
  const [collapsed, setCollapsed] = useState(() => new Set(saved.current?.collapsed || []));
  const [activeTab, setActiveTab] = useState('toKeyed');
  const fileRef = useRef(null);
  const [posData, setPosData] = useState({});
  const [posUploadMsg, setPosUploadMsg] = useState(null);
  const spayRef = useRef(null);
  const cpRef = useRef(null);
  const mkRef = useRef(null);
  const loadPosData = () => { try { const s = localStorage.getItem('br_pos_daily'); setPosData(s ? JSON.parse(s) : {}); } catch { setPosData({}); } };
  const handlePosUpload = async (type, parser, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPosUploadMsg(null);
    try {
      const dailies = await parser(await file.arrayBuffer());
      const count = Object.keys(dailies).length;
      if (!count) { setPosUploadMsg({ text: `No daily data found in ${file.name}`, error: true }); return; }
      savePOSDailiesBR(type, 'HQ', dailies);
      loadPosData();
      setPosUploadMsg({ text: `✓ ${type}: ${count} dates extracted from ${file.name}` });
    } catch {
      setPosUploadMsg({ text: `Could not parse ${file.name}`, error: true });
    }
  };

  useEffect(() => {
    if (activeTab === 'posBank') loadPosData();
  }, [activeTab]);

  useEffect(() => {
    if (result) {
      localStorage.setItem(LS_BR, JSON.stringify({ v: BR_VER, result, excluded: [...excluded], collapsed: [...collapsed] }));
    }
  }, [result, excluded, collapsed]);

  const clearAll = () => {
    localStorage.removeItem(LS_BR);
    setResult(null);
    setExcluded(new Set());
    setCollapsed(new Set());
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    setExcluded(new Set());
    setCollapsed(new Set());
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const { txns, numPages } = await parsePBBStatement(buf);
      if (!txns.length) {
        setError('No transactions found in this PDF. Make sure it is a Public Bank statement.');
      } else {
        const classified = classifyBankTxns(txns);
        setResult({ txns, ...classified, totalTxns: txns.length, totalPages: numPages });
      }
    } catch (err) {
      setError('Could not read PDF: ' + (err.message || 'unknown error'));
    }
    setLoading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const toggleExclude = (idx) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleCollapse = (dateKey) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  };

  const fmtAmt = (n) => n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  const onlineTotal = result ? result.onlineTransfers.reduce((s, t, i) => s + (excluded.has(i) ? 0 : t.credit), 0) : 0;

  return (
    <div className="br-root">
      <style>{CSS}</style>
      <div className="br-bar">
        <h1>BANK RECONCILIATION</h1>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 400 }}>Upload Public Bank statement · All processing in browser · Nothing sent to server</span>
        {result && <button className="br-clear" onClick={() => { if (window.confirm('Clear all bank recon data? This cannot be undone.')) clearAll(); }}>Clear All Data</button>}
      </div>
      <div className="br-body">
        {!result && (
          <div className="br-upload-area">
            <div
              className={`br-upload${dragging ? ' drag' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <div className="br-icon">🏦</div>
              <div className="br-label">Click to upload or drag & drop</div>
              <div className="br-hint">Public Bank statement PDF</div>
            </div>
            <div className="br-privacy">🔒 100% browser-side — your bank data never leaves this device</div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
        />

        {loading && <div className="br-loading">Reading bank statement...</div>}
        {error && <div className="br-error">{error}</div>}

        {result && (
          <>
            <div className="br-summary">
              <div className="br-summary-left">
                <div className="br-summary-title">Statement parsed</div>
                <div className="br-summary-info">{result.totalTxns} transactions across {result.totalPages} pages</div>
                <div className="br-summary-info">
                  Found: {result.toKeyed.length} to key · {result.onlineTransfers.length} POS DuitNow · {result.depCash.length} cash deposits
                </div>
              </div>
              <button className="br-upload-new" onClick={() => fileRef.current?.click()}>Upload new</button>
            </div>

            <div className="br-tabs">
              <button className={`br-tab${activeTab==='toKeyed'?' active':''}`} onClick={()=>setActiveTab('toKeyed')}>To Key<span className="br-tab-count">({result.toKeyed.length})</span></button>
              <button className={`br-tab${activeTab==='depCash'?' active':''}`} onClick={()=>setActiveTab('depCash')}>Cash Deposits<span className="br-tab-count">({result.depCash.length})</span></button>
              <button className={`br-tab${activeTab==='online'?' active':''}`} onClick={()=>setActiveTab('online')}>POS DuitNow<span className="br-tab-count">({result.onlineTransfers.length})</span></button>
              <button className={`br-tab${activeTab==='posBank'?' active':''}`} onClick={()=>setActiveTab('posBank')}>POS vs Bank</button>
            </div>

            {activeTab==='toKeyed' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.toKeyed.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No bank charges or loan payments found</div>
                  ) : (() => {
                    const _tkHelp = <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Captures DEBIT matching PROCESS FEE, HANDLING CHARGE, AUDIT CONFIRMATION, AUTOMATED LOAN. <span style={{color:'#2563eb'}}>Charges in blue</span>, <span style={{color:'#dc2626'}}>Loan in red</span>.</div>;
                    const groups = groupByDate(result.toKeyed);
                    const chargeTotal = result.toKeyed.filter(t => t.type !== 'Loan Payment').reduce((s, t) => s + (t.debit || t.credit || 0), 0);
                    const loanTotal = result.toKeyed.filter(t => t.type === 'Loan Payment').reduce((s, t) => s + (t.debit || t.credit || 0), 0);
                    return (<>
                    {_tkHelp}
                    <table className="br-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Pg</th><th className="br-amt">Debit</th><th className="br-amt">Daily Total</th></tr></thead>
                      <tbody>
                        {groups.map(g => {
                          const ck = 'tk_' + g.date;
                          const isCollapsed = collapsed.has(ck);
                          const loanAmt = g.items.filter(({txn}) => txn.type === 'Loan Payment').reduce((s, {txn}) => s + (txn.debit || txn.credit || 0), 0);
                          const chargeAmt = g.items.filter(({txn}) => txn.type !== 'Loan Payment').reduce((s, {txn}) => s + (txn.debit || txn.credit || 0), 0);
                          const hasLoan = loanAmt > 0;
                          const hasCharge = chargeAmt > 0;
                          const dailyCell = hasLoan && hasCharge ? (
                            <>
                              <div style={{color:'#dc2626',fontSize:11,lineHeight:'1.4'}}>L {fmtAmt(loanAmt)}</div>
                              <div style={{color:'#2563eb',fontSize:11,lineHeight:'1.4',borderTop:'1px dashed #d4d4d8',marginTop:2,paddingTop:2}}>C {fmtAmt(chargeAmt)}</div>
                            </>
                          ) : fmtAmt(loanAmt + chargeAmt);
                          const dailyClass = 'br-amt br-daily' + (hasLoan && hasCharge ? ' mixed' : hasLoan ? ' loan' : '');
                          return isCollapsed ? (
                            <tr key={ck} className="br-dh" onClick={() => toggleCollapse(ck)}>
                              <td><span className="br-arrow">▶</span>{g.date}</td>
                              <td colSpan={3}><span className="br-dh-count">{g.items.length} transactions</span></td>
                              <td className="br-amt">{fmtAmt(loanAmt + chargeAmt)}</td>
                              <td className={dailyClass}>{dailyCell}</td>
                            </tr>
                          ) : (
                            g.items.map(({txn: t, idx: i}, j) => {
                              const isLoan = t.type === 'Loan Payment';
                              const isMixed = hasLoan && hasCharge;
                              const isFirstOfType = j === g.items.findIndex(({txn: x}) => (x.type === 'Loan Payment') === isLoan);
                              let dtClass = 'br-amt br-daily';
                              let dtContent = null;
                              if (isMixed) {
                                dtClass += isLoan ? ' loan' : '';
                                if (isFirstOfType) dtContent = (isLoan ? 'L ' : 'C ') + fmtAmt(isLoan ? loanAmt : chargeAmt);
                              } else {
                                if (hasLoan) dtClass += ' loan';
                                if (j === 0) dtContent = fmtAmt(loanAmt + chargeAmt);
                              }
                              return (
                              <tr key={i} className={j === 0 ? 'br-dfirst' : ''} style={{ background: isLoan ? '#fef2f2' : '#eff6ff' }}>
                                <td style={{ whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => toggleCollapse(ck)}>{j === 0 && <span className="br-arrow open">▶</span>}{t.date}</td>
                                <td className="br-desc">{t.description}</td>
                                <td><span className={`br-tag ${isLoan ? 'loan' : 'charge'}`}>{t.type}</span></td>
                                <td className="br-page">p{t.page}</td>
                                <td className="br-amt">{fmtAmt(t.debit || t.credit)}</td>
                                <td className={dtClass}>{dtContent}</td>
                              </tr>);
                            })
                          );
                        })}
                        <tr className="br-total">
                          <td colSpan={4}>Bank Charges Total</td>
                          <td className="br-amt">{fmtAmt(chargeTotal)}</td>
                          <td></td>
                        </tr>
                        {loanTotal > 0 && <tr className="br-total">
                          <td colSpan={4}>Loan Payments Total</td>
                          <td className="br-amt">{fmtAmt(loanTotal)}</td>
                          <td></td>
                        </tr>}
                      </tbody>
                    </table></>);
                  })()}
                </div>
              </div>
            )}

            {activeTab==='depCash' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.depCash.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No DEP-CASH entries found</div>
                  ) : (() => {
                    const groups = groupByDate(result.depCash);
                    return (<>
                    <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Captures every CREDIT matching DEP-CASH.</div>
                    <table className="br-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Pg</th><th className="br-amt">Amount</th><th className="br-amt">Daily Total</th></tr></thead>
                      <tbody>
                        {groups.map(g => {
                          const ck = 'dc_' + g.date;
                          const isCollapsed = collapsed.has(ck);
                          const dailyTotal = g.items.reduce((s, {txn}) => s + txn.credit, 0);
                          return isCollapsed ? (
                            <tr key={ck} className="br-dh" onClick={() => toggleCollapse(ck)}>
                              <td><span className="br-arrow">▶</span>{g.date}</td>
                              <td colSpan={2}><span className="br-dh-count">{g.items.length} deposits</span></td>
                              <td className="br-amt">{fmtAmt(dailyTotal)}</td>
                              <td className="br-amt br-daily">{fmtAmt(dailyTotal)}</td>
                            </tr>
                          ) : (
                            g.items.map(({txn: t, idx: i}, j) => (
                              <tr key={i} className={j === 0 ? 'br-dfirst' : ''}>
                                <td style={{ whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => toggleCollapse(ck)}>{j === 0 && <span className="br-arrow open">▶</span>}{t.date}</td>
                                <td className="br-desc">{t.description}</td>
                                <td className="br-page">p{t.page}</td>
                                <td className="br-amt">{fmtAmt(t.credit)}</td>
                                <td className="br-amt br-daily">{j === 0 && fmtAmt(dailyTotal)}</td>
                              </tr>
                            ))
                          );
                        })}
                        <tr className="br-total">
                          <td colSpan={3}>Total ({result.depCash.length} deposits)</td>
                          <td className="br-amt">{fmtAmt(result.depCash.reduce((s, t) => s + t.credit, 0))}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table></>);
                  })()}
                </div>
              </div>
            )}

            {activeTab==='online' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {result.onlineTransfers.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>No POS DuitNow transfers found</div>
                  ) : (() => {
                    const groups = groupByDate(result.onlineTransfers);
                    return (
                    <>
                      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Extracts every CREDIT matching DUITNOW QR CR, TSFR FUND CR etc. Untick non-retail to exclude from total.</div>
                      <table className="br-table">
                        <thead><tr><th style={{ width: 28 }}>✓</th><th>Date</th><th>Description</th><th>Pg</th><th className="br-amt">Amount</th><th className="br-amt">Daily Total</th></tr></thead>
                        <tbody>
                          {groups.map(g => {
                            const ck = 'on_' + g.date;
                            const isCollapsed = collapsed.has(ck);
                            const tickedCount = g.items.filter(({idx}) => !excluded.has(idx)).length;
                            const dailyTotal = g.items.reduce((s, {txn, idx}) => s + (excluded.has(idx) ? 0 : txn.credit), 0);
                            return isCollapsed ? (
                              <tr key={ck} className="br-dh" onClick={() => toggleCollapse(ck)}>
                                <td colSpan={2}><span className="br-arrow">▶</span>{g.date}</td>
                                <td colSpan={2}><span className="br-dh-count">{tickedCount} of {g.items.length} ticked</span></td>
                                <td className="br-amt">{fmtAmt(dailyTotal)}</td>
                                <td className="br-amt br-daily">{fmtAmt(dailyTotal)}</td>
                              </tr>
                            ) : (
                              g.items.map(({txn: t, idx: i}, j) => (
                                <tr key={i} className={j === 0 ? 'br-dfirst' : ''} style={excluded.has(i) ? { opacity: 0.4, textDecoration: 'line-through' } : {}}>
                                  <td><input type="checkbox" className="br-check" checked={!excluded.has(i)} onChange={() => toggleExclude(i)} /></td>
                                  <td style={{ whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => toggleCollapse(ck)}>{j === 0 && <span className="br-arrow open">▶</span>}{t.date}</td>
                                  <td className="br-desc">{(sd => <>{sd}{!hasName(sd) && <span className="br-noname">⚠ NO NAME</span>}</>)(shortDesc(t.description))}<div className="br-tip">{t.description.split('\n').map(l => OWN_COMPANY.test(l) ? l.replace(OWN_COMPANY, '').trim() : l).filter(l => l.trim()).join('\n')}</div></td>
                                  <td className="br-page">p{t.page}</td>
                                  <td className="br-amt">{fmtAmt(t.credit)}</td>
                                  <td className="br-amt br-daily">{j === 0 && fmtAmt(dailyTotal)}</td>
                                </tr>
                              ))
                            );
                          })}
                          <tr className="br-total">
                            <td colSpan={4}>Total ({result.onlineTransfers.length - excluded.size} of {result.onlineTransfers.length} included)</td>
                            <td className="br-amt">{fmtAmt(onlineTotal)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </>);
                  })()}
                </div>
              </div>
            )}

            {activeTab==='posBank' && (
              <div className="br-section">
                <div className="br-body-inner">
                  {(() => {
                    const bankMatch = matchBankCredits(result.txns);
                    const types = [
                      { key: 'spay', label: 'Sarawak Pay (SPAY)', keyword: 'SILICONNET' },
                      { key: 'cardpay', label: 'Cardpay (GHL)', keyword: 'GHL + outlet ID' },
                      { key: 'mykasih', label: 'MyKasih', keyword: 'MYKASIH FOUNDATION' },
                    ];
                    const hasPOS = posData.spay || posData.cardpay || posData.mykasih;
                    return (<>
                      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 12 }}>
                        Compares POS merchant daily settlements against bank CREDIT entries by keyword.
                        <button style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', border: '1px solid #d4d4d8', borderRadius: 4, background: '#fff', cursor: 'pointer' }} onClick={loadPosData}>↻ Refresh POS data</button>
                      </div>
                      <div style={{ marginBottom: 12, padding: '10px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e4e4e7' }}>
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Upload HQ Merchant Reports (PDF only)</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => spayRef.current?.click()} style={{ padding: '6px 12px', border: '1px solid #d4d4d8', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📄 Spay HQ <span style={{ color: '#71717a', fontWeight: 400 }}>(M100006137)</span></button>
                          <button onClick={() => cpRef.current?.click()} style={{ padding: '6px 12px', border: '1px solid #d4d4d8', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📄 Cardpay HQ <span style={{ color: '#71717a', fontWeight: 400 }}>(162259)</span></button>
                          <button onClick={() => mkRef.current?.click()} style={{ padding: '6px 12px', border: '1px solid #d4d4d8', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📄 MyKasih HQ <span style={{ color: '#71717a', fontWeight: 400 }}>(M9610)</span></button>
                        </div>
                        <input ref={spayRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => handlePosUpload('spay', parseSpayOutputPDF, e)} />
                        <input ref={cpRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => handlePosUpload('cardpay', parseCardpayOutputPDF, e)} />
                        <input ref={mkRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => handlePosUpload('mykasih', parseMyKasihOutputPDF, e)} />
                        {posUploadMsg && <div style={{ fontSize: 11, marginTop: 6, color: posUploadMsg.error ? '#dc2626' : '#166534' }}>{posUploadMsg.text}</div>}
                      </div>
                      {hasPOS ? (
                        <div style={{ fontSize: 11, color: '#166534', background: '#f0fdf4', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
                          POS data loaded: {[
                            posData.spay && `Spay (${Object.keys(posData.spay).join(', ')})`,
                            posData.cardpay && `Cardpay (${Object.keys(posData.cardpay).join(', ')})`,
                            posData.mykasih && `MyKasih (${Object.keys(posData.mykasih).join(', ')})`,
                          ].filter(Boolean).join(' · ')}
                          <button style={{ marginLeft: 12, fontSize: 10, padding: '2px 8px', border: '1px solid #fecaca', borderRadius: 4, background: '#fff', color: '#dc2626', cursor: 'pointer' }}
                            onClick={() => { if (window.confirm('Clear all POS daily data?')) { localStorage.removeItem('br_pos_daily'); setPosData({}); } }}>Clear POS data</button>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: '#d97706', background: '#fefce8', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
                          ⚠ No POS data yet — upload your merchant report PDFs above, or use the POS Merchant Report page.
                        </div>
                      )}
                      {types.map(({ key, label, keyword }) => {
                        const posDailies = sumPOSOutlets(posData[key]);
                        const bankDailies = bankMatch[key];
                        const batchLookup = findBatchMatches(posDailies, bankDailies);
                        const allDates = [...new Set([...Object.keys(posDailies), ...Object.keys(bankDailies)])].sort((a, b) => {
                          const [da, ma] = a.split('/').map(Number);
                          const [db, mb] = b.split('/').map(Number);
                          return (ma - mb) || (da - db);
                        });
                        if (!allDates.length) return null;
                        const totalPOS = Object.values(posDailies).reduce((s, v) => s + v, 0);
                        const totalBank = Object.values(bankDailies).reduce((s, v) => s + v, 0);
                        return (
                          <div key={key} style={{ marginBottom: 20 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, borderBottom: '1px solid #e4e4e7', paddingBottom: 4 }}>{label} <span style={{ fontSize: 11, color: '#71717a', fontWeight: 400 }}>bank keyword: {keyword}</span></div>
                            <table className="br-table">
                              <thead>
                                <tr><th>Date</th><th className="br-amt">POS Amount</th><th className="br-amt">Bank Credit</th><th className="br-amt">Diff</th><th>Status</th></tr>
                              </thead>
                              <tbody>
                                {allDates.map(d => {
                                  const pos = posDailies[d] || 0;
                                  const bank = bankDailies[d] || 0;
                                  const diff = Math.abs(pos - bank);
                                  const match = diff < 0.02;
                                  const posOnly = pos > 0 && bank === 0;
                                  const bankOnly = bank > 0 && pos === 0;
                                  const batch = batchLookup[d];
                                  return (
                                    <tr key={d} style={{ background: match || batch ? '#f0fdf4' : posOnly || bankOnly ? '#fefce8' : '#fef2f2' }}>
                                      <td>{d}</td>
                                      <td className="br-amt">{pos ? fmtAmt(pos) : <span style={{ color: '#a1a1aa' }}>—</span>}</td>
                                      <td className="br-amt">{bank ? fmtAmt(bank) : <span style={{ color: '#a1a1aa' }}>—</span>}</td>
                                      <td className="br-amt" style={{ color: match || batch ? '#166534' : '#dc2626', fontWeight: 600 }}>{match ? '0.00' : fmtAmt(diff)}</td>
                                      <td style={{ fontSize: 11 }}>{match ? <span style={{ color: '#166534' }}>✓ Match</span> : batch ? <span style={{ color: '#166534' }}>{batch.type === 'pos' ? `✓ Batched → ${batch.bankDate}` : `✓ Batch (${batch.posDates.join('+')})`}</span> : posOnly ? <span style={{ color: '#d97706' }}>⚠ No bank credit</span> : bankOnly ? <span style={{ color: '#d97706' }}>⚠ No POS data</span> : <span style={{ color: '#dc2626' }}>✗ Mismatch</span>}</td>
                                    </tr>
                                  );
                                })}
                                <tr className="br-total">
                                  <td>Total</td>
                                  <td className="br-amt">{fmtAmt(totalPOS)}</td>
                                  <td className="br-amt">{fmtAmt(totalBank)}</td>
                                  <td className="br-amt" style={{ color: Math.abs(totalPOS - totalBank) < 0.02 ? '#166534' : '#dc2626' }}>{fmtAmt(Math.abs(totalPOS - totalBank))}</td>
                                  <td>{Math.abs(totalPOS - totalBank) < 0.02 ? <span style={{ color: '#166534' }}>✓ Balanced</span> : <span style={{ color: '#dc2626' }}>✗ {fmtAmt(Math.abs(totalPOS - totalBank))} difference</span>}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                    </>);
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

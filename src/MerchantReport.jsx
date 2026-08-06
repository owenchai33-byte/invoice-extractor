import { useState, useRef } from 'react';
import * as XLSXStyle from 'xlsx-js-style';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const MON_S = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

const SPAY_OUTLETS = {
  'M100006137': 'HQ',
  'M100006143': 'KC',
  'M100006140': 'ST',
  'M100006142': 'TH',
};

const SPAY_KEEP = [
  'Serial No.','Merchant ID','Merchant Name','Settlement Date','Settlement No.',
  'Settlement Bank','Bank Account','Transaction Amount','Platform Amount',
  'Institution Amount','Merchant Amount','Actual Amount','Refund Amount',
  'Settlement Amount','Merchant Fee','User Fee','Status','Status Date'
];
const SPAY_ALWAYS_HIDE = new Set();
const SPAY_NUMERIC = new Set([
  'Transaction Amount','Platform Amount','Institution Amount','Merchant Amount',
  'Actual Amount','Refund Amount','Settlement Amount','Merchant Fee','User Fee'
]);
const SPAY_SUM = new Set([
  'Transaction Amount','Refund Amount','Settlement Amount','Merchant Fee',
  'Platform Amount','Institution Amount','Merchant Amount','Actual Amount','User Fee'
]);

function detectMonth(rows) {
  for (const r of rows) {
    const d = r['Settlement Date'];
    if (d && typeof d === 'string') {
      const m = d.trim().match(/^(\d{4})-(\d{2})/);
      if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) - 1 };
    }
  }
  return { year: new Date().getFullYear(), month: new Date().getMonth() };
}

function parseNum(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '-' || s === '') return 0;
  return parseFloat(s) || 0;
}

function processSpay(rawRows) {
  const headers = Object.keys(rawRows[0] || {});
  const numericCols = headers.filter(h => SPAY_NUMERIC.has(h));
  const allZeroCols = new Set();
  numericCols.forEach(col => {
    const allZero = rawRows.every(r => parseNum(r[col]) === 0);
    if (allZero) allZeroCols.add(col);
  });
  const keepCols = SPAY_KEEP.filter(h => headers.includes(h) && !allZeroCols.has(h));
  const { year, month } = detectMonth(rawRows);
  const allMids = new Set(rawRows.map(r => SPAY_OUTLETS[(r['Merchant ID'] || '').trim()]).filter(Boolean));
  const warnings = [];
  if (allMids.size > 1) {
    warnings.push(`Mixed outlets detected: ${[...allMids].join(', ')}. Please check your file — each file should contain one outlet only.`);
  }
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const wrongDates = rawRows.filter(r => {
    const d = r['Settlement Date'];
    if (!d || typeof d !== 'string') return false;
    const m = d.trim().match(/^(\d{4})-(\d{2})/);
    if (!m) return false;
    const dy = parseInt(m[1]), dm = parseInt(m[2]) - 1;
    return !((dm === month && dy === year) || (dm === prevMonth && dy === prevYear));
  });
  if (wrongDates.length > 0) {
    const months = [...new Set(wrongDates.map(r => {
      const m = r['Settlement Date'].trim().match(/^(\d{4})-(\d{2})/);
      return `${MON_S[parseInt(m[2]) - 1]}'${m[1].slice(-2)}`;
    }))];
    warnings.push(`Found dates from unexpected months: ${months.join(', ')}. Please check these entries.`);
  }
  const mid = rawRows[0]?.['Merchant ID'] || '';
  const outlet = SPAY_OUTLETS[mid.trim()] || 'HQ';
  const title = `${outlet} SARAWAK PAY ${MONTHS[month]} ${year}`;
  const dataRows = rawRows.map(r => {
    return keepCols.map(col => {
      let v = r[col];
      if (SPAY_NUMERIC.has(col)) {
        const n = parseNum(v);
        if (n === 0) return '-';
        return n;
      }
      return v || '';
    });
  });
  const sums = keepCols.map(col => {
    if (SPAY_SUM.has(col) && !allZeroCols.has(col)) {
      const total = rawRows.reduce((s, r) => s + parseNum(r[col]), 0);
      return Math.round(total * 100) / 100;
    }
    return null;
  });

  return { keepCols, title, dataRows, sums, year, month, outlet, warnings };
}

function buildSpayPDF(keepCols, title, dataRows, sums, month, year, outlet) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bolditalic');
  const cjk = 'C.J.K.';
  const cjkW = doc.getTextWidth(cjk);
  doc.setFont('helvetica', 'bold');
  const rest = ' CHAI JEE KIONG TRADING SDN BHD';
  const restW = doc.getTextWidth(rest);
  const totalW = cjkW + restW;
  const startX = (pageW - totalW) / 2;
  doc.setFont('helvetica', 'bolditalic');
  doc.text(cjk, startX, 28);
  doc.setFont('helvetica', 'bold');
  doc.text(rest, startX + cjkW, 28);

  doc.setFontSize(10);
  doc.text(title, pageW / 2, 44, { align: 'center' });

  const fmtNum = (v) => {
    if (v == null || v === '' || v === '-') return '-';
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    if (isNaN(n) || n === 0) return '-';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const body = dataRows.map((row, ri) =>
    row.map((v, ci) => typeof v === 'number' ? fmtNum(v) : (v || ''))
  );

  const sumRowData = sums.map((v, ci) => v !== null ? fmtNum(v) : '');
  body.push(sumRowData);

  const lastDataIdx = dataRows.length;

  autoTable(doc, {
    startY: 52,
    head: [keepCols],
    body,
    theme: 'grid',
    styles: { fontSize: 5.5, cellPadding: 2, lineColor: [170, 170, 170], lineWidth: 0.5, font: 'helvetica' },
    headStyles: { fillColor: [233, 233, 233], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', fontSize: 5.5 },
    columnStyles: keepCols.reduce((acc, h, i) => {
      if (SPAY_NUMERIC.has(h)) acc[i] = { halign: 'right' };
      return acc;
    }, {}),
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === lastDataIdx) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.lineWidth = { top: 1, bottom: 0.5, left: 0.5, right: 0.5 };
      }
    },
    margin: { left: 20, right: 20 },
  });

  const fname = `SPAY ${outlet || 'HQ'} - ${MON_S[month]}'${String(year).slice(-2)}.pdf`;
  doc.save(fname);
}

const CP_OUTLETS = ['HQ', 'KC', 'ST', 'TH'];
const CP_OUTLET_MAP = {
  '162259': 'HQ',
  '162250': 'KC',
  '162260': 'ST',
  '162249': 'TH',
};

async function processCardPayZip(arrayBuffer) {
  const pdfs = [];
  const detectedOutlets = new Set();
  async function collectPDFs(z) {
    for (const [path, f] of Object.entries(z.files)) {
      if (f.dir) continue;
      const name = path.split('/').pop();
      if (name.endsWith('.zip')) {
        const nested = await JSZip.loadAsync(await f.async('arraybuffer'));
        await collectPDFs(nested);
      } else if (/^StatementOfAccount.*\.pdf$/i.test(name)) {
        const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '0000-00-00';
        const midMatch = name.match(/_(\d{6})\.pdf$/);
        if (midMatch && CP_OUTLET_MAP[midMatch[1]]) {
          detectedOutlets.add(CP_OUTLET_MAP[midMatch[1]]);
        }
        pdfs.push({ name, date, buf: await f.async('arraybuffer') });
      }
    }
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  await collectPDFs(zip);
  pdfs.sort((a, b) => a.date.localeCompare(b.date));
  let year = new Date().getFullYear(), month = new Date().getMonth();
  if (pdfs.length > 0) {
    const m = pdfs[0].date.match(/^(\d{4})-(\d{2})/);
    if (m) { year = parseInt(m[1]); month = parseInt(m[2]) - 1; }
  }
  const warnings = [];
  if (detectedOutlets.size > 1) {
    warnings.push(`Mixed outlets detected: ${[...detectedOutlets].join(', ')}. Please check your zip — each zip should contain one outlet only.`);
  }
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const wrongDatePdfs = pdfs.filter(p => {
    const m = p.date.match(/^(\d{4})-(\d{2})/);
    if (!m) return false;
    const py = parseInt(m[1]), pm = parseInt(m[2]) - 1;
    return !((pm === month && py === year) || (pm === prevMonth && py === prevYear));
  });
  if (wrongDatePdfs.length > 0) {
    const months = [...new Set(wrongDatePdfs.map(p => {
      const m = p.date.match(/^(\d{4})-(\d{2})/);
      return `${MON_S[parseInt(m[2]) - 1]}'${m[1].slice(-2)}`;
    }))];
    warnings.push(`Found dates from unexpected months: ${months.join(', ')}. Please check these entries.`);
  }
  const outlet = detectedOutlets.size > 0 ? [...detectedOutlets][0] : 'HQ';
  return { pdfs, year, month, outlet, warnings };
}

async function mergeCardPayPDFs(pdfs, outlet, month, year) {
  const merged = await PDFDocument.create();
  for (const p of pdfs) {
    const doc = await PDFDocument.load(p.buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(page => merged.addPage(page));
  }
  const bytes = await merged.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CARDPAY D ${outlet} - ${MON_S[month]}'${String(year).slice(-2)}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const MK_OUTLET_MAP = {
  'M0000009610': 'HQ', 'M9610': 'HQ',
  'M0000009611': 'KC',  'M9611': 'KC',
  'M0000009612': 'ST',  'M9612': 'ST',
  'M0000009613': 'TH',  'M9613': 'TH',
};

function parseMkDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) {
    const mo = parseInt(m[2]) - 1;
    if (mo >= 0 && mo <= 11) return { day: parseInt(m[1]), month: mo, year: parseInt(m[3]) };
  }
  return null;
}

async function processMyKasihZip(arrayBuffer) {
  const excels = [];
  const pdfs = [];
  const detectedOutlets = new Set();
  const allDates = [];

  async function collect(z) {
    for (const [path, f] of Object.entries(z.files)) {
      if (f.dir) continue;
      const name = path.split('/').pop();
      if (name.endsWith('.zip')) {
        const nested = await JSZip.loadAsync(await f.async('arraybuffer'));
        await collect(nested);
      } else if (/\.xlsx?$/i.test(name) && /^INV/i.test(name)) {
        const dateMatch = name.match(/(\d{8})\./);
        const date = dateMatch ? dateMatch[1] : '00000000';
        const buf = await f.async('arraybuffer');
        const wb = XLSXStyle.read(new Uint8Array(buf), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSXStyle.utils.sheet_to_json(ws, { header: 1 });
        const midRow = rows.find(r => r[0] === 'MID');
        if (midRow && midRow[2] && MK_OUTLET_MAP[midRow[2]]) {
          detectedOutlets.add(MK_OUTLET_MAP[midRow[2]]);
        }
        rows.forEach(r => {
          if (r[2] && typeof r[2] === 'string') {
            const d = parseMkDate(r[2]);
            if (d) allDates.push(d);
          }
        });
        excels.push({ name, date, rows });
      } else if (/\.pdf$/i.test(name)) {
        const dateMatch = name.match(/(\d{8})\./);
        const date = dateMatch ? dateMatch[1] : '00000000';
        pdfs.push({ name, date, buf: await f.async('arraybuffer') });
      }
    }
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  await collect(zip);
  excels.sort((a, b) => a.date.localeCompare(b.date));
  pdfs.sort((a, b) => a.date.localeCompare(b.date));

  let year = new Date().getFullYear(), month = new Date().getMonth();
  if (excels.length > 0) {
    const m = excels[0].date.match(/^(\d{4})(\d{2})/);
    if (m) { year = parseInt(m[1]); month = parseInt(m[2]) - 1; }
  }

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const wrongMonthDates = allDates.filter(d =>
    d.month >= 0 && d.month <= 11 &&
    !((d.month === month && d.year === year) || (d.month === prevMonth && d.year === prevYear))
  );
  const warnings = [];
  if (detectedOutlets.size > 1) {
    warnings.push(`Mixed outlets detected: ${[...detectedOutlets].join(', ')}. Please check your zip — each zip should contain one outlet only.`);
  }
  if (wrongMonthDates.length > 0) {
    const months = [...new Set(wrongMonthDates.map(d => `${MON_S[d.month] || '??'}'${String(d.year).slice(-2)}`))];
    warnings.push(`Found dates from unexpected months: ${months.join(', ')}. Please check these entries.`);
  }

  for (const excel of excels) {
    const rows = excel.rows;
    const dataHeaderIdx = rows.findIndex(r => r[0] === 'NO');
    if (dataHeaderIdx < 0) continue;
    const allDataRows = rows.slice(dataHeaderIdx + 1).filter(r => r.length > 0 && r.some(v => v != null && v !== ''));
    const txnRows = allDataRows.filter(r => !isNaN(parseInt(r[0])));
    const totalRow = allDataRows.find(r => r.some(v => typeof v === 'string' && /^TOTAL GROSS AMT$/i.test(String(v).trim())));
    if (!totalRow) continue;
    const txnSum = txnRows.reduce((sum, r) => sum + (typeof r[13] === 'number' ? r[13] : 0), 0);
    const grossFilled = totalRow.filter(v => v != null && v !== '');
    const grossAmt = grossFilled.length > 0 ? grossFilled[grossFilled.length - 1] : null;
    if (typeof grossAmt === 'number' && Math.abs(txnSum - grossAmt) > 0.01) {
      const settleRow = rows.find(r => r[0] === 'SETTLEMENT DATE');
      const period = settleRow ? String(settleRow[2] || settleRow[1] || '').trim() : excel.name;
      warnings.push(`Amount mismatch in ${period}: daily sum ${txnSum.toFixed(2)} ≠ TOTAL GROSS AMT ${grossAmt.toFixed(2)}`);
    }
  }

  const outlet = detectedOutlets.size > 0 ? [...detectedOutlets][0] : 'HQ';
  return { excels, pdfs, year, month, outlet, warnings };
}

function buildMyKasihExcelPDF(excels, outlet, month, year) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let firstPage = true;

  for (const excel of excels) {
    const rows = excel.rows;
    const headerRows = rows.slice(0, 4);
    const dataHeaderRow = rows.find(r => r[0] === 'NO');
    const dataHeaderIdx = rows.indexOf(dataHeaderRow);
    if (dataHeaderIdx < 0) continue;

    const allDataRows = rows.slice(dataHeaderIdx + 1).filter(r => r.length > 0 && r.some(v => v != null && v !== ''));
    const txnRows = allDataRows.filter(r => !isNaN(parseInt(r[0])));
    const totalRows = allDataRows.filter(r => isNaN(parseInt(r[0])) && r.some(v => typeof v === 'string' && /TOTAL|LESS|NET/i.test(v)));

    if (!firstPage) doc.addPage();
    firstPage = false;

    let y = 10;
    headerRows.forEach(r => {
      const text = r.filter(v => v != null).join('  ');
      if (text.trim()) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(text, 105, y, { align: 'center' });
        y += 5;
      }
    });
    y += 2;

    const cols = ['NO', 'MERCHANT NAME', 'TXN DATE', 'SETTLE DATE', 'TID', 'BTH', 'APPR CODE', 'STAN #', 'GROSS AMT'];

    const grouped = new Map();
    txnRows.forEach(r => {
      const dateKey = String(r[2] || 'Unknown').substring(0, 10);
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey).push(r);
    });

    const sortedKeys = [...grouped.keys()].sort((a, b) => {
      const [da, ma, ya] = a.split('-').map(Number);
      const [db, mb, yb] = b.split('-').map(Number);
      return (ya - yb) || (ma - mb) || (da - db);
    });

    const body = [];
    const subtotalRowIndices = new Set();
    for (const dateKey of sortedKeys) {
      const group = grouped.get(dateKey);
      group.forEach(r => {
        body.push([
          r[0], String(r[1] || '').substring(0, 20),
          String(r[2] || '').substring(0, 16), String(r[3] || '').substring(0, 16),
          r[4] || '', r[8] || '', r[9] || '', r[11] || '',
          typeof r[13] === 'number' ? r[13].toFixed(2) : (r[13] || '')
        ]);
      });
      const dayTotal = group.reduce((sum, r) => sum + (typeof r[13] === 'number' ? r[13] : 0), 0);
      subtotalRowIndices.add(body.length);
      body.push(['', '', '', '', '', '', '', 'Daily Total:', dayTotal.toFixed(2)]);
    }

    autoTable(doc, {
      startY: y,
      head: [cols],
      body,
      styles: { fontSize: 6, cellPadding: 1, lineColor: [170, 170, 170], lineWidth: 0.1 },
      headStyles: { fillColor: [233, 233, 233], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 6 },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 30 }, 8: { halign: 'right' } },
      margin: { left: 5, right: 5 },
      theme: 'grid',
      didParseCell: (data) => {
        if (data.section === 'body' && subtotalRowIndices.has(data.row.index)) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [245, 245, 245];
        }
      }
    });

    let finalY = doc.lastAutoTable?.finalY || y + 20;
    finalY += 4;
    totalRows.forEach(r => {
      const filled = r.filter(v => v != null && v !== '');
      if (filled.length < 1) return;
      const val = filled[filled.length - 1];
      const label = filled.slice(0, -1).join(' ');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text(label, 170, finalY, { align: 'right' });
      doc.text(typeof val === 'number' ? val.toFixed(2) : String(val || ''), 200, finalY, { align: 'right' });
      finalY += 4;
    });
  }

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MYKASIH D ${outlet} - ${MON_S[month]}'${String(year).slice(-2)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function mergeMyKasihInvoicePDFs(pdfs, outlet, month, year) {
  const merged = await PDFDocument.create();
  for (const p of pdfs) {
    const doc = await PDFDocument.load(p.buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(page => merged.addPage(page));
  }
  const bytes = await merged.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MYKASIH MDR ${outlet} - ${MON_S[month]}'${String(year).slice(-2)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const EPAY_OUTLET_MAP = {
  '80059855': 'HQ',
  '80059858': 'KC',
  '80059857': 'ST',
  '80059860': 'TH',
};
const EPAY_OUTLET_ORDER = ['HQ', 'KC', 'ST', 'TH'];

const EPAY_COL_KEYS = ['dateTime', 'terminalId', 'operator', 'retailerName', 'storeName', 'retailerRef', 'txnNo', 'narrative', 'snEtuTxnNo', 'topupRef', 'value'];

async function extractEpayTransactions(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const transactions = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter(item => item.str.trim());
    const dateItem = items.find(it => /^Date/i.test(it.str));
    const valItem = items.find(it => /^Value$/i.test(it.str));
    if (!dateItem || !valItem) continue;
    const landscape = Math.abs(dateItem.transform[4] - valItem.transform[4]) < 10;
    const rowAxis = landscape ? 4 : 5;
    const colAxis = landscape ? 5 : 4;
    const rowMap = new Map();
    items.forEach(item => {
      const pos = Math.round(item.transform[rowAxis]);
      let matchPos = null;
      for (const k of rowMap.keys()) {
        if (Math.abs(k - pos) < 3) { matchPos = k; break; }
      }
      const key = matchPos !== null ? matchPos : pos;
      if (!rowMap.has(key)) rowMap.set(key, []);
      rowMap.get(key).push({ col: item.transform[colAxis], text: item.str });
    });
    const headerRow = [...rowMap.entries()].find(([, ri]) =>
      ri.some(it => /^Date/i.test(it.text)) && ri.some(it => /^Value$/i.test(it.text))
    );
    if (!headerRow) continue;
    const headerSorted = headerRow[1].sort((a, b) => a.col - b.col);
    const colPositions = headerSorted.map((h, idx) => ({ key: EPAY_COL_KEYS[idx] || `col${idx}`, col: h.col }));
    const sortedRows = [...rowMap.entries()].sort((a, b) => landscape ? a[0] - b[0] : b[0] - a[0]);
    for (const [rowKey, rowItems] of sortedRows) {
      if (rowKey === headerRow[0]) continue;
      const sorted = rowItems.sort((a, b) => a.col - b.col);
      const firstText = sorted[0]?.text || '';
      if (!/^\d{2}\/\d{2}\/\d{4}/.test(firstText)) continue;
      const rowData = {};
      for (const item of sorted) {
        let nearest = null, dist = Infinity;
        for (const cp of colPositions) {
          const d = Math.abs(item.col - cp.col);
          if (d < dist) { dist = d; nearest = cp.key; }
        }
        if (nearest) rowData[nearest] = rowData[nearest] ? rowData[nearest] + ' ' + item.text : item.text;
      }
      const dt = rowData.dateTime || '';
      const dtMatch = dt.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
      if (!dtMatch) continue;
      transactions.push({
        date: dtMatch[1], time: dtMatch[2],
        terminalId: rowData.terminalId || '', operator: rowData.operator || '',
        retailerName: rowData.retailerName || '', storeName: rowData.storeName || '',
        retailerRef: rowData.retailerRef || '', txnNo: rowData.txnNo || '',
        narrative: rowData.narrative || '', snEtuTxnNo: rowData.snEtuTxnNo || '',
        topupRef: rowData.topupRef || '', details: rowData.narrative || '',
        value: parseFloat((rowData.value || '0').replace(/,/g, ''))
      });
    }
  }
  return transactions;
}

function extractEpayTransactionsFromExcel(arrayBuffer) {
  const wb = XLSXStyle.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSXStyle.utils.sheet_to_json(ws, { header: 1 });
  const transactions = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 11) continue;
    const dt = String(r[0] || '');
    const dtMatch = dt.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
    if (!dtMatch) continue;
    const narrative = String(r[7] || '');
    const val = typeof r[10] === 'number' ? r[10] : parseFloat(String(r[10] || '0').replace(/,/g, ''));
    transactions.push({
      date: dtMatch[1], time: dtMatch[2],
      terminalId: String(r[1]), operator: String(r[2] || ''),
      retailerName: String(r[3] || ''), storeName: String(r[4] || ''),
      retailerRef: String(r[5] || ''), txnNo: String(r[6] || ''),
      narrative, snEtuTxnNo: String(r[8] || ''),
      topupRef: String(r[9] || ''), details: narrative,
      value: isNaN(val) ? 0 : val
    });
  }
  return transactions;
}

async function processEpayFiles(files) {
  const periodSales = [];
  const allTxns = [];

  for (const file of files) {
    const buf = await file.arrayBuffer();
    const isExcel = /\.xlsx?$/i.test(file.name);
    if (isExcel) {
      const txns = extractEpayTransactionsFromExcel(buf);
      allTxns.push(...txns);
    } else if (/TransactionDetail/i.test(file.name)) {
      const txns = await extractEpayTransactions(buf);
      allTxns.push(...txns);
    } else {
      periodSales.push({ name: file.name, buf });
    }
  }

  const byOutlet = new Map();
  EPAY_OUTLET_ORDER.forEach(o => byOutlet.set(o, []));
  for (const txn of allTxns) {
    const outlet = EPAY_OUTLET_MAP[txn.terminalId] || 'Unknown';
    if (!byOutlet.has(outlet)) byOutlet.set(outlet, []);
    byOutlet.get(outlet).push(txn);
  }
  for (const [, txns] of byOutlet) {
    txns.sort((a, b) => {
      const [da, ma, ya] = a.date.split('/').map(Number);
      const [db, mb, yb] = b.date.split('/').map(Number);
      const cmp = (ya - yb) || (ma - mb) || (da - db);
      if (cmp !== 0) return cmp;
      return a.time.localeCompare(b.time);
    });
  }

  let year = new Date().getFullYear(), month = new Date().getMonth();
  if (allTxns.length > 0) {
    const sorted = [...allTxns].sort((a, b) => {
      const [da, ma, ya] = a.date.split('/').map(Number);
      const [db, mb, yb] = b.date.split('/').map(Number);
      return (ya - yb) || (ma - mb) || (da - db);
    });
    const mid = sorted[Math.floor(sorted.length / 2)];
    const parts = mid.date.split('/');
    month = parseInt(parts[1]) - 1;
    year = parseInt(parts[2]);
  } else if (periodSales.length > 0) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(periodSales[0].buf) }).promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map(i => i.str).join(' ');
      const fm = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
      if (fm) {
        const idx = MONTHS.findIndex(m => m.toLowerCase() === fm[1].toLowerCase());
        if (idx >= 0) { month = idx; year = parseInt(fm[2]); }
      } else {
        const dm = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dm) { month = parseInt(dm[2]) - 1; year = parseInt(dm[3]); }
      }
    } catch (e) { /* fallback to current date */ }
  }

  const warnings = [];
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const wrongDates = allTxns.filter(t => {
    const parts = t.date.split('/');
    const dm = parseInt(parts[1]) - 1, dy = parseInt(parts[2]);
    return !((dm === month && dy === year) || (dm === prevMonth && dy === prevYear));
  });
  if (wrongDates.length > 0) {
    const months = [...new Set(wrongDates.map(t => {
      const p = t.date.split('/');
      return `${MON_S[parseInt(p[1]) - 1]}'${p[2].slice(-2)}`;
    }))];
    warnings.push(`Found dates from unexpected months: ${months.join(', ')}. Please check.`);
  }

  return { periodSales, byOutlet, year, month, warnings, txnCount: allTxns.length, psCount: periodSales.length };
}

async function buildEpayPDF(periodSales, byOutlet, month, year) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const cols = ['No.', 'Date & Time', 'Terminal ID', 'Operator', 'Retailer Name', 'Store Name', 'Retailer Ref', 'Txn. No.', 'Narrative', 'SN / ETU Txn No.', 'Topup Ref', 'Value'];
  let firstPage = true;

  for (const outlet of EPAY_OUTLET_ORDER) {
    const txns = byOutlet.get(outlet);
    if (!txns || !txns.length) continue;

    if (!firstPage) doc.addPage();
    firstPage = false;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`EPAY Transaction Detail — ${outlet}`, 148.5, 10, { align: 'center' });

    const grouped = new Map();
    txns.forEach(t => {
      if (!grouped.has(t.date)) grouped.set(t.date, []);
      grouped.get(t.date).push(t);
    });

    const body = [];
    const dailyTotalIndices = new Set();
    let rowNo = 1;

    for (const [dateKey, group] of grouped) {
      const dayTotal = group.filter(t => !/^Paid:/i.test(t.narrative)).reduce((s, t) => s + t.value, 0);
      group.forEach((t, idx) => {
        body.push([rowNo++, `${t.date} ${t.time}`, t.terminalId, t.operator, t.retailerName, t.storeName, t.retailerRef, t.txnNo, t.narrative, t.snEtuTxnNo, t.topupRef, t.value.toFixed(2)]);
        if (idx === group.length - 1) {
          body.push(['', '', '', '', '', '', '', '', `Daily Total (${dateKey}):`, '', '', dayTotal.toFixed(2)]);
          dailyTotalIndices.add(body.length - 1);
        }
      });
    }

    autoTable(doc, {
      startY: 14,
      head: [cols],
      body,
      styles: { fontSize: 5, cellPadding: 1, lineColor: [180, 180, 180], lineWidth: 0.1, overflow: 'linebreak' },
      headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 5 },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 30 },
        2: { cellWidth: 16 },
        3: { cellWidth: 16 },
        4: { cellWidth: 26 },
        5: { cellWidth: 30 },
        6: { cellWidth: 32 },
        7: { cellWidth: 18 },
        8: { cellWidth: 'auto' },
        9: { cellWidth: 30 },
        10: { cellWidth: 20 },
        11: { cellWidth: 16, halign: 'right' }
      },
      margin: { left: 5, right: 5 },
      theme: 'grid',
      didParseCell: (data) => {
        if (data.section === 'body' && dailyTotalIndices.has(data.row.index)) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [255, 255, 230];
        }
      }
    });
  }

  const txnBytes = doc.output('arraybuffer');
  const merged = await PDFDocument.create();

  for (const ps of periodSales) {
    try {
      const copy = new Uint8Array(ps.buf).slice(0);
      const psDoc = await pdfjsLib.getDocument({ data: copy }).promise;
      const page = await psDoc.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map(it => it.str).join(' ');
      const dm = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+to\s/);
      ps.sortKey = dm ? parseInt(dm[3]) * 10000 + parseInt(dm[2]) * 100 + parseInt(dm[1]) : 0;
    } catch (_) { ps.sortKey = 0; }
  }
  periodSales.sort((a, b) => a.sortKey - b.sortKey);

  for (const ps of periodSales) {
    try {
      const psDoc = await PDFDocument.load(ps.buf);
      const pages = await merged.copyPages(psDoc, psDoc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    } catch (_) {}
  }

  try {
    const txnDoc = await PDFDocument.load(txnBytes);
    const pages = await merged.copyPages(txnDoc, txnDoc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  } catch (_) {}

  const bytes = await merged.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EPAY SALES SUMMARY - ${MON_S[month]}'${String(year).slice(-2)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function buildEpayOutletPDF(txns, outletName, month, year) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const cols = ['No.', 'Date & Time', 'Terminal ID', 'Operator', 'Retailer Name', 'Store Name', 'Retailer Ref', 'Txn. No.', 'Narrative', 'SN / ETU Txn No.', 'Topup Ref', 'Value'];
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`EPAY Transaction Detail — ${outletName}`, 148.5, 10, { align: 'center' });
  const grouped = new Map();
  txns.forEach(t => { if (!grouped.has(t.date)) grouped.set(t.date, []); grouped.get(t.date).push(t); });
  const body = [];
  const dailyTotalIndices = new Set();
  let rowNo = 1;
  for (const [dateKey, group] of grouped) {
    const dayTotal = group.filter(t => !/^Paid:/i.test(t.narrative)).reduce((s, t) => s + t.value, 0);
    group.forEach((t, idx) => {
      body.push([rowNo++, `${t.date} ${t.time}`, t.terminalId, t.operator, t.retailerName, t.storeName, t.retailerRef, t.txnNo, t.narrative, t.snEtuTxnNo, t.topupRef, t.value.toFixed(2)]);
      if (idx === group.length - 1) {
        body.push(['', '', '', '', '', '', '', '', `Daily Total (${dateKey}):`, '', '', dayTotal.toFixed(2)]);
        dailyTotalIndices.add(body.length - 1);
      }
    });
  }
  autoTable(doc, {
    startY: 14, head: [cols], body,
    styles: { fontSize: 5, cellPadding: 1, lineColor: [180, 180, 180], lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 5 },
    columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 30 }, 2: { cellWidth: 16 }, 3: { cellWidth: 16 }, 4: { cellWidth: 26 }, 5: { cellWidth: 30 }, 6: { cellWidth: 32 }, 7: { cellWidth: 18 }, 8: { cellWidth: 'auto' }, 9: { cellWidth: 30 }, 10: { cellWidth: 20 }, 11: { cellWidth: 16, halign: 'right' } },
    margin: { left: 5, right: 5 }, theme: 'grid',
    didParseCell: (data) => { if (data.section === 'body' && dailyTotalIndices.has(data.row.index)) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 255, 230]; } }
  });
  const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EPAY D ${outletName} - ${MON_S[month]}'${String(year).slice(-2)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function parsePBBStatement(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const allTxns = [];

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
    let currentDate = '';
    let pendingTxn = null;

    const flushTxn = () => { if (pendingTxn) { allTxns.push(pendingTxn); pendingTxn = null; } };

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

      if (/^(TARIKH|DATE)$/i.test(text) || /^(URUS NIAGA|TRANSACTION)$/i.test(text)) continue;
      if (/DEBIT|KREDIT|CREDIT|BAKI|BALANCE/i.test(text) && !date && !debit && !credit) continue;

      if (/balance (from last|b\/f)/i.test(text)) {
        currentDate = date || currentDate;
        continue;
      }
      if (/balance c\/f/i.test(text)) { flushTxn(); continue; }

      if (date && /^\d{2}\/\d{2}$/.test(date)) currentDate = date;

      const hasAmount = debit || credit;

      if (hasAmount) {
        flushTxn();
        const parseAmt = (s) => { if (!s) return 0; return parseFloat(s.replace(/,/g, '')) || 0; };
        pendingTxn = {
          date: currentDate,
          description: text,
          debit: parseAmt(debit),
          credit: parseAmt(credit),
          balance: balance.replace(/,/g, ''),
          page: p,
        };
      } else if (text && pendingTxn) {
        pendingTxn.description += '\n' + text;
      }
    }
    flushTxn();
  }
  return allTxns;
}

function classifyBankTxns(txns) {
  const toKeyed = [];
  const onlineTransfers = [];
  const depCash = [];

  const TO_KEYED_PATTERNS = [/PROCESS FEE/i, /HANDLING CHARGE/i, /AUDIT CONFIRMATION/i, /AUTOMATED LOAN/i];
  const ONLINE_PATTERNS = [/DUITNOW QR CR/i, /TSFR FUND CR/i, /DUITNOW CR/i, /IBG CR/i, /IBFT CR/i];

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

const CSS = `
.mr-root{background:#fafafa;height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.mr-bar{background:#fff;border-bottom:1px solid #e4e4e7;padding:0 24px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:50}
.mr-bar h1{font-size:15px;font-weight:800;letter-spacing:.04em;margin:0;color:#18181b}
.mr-body{margin:0;padding:16px 48px;position:relative;flex:1;display:flex;flex-direction:column;overflow:hidden}
.mr-scroll{display:flex;gap:16px;overflow-x:auto;scroll-behavior:smooth;scroll-snap-type:x mandatory;-ms-overflow-style:none;scrollbar-width:none;flex:1}
.mr-scroll::-webkit-scrollbar{display:none}
.mr-card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:20px;min-width:0;flex:1 1 0;scroll-snap-align:start;display:flex;flex-direction:column}
.mr-nav{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;background:#18181b;color:#fff;border:none;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;opacity:.8}
.mr-nav:hover{opacity:1}
.mr-nav.left{left:4px}
.mr-nav.right{right:4px}
.mr-card h2{font-size:14px;font-weight:700;margin:0 0 4px;color:#18181b}
.mr-card p{font-size:12px;color:#71717a;margin:0 0 20px}
.mr-upload{border:2px dashed #d4d4d8;border-radius:8px;padding:20px;text-align:center;cursor:pointer;transition:all .15s;flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center}
.mr-upload:hover{border-color:#2563eb;background:#eff6ff}
.mr-upload.drag{border-color:#2563eb;background:#eff6ff}
.mr-icon{font-size:32px;margin-bottom:8px}
.mr-label{font-size:13px;font-weight:600;color:#18181b}
.mr-hint{font-size:11px;color:#a1a1aa;margin-top:4px}
.mr-result{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-top:16px}
.mr-result-title{font-size:13px;font-weight:700;color:#166534;margin:0 0 8px}
.mr-result-info{font-size:12px;color:#15803d;margin:0 0 4px}
.mr-btn{padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:#18181b;color:#fff;margin-top:12px}
.mr-btn:hover{background:#27272a}
.mr-btn:active{transform:scale(.97)}
.mr-error{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:16px;font-size:12px;color:#dc2626}
.mr-select{padding:6px 10px;border-radius:6px;border:1px solid #d4d4d8;font-size:13px;font-weight:600;background:#fff;margin-right:8px}
.mr-loading{font-size:12px;color:#71717a;margin-top:12px}
.mr-warn{background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px;margin-top:12px;font-size:12px;color:#92400E}
.br-section{margin-top:14px;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden}
.br-header{padding:10px 14px;background:#f4f4f5;font-size:12px;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none}
.br-header:hover{background:#e4e4e7}
.br-body{padding:12px 14px}
.br-table{width:100%;border-collapse:collapse;font-size:11px}
.br-table th{text-align:left;padding:4px 6px;border-bottom:2px solid #d4d4d8;font-weight:700;white-space:nowrap}
.br-table td{padding:4px 6px;border-bottom:1px solid #e4e4e7;vertical-align:top}
.br-table tr:last-child td{border-bottom:none}
.br-amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.br-total{font-weight:700;background:#f0fdf4;font-size:12px}
.br-total td{padding:6px;border-top:2px solid #15803d}
.br-check{width:14px;height:14px;cursor:pointer;accent-color:#18181b}
.br-tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px}
.br-tag.charge{background:#fef2f2;color:#dc2626}
.br-tag.loan{background:#eff6ff;color:#2563eb}
.br-desc{white-space:pre-line;max-width:300px}
.br-page{color:#71717a;font-size:10px}
.br-count{font-size:11px;color:#71717a;font-weight:400}
@media print{.mr-root{display:none}}
`;

export default function MerchantReport() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const [cpResult, setCpResult] = useState(null);
  const [cpError, setCpError] = useState('');
  const [cpLoading, setCpLoading] = useState(false);
  const [cpDragging, setCpDragging] = useState(false);
  const cpFileRef = useRef(null);

  const [mkResult, setMkResult] = useState(null);
  const [mkError, setMkError] = useState('');
  const [mkLoading, setMkLoading] = useState(false);
  const [mkDragging, setMkDragging] = useState(false);
  const mkFileRef = useRef(null);

  const [epResult, setEpResult] = useState(null);
  const [epError, setEpError] = useState('');
  const [epLoading, setEpLoading] = useState(false);
  const [epDragging, setEpDragging] = useState(false);
  const epFileRef = useRef(null);

  const [brResult, setBrResult] = useState(null);
  const [brError, setBrError] = useState('');
  const [brLoading, setBrLoading] = useState(false);
  const [brDragging, setBrDragging] = useState(false);
  const [brExcluded, setBrExcluded] = useState(new Set());
  const [brOpen, setBrOpen] = useState({ toKeyed: true, online: true, depCash: true });
  const brFileRef = useRef(null);

  const scrollRef = useRef(null);

  const scrollCards = (dir) => {
    if (!scrollRef.current) return;
    const card = scrollRef.current.querySelector('.mr-card');
    const w = card ? card.offsetWidth + 16 : 340;
    scrollRef.current.scrollBy({ left: dir * w, behavior: 'smooth' });
  };

  const handleFile = (file) => {
    if (!file) return;
    setError('');
    setResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSXStyle.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSXStyle.utils.sheet_to_json(ws, { raw: true });

        if (!rawRows.length) { setError('File appears to be empty.'); return; }

        const headers = Object.keys(rawRows[0]);
        if (headers.includes('Settlement No.') || headers.includes('Merchant ID')) {
          const { keepCols, title, dataRows, sums, year, month, outlet, warnings } = processSpay(rawRows);
          setResult({ type: 'SPAY', keepCols, title, dataRows, sums, year, month, outlet, warnings, rows: rawRows.length });
        } else {
          setError('Could not detect merchant format. Make sure the file has the original headers from the portal.');
        }
      } catch (err) {
        setError('Could not read file: ' + (err.message || 'unknown error'));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const doDownload = () => {
    if (!result) return;
    buildSpayPDF(result.keepCols, result.title, result.dataRows, result.sums, result.month, result.year, result.outlet);
  };

  const handleCpFile = async (file) => {
    if (!file) return;
    setCpError('');
    setCpResult(null);
    setCpLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await processCardPayZip(buf);
      if (!res.pdfs.length) {
        setCpError('No StatementOfAccount PDFs found in the zip file.');
      } else {
        setCpResult(res);
      }
    } catch (err) {
      setCpError('Could not process zip: ' + (err.message || 'unknown error'));
    }
    setCpLoading(false);
  };

  const handleCpDrop = (e) => {
    e.preventDefault();
    setCpDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleCpFile(file);
  };

  const doCpDownload = () => {
    if (!cpResult) return;
    mergeCardPayPDFs(cpResult.pdfs, cpResult.outlet, cpResult.month, cpResult.year);
  };

  const handleMkFile = async (file) => {
    if (!file) return;
    setMkError('');
    setMkResult(null);
    setMkLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await processMyKasihZip(buf);
      if (!res.excels.length && !res.pdfs.length) {
        setMkError('No Terminal Activity Reports or Invoice PDFs found in the zip.');
      } else {
        if (res.warnings.length > 0) {
          alert('⚠️ Date Warning\n\n' + res.warnings.join('\n'));
        }
        setMkResult(res);
      }
    } catch (err) {
      setMkError('Could not process zip: ' + (err.message || 'unknown error'));
    }
    setMkLoading(false);
  };

  const handleMkDrop = (e) => {
    e.preventDefault();
    setMkDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleMkFile(file);
  };

  const doMkExcelDownload = () => {
    if (!mkResult) return;
    try {
      buildMyKasihExcelPDF(mkResult.excels, mkResult.outlet, mkResult.month, mkResult.year);
    } catch (e) {
      console.error('MyKasih D download error:', e);
      setMkError('Download failed: ' + e.message);
    }
  };

  const doMkInvoiceDownload = () => {
    if (!mkResult) return;
    mergeMyKasihInvoicePDFs(mkResult.pdfs, mkResult.outlet, mkResult.month, mkResult.year);
  };

  const handleEpFiles = async (fileList) => {
    const files = [...fileList].filter(f => /\.(pdf|xlsx?)$/i.test(f.name));
    if (!files.length) { setEpError('No PDF or Excel files found.'); return; }
    setEpError('');
    setEpResult(null);
    setEpLoading(true);
    try {
      const res = await processEpayFiles(files);
      if (!res.txnCount && !res.psCount) {
        setEpError('No transaction data or period sales found in the uploaded files.');
      } else {
        setEpResult(res);
      }
    } catch (err) {
      setEpError('Could not process files: ' + (err.message || 'unknown error'));
    }
    setEpLoading(false);
  };

  const handleEpDrop = (e) => {
    e.preventDefault();
    setEpDragging(false);
    if (e.dataTransfer.files?.length) handleEpFiles(e.dataTransfer.files);
  };

  const doEpDownload = async () => {
    if (!epResult) return;
    try {
      await buildEpayPDF(epResult.periodSales, epResult.byOutlet, epResult.month, epResult.year);
    } catch (e) {
      console.error('EPAY download error:', e);
      setEpError('Download failed: ' + e.message);
    }
  };

  const doEpOutletDownload = (outlet) => {
    if (!epResult) return;
    const txns = epResult.byOutlet.get(outlet);
    if (!txns || !txns.length) return;
    try {
      buildEpayOutletPDF(txns, outlet, epResult.month, epResult.year);
    } catch (e) {
      setEpError('Download failed: ' + e.message);
    }
  };

  const handleBrFile = async (file) => {
    if (!file) return;
    setBrError('');
    setBrResult(null);
    setBrExcluded(new Set());
    setBrLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const txns = await parsePBBStatement(buf);
      if (!txns.length) {
        setBrError('No transactions found in this PDF. Make sure it is a Public Bank statement.');
      } else {
        const classified = classifyBankTxns(txns);
        setBrResult({ txns, ...classified, totalTxns: txns.length, totalPages: (await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise).numPages });
      }
    } catch (err) {
      setBrError('Could not read PDF: ' + (err.message || 'unknown error'));
    }
    setBrLoading(false);
  };

  const handleBrDrop = (e) => {
    e.preventDefault();
    setBrDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleBrFile(file);
  };

  const toggleBrSection = (key) => setBrOpen(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleBrExclude = (idx) => {
    setBrExcluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const fmtAmt = (n) => n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  const brOnlineTotal = brResult ? brResult.onlineTransfers.reduce((s, t, i) => s + (brExcluded.has(i) ? 0 : t.credit), 0) : 0;

  return (
    <div className="mr-root">
      <style>{CSS}</style>
      <div className="mr-bar">
        <h1>POS MERCHANT REPORT</h1>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 400 }}>Outlet is auto-detected from merchant ID · Mixed outlets, unexpected dates, and amount mismatches will trigger alerts</span>
      </div>
      <div className="mr-body">
        <button className="mr-nav left" onClick={() => scrollCards(-1)}>‹</button>
        <button className="mr-nav right" onClick={() => scrollCards(1)}>›</button>
        <div className="mr-scroll" ref={scrollRef}>
        <div className="mr-card">
          <h2>Sarawak Pay (SPAY)</h2>
          <p>Upload the settlement report from the SPAY portal. It will be formatted with company header, totals, and print-ready layout.</p>
          <div
            className={`mr-upload${dragging ? ' drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="mr-icon">📄</div>
            <div className="mr-label">Click to upload or drag & drop</div>
            <div className="mr-hint">Accepts .xls / .xlsx files from SPAY portal</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx"
            style={{ display: 'none' }}
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
          />

          {error && <div className="mr-error">{error}</div>}

          {result && (
            <div className="mr-result">
              <div className="mr-result-title">Ready to download</div>
              <div className="mr-result-info">{result.title}</div>
              <div className="mr-result-info">{result.rows} transactions · {result.keepCols.length} columns (zero-value columns hidden)</div>
              {result.warnings?.map((w, i) => <div key={i} className="mr-warn">⚠️ {w}</div>)}
              <button className="mr-btn" onClick={doDownload}>Download SPAY {result.outlet} - {MON_S[result.month]}'{String(result.year).slice(-2)}</button>
            </div>
          )}
        </div>

        <div className="mr-card">
          <h2>CardPay</h2>
          <p>Upload the zip file from CardPay portal. Statement of Account PDFs will be extracted, sorted by date, and merged into one PDF.</p>
          <div
            className={`mr-upload${cpDragging ? ' drag' : ''}`}
            onClick={() => cpFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setCpDragging(true); }}
            onDragLeave={() => setCpDragging(false)}
            onDrop={handleCpDrop}
          >
            <div className="mr-icon">📦</div>
            <div className="mr-label">Click to upload or drag & drop</div>
            <div className="mr-hint">Accepts .zip files from CardPay portal (nested zips supported)</div>
          </div>
          <input
            ref={cpFileRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={(e) => { handleCpFile(e.target.files?.[0]); e.target.value = ''; }}
          />

          {cpLoading && <div className="mr-loading">Extracting and sorting PDFs...</div>}
          {cpError && <div className="mr-error">{cpError}</div>}

          {cpResult && (
            <div className="mr-result">
              <div className="mr-result-title">Ready to download</div>
              <div className="mr-result-info">{cpResult.pdfs.length} Statement of Account PDFs found</div>
              <div className="mr-result-info">Date range: {cpResult.pdfs[0]?.date} to {cpResult.pdfs[cpResult.pdfs.length - 1]?.date}</div>
              <div className="mr-result-info">Outlet detected: {cpResult.outlet}</div>
              <div className="mr-result-info">Download as: CARDPAY D {cpResult.outlet} - {MON_S[cpResult.month]}'{String(cpResult.year).slice(-2)}.pdf</div>
              {cpResult.warnings?.map((w, i) => <div key={i} className="mr-warn">⚠️ {w}</div>)}
              <button className="mr-btn" onClick={doCpDownload}>Download Merged PDF</button>
            </div>
          )}
        </div>

        <div className="mr-card">
          <h2>MyKasih</h2>
          <p>Upload the zip file from MyKasih portal (nested zips supported). Terminal Activity Reports → PDF, Invoices → merged PDF.</p>
          <div
            className={`mr-upload${mkDragging ? ' drag' : ''}`}
            onClick={() => mkFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setMkDragging(true); }}
            onDragLeave={() => setMkDragging(false)}
            onDrop={handleMkDrop}
          >
            <div className="mr-icon">📦</div>
            <div className="mr-label">Click to upload or drag & drop</div>
            <div className="mr-hint">Accepts .zip files from MyKasih portal (nested zips supported)</div>
          </div>
          <input
            ref={mkFileRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={(e) => { handleMkFile(e.target.files?.[0]); e.target.value = ''; }}
          />

          {mkLoading && <div className="mr-loading">Extracting and processing files...</div>}
          {mkError && <div className="mr-error">{mkError}</div>}

          {mkResult && (
            <div className="mr-result">
              <div className="mr-result-title">Ready to download</div>
              <div className="mr-result-info">Outlet detected: {mkResult.outlet}</div>
              <div className="mr-result-info">{mkResult.excels.length} Terminal Activity Reports · {mkResult.pdfs.length} Invoice PDFs</div>
              {mkResult.warnings.map((w, i) => <div key={i} className="mr-warn">⚠️ {w}</div>)}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="mr-btn" onClick={doMkExcelDownload} disabled={!mkResult.excels.length}>
                  Download MYKASIH D {mkResult.outlet}
                </button>
                <button className="mr-btn" onClick={doMkInvoiceDownload} disabled={!mkResult.pdfs.length}>
                  Download MYKASIH MDR {mkResult.outlet}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mr-card">
          <h2>ePay</h2>
          <p>Upload all PDFs from ePay portal (Period Sales + Transaction Detail). Transaction Details will be grouped by outlet, sorted by date, with daily totals.</p>
          <div
            className={`mr-upload${epDragging ? ' drag' : ''}`}
            onClick={() => epFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setEpDragging(true); }}
            onDragLeave={() => setEpDragging(false)}
            onDrop={handleEpDrop}
          >
            <div className="mr-icon">📑</div>
            <div className="mr-label">Click to upload or drag & drop</div>
            <div className="mr-hint">Select multiple files (Period Sales PDF + Transaction Detail PDF or Excel)</div>
          </div>
          <input
            ref={epFileRef}
            type="file"
            accept=".pdf,.xlsx,.xls"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleEpFiles(e.target.files); e.target.value = ''; }}
          />

          {epLoading && <div className="mr-loading">Processing ePay files...</div>}
          {epError && <div className="mr-error">{epError}</div>}

          {epResult && (
            <div className="mr-result">
              <div className="mr-result-title">Ready to download</div>
              <div className="mr-result-info">{epResult.psCount} Period Sales · {epResult.txnCount} transactions parsed</div>
              <div className="mr-result-info">
                Outlets: {EPAY_OUTLET_ORDER.filter(o => epResult.byOutlet.get(o)?.length > 0).map(o => `${o} (${epResult.byOutlet.get(o).length})`).join(', ')}
              </div>
              {epResult.warnings.map((w, i) => <div key={i} className="mr-warn">⚠️ {w}</div>)}
              <button className="mr-btn" onClick={doEpDownload}>Download EPAY SALES SUMMARY - {MON_S[epResult.month]}'{String(epResult.year).slice(-2)}</button>
              {epResult.txnCount > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {['KC', 'ST', 'TH'].filter(o => epResult.byOutlet.get(o)?.length > 0).map(o => (
                    <button key={o} className="mr-btn" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => doEpOutletDownload(o)}>
                      EPAY D {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mr-card">
          <h2>Bank Recon</h2>
          <p>Upload Public Bank statement PDF. Extracts items to key, online transfers, and cash deposits — all processed in your browser, nothing sent anywhere.</p>
          <div
            className={`mr-upload${brDragging ? ' drag' : ''}`}
            onClick={() => brFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setBrDragging(true); }}
            onDragLeave={() => setBrDragging(false)}
            onDrop={handleBrDrop}
          >
            <div className="mr-icon">🏦</div>
            <div className="mr-label">Click to upload or drag & drop</div>
            <div className="mr-hint">Public Bank statement PDF only</div>
          </div>
          <input
            ref={brFileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => { handleBrFile(e.target.files?.[0]); e.target.value = ''; }}
          />

          {brLoading && <div className="mr-loading">Reading bank statement...</div>}
          {brError && <div className="mr-error">{brError}</div>}

          {brResult && (
            <div style={{ marginTop: 16 }}>
              <div className="mr-result" style={{ marginTop: 0, marginBottom: 12 }}>
                <div className="mr-result-title">Statement parsed</div>
                <div className="mr-result-info">{brResult.totalTxns} transactions across {brResult.totalPages} pages</div>
                <div className="mr-result-info">
                  Found: {brResult.toKeyed.length} to key · {brResult.onlineTransfers.length} online transfers · {brResult.depCash.length} cash deposits
                </div>
              </div>

              <div className="br-section">
                <div className="br-header" onClick={() => toggleBrSection('toKeyed')}>
                  <span>To Key {brResult.toKeyed.length > 0 && <span className="br-count">({brResult.toKeyed.length})</span>}</span>
                  <span>{brOpen.toKeyed ? '▾' : '▸'}</span>
                </div>
                {brOpen.toKeyed && (
                  <div className="br-body">
                    {brResult.toKeyed.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#71717a' }}>No bank charges or loan payments found</div>
                    ) : (
                      <table className="br-table">
                        <thead><tr><th>Date</th><th>Description</th><th>Type</th><th className="br-amt">Debit</th><th className="br-amt">Credit</th><th>Pg</th></tr></thead>
                        <tbody>
                          {brResult.toKeyed.map((t, i) => (
                            <tr key={i}>
                              <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                              <td className="br-desc">{t.description}</td>
                              <td><span className={`br-tag ${t.type === 'Loan Payment' ? 'loan' : 'charge'}`}>{t.type}</span></td>
                              <td className="br-amt">{t.debit ? fmtAmt(t.debit) : '-'}</td>
                              <td className="br-amt">{t.credit ? fmtAmt(t.credit) : '-'}</td>
                              <td className="br-page">p{t.page}</td>
                            </tr>
                          ))}
                          <tr className="br-total">
                            <td colSpan={3}>Total</td>
                            <td className="br-amt">{fmtAmt(brResult.toKeyed.reduce((s, t) => s + t.debit, 0))}</td>
                            <td className="br-amt">{fmtAmt(brResult.toKeyed.reduce((s, t) => s + t.credit, 0))}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              <div className="br-section">
                <div className="br-header" onClick={() => toggleBrSection('online')}>
                  <span>Online Transfers (Credit) {brResult.onlineTransfers.length > 0 && <span className="br-count">({brResult.onlineTransfers.length})</span>}</span>
                  <span>{brOpen.online ? '▾' : '▸'}</span>
                </div>
                {brOpen.online && (
                  <div className="br-body">
                    {brResult.onlineTransfers.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#71717a' }}>No online transfers found</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>Uncheck items that are not retail trade to exclude from total</div>
                        <table className="br-table">
                          <thead><tr><th style={{ width: 28 }}>✓</th><th>Date</th><th>Description</th><th className="br-amt">Amount</th><th>Pg</th></tr></thead>
                          <tbody>
                            {brResult.onlineTransfers.map((t, i) => (
                              <tr key={i} style={brExcluded.has(i) ? { opacity: 0.4, textDecoration: 'line-through' } : {}}>
                                <td><input type="checkbox" className="br-check" checked={!brExcluded.has(i)} onChange={() => toggleBrExclude(i)} /></td>
                                <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                                <td className="br-desc">{t.description}</td>
                                <td className="br-amt">{fmtAmt(t.credit)}</td>
                                <td className="br-page">p{t.page}</td>
                              </tr>
                            ))}
                            <tr className="br-total">
                              <td colSpan={3}>Total ({brResult.onlineTransfers.length - brExcluded.size} of {brResult.onlineTransfers.length} included)</td>
                              <td className="br-amt">{fmtAmt(brOnlineTotal)}</td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="br-section">
                <div className="br-header" onClick={() => toggleBrSection('depCash')}>
                  <span>Cash Deposits (DEP-CASH) {brResult.depCash.length > 0 && <span className="br-count">({brResult.depCash.length})</span>}</span>
                  <span>{brOpen.depCash ? '▾' : '▸'}</span>
                </div>
                {brOpen.depCash && (
                  <div className="br-body">
                    {brResult.depCash.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#71717a' }}>No DEP-CASH entries found</div>
                    ) : (
                      <table className="br-table">
                        <thead><tr><th>Date</th><th>Description</th><th className="br-amt">Amount</th><th>Pg</th></tr></thead>
                        <tbody>
                          {brResult.depCash.map((t, i) => (
                            <tr key={i}>
                              <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                              <td className="br-desc">{t.description}</td>
                              <td className="br-amt">{fmtAmt(t.credit)}</td>
                              <td className="br-page">p{t.page}</td>
                            </tr>
                          ))}
                          <tr className="br-total">
                            <td colSpan={2}>Total ({brResult.depCash.length} deposits)</td>
                            <td className="br-amt">{fmtAmt(brResult.depCash.reduce((s, t) => s + t.credit, 0))}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

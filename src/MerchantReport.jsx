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

function buildExcel(keepCols, title, dataRows, sums, month, year, outlet) {
  const X = XLSXStyle;
  const wb = X.utils.book_new();
  const ws = {};
  const mg = [];
  const colCount = keepCols.length;
  const lastCol = colCount - 1;
  const _thin = { style: 'thin', color: { rgb: 'AAAAAA' } };
  const _bd = { top: _thin, bottom: _thin, left: _thin, right: _thin };
  const font = { name: 'Arial', sz: 14 };
  const boldFont = { name: 'Arial', sz: 14, bold: true };
  const headerFont = { name: 'Arial', sz: 16, bold: true };
  const titleFont = { name: 'Arial', sz: 16, bold: true };

  const sc = (r, c, v, style) => {
    const ref = X.utils.encode_cell({ r, c });
    const cell = { v, t: typeof v === 'number' ? 'n' : 's' };
    if (typeof v === 'number') cell.z = '#,##0.00';
    if (style) cell.s = style;
    ws[ref] = cell;
  };

  sc(0, 0, 'C.J.K. CHAI JEE KIONG TRADING SDN BHD', {
    font: headerFont, alignment: { horizontal: 'center', vertical: 'center' }
  });
  mg.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } });

  sc(1, 0, title, {
    font: titleFont, alignment: { horizontal: 'center', vertical: 'center' }
  });
  mg.push({ s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } });

  keepCols.forEach((h, c) => {
    sc(2, c, h, {
      font: boldFont,
      border: _bd,
      fill: { fgColor: { rgb: 'E9E9E9' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    });
  });

  dataRows.forEach((row, ri) => {
    row.forEach((v, ci) => {
      const isNum = typeof v === 'number';
      sc(3 + ri, ci, v === '-' ? '-' : v, {
        font,
        border: _bd,
        alignment: {
          horizontal: isNum ? 'right' : (v === '-' ? 'center' : 'left'),
          vertical: 'center'
        },
        ...(isNum ? { numFmt: '#,##0.00' } : {})
      });
    });
  });

  const sumRow = 3 + dataRows.length + 1;
  sc(sumRow - 1, 0, '', { font });
  const dataStart = 4, dataEnd = 3 + dataRows.length;
  sums.forEach((v, ci) => {
    if (v !== null) {
      const colLetter = X.utils.encode_col(ci);
      const ref = X.utils.encode_cell({ r: sumRow, c: ci });
      ws[ref] = {
        t: 'n', v,
        f: `SUM(${colLetter}${dataStart}:${colLetter}${dataEnd})`,
        z: '#,##0.00',
        s: {
          font: boldFont,
          border: { top: { style: 'medium', color: { rgb: '000000' } }, bottom: { style: 'double', color: { rgb: '000000' } } },
          alignment: { horizontal: 'right', vertical: 'center' },
          numFmt: '#,##0.00'
        }
      };
    }
  });

  const totalRows = sumRow + 1;
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows, c: lastCol } });
  ws['!merges'] = mg;

  const rowHt = [];
  for (let i = 0; i <= totalRows; i++) {
    if (i <= 1) rowHt.push({ hpt: 28 });
    else if (i === 2) rowHt.push({ hpt: 36 });
    else rowHt.push({ hpt: 24 });
  }
  ws['!rows'] = rowHt;

  const colWidths = keepCols.map(h => {
    if (h === 'Merchant Name') return { wch: 26 };
    if (h === 'Settlement No.') return { wch: 30 };
    if (h === 'Settlement Bank') return { wch: 32 };
    if (h === 'Settlement Date' || h === 'Status Date') return { wch: 18 };
    if (h === 'Status') return { wch: 24 };
    if (h === 'Bank Account') return { wch: 18 };
    if (h === 'Merchant ID') return { wch: 18 };
    if (SPAY_NUMERIC.has(h)) return { wch: 18 };
    return { wch: 14 };
  });
  ws['!cols'] = colWidths;
  ws['!margins'] = { left: 0, right: 0, top: 0.5, bottom: 0.5, header: 0, footer: 0 };

  X.utils.book_append_sheet(wb, ws, MON_S[month]);

  const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
  const fname = `SPAY ${outlet || 'HQ'} - ${MON_S[month]}'${String(year).slice(-2)}.xlsx`;

  JSZip.loadAsync(buf).then(async (zip) => {
    try {
      const ssFile = zip.file('xl/sharedStrings.xml');
      if (ssFile) {
        let ssxml = await ssFile.async('string');
        ssxml = ssxml.replace(
          '<t>C.J.K. CHAI JEE KIONG TRADING SDN BHD</t>',
          '<r><rPr><b/><i/><sz val="16"/><rFont val="Arial"/></rPr><t>C.J.K.</t></r>' +
          '<r><rPr><b/><sz val="16"/><rFont val="Arial"/></rPr><t xml:space="preserve"> CHAI JEE KIONG TRADING SDN BHD</t></r>'
        );
        zip.file('xl/sharedStrings.xml', ssxml);
      }
    } catch (_) {}
    let xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    if (xml.includes('<sheetPr/>')) {
      xml = xml.replace('<sheetPr/>', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    } else if (xml.includes('<sheetPr')) {
      xml = xml.replace(/<sheetPr([^>]*)>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/>');
    } else {
      xml = xml.replace('<dimension', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
    }
    xml = xml.replace(/<pageSetup[^/]*\/>/g, '');
    xml = xml.replace(/<pageMargins[^/]*\/>/,
      '$&<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0" scale="100"/>');
    zip.file('xl/worksheets/sheet1.xml', xml);
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(err => { console.error('Excel download error:', err); });
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

async function extractEpayTransactions(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const transactions = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const rowMap = new Map();
    content.items.forEach(item => {
      if (!item.str.trim()) return;
      const y = Math.round(item.transform[5]);
      let matchY = null;
      for (const ky of rowMap.keys()) {
        if (Math.abs(ky - y) < 3) { matchY = ky; break; }
      }
      const key = matchY !== null ? matchY : y;
      if (!rowMap.has(key)) rowMap.set(key, []);
      rowMap.get(key).push({ x: item.transform[4], text: item.str });
    });
    for (const [, items] of [...rowMap.entries()].sort((a, b) => b[0] - a[0])) {
      const sorted = items.sort((a, b) => a.x - b.x);
      const lineText = sorted.map(i => i.text).join(' ').trim();
      const m = lineText.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2}\s+[AP]M)\s+(\d{8})\s+(.*?)\s+([\d,]+\.\d{2})$/);
      if (!m) continue;
      const details = m[4];
      const opMatch = details.match(/^(\w+)\s/);
      const narMatch = details.match(/(Sold:\s*.+?\([^)]+\))/);
      transactions.push({
        date: m[1],
        time: m[2],
        terminalId: m[3],
        operator: opMatch ? opMatch[1] : '',
        narrative: narMatch ? narMatch[1] : '',
        details,
        value: parseFloat(m[5].replace(/,/g, ''))
      });
    }
  }
  return transactions;
}

async function processEpayFiles(files) {
  const periodSales = [];
  const allTxns = [];

  for (const file of files) {
    const buf = await file.arrayBuffer();
    if (/TransactionDetail/i.test(file.name)) {
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
  const cols = ['No.', 'Date', 'Time', 'Operator', 'Narrative', 'Value'];
  let firstPage = true;
  let globalNo = 1;

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
    const outletStartIdx = 0;
    let rowNo = 1;

    for (const [dateKey, group] of grouped) {
      const dayTotal = group.reduce((s, t) => s + t.value, 0);
      group.forEach((t, idx) => {
        const isLast = idx === group.length - 1;
        body.push([rowNo++, t.date, t.time, t.operator, t.narrative, t.value.toFixed(2)]);
        if (isLast) {
          dailyTotalIndices.add(body.length - 1);
          body.push(['', '', '', '', `Daily Total (${dateKey}):`, dayTotal.toFixed(2)]);
          dailyTotalIndices.add(body.length - 1);
        }
      });
    }

    autoTable(doc, {
      startY: 14,
      head: [cols],
      body,
      styles: { fontSize: 7, cellPadding: 1.5, lineColor: [180, 180, 180], lineWidth: 0.1 },
      headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 24 },
        2: { cellWidth: 28 },
        3: { cellWidth: 22 },
        4: { cellWidth: 'auto' },
        5: { cellWidth: 22, halign: 'right' }
      },
      margin: { left: 8, right: 8 },
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
    buildExcel(result.keepCols, result.title, result.dataRows, result.sums, result.month, result.year, result.outlet);
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
    const files = [...fileList].filter(f => /\.pdf$/i.test(f.name));
    if (!files.length) { setEpError('No PDF files found.'); return; }
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
              <button className="mr-btn" onClick={doDownload}>Download Formatted Excel</button>
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
            <div className="mr-hint">Select multiple PDF files (Period Sales + Transaction Detail by Period)</div>
          </div>
          <input
            ref={epFileRef}
            type="file"
            accept=".pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleEpFiles(e.target.files); e.target.value = ''; }}
          />

          {epLoading && <div className="mr-loading">Processing ePay PDFs...</div>}
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
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

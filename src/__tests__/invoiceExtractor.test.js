import { describe, it, expect } from 'vitest';
import {
  SUPPLIERS,
  normalizeDate,
  validInvoiceNo,
  parseDesc,
  formatVolUnit,
  deriveActualLabel,
  matchCat,
  calcSub,
  computeIssues,
  fmt,
} from '../InvoiceExtractor.jsx';

// Choon Hua rate config — pulled straight from the SUPPLIERS export so the
// tests are always run against whatever is in source.
const RATES = SUPPLIERS['CHOON HUA'].rates;

describe('normalizeDate', () => {
  it('DD/MM/YYYY standard', () => {
    expect(normalizeDate('12/06/2026')).toEqual({ date: '12/06/2026', ok: true });
  });
  it('D/M/YYYY pads zeros', () => {
    expect(normalizeDate('5/6/2026')).toEqual({ date: '05/06/2026', ok: true });
  });
  it('DD-MM-YYYY with dashes', () => {
    expect(normalizeDate('12-06-2026')).toEqual({ date: '12/06/2026', ok: true });
  });
  it('DD.MM.YYYY with dots', () => {
    expect(normalizeDate('12.06.2026')).toEqual({ date: '12/06/2026', ok: true });
  });
  it('ISO YYYY-MM-DD', () => {
    expect(normalizeDate('2026-06-12')).toEqual({ date: '12/06/2026', ok: true });
  });
  it('ISO with single digit day', () => {
    expect(normalizeDate('2026-6-5')).toEqual({ date: '05/06/2026', ok: true });
  });
  it('Trim whitespace', () => {
    expect(normalizeDate('  12/06/2026  ')).toEqual({ date: '12/06/2026', ok: true });
  });
  it('Day > 31 invalid', () => {
    expect(normalizeDate('32/06/2026')).toEqual({ date: '32/06/2026', ok: false });
  });
  it('Month > 12 invalid', () => {
    expect(normalizeDate('12/13/2026')).toEqual({ date: '12/13/2026', ok: false });
  });
  it('Year too early', () => {
    expect(normalizeDate('12/06/2019')).toEqual({ date: '12/06/2019', ok: false });
  });
  it('Year too late', () => {
    expect(normalizeDate('12/06/2100')).toEqual({ date: '12/06/2100', ok: false });
  });
  it('Empty string', () => {
    expect(normalizeDate('')).toEqual({ date: '', ok: false });
  });
  it('Null', () => {
    expect(normalizeDate(null)).toEqual({ date: '', ok: false });
  });
  it('Undefined', () => {
    expect(normalizeDate(undefined)).toEqual({ date: '', ok: false });
  });
  it('Non-string number', () => {
    expect(normalizeDate(12345)).toEqual({ date: '', ok: false });
  });
  it('Garbage', () => {
    expect(normalizeDate('not a date')).toEqual({ date: 'not a date', ok: false });
  });
  it('Half date', () => {
    expect(normalizeDate('12/06')).toEqual({ date: '12/06', ok: false });
  });
});

describe('validInvoiceNo', () => {
  it('Standard IN+8 digits', () => {
    expect(validInvoiceNo('IN93018360')).toBe(true);
  });
  it('Lowercase in (regex /i)', () => {
    expect(validInvoiceNo('in93018360')).toBe(true);
  });
  it('Mixed case', () => {
    expect(validInvoiceNo('In93018360')).toBe(true);
  });
  it('With trim', () => {
    expect(validInvoiceNo('  IN93018360  ')).toBe(true);
  });
  it('7 digits — too short', () => {
    expect(validInvoiceNo('IN9301836')).toBe(false);
  });
  it('9 digits — too long', () => {
    expect(validInvoiceNo('IN930183600')).toBe(false);
  });
  it('Letters mixed', () => {
    expect(validInvoiceNo('IN93A18360')).toBe(false);
  });
  it('No IN prefix', () => {
    expect(validInvoiceNo('93018360')).toBe(false);
  });
  it('Wrong prefix', () => {
    expect(validInvoiceNo('IV93018360')).toBe(false);
  });
  it('Empty string', () => {
    expect(validInvoiceNo('')).toBe(false);
  });
  it('Null', () => {
    expect(validInvoiceNo(null)).toBe(false);
  });
  it('Undefined', () => {
    expect(validInvoiceNo(undefined)).toBe(false);
  });
  it('Number type', () => {
    expect(validInvoiceNo(93018360)).toBe(false);
  });
});

describe('parseDesc (volume/pack extraction)', () => {
  it('Standard 320ML x 24', () => {
    expect(parseDesc('320MLALSCN1X24', null)).toEqual({ volume: 320, pack: 24 });
  });
  it('1.5L x 12 from desc', () => {
    expect(parseDesc('1.5LPLBTN1X12', null)).toEqual({ volume: 1500, pack: 12 });
  });
  it('1L x 12 (no decimal)', () => {
    expect(parseDesc('1LBTN1X12', null)).toEqual({ volume: 1000, pack: 12 });
  });
  it('300ML x 12', () => {
    expect(parseDesc('300MLALSCN1X12', null)).toEqual({ volume: 300, pack: 12 });
  });
  it('Uses code if desc empty', () => {
    expect(parseDesc('', '320MLX24')).toEqual({ volume: 320, pack: 24 });
  });
  it('Uses code if desc null', () => {
    expect(parseDesc(null, '320MLX24')).toEqual({ volume: 320, pack: 24 });
  });
  it('Falls back desc → code', () => {
    expect(parseDesc('NO MATCH HERE', '500ML X 24')).toEqual({ volume: 500, pack: 24 });
  });
  it('Both empty', () => {
    expect(parseDesc('', '')).toEqual({ volume: null, pack: null });
  });
  it('Both null', () => {
    expect(parseDesc(null, null)).toEqual({ volume: null, pack: null });
  });
  it('Multiplication sign ×', () => {
    expect(parseDesc('320ML×24', null)).toEqual({ volume: 320, pack: 24 });
  });
  it('Spaces in volume', () => {
    expect(parseDesc('320 ML 1X24', null)).toEqual({ volume: 320, pack: 24 });
  });
  it('Lowercase still works', () => {
    expect(parseDesc('320ml1x24', null)).toEqual({ volume: 320, pack: 24 });
  });
  it('Only volume no pack', () => {
    expect(parseDesc('320ML', null)).toEqual({ volume: null, pack: null });
  });
  it('Only pack no volume', () => {
    expect(parseDesc('X24', null)).toEqual({ volume: null, pack: null });
  });
  it('Garbage string', () => {
    expect(parseDesc('XYZABC', null)).toEqual({ volume: null, pack: null });
  });
});

describe('parseDesc — real Choon Hua codes (regression)', () => {
  it('1.75L bottled water code', () => {
    expect(parseDesc('1.75LPETBTN1X12', null)).toEqual({ volume: 1750, pack: 12 });
  });
  it('Description style with spaces', () => {
    expect(parseDesc('SOYA BEAN MILK 1.5L X12', null)).toEqual({ volume: 1500, pack: 12 });
  });
  it('Mixed-case in description', () => {
    expect(parseDesc('Coconut Water 500ml x 24', null)).toEqual({ volume: 500, pack: 24 });
  });
  it('L with no following letters', () => {
    expect(parseDesc('1L X12', null)).toEqual({ volume: 1000, pack: 12 });
  });
  it('1.5L followed by space', () => {
    expect(parseDesc('1.5L PLBTN 1X12', null)).toEqual({ volume: 1500, pack: 12 });
  });
  it('Word with L but no digit (BOTTLE)', () => {
    expect(parseDesc('BOTTLE FOR SAMPLE', null)).toEqual({ volume: null, pack: null });
  });
});

describe('formatVolUnit', () => {
  it('320ml → 320ML', () => { expect(formatVolUnit(320)).toBe('320ML'); });
  it('300ml → 300ML', () => { expect(formatVolUnit(300)).toBe('300ML'); });
  it('500ml → 500ML', () => { expect(formatVolUnit(500)).toBe('500ML'); });
  it('1000ml → 1L', () => { expect(formatVolUnit(1000)).toBe('1L'); });
  it('1500ml → 1.5L', () => { expect(formatVolUnit(1500)).toBe('1.5L'); });
  it('1750ml → 1.75L (FIXED)', () => { expect(formatVolUnit(1750)).toBe('1.75L'); });
  it('1250ml → 1.25L', () => { expect(formatVolUnit(1250)).toBe('1.25L'); });
  it('1100ml → 1.1L', () => { expect(formatVolUnit(1100)).toBe('1.1L'); });
  it('2000ml → 2L', () => { expect(formatVolUnit(2000)).toBe('2L'); });
  it('0 → empty', () => { expect(formatVolUnit(0)).toBe(''); });
  it('null → empty', () => { expect(formatVolUnit(null)).toBe(''); });
  it('undefined → empty', () => { expect(formatVolUnit(undefined)).toBe(''); });
  it('Negative → empty', () => { expect(formatVolUnit(-100)).toBe(''); });
});

describe('deriveActualLabel', () => {
  it('Empty map → fallback to rateLabel', () => {
    expect(deriveActualLabel(new Map(), '320ML x 24')).toBe('320ML x 24');
  });
  it('Null map → fallback', () => {
    expect(deriveActualLabel(null, '320ML x 24')).toBe('320ML x 24');
  });
  it('Single vol', () => {
    expect(
      deriveActualLabel(new Map([['k1', { volume_ml: 320, pack_size: 24 }]]), 'rate'),
    ).toBe('320ML x 24');
  });
  it('Two same-pack vols', () => {
    expect(
      deriveActualLabel(new Map([
        ['k1', { volume_ml: 320, pack_size: 24 }],
        ['k2', { volume_ml: 300, pack_size: 24 }],
      ]), 'rate'),
    ).toBe('320ML/300ML x 24');
  });
  it('Sorted high→low', () => {
    expect(
      deriveActualLabel(new Map([
        ['k1', { volume_ml: 300, pack_size: 24 }],
        ['k2', { volume_ml: 320, pack_size: 24 }],
      ]), 'rate'),
    ).toBe('320ML/300ML x 24');
  });
  it('Mixed packs join +', () => {
    expect(
      deriveActualLabel(new Map([
        ['k1', { volume_ml: 320, pack_size: 24 }],
        ['k2', { volume_ml: 1500, pack_size: 12 }],
      ]), 'rate'),
    ).toBe('320ML x 24 + 1.5L x 12');
  });
});

describe('matchCat', () => {
  const m1 = matchCat(320, 24, RATES, '320MLALSCN1X24', null);
  it('320ML x 24 → r3a', () => { expect(m1.cat?.id).toBe('r3a'); });
  it('320ML x 24 not inconsistent', () => { expect(m1.inconsistent).toBe(false); });

  const m2 = matchCat(1500, 12, RATES, '1.5LPLBTN1X12', null);
  it('1.5L x 12 → r1b', () => { expect(m2.cat?.id).toBe('r1b'); });

  // AI says 300×12, description says 320×24 → description wins → r3a.
  const m3 = matchCat(300, 12, RATES, '320ML 1X24', null);
  it('Description wins over AI vol', () => { expect(m3.cat?.id).toBe('r3a'); });
  it('Mismatch flagged as inconsistent', () => { expect(m3.inconsistent).toBe(true); });

  const m4 = matchCat(320, 24, RATES, null, null);
  it('No desc, AI used', () => { expect(m4.cat?.id).toBe('r3a'); });
  it('No desc, not inconsistent (only one source)', () => { expect(m4.inconsistent).toBe(false); });

  const m5 = matchCat(700, 24, RATES, '700ML 1X24', null);
  it('Out of range → no cat', () => { expect(m5.cat).toBeNull(); });

  const m6 = matchCat(320, 6, RATES, '320ML 1X6', null);
  it('Wrong pack → no cat', () => { expect(m6.cat).toBeNull(); });

  const m7 = matchCat(null, null, RATES, null, null);
  it('All null → no cat', () => { expect(m7.cat).toBeNull(); });
  it('All null usedVol is null', () => { expect(m7.usedVol).toBeNull(); });

  const m8 = matchCat(320, 24, [], '320ML 1X24', null);
  it('Empty rates → no cat', () => { expect(m8.cat).toBeNull(); });

  const m9 = matchCat('320', '24', RATES, null, null);
  it('AI strings coerced', () => { expect(m9.cat?.id).toBe('r3a'); });

  const m10 = matchCat(1750, 12, RATES, '1.75L 1X12', null);
  it('1.75L x 12 → r1a', () => { expect(m10.cat?.id).toBe('r1a'); });

  const m11 = matchCat(320, 24, RATES, null, null);
  it('320 NOT in r3b (300ML range)', () => { expect(m11.cat?.id).not.toBe('r3b'); });
  it('320 hits r3a', () => { expect(m11.cat?.id).toBe('r3a'); });
});

describe('calcSub', () => {
  it('Single cat positive amount', () => {
    // 10 CTN × 0.40 = 4.00 carton
    expect(calcSub(1000, [{ ctn: 10, rate: 0.40 }], 0.004, 0.002)).toEqual({
      carton: 4, p1: 3.98, p2: 1.98, total: 9.96,
    });
  });
  it('FOC (amt=0) keeps CARTON, zeros %', () => {
    expect(calcSub(0, [{ ctn: 10, rate: 0.40 }], 0.004, 0.002))
      .toEqual({ carton: 4, p1: 0, p2: 0, total: 4 });
  });
  it('FOC 1.5L x 12 keeps CARTON', () => {
    expect(calcSub(0, [{ ctn: 6, rate: 0.50 }], 0.004, 0.002))
      .toEqual({ carton: 3, p1: 0, p2: 0, total: 3 });
  });
  it('FOC 320ML x 24 real client case', () => {
    expect(calcSub(0, [{ ctn: 10, rate: 0.40 }], 0.004, 0.002))
      .toEqual({ carton: 4, p1: 0, p2: 0, total: 4 });
  });
  it('Negative amount keeps CARTON', () => {
    expect(calcSub(-100, [{ ctn: 10, rate: 0.50 }], 0.004, 0.002))
      .toEqual({ carton: 5, p1: 0, p2: 0, total: 5 });
  });
  it('Null amount keeps CARTON', () => {
    expect(calcSub(null, [{ ctn: 10, rate: 0.50 }], 0.004, 0.002))
      .toEqual({ carton: 5, p1: 0, p2: 0, total: 5 });
  });
  it('Undefined amount keeps CARTON', () => {
    expect(calcSub(undefined, [{ ctn: 5, rate: 0.40 }], 0.004, 0.002))
      .toEqual({ carton: 2, p1: 0, p2: 0, total: 2 });
  });
  it('FOC with empty groups → zero', () => {
    expect(calcSub(0, [], 0.004, 0.002))
      .toEqual({ carton: 0, p1: 0, p2: 0, total: 0 });
  });
  it('Multi-group carton sum', () => {
    // 50 × 0.50 + 30 × 0.40 = 25 + 12 = 37
    expect(calcSub(5000, [{ ctn: 50, rate: 0.50 }, { ctn: 30, rate: 0.40 }], 0.004, 0.002).carton)
      .toBe(37);
  });
  it('Empty groups positive amt carton=0', () => {
    expect(calcSub(1000, [], 0.004, 0.002).carton).toBe(0);
  });
});

describe('calcSub — real client bug (screenshot)', () => {
  // The exact 3-invoice scenario the client hit: two FOC lines had their carton
  // subsidy dropped from the summary. Regression suite locks in the fix.
  const inv1 = calcSub(23316, [{ ctn: 660, rate: 0.40 }], 0.004, 0.002);
  const inv2 = calcSub(0, [{ ctn: 10, rate: 0.40 }], 0.004, 0.002);
  const inv3 = calcSub(0, [{ ctn: 6, rate: 0.50 }], 0.004, 0.002);

  it('Invoice 1: 660 CTN @ RM23,316', () => {
    expect({ c: inv1.carton, p1: inv1.p1, p2: inv1.p2 })
      .toEqual({ c: 264, p1: 92.21, p2: 45.92 });
  });
  it('Invoice 2 (FOC): 10 CTN carton preserved', () => {
    expect(inv2.carton).toBe(4);
  });
  it('Invoice 3 (FOC): 6 CTN carton preserved', () => {
    expect(inv3.carton).toBe(3);
  });
  it('Summary CARTON = RM271 (was RM264 — bug)', () => {
    expect(inv1.carton + inv2.carton + inv3.carton).toBe(271);
  });
});

describe('computeIssues', () => {
  const baseValid = {
    parsed: { invoice_no: 'IN12345678', invoice_date: '12/06/2026', total_amount: 1000 },
    items: [],
    groups: [],
    declaredTotal: 0,
    duplicateInfo: null,
    extractedCtnSum: 0,
    manuallyAssigned: false,
  };

  describe('invoice_no checks', () => {
    it('Valid invoice → no issues', () => {
      expect(computeIssues(baseValid).length).toBe(0);
    });
    it('Missing invoice_no flagged', () => {
      const issues = computeIssues({
        ...baseValid, parsed: { ...baseValid.parsed, invoice_no: '' },
      }).filter(i => i.kind === 'invoice_no');
      expect(issues.length).toBe(1);
    });
    it('Bad invoice_no flagged', () => {
      const issues = computeIssues({
        ...baseValid, parsed: { ...baseValid.parsed, invoice_no: 'X123' },
      }).filter(i => i.kind === 'invoice_no');
      expect(issues.length).toBe(1);
    });
  });

  describe('date checks', () => {
    it('Bad date flagged', () => {
      const issues = computeIssues({
        ...baseValid, parsed: { ...baseValid.parsed, invoice_date: 'bad' },
      }).filter(i => i.kind === 'date');
      expect(issues.length).toBe(1);
    });
    it('Missing date flagged', () => {
      const issues = computeIssues({
        ...baseValid, parsed: { ...baseValid.parsed, invoice_date: '' },
      }).filter(i => i.kind === 'date');
      expect(issues.length).toBe(1);
    });
  });

  describe('duplicate detection', () => {
    it('True duplicate (same date+amount)', () => {
      const issues = computeIssues({
        ...baseValid,
        duplicateInfo: {
          isLikelyTrueDuplicate: true, otherDate: '12/06/2026',
          otherAmount: 1000, otherInvoiceNo: 'IN12345678',
        },
      }).filter(i => i.kind === 'duplicate' && i.msg.includes('likely a duplicate file'));
      expect(issues.length).toBe(1);
    });
    it('Extraction error (diff date/amount)', () => {
      const issues = computeIssues({
        ...baseValid,
        duplicateInfo: {
          isLikelyTrueDuplicate: false, otherDate: '13/06/2026',
          otherAmount: 2000, otherInvoiceNo: 'IN12345678',
        },
      }).filter(i => i.kind === 'duplicate' && i.msg.includes('AI likely misread'));
      expect(issues.length).toBe(1);
    });
  });

  describe('unmatched items', () => {
    it('Unmatched flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        items: [{ description: 'unknown', qty: 5, category: null }],
      }).filter(i => i.kind === 'unmatched');
      expect(issues.length).toBe(1);
    });
    it('Manual assignment suppresses unmatched warning', () => {
      const issues = computeIssues({
        ...baseValid,
        manuallyAssigned: true,
        items: [{ description: 'unknown', qty: 5, category: null }],
      }).filter(i => i.kind === 'unmatched');
      expect(issues.length).toBe(0);
    });
  });

  describe('extraction conflicts', () => {
    it('Inconsistent items flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        items: [{
          description: 'a', _inconsistent: true,
          _aiVol: 300, _aiPack: 24, _descVol: 320, _descPack: 24,
        }],
      }).filter(i => i.kind === 'extraction_conflict');
      expect(issues.length).toBe(1);
    });
  });

  describe('carton mismatch (multi-cat only)', () => {
    it('Single-cat mismatch NOT flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        declaredTotal: 100, extractedCtnSum: 90,
        groups: [{ ctn: 90, rate: 0.4 }],
      }).filter(i => i.kind === 'ctn_mismatch');
      expect(issues.length).toBe(0);
    });
    it('Multi-cat mismatch flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        declaredTotal: 100, extractedCtnSum: 90,
        groups: [{ ctn: 50, rate: 0.4 }, { ctn: 40, rate: 0.5 }],
      }).filter(i => i.kind === 'ctn_mismatch');
      expect(issues.length).toBe(1);
    });
  });

  describe('AI uncertain', () => {
    it('Uncertain fields flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        parsed: { ...baseValid.parsed, uncertain_fields: ['invoice_no'] },
      }).filter(i => i.kind === 'ai_uncertain');
      expect(issues.length).toBe(1);
    });
    it('Empty uncertain array not flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        parsed: { ...baseValid.parsed, uncertain_fields: [] },
      }).filter(i => i.kind === 'ai_uncertain');
      expect(issues.length).toBe(0);
    });
  });

  describe('amount sanity (decimal error)', () => {
    it('10x decimal error flagged', () => {
      const issues = computeIssues({
        ...baseValid,
        parsed: { ...baseValid.parsed, total_amount: 100 },
        items: [{ amount: 1000 }],
      }).filter(i => i.kind === 'amount_sanity');
      expect(issues.length).toBe(1);
    });
    it('Normal discount NOT flagged (1.1x)', () => {
      const issues = computeIssues({
        ...baseValid,
        parsed: { ...baseValid.parsed, total_amount: 1000 },
        items: [{ amount: 1100 }],
      }).filter(i => i.kind === 'amount_sanity');
      expect(issues.length).toBe(0);
    });
    it('No items → no sanity check', () => {
      const issues = computeIssues({ ...baseValid, items: [] })
        .filter(i => i.kind === 'amount_sanity');
      expect(issues.length).toBe(0);
    });
  });

  describe('null safety', () => {
    it('parsed=null does not crash', () => {
      expect(() => computeIssues({ ...baseValid, parsed: null })).not.toThrow();
    });
    it('parsed=undefined does not crash', () => {
      expect(() => computeIssues({ ...baseValid, parsed: undefined })).not.toThrow();
    });
    it('items=null does not crash', () => {
      expect(() => computeIssues({ ...baseValid, items: null })).not.toThrow();
    });
    it('groups=null does not crash', () => {
      expect(() => computeIssues({ ...baseValid, groups: null })).not.toThrow();
    });
  });
});

describe('fmt', () => {
  it('fmt(1234.5)', () => { expect(fmt(1234.5)).toBe('RM1,234.50'); });
  it('fmt(0)', () => { expect(fmt(0)).toBe('RM0.00'); });
  it('fmt("")', () => { expect(fmt('')).toBe(''); });
  it('fmt(null)', () => { expect(fmt(null)).toBe(''); });
  it('fmt(undefined)', () => { expect(fmt(undefined)).toBe(''); });
  it('fmt("100")', () => { expect(fmt('100')).toBe('RM100.00'); });
});

import { describe, it, expect } from 'vitest';
import { calcYHS, volLabel, parseVolInput } from '../YHSExtractor.jsx';

// The 7-invoice sample batch from the YHS Excel Owen provided (1.xlsx). Each
// invoice carries only the volumes it actually has (per-invoice breakdown).
// 250ML=360 (inv1), 300ML=990 (inv3/4/6); the rest are other volumes that earn
// transport subsidy only. Default rate RM0.50 for every volume.
const SAMPLE = [
  { amount: 6548.76, qty: 360, vols: { 250: 360 } },
  { amount: 5193.77, qty: 60, vols: {} },
  { amount: 9021, qty: 330, vols: { 300: 330 } },
  { amount: 9021, qty: 330, vols: { 300: 330 } },
  { amount: 12675.96, qty: 330, vols: {} },
  { amount: 9021, qty: 330, vols: { 300: 330 } },
  { amount: 9523.2, qty: 300, vols: {} },
];

describe('calcYHS — sample Excel batch (1.xlsx) reproduces the sheet exactly', () => {
  // No explicit rates → every volume falls back to the 0.50 default.
  const r = calcYHS({ invoices: SAMPLE, rates: {}, otherDiscount: 0, creditNote: 606.27 });

  it('TOTAL INVOICE AMOUNT = 61004.69', () => expect(r.totalAmount).toBe(61004.69));
  it('total cartons = 2040', () => expect(r.totalCtn).toBe(2040));
  it('2% DISCOUNT = 1220.0938 (unrounded, matches sheet)', () => expect(r.discount2).toBe(1220.0938));
  it('TRANSPORT SUBSIDY 0.30 = 612', () => expect(r.transport1).toBe(612));
  it('TRANSPORT SUBSIDY 0.20 = 408', () => expect(r.transport2).toBe(408));

  it('only 250ML and 300ML appear (empty-volume invoices contribute nothing)', () => {
    expect(r.volumes.map(v => v.ml)).toEqual([250, 300]);
  });
  it('250ML total = 360 CTN, bonus = 180', () => {
    const v = r.volumes.find(x => x.ml === 250);
    expect(v.ctn).toBe(360);
    expect(v.bonus).toBe(180);
  });
  it('300ML total = 990 CTN, bonus = 495', () => {
    const v = r.volumes.find(x => x.ml === 300);
    expect(v.ctn).toBe(990);
    expect(v.bonus).toBe(495);
  });
  it('total volume bonus = 675', () => expect(r.totalBonus).toBe(675));
  it('CREDIT NOTE carried through = 606.27', () => expect(r.creditNote).toBe(606.27));
  it('TOTAL AMOUNT PAYABLE = 57483.3262 (matches sheet exactly)', () => expect(r.payable).toBe(57483.3262));
});

describe('calcYHS — per-volume rates (some products get no discount)', () => {
  const invoices = [{ amount: 1000, qty: 100, vols: { 300: 40, 1000: 30, 1500: 30 } }];

  it('a volume with rate 0 earns no bonus; others use their own rate', () => {
    // 300ML @ 0.50, 1L @ 0 (no discount), 1.5L @ 0.80
    const r = calcYHS({ invoices, rates: { 300: 0.50, 1000: 0, 1500: 0.80 } });
    expect(r.volumes.find(v => v.ml === 300).bonus).toBe(20);  // 40 × 0.50
    expect(r.volumes.find(v => v.ml === 1000).bonus).toBe(0);  // 30 × 0
    expect(r.volumes.find(v => v.ml === 1500).bonus).toBe(24); // 30 × 0.80
    expect(r.totalBonus).toBe(44);
  });

  it('volumes without an explicit rate fall back to the 0.50 default', () => {
    const r = calcYHS({ invoices, rates: { 1500: 0.80 } });
    expect(r.volumes.find(v => v.ml === 300).rate).toBe(0.50);  // default
    expect(r.volumes.find(v => v.ml === 1000).rate).toBe(0.50); // default
    expect(r.volumes.find(v => v.ml === 1500).rate).toBe(0.80); // explicit
  });

  it('custom defaultRate applies to unspecified volumes', () => {
    const r = calcYHS({ invoices, rates: {}, defaultRate: 0.30 });
    expect(r.volumes.every(v => v.rate === 0.30)).toBe(true);
  });
});

describe('calcYHS — per-volume subsidy-qty override (only part of a volume qualifies)', () => {
  const invoices = [{ amount: 1000, qty: 100, vols: { 300: 100 } }];

  it('without an override, the full carton count earns the bonus', () => {
    const r = calcYHS({ invoices, rates: { 300: 0.50 } });
    const v = r.volumes.find(x => x.ml === 300);
    expect(v.ctn).toBe(100);
    expect(v.subsidyCtn).toBe(100);
    expect(v.overridden).toBe(false);
    expect(v.bonus).toBe(50); // 100 × 0.50
  });

  it('an override applies the rate to only the overridden qty; ctn stays the real total', () => {
    // 100 CTN total but only 60 qualify for the RM0.50 bonus (rest are no-discount).
    const r = calcYHS({ invoices, rates: { 300: 0.50 }, ctnOverrides: { 300: 60 } });
    const v = r.volumes.find(x => x.ml === 300);
    expect(v.ctn).toBe(100);        // real aggregate unchanged
    expect(v.subsidyCtn).toBe(60);  // qty that earns the bonus
    expect(v.overridden).toBe(true);
    expect(v.bonus).toBe(30);       // 60 × 0.50
    expect(r.totalBonus).toBe(30);
  });

  it('override does not change transport (still based on the real total cartons)', () => {
    const base = calcYHS({ invoices, rates: { 300: 0.50 } });
    const withOv = calcYHS({ invoices, rates: { 300: 0.50 }, ctnOverrides: { 300: 60 } });
    expect(withOv.transport1).toBe(base.transport1); // 100 × 0.30
    expect(withOv.transport2).toBe(base.transport2); // 100 × 0.20
  });

  it('an override of 0 zeroes the bonus for that volume', () => {
    const r = calcYHS({ invoices, rates: { 300: 0.50 }, ctnOverrides: { 300: 0 } });
    expect(r.volumes.find(v => v.ml === 300).bonus).toBe(0);
  });
});

describe('calcYHS — volumes aggregate across invoices and stay sorted', () => {
  const invoices = [
    { amount: 1000, qty: 100, vols: { 1500: 30, 250: 40 } },
    { amount: 500, qty: 60, vols: { 250: 20, 320: 40 } },
  ];
  const r = calcYHS({ invoices, rates: {} });

  it('distinct volumes sorted ascending by ml', () => {
    expect(r.volumes.map(v => v.ml)).toEqual([250, 320, 1500]);
  });
  it('250ML aggregates across both invoices (40 + 20 = 60)', () => {
    expect(r.volumes.find(v => v.ml === 250).ctn).toBe(60);
  });
  it('bonus = ctn × default rate', () => {
    expect(r.volumes.find(v => v.ml === 250).bonus).toBe(30);  // 60 × 0.50
    expect(r.totalBonus).toBe(65);
  });
});

describe('calcYHS — cartons with no volume earn transport only', () => {
  const invoices = [{ amount: 1000, qty: 100, vols: {} }];
  const r = calcYHS({ invoices, rates: {} });
  it('no volumes → zero bonus, transport still applies', () => {
    expect(r.volumes).toEqual([]);
    expect(r.totalBonus).toBe(0);
    expect(r.transport1).toBe(30);
    expect(r.transport2).toBe(20);
    expect(r.payable).toBe(930); // 1000 − 20 − 30 − 20
  });
});

describe('calcYHS — OTHER DISCOUNT is subtracted', () => {
  it('an other discount reduces the payable by exactly that amount', () => {
    const base = calcYHS({ invoices: SAMPLE, rates: {}, creditNote: 606.27 });
    const withOD = calcYHS({ invoices: SAMPLE, rates: {}, otherDiscount: 100, creditNote: 606.27 });
    expect(withOD.payable).toBe(Math.round((base.payable - 100) * 10000) / 10000);
  });
});

describe('calcYHS — edge cases', () => {
  it('empty batch → all zeros', () => {
    const r = calcYHS({ invoices: [], rates: {} });
    expect(r.totalAmount).toBe(0);
    expect(r.totalCtn).toBe(0);
    expect(r.totalBonus).toBe(0);
    expect(r.payable).toBe(0);
  });
  it('missing args default safely', () => {
    expect(() => calcYHS({})).not.toThrow();
    expect(calcYHS({}).payable).toBe(0);
  });
  it('non-numeric fields coerce to 0', () => {
    const r = calcYHS({ invoices: [{ amount: '500', qty: '50', vols: { 250: '25' } }], rates: {} });
    expect(r.totalAmount).toBe(500);
    expect(r.totalCtn).toBe(50);
    expect(r.volumes.find(v => v.ml === 250).ctn).toBe(25);
  });
});

describe('parseVolInput — friendly volume string → ml', () => {
  it('reads ML suffix', () => {
    expect(parseVolInput('320ML')).toBe(320);
    expect(parseVolInput('300ml')).toBe(300);
    expect(parseVolInput(' 500 ML ')).toBe(500);
  });
  it('reads L suffix and converts to ml', () => {
    expect(parseVolInput('1L')).toBe(1000);
    expect(parseVolInput('1.5L')).toBe(1500);
    expect(parseVolInput('1.2l')).toBe(1200);
    expect(parseVolInput('2L')).toBe(2000);
  });
  it('bare number ≤ 10 is read as litres', () => {
    expect(parseVolInput('1')).toBe(1000);
    expect(parseVolInput('1.5')).toBe(1500);
    expect(parseVolInput('1.25')).toBe(1250);
  });
  it('bare number > 10 is read as ml', () => {
    expect(parseVolInput('320')).toBe(320);
    expect(parseVolInput('500')).toBe(500);
    expect(parseVolInput('1000')).toBe(1000);
  });
  it('returns null for unreadable input so the old value is kept', () => {
    expect(parseVolInput('abc')).toBeNull();
    expect(parseVolInput('')).toBeNull();
    expect(parseVolInput(null)).toBeNull();
    expect(parseVolInput('0')).toBeNull();
    expect(parseVolInput('-5')).toBeNull();
  });
});

describe('volLabel', () => {
  it('250 → 250ML', () => expect(volLabel(250)).toBe('250ML'));
  it('300 → 300ML', () => expect(volLabel(300)).toBe('300ML'));
  it('320 → 320ML', () => expect(volLabel(320)).toBe('320ML'));
  it('1000 → 1L', () => expect(volLabel(1000)).toBe('1L'));
  it('1500 → 1.5L', () => expect(volLabel(1500)).toBe('1.5L'));
  it('1200 → 1.2L', () => expect(volLabel(1200)).toBe('1.2L'));
});

import { describe, it, expect } from 'vitest';
import { calcYHS, volLabel } from '../YHSExtractor.jsx';

// The 7-invoice sample batch from the YHS Excel Owen provided (1.xlsx). Each
// invoice carries only the volumes it actually has (per-invoice breakdown).
// 250ML=360 (inv1), 300ML=990 (inv3/4/6); the rest are other volumes that earn
// transport subsidy only. Flat rate RM0.50 for every volume.
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
  const r = calcYHS({ invoices: SAMPLE, rate: 0.50, otherDiscount: 0, creditNote: 606.27 });

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

describe('calcYHS — volumes aggregate across invoices and stay sorted', () => {
  const invoices = [
    { amount: 1000, qty: 100, vols: { 1500: 30, 250: 40 } },
    { amount: 500, qty: 60, vols: { 250: 20, 320: 40 } },
  ];
  const r = calcYHS({ invoices, rate: 0.50 });

  it('distinct volumes sorted ascending by ml', () => {
    expect(r.volumes.map(v => v.ml)).toEqual([250, 320, 1500]);
  });
  it('250ML aggregates across both invoices (40 + 20 = 60)', () => {
    expect(r.volumes.find(v => v.ml === 250).ctn).toBe(60);
  });
  it('bonus = ctn × flat rate', () => {
    expect(r.volumes.find(v => v.ml === 250).bonus).toBe(30);  // 60 × 0.50
    expect(r.volumes.find(v => v.ml === 320).bonus).toBe(20);  // 40 × 0.50
    expect(r.volumes.find(v => v.ml === 1500).bonus).toBe(15); // 30 × 0.50
    expect(r.totalBonus).toBe(65);
  });
});

describe('calcYHS — the flat rate applies to every volume', () => {
  const invoices = [{ amount: 1000, qty: 100, vols: { 320: 40, 1000: 30, 1500: 30 } }];
  it('rate 0.50 → total bonus 50, payable 880', () => {
    const r = calcYHS({ invoices, rate: 0.50 });
    expect(r.totalBonus).toBe(50);
    // 1000 − 20 (2%) − 30 (0.30) − 20 (0.20) − 50 (volume) = 880
    expect(r.payable).toBe(880);
  });
  it('a different flat rate scales all volumes together', () => {
    const r = calcYHS({ invoices, rate: 0.80 });
    expect(r.totalBonus).toBe(80); // 100 × 0.80
  });
});

describe('calcYHS — cartons with no volume earn transport only', () => {
  const invoices = [{ amount: 1000, qty: 100, vols: {} }];
  const r = calcYHS({ invoices, rate: 0.50 });
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
    const base = calcYHS({ invoices: SAMPLE, rate: 0.50, creditNote: 606.27 });
    const withOD = calcYHS({ invoices: SAMPLE, rate: 0.50, otherDiscount: 100, creditNote: 606.27 });
    expect(withOD.payable).toBe(Math.round((base.payable - 100) * 10000) / 10000);
  });
});

describe('calcYHS — edge cases', () => {
  it('empty batch → all zeros', () => {
    const r = calcYHS({ invoices: [], rate: 0.50 });
    expect(r.totalAmount).toBe(0);
    expect(r.totalCtn).toBe(0);
    expect(r.totalBonus).toBe(0);
    expect(r.payable).toBe(0);
  });
  it('missing args default safely (rate defaults to 0.50)', () => {
    expect(() => calcYHS({})).not.toThrow();
    expect(calcYHS({}).payable).toBe(0);
    expect(calcYHS({}).rate).toBe(0.50);
  });
  it('non-numeric fields coerce to 0', () => {
    const r = calcYHS({ invoices: [{ amount: '500', qty: '50', vols: { 250: '25' } }], rate: 0.50 });
    expect(r.totalAmount).toBe(500);
    expect(r.totalCtn).toBe(50);
    expect(r.volumes.find(v => v.ml === 250).ctn).toBe(25);
  });
});

describe('volLabel', () => {
  it('250 → 250ML', () => expect(volLabel(250)).toBe('250ML'));
  it('300 → 300ML', () => expect(volLabel(300)).toBe('300ML'));
  it('320 → 320ML', () => expect(volLabel(320)).toBe('320ML'));
  it('1000 → 1L', () => expect(volLabel(1000)).toBe('1L'));
  it('1500 → 1.5L', () => expect(volLabel(1500)).toBe('1.5L'));
});

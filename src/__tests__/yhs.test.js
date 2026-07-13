import { describe, it, expect } from 'vitest';
import { calcYHS, volLabel } from '../YHSExtractor.jsx';

// The 7-invoice sample batch from the YHS Excel Owen provided (1.xlsx), now with
// per-volume carton maps. 250ML=360 (inv1), 300ML=990 (inv3/4/6), rest are other
// volumes that earn transport subsidy only.
const SAMPLE = [
  { amount: 6548.76, qty: 360, vols: { 250: 360 } },
  { amount: 5193.77, qty: 60, vols: {} },
  { amount: 9021, qty: 330, vols: { 300: 330 } },
  { amount: 9021, qty: 330, vols: { 300: 330 } },
  { amount: 12675.96, qty: 330, vols: {} },
  { amount: 9021, qty: 330, vols: { 300: 330 } },
  { amount: 9523.2, qty: 300, vols: {} },
];

// Original deal: 250ML and 300ML at RM0.50/CTN.
const VOLCATS = [
  { ml: 250, rate: 0.50 },
  { ml: 300, rate: 0.50 },
];

describe('calcYHS — sample Excel batch (1.xlsx) reproduces the sheet exactly', () => {
  const r = calcYHS({ invoices: SAMPLE, volCats: VOLCATS, otherDiscount: 0, creditNote: 606.27 });

  it('TOTAL INVOICE AMOUNT = 61004.69', () => expect(r.totalAmount).toBe(61004.69));
  it('total cartons = 2040', () => expect(r.totalCtn).toBe(2040));
  it('2% DISCOUNT = 1220.0938 (unrounded, matches sheet)', () => expect(r.discount2).toBe(1220.0938));
  it('TRANSPORT SUBSIDY 0.30 = 612', () => expect(r.transport1).toBe(612));
  it('TRANSPORT SUBSIDY 0.20 = 408', () => expect(r.transport2).toBe(408));

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

describe('calcYHS — flexible volumes (320ML, 1L, 1.5L)', () => {
  const invoices = [
    { amount: 1000, qty: 100, vols: { 320: 40, 1000: 30, 1500: 30 } },
  ];
  const volCats = [
    { ml: 320, rate: 0.50 },
    { ml: 1000, rate: 0.50 },
    { ml: 1500, rate: 0.50 },
  ];
  const r = calcYHS({ invoices, volCats });

  it('each volume totals its cartons', () => {
    expect(r.volumes.find(v => v.ml === 320).ctn).toBe(40);
    expect(r.volumes.find(v => v.ml === 1000).ctn).toBe(30);
    expect(r.volumes.find(v => v.ml === 1500).ctn).toBe(30);
  });
  it('bonus = ctn × rate per volume', () => {
    expect(r.volumes.find(v => v.ml === 320).bonus).toBe(20); // 40 × 0.50
    expect(r.totalBonus).toBe(50); // (40+30+30) × 0.50
  });
  it('payable = 1000 − 20 (2%) − 30 (0.30) − 20 (0.20) − 50 (volume) = 880', () => {
    expect(r.payable).toBe(880);
  });
});

describe('calcYHS — per-volume rates can differ', () => {
  const invoices = [{ amount: 500, qty: 20, vols: { 250: 10, 1500: 10 } }];
  const volCats = [
    { ml: 250, rate: 0.50 },
    { ml: 1500, rate: 0.80 },  // a different rate for the big bottles
  ];
  const r = calcYHS({ invoices, volCats });
  it('250ML @ 0.50 → 5.00', () => expect(r.volumes.find(v => v.ml === 250).bonus).toBe(5));
  it('1.5L @ 0.80 → 8.00', () => expect(r.volumes.find(v => v.ml === 1500).bonus).toBe(8));
  it('total bonus = 13', () => expect(r.totalBonus).toBe(13));
});

describe('calcYHS — a volume with no configured rate earns no bonus', () => {
  // 690 "other" cartons in the sample earned transport subsidy only. Cartons
  // whose volume isn't in volCats must not add a bonus.
  const invoices = [{ amount: 1000, qty: 100, vols: { 999: 100 } }];
  const volCats = [{ ml: 250, rate: 0.50 }];
  const r = calcYHS({ invoices, volCats });
  it('unconfigured volume → zero bonus, still counts in transport', () => {
    expect(r.totalBonus).toBe(0);
    expect(r.transport1).toBe(30); // 100 × 0.30
    expect(r.transport2).toBe(20); // 100 × 0.20
  });
});

describe('calcYHS — OTHER DISCOUNT is subtracted', () => {
  it('an other discount reduces the payable by exactly that amount', () => {
    const base = calcYHS({ invoices: SAMPLE, volCats: VOLCATS, creditNote: 606.27 });
    const withOD = calcYHS({ invoices: SAMPLE, volCats: VOLCATS, otherDiscount: 100, creditNote: 606.27 });
    expect(withOD.payable).toBe(Math.round((base.payable - 100) * 10000) / 10000);
  });
});

describe('calcYHS — edge cases', () => {
  it('empty batch → all zeros', () => {
    const r = calcYHS({ invoices: [], volCats: VOLCATS });
    expect(r.totalAmount).toBe(0);
    expect(r.totalCtn).toBe(0);
    expect(r.totalBonus).toBe(0);
    expect(r.payable).toBe(0);
  });
  it('missing args default safely', () => {
    expect(() => calcYHS({})).not.toThrow();
    expect(calcYHS({}).payable).toBe(0);
  });
  it('no volCats → only transport + 2% apply', () => {
    const r = calcYHS({ invoices: [{ amount: 1000, qty: 100, vols: { 250: 100 } }], volCats: [] });
    expect(r.totalBonus).toBe(0);
    expect(r.payable).toBe(930); // 1000 − 20 − 30 − 20
  });
  it('non-numeric fields coerce to 0', () => {
    const r = calcYHS({ invoices: [{ amount: '500', qty: '50', vols: { 250: '25' } }], volCats: VOLCATS });
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

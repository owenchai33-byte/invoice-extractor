import { describe, it, expect } from 'vitest';
import { calcYHS } from '../YHSExtractor.jsx';

// The 7-invoice sample batch from the YHS Excel Owen provided (1.xlsx).
// Verifies the calc reproduces the sheet's summary block exactly.
const SAMPLE = [
  { amount: 6548.76, qty: 360, ctn250: 360, ctn300: 0 },
  { amount: 5193.77, qty: 60,  ctn250: 0,   ctn300: 0 },
  { amount: 9021,    qty: 330, ctn250: 0,   ctn300: 330 },
  { amount: 9021,    qty: 330, ctn250: 0,   ctn300: 330 },
  { amount: 12675.96, qty: 330, ctn250: 0,  ctn300: 0 },
  { amount: 9021,    qty: 330, ctn250: 0,   ctn300: 330 },
  { amount: 9523.2,  qty: 300, ctn250: 0,   ctn300: 0 },
];

describe('calcYHS — sample Excel batch (1.xlsx)', () => {
  const r = calcYHS({ invoices: SAMPLE, otherDiscount: 0, creditNote: 606.27 });

  it('TOTAL INVOICE AMOUNT = 61004.69', () => {
    expect(r.totalAmount).toBe(61004.69);
  });
  it('total cartons = 2040', () => {
    expect(r.totalCtn).toBe(2040);
  });
  it('total 250ML cartons = 360', () => {
    expect(r.total250).toBe(360);
  });
  it('total 300ML cartons = 990', () => {
    expect(r.total300).toBe(990);
  });
  it('2% DISCOUNT = 1220.0938 (not rounded to sen, matches sheet)', () => {
    expect(r.discount2).toBe(1220.0938);
  });
  it('TRANSPORT SUBSIDY 0.30 = 612', () => {
    expect(r.transport1).toBe(612);
  });
  it('TRANSPORT SUBSIDY 0.20 = 408', () => {
    expect(r.transport2).toBe(408);
  });
  it('250ML bonus = 180', () => {
    expect(r.bonus250).toBe(180);
  });
  it('300ML bonus = 495', () => {
    expect(r.bonus300).toBe(495);
  });
  it('CREDIT NOTE carried through = 606.27', () => {
    expect(r.creditNote).toBe(606.27);
  });
  it('TOTAL AMOUNT PAYABLE = 57483.3262 (matches sheet exactly)', () => {
    expect(r.payable).toBe(57483.3262);
  });
});

describe('calcYHS — OTHER DISCOUNT is subtracted', () => {
  it('an other discount reduces the payable by exactly that amount', () => {
    const base = calcYHS({ invoices: SAMPLE, creditNote: 606.27 });
    const withOD = calcYHS({ invoices: SAMPLE, otherDiscount: 100, creditNote: 606.27 });
    expect(withOD.payable).toBe(Math.round((base.payable - 100) * 10000) / 10000);
  });
});

describe('calcYHS — edge cases', () => {
  it('empty batch → all zeros', () => {
    expect(calcYHS({ invoices: [] })).toEqual({
      totalAmount: 0, totalCtn: 0, total250: 0, total300: 0,
      discount2: 0, transport1: 0, transport2: 0, bonus250: 0, bonus300: 0,
      otherDiscount: 0, creditNote: 0, payable: 0,
    });
  });
  it('missing args default safely', () => {
    expect(() => calcYHS({})).not.toThrow();
    expect(calcYHS({}).payable).toBe(0);
  });
  it('single invoice, no 250/300 cartons', () => {
    const r = calcYHS({ invoices: [{ amount: 1000, qty: 100, ctn250: 0, ctn300: 0 }] });
    // 1000 - 20 (2%) - 30 (0.30) - 20 (0.20) = 930
    expect(r.discount2).toBe(20);
    expect(r.transport1).toBe(30);
    expect(r.transport2).toBe(20);
    expect(r.payable).toBe(930);
  });
  it('non-numeric fields coerce to 0', () => {
    const r = calcYHS({ invoices: [{ amount: '500', qty: '50', ctn250: null, ctn300: undefined }] });
    expect(r.totalAmount).toBe(500);
    expect(r.totalCtn).toBe(50);
    expect(r.total250).toBe(0);
    expect(r.total300).toBe(0);
  });
});

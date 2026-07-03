import { describe, it, expect } from 'vitest';
import {
  calcEPF,
  calcSOCSO,
  calcEIS,
  getAgeFromIC,
  fmt,
} from '../Payroll.jsx';

// Reference date used across age-detection tests: 29 June 2026.
const REF = new Date(2026, 5, 29);

describe('EPF Third Schedule (under 60)', () => {
  it('Simon RM2550 → 333/282', () => {
    expect(calcEPF(2550, 51)).toEqual({ employer: 333, employee: 282 });
  });
  it('RM1700 base', () => {
    expect(calcEPF(1700, 30)).toEqual({ employer: 221, employee: 187 });
  });
  it('RM1700.01 → next band (1720)', () => {
    expect(calcEPF(1700.01, 30)).toEqual({ employer: 224, employee: 190 });
  });
  it('RM2540 exact edge', () => {
    expect(calcEPF(2540, 30)).toEqual({ employer: 331, employee: 280 });
  });
  it('RM2541 → next band (2560)', () => {
    expect(calcEPF(2541, 30)).toEqual({ employer: 333, employee: 282 });
  });
  it('RM5000 at threshold', () => {
    expect(calcEPF(5000, 30)).toEqual({ employer: 650, employee: 550 });
  });
  it('RM5001 no band (12% flat)', () => {
    expect(calcEPF(5001, 30)).toEqual({ employer: 601, employee: 551 });
  });
  it('RM10000 high wage', () => {
    expect(calcEPF(10000, 30)).toEqual({ employer: 1200, employee: 1100 });
  });
  it('RM20 minimum band', () => {
    expect(calcEPF(20, 30)).toEqual({ employer: 3, employee: 3 });
  });
  it('RM100 small wage', () => {
    expect(calcEPF(100, 30)).toEqual({ employer: 13, employee: 11 });
  });
  it('RM3000 mid range', () => {
    expect(calcEPF(3000, 30)).toEqual({ employer: 390, employee: 330 });
  });
});

describe('EPF age 60+', () => {
  it('60yo RM2550', () => {
    expect(calcEPF(2550, 60)).toEqual({ employer: 167, employee: 141 });
  });
  it('60yo RM1700', () => {
    expect(calcEPF(1700, 60)).toEqual({ employer: 111, employee: 94 });
  });
  it('65yo RM5000', () => {
    expect(calcEPF(5000, 65)).toEqual({ employer: 325, employee: 275 });
  });
  it('75yo RM3000', () => {
    expect(calcEPF(3000, 75)).toEqual({ employer: 195, employee: 165 });
  });
});

describe('SOCSO Cat 1 (under 60, includes Lindung 24 Jam)', () => {
  it('RM1700 base', () => {
    expect(calcSOCSO(1700, 30)).toEqual({
      employer: 28.85, employee: 20.6, employeeInv: 8.25, employeeNEI: 12.35,
    });
  });
  it('Simon RM2550 → 44.65/31.90', () => {
    expect(calcSOCSO(2550, 51)).toEqual({
      employer: 44.65, employee: 31.90, employeeInv: 12.75, employeeNEI: 19.15,
    });
  });
  it('RM2500 exact edge', () => {
    expect(calcSOCSO(2500, 30)).toEqual({
      employer: 42.85, employee: 30.6, employeeInv: 12.25, employeeNEI: 18.35,
    });
  });
  it('RM2501 → next band 2600', () => {
    expect(calcSOCSO(2501, 30)).toEqual({
      employer: 44.65, employee: 31.90, employeeInv: 12.75, employeeNEI: 19.15,
    });
  });
  it('RM6000 ceiling', () => {
    expect(calcSOCSO(6000, 30)).toEqual({
      employer: 104.65, employee: 74.45, employeeInv: 29.90, employeeNEI: 44.55,
    });
  });
  it('RM10000 above ceiling (capped)', () => {
    expect(calcSOCSO(10000, 30)).toEqual({
      employer: 104.65, employee: 74.45, employeeInv: 29.90, employeeNEI: 44.55,
    });
  });
  it('RM30 minimum', () => {
    expect(calcSOCSO(30, 30)).toEqual({
      employer: 0.4, employee: 0.3, employeeInv: 0.1, employeeNEI: 0.2,
    });
  });
});

describe('SOCSO Cat 2 (age 60+)', () => {
  it('60yo RM1700', () => {
    expect(calcSOCSO(1700, 60)).toEqual({
      employer: 20.60, employee: 0, employeeInv: 0, employeeNEI: 0,
    });
  });
  it('65yo RM3000', () => {
    expect(calcSOCSO(3000, 65)).toEqual({
      employer: 36.90, employee: 0, employeeInv: 0, employeeNEI: 0,
    });
  });
  it('70yo RM6000 ceiling', () => {
    expect(calcSOCSO(6000, 70)).toEqual({
      employer: 74.40, employee: 0, employeeInv: 0, employeeNEI: 0,
    });
  });
});

describe('EIS (banded 0.2% + 0.2%)', () => {
  it('Simon RM2550 → 5.10/5.10', () => {
    expect(calcEIS(2550, 51)).toEqual({ employer: 5.10, employee: 5.10 });
  });
  it('RM1700 base', () => {
    expect(calcEIS(1700, 30)).toEqual({ employer: 3.30, employee: 3.30 });
  });
  it('RM2500 exact edge', () => {
    expect(calcEIS(2500, 30)).toEqual({ employer: 4.90, employee: 4.90 });
  });
  it('RM6000 ceiling', () => {
    expect(calcEIS(6000, 30)).toEqual({ employer: 11.90, employee: 11.90 });
  });
  it('RM10000 above ceiling', () => {
    expect(calcEIS(10000, 30)).toEqual({ employer: 11.90, employee: 11.90 });
  });
});

describe('EIS age exclusions', () => {
  it('Under 18 (16yo)', () => {
    expect(calcEIS(1700, 16)).toEqual({ employer: 0, employee: 0 });
  });
  it('Under 18 (17yo)', () => {
    expect(calcEIS(1700, 17)).toEqual({ employer: 0, employee: 0 });
  });
  it('Exactly 18 (included)', () => {
    expect(calcEIS(1700, 18)).toEqual({ employer: 3.30, employee: 3.30 });
  });
  it('Exactly 59 (included)', () => {
    expect(calcEIS(1700, 59)).toEqual({ employer: 3.30, employee: 3.30 });
  });
  it('Exactly 60 (excluded)', () => {
    expect(calcEIS(1700, 60)).toEqual({ employer: 0, employee: 0 });
  });
  it('Over 60', () => {
    expect(calcEIS(1700, 65)).toEqual({ employer: 0, employee: 0 });
  });
});

describe('Age detection from IC', () => {
  it('Simon 740202-13-5485 → 52', () => {
    expect(getAgeFromIC('740202-13-5485', REF)).toBe(52);
  });
  it('Jenny 940921-13-5170 → 31', () => {
    expect(getAgeFromIC('940921-13-5170', REF)).toBe(31);
  });
  it('Janet 971020-13-5220 → 28', () => {
    expect(getAgeFromIC('971020-13-5220', REF)).toBe(28);
  });
  it('Lo Hui Tin 961122-13-5142 → 29', () => {
    expect(getAgeFromIC('961122-13-5142', REF)).toBe(29);
  });
  it('Voon 001028-13-1446 → 25', () => {
    expect(getAgeFromIC('001028-13-1446', REF)).toBe(25);
  });
  it('Chai Wan Nee 011227-13-0648 → 24', () => {
    expect(getAgeFromIC('011227-13-0648', REF)).toBe(24);
  });
  it('IC without dashes', () => {
    expect(getAgeFromIC('740202135485', REF)).toBe(52);
  });
  it('null IC → null', () => {
    expect(getAgeFromIC(null, REF)).toBeNull();
  });
  it('empty IC → null', () => {
    expect(getAgeFromIC('', REF)).toBeNull();
  });
  it('short IC → null', () => {
    expect(getAgeFromIC('740', REF)).toBeNull();
  });
  it('Bday today (turning 50)', () => {
    expect(getAgeFromIC('760629-13-1234', REF)).toBe(50);
  });
  it('Bday tomorrow (still 49)', () => {
    expect(getAgeFromIC('760630-13-1234', REF)).toBe(49);
  });
  it('Bday yesterday (turned 50)', () => {
    expect(getAgeFromIC('760628-13-1234', REF)).toBe(50);
  });
  it('Born 2000 (yy=00) → 26', () => {
    expect(getAgeFromIC('000101-13-1234', REF)).toBe(26);
  });
  it('Born 1931 (yy=31 → 1931)', () => {
    expect(getAgeFromIC('310101-13-1234', REF)).toBe(95);
  });
});

describe('Full payroll row — Simon (RM2250 salary + 300 incentive)', () => {
  const simonAge = getAgeFromIC('740202-13-5485', REF);
  const simonEpfWage = 2250 + 300 + 0;       // salary + incentive + bonus
  const simonSssWage = 2250 + 300;           // salary + incentive (no bonus)
  const simonEpf = calcEPF(simonEpfWage, simonAge);
  const simonSocso = calcSOCSO(simonSssWage, simonAge);
  const simonEis = calcEIS(simonSssWage, simonAge);

  it('Simon EPF M (employer)', () => {
    expect(simonEpf.employer).toBe(333);
  });
  it('Simon EPF P (employee)', () => {
    expect(simonEpf.employee).toBe(282);
  });
  it('Simon SOCSO M', () => {
    expect(simonSocso.employer).toBe(44.65);
  });
  it('Simon SOCSO P', () => {
    expect(simonSocso.employee).toBe(31.90);
  });
  it('Simon EIS', () => {
    expect(simonEis.employee).toBe(5.10);
  });
  it('Simon net pay', () => {
    const gross = 2250 + 300 + 0;
    const deductions = simonEpf.employee + simonSocso.employee + simonEis.employee;
    expect(gross - deductions).toBe(2550 - 282 - 31.90 - 5.10); // 2231.00
  });
});

describe('Full payroll row — Standard RM1700 staff (no incentive)', () => {
  const jennyAge = getAgeFromIC('940921-13-5170', REF);
  const jennyEpf = calcEPF(1700, jennyAge);
  const jennySocso = calcSOCSO(1700, jennyAge);
  const jennyEis = calcEIS(1700, jennyAge);

  it('Jenny EPF M', () => {
    expect(jennyEpf.employer).toBe(221);
  });
  it('Jenny EPF P', () => {
    expect(jennyEpf.employee).toBe(187);
  });
  it('Jenny SOCSO M', () => {
    expect(jennySocso.employer).toBe(28.85);
  });
  it('Jenny SOCSO P', () => {
    expect(jennySocso.employee).toBe(20.60);
  });
  it('Jenny EIS', () => {
    expect(jennyEis.employee).toBe(3.30);
  });
  it('Jenny net pay', () => {
    const net = 1700 - 187 - 20.60 - 3.30;
    expect(Math.round(net * 100) / 100).toBe(1489.10);
  });
});

describe('Edge cases — input validation guards', () => {
  it('Zero salary EPF', () => {
    expect(calcEPF(0, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('Zero salary SOCSO (guarded)', () => {
    expect(calcSOCSO(0, 30)).toEqual({ employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 });
  });
  it('Zero salary EIS (guarded)', () => {
    expect(calcEIS(0, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('Negative wage EPF (guarded)', () => {
    expect(calcEPF(-100, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('Negative wage SOCSO (guarded)', () => {
    expect(calcSOCSO(-100, 30)).toEqual({ employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 });
  });
  it('Negative wage EIS (guarded)', () => {
    expect(calcEIS(-100, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('NaN EPF (guarded)', () => {
    expect(calcEPF(NaN, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('NaN SOCSO (guarded — critical, was max!)', () => {
    expect(calcSOCSO(NaN, 30)).toEqual({ employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 });
  });
  it('NaN EIS (guarded — critical, was max!)', () => {
    expect(calcEIS(NaN, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('undefined EPF (guarded)', () => {
    expect(calcEPF(undefined, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('undefined SOCSO (guarded)', () => {
    expect(calcSOCSO(undefined, 30)).toEqual({ employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 });
  });
  it('undefined EIS (guarded)', () => {
    expect(calcEIS(undefined, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('null EPF (guarded)', () => {
    expect(calcEPF(null, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('null SOCSO (guarded)', () => {
    expect(calcSOCSO(null, 30)).toEqual({ employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 });
  });
  it('null EIS (guarded)', () => {
    expect(calcEIS(null, 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('Empty string EPF (guarded)', () => {
    expect(calcEPF('', 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('Empty string SOCSO (guarded)', () => {
    expect(calcSOCSO('', 30)).toEqual({ employer: 0, employee: 0, employeeInv: 0, employeeNEI: 0 });
  });
  it('Empty string EIS (guarded)', () => {
    expect(calcEIS('', 30)).toEqual({ employer: 0, employee: 0 });
  });
  it('Decimal wage 1750.55 EPF', () => {
    expect(calcEPF(1750.55, 30)).toEqual({ employer: 229, employee: 194 });
  });
  it('Decimal wage 1750.55 SOCSO', () => {
    expect(calcSOCSO(1750.55, 30)).toEqual({
      employer: 30.65, employee: 21.9, employeeInv: 8.75, employeeNEI: 13.15,
    });
  });
});

describe('getAgeFromIC garbage handling', () => {
  it('Garbage IC returns null', () => {
    expect(getAgeFromIC('abcdef', REF)).toBeNull();
  });
  it('Mixed garbage IC returns null', () => {
    expect(getAgeFromIC('abcxyz-13-1234', REF)).toBeNull();
  });
  it('null IC', () => {
    expect(getAgeFromIC(null, REF)).toBeNull();
  });
});

describe('fmt() guard — no crashes on bad inputs', () => {
  it('fmt(null) → "0.00"', () => {
    expect(fmt(null)).toBe('0.00');
  });
  it('fmt(undefined) → "0.00"', () => {
    expect(fmt(undefined)).toBe('0.00');
  });
  it('fmt(NaN) → "0.00"', () => {
    expect(fmt(NaN)).toBe('0.00');
  });
  it('fmt(Infinity) → "0.00"', () => {
    expect(fmt(Infinity)).toBe('0.00');
  });
  it('fmt(0) → "0.00"', () => {
    expect(fmt(0)).toBe('0.00');
  });
  it('fmt(1489.10) → "1,489.10"', () => {
    expect(fmt(1489.10)).toBe('1,489.10');
  });
  it('fmt(-50) → "-50.00"', () => {
    expect(fmt(-50)).toBe('-50.00');
  });
});

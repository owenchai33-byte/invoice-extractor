import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/*
 * FORMAT PROTECTION — DO NOT MODIFY THESE HASHES WITHOUT SABRINA'S CONSENT
 *
 * These tests guard the visual format of every feature in Sabrina OS.
 * Each hash is a SHA-256 fingerprint of the component's CSS block.
 * If a format changes, the hash changes, this test fails, and deploy is blocked.
 *
 * To update after an APPROVED change:
 *   1. Get Sabrina's explicit consent for the format change
 *   2. Run: node -e "const c=require('crypto'),f=require('fs');const s=f.readFileSync(process.argv[1],'utf8');const m=s.match(/const CSS\s*=\s*\x60([\s\S]*?)\x60/);console.log(m?c.createHash('sha256').update(m[1]).digest('hex').slice(0,16):'NO_CSS')" src/FILENAME.jsx
 *   3. Replace the old hash with the new one below
 */

const PROTECTED_FORMATS = {
  'src/Payslip.jsx':          '430bb3e62966b314',
  'src/Payroll.jsx':          '593b10929efb1b79',
  'src/WeeklyPayment.jsx':    '5eee73ba86442fc4',
  'src/BeverageFOC.jsx':      '27319168abc50c81',
  'src/EmployeePayslip.jsx':  '2ef2ae401c1e466a',
  'src/MerchantReport.jsx':   '162fa68fe0a043b4',
  'src/BankRecon.jsx':        '3d90d83a9b95eeb7',
};

const root = resolve(__dirname, '../..');

function getCSSHash(filePath) {
  const content = readFileSync(resolve(root, filePath), 'utf8');
  const match = content.match(/const CSS\s*=\s*`([\s\S]*?)`/);
  if (!match) return 'NO_CSS';
  return createHash('sha256').update(match[1]).digest('hex').slice(0, 16);
}

describe('Format Protection — DO NOT change without Sabrina\'s consent', () => {
  for (const [file, expectedHash] of Object.entries(PROTECTED_FORMATS)) {
    it(`${file} format unchanged`, () => {
      const actual = getCSSHash(file);
      expect(actual, `
╔══════════════════════════════════════════════════════════════╗
║  ⛔ FORMAT CHANGE DETECTED: ${file.padEnd(33)}║
║                                                              ║
║  This file's CSS/layout has been modified.                   ║
║  ALL formats are PROTECTED — you MUST get Sabrina's          ║
║  explicit consent before changing any format.                ║
║                                                              ║
║  If approved, update the hash in formatProtection.test.js    ║
╚══════════════════════════════════════════════════════════════╝
      `).toBe(expectedHash);
    });
  }
});

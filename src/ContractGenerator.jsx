import { useState, useEffect, useRef, Fragment } from 'react';
import { callAI, parseAIJson, downsizeBase64ToJPEG, AI_PROVIDER, AI_CFG } from './InvoiceExtractor';
import cjkLetterhead from './cjk_letterhead.png';   // exact letterhead lifted from the official CJK contract PDF

// Employment Contract generator (CJK). Four outlets (HQ/KC/ST/TH) share one 4-page
// contract body; only the workplace address and the witness signatory differ per
// outlet. The per-employee variables (name, NRIC, address, position, effective date)
// are click-to-type & editable, print clean (no highlight) to A4. Multiple IC photos
// can be uploaded at once → one editable contract is generated per IC.

const LS_KEY = 'contract_data_v2';       // { HQ:[...], KC:[...], ST:[...], TH:[...] }
const LS_OUTLET = 'contract_outlet_v1';
const F = `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif`;
const SERIF = `"Times New Roman", Times, serif`;

// ── Per-outlet variables. Everything else in the contract is identical. ──
const OUTLETS = {
  HQ: {
    label: 'HQ',
    workplace: 'No. 19-27, Jalan Petanak, 93100, Kuching, Sarawak,',
    witness: { name: 'Sabrina Chai Wen Hui', nric: '000606-13-0548', designation: 'Account Executive' },
  },
  KC: {
    label: 'KC',
    workplace: 'Ground Floor, Lot 45, 46, Block F, Jalan Tun Jugah, Kings Centre, 93350 Kuching, Sarawak,',
    witness: { name: 'Chai Ah Lan', nric: '780530-13-5026', designation: 'Branch Manager' },
  },
  ST: {
    label: 'ST',
    workplace: 'Lot 13371-13373, SECT 65, KTLD, 18B Riveredge Commercial Centre, Jalan Tun Abdul Rahman Yaakub, 93050 Kuching, Sarawak,',
    witness: { name: 'Lo Hui Tin', nric: '961122-13-5142', designation: 'Branch Executive Operations Supervisor' },
  },
  TH: {
    label: 'TH',
    workplace: 'Sublot 3-6, Lot 12229-12232, Block 16, Trinity Hub KCLD 4th Mile, Jalan Datuk Tawi Sli, 93250 Kuching, Sarawak,',
    witness: { name: 'Chai Jan Lee', nric: '731210-13-5376', designation: 'Branch Manager' },
  },
};
const OUTLET_ORDER = ['HQ', 'KC', 'ST', 'TH'];

let _seq = 0;
function uid() { return 'c' + Date.now().toString(36) + (_seq++).toString(36) + Math.random().toString(36).slice(2, 6); }
const BLANK = () => ({ id: uid(), name: '', nric: '', address: '', position: '', effectiveDate: '' });
const isBlank = (c) => !c.name && !c.nric && !c.address && !c.position && !c.effectiveDate;
// "SABRINA CHAI" -> "Sabrina Chai" for the employee signature line.
const titleCase = (s) => (s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
function loadJSON(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } }

// Small promise pool so a batch of ICs is read a few at a time (Anthropic tier).
async function pool(items, worker, concurrency = 4) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return out;
}

// Prompt for reading a Malaysian IC (MyKad) / ID photo to auto-fill the contract.
const ID_PROMPT = `You are reading a photo of a Malaysian identity card (MyKad / NRIC) or a similar ID document, to help fill an employment contract.

Extract ONLY what is clearly printed on the card:
- "name": the person's FULL NAME exactly as printed (usually capital letters).
- "nric": the IC / NRIC number as 000000-00-0000 (12 digits, keep the two dashes). Read EACH DIGIT carefully — 0/6/8, 1/7, 3/5 are easy to confuse.
- "address": the residential address if visible (it is on the BACK of a MyKad). Put it on one line.

ABSOLUTE RULES:
- NEVER guess or invent. If a field is not clearly visible or you are unsure, return null for it and add its name to "uncertain_fields".
- Do NOT output a position or any dates — those are not on an ID.

Respond with ONLY this JSON and nothing else:
{"name": null, "nric": null, "address": null, "uncertain_fields": []}`;

// Inline editable variable — yellow highlight on screen, plain text in print.
function CField({ value, onChange, placeholder, bold, center, min = 8 }) {
  const shown = value || placeholder || '';
  return (
    <input
      className="cfield"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      size={value ? value.length + 1 : Math.max(shown.length + 2, min)}
      style={{
        background: '#fff59d',
        border: 'none',
        borderBottom: '1px dotted #b59f00',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontWeight: bold ? 700 : 'inherit',
        textAlign: center ? 'center' : 'left',
        color: '#111',
        padding: '0 3px',
        margin: '0 1px',
        outline: 'none',
        borderRadius: 2,
        fieldSizing: 'content',   // input hugs its text exactly (no trailing slack before the next word)
      }}
    />
  );
}

// Matches the source PDF's look (Times New Roman ~12pt, ~13mm margins) but on A4
// so it prints on Malaysian A4 paper without scaling.
const pageStyle = {
  background: '#fff', width: '210mm', maxWidth: '100%', minHeight: '297mm',
  margin: '0 auto 22px', padding: '15mm 13mm 13mm', boxShadow: '0 1px 10px rgba(0,0,0,0.12)',
  boxSizing: 'border-box', fontFamily: SERIF, fontSize: '11pt', lineHeight: 1.25, color: '#111',
  position: 'relative', textAlign: 'justify',
};
const foot = { position: 'absolute', bottom: '8mm', left: '13mm', right: '13mm', display: 'flex', justifyContent: 'space-between', fontSize: '9pt', color: '#111' };
const h = { fontWeight: 700, margin: '12px 0 4px', textAlign: 'left' };
const li = { margin: '2px 0' };
const ctr = { textAlign: 'center' };

// ── One full 4-page contract for a single employee under a chosen outlet ──
function ContractDoc({ c, outlet, onField }) {
  const set = (k) => (v) => onField(c.id, k, v);
  return (
    <>
      {/* ═══════════════ PAGE 1 ═══════════════ */}
      <div className="contract-page" style={pageStyle}>
        <div style={{ paddingBottom: 4, marginBottom: 12 }}>
          <img src={cjkLetterhead} alt="CHAI JEE KIONG TRADING SDN. BHD. (200901034210) — No. 19-27, Jalan Petanak, 93100, Kuching, Sarawak. Tel: 082-427630  E-mail: chaijeekionghq@gmail.com" style={{ width: '151mm', maxWidth: '100%', display: 'block' }} />
        </div>

        <div style={{ ...ctr, fontWeight: 700, fontSize: '15pt', letterSpacing: 1, margin: '6px 0' }}>EMPLOYMENT CONTRACT</div>
        <div style={ctr}>BETWEEN</div>
        <div style={{ ...ctr, fontWeight: 700, marginTop: 8 }}>CHAI JEE KIONG TRADING SDN. BHD.</div>
        <div style={ctr}>[Company Registration No. 200901034210]</div>
        <div style={{ ...ctr, marginTop: 8 }}>a company incorporated in Malaysia and having its registered office at<br />No. 19-27, Jalan Petanak, 93100, Kuching, Sarawak,</div>
        <div style={{ ...ctr, marginTop: 8, fontWeight: 700 }}>hereinafter referred to as “the Employer” or “the Company”,</div>
        <div style={{ ...ctr, margin: '10px 0' }}>AND</div>

        <div style={{ ...ctr, fontWeight: 700, fontSize: 15 }}>
          <CField value={c.name} onChange={set('name')} placeholder="EMPLOYEE NAME" bold center min={18} />
        </div>
        <div style={{ ...ctr, marginTop: 6 }}>[NRIC No.: <CField value={c.nric} onChange={set('nric')} placeholder="000000-00-0000" bold center min={14} />]</div>
        <div style={{ ...ctr, marginTop: 6 }}>residing at <CField value={c.address} onChange={set('address')} placeholder="residential address" center min={30} />,</div>
        <div style={{ ...ctr, marginTop: 10 }}>holding the position of <CField value={c.position} onChange={set('position')} placeholder="position" bold center min={12} />,</div>
        <div style={{ ...ctr, marginTop: 6 }}>with the workplace at<br />{outlet.workplace}</div>
        <div style={{ ...ctr, marginTop: 8 }}>hereinafter referred to as “the Employee”.</div>
        <div style={{ ...ctr, marginTop: 10 }}>Dated this <CField value={c.effectiveDate} onChange={set('effectiveDate')} placeholder="DD Month YYYY" bold center min={14} /> <b>(the “Effective Date”).</b></div>

        <hr style={{ border: 'none', borderTop: '1px dashed #999', margin: '12px 0' }} />

        <div style={h}>1. Commencement, Probation &amp; Confirmation</div>
        <p style={li}>1.1 The Employer agrees to employ the Employee, and the Employee agrees to serve the Employer, in the position stated on the top half of Page 1 of this Agreement.</p>
        <p style={li}>1.2 The Employee’s employment commencement date is <CField value={c.effectiveDate} onChange={set('effectiveDate')} placeholder="DD Month YYYY" bold min={14} />. This Agreement, effective from the Effective Date specified at the top of this page, governs the terms and conditions of employment. The Employee’s period of service shall be recognised for statutory benefits, leave entitlement, and seniority in accordance with applicable laws.</p>
        <p style={li}>1.3 The probationary period shall be up to 3 months, which may be shortened at the Company’s discretion should the Employee’s performance be satisfactory. Upon successful completion of probation, the Employee shall be confirmed as permanent staff.</p>

        <div style={h}>2. Conduct &amp; Duties</div>
        <p style={li}>2.1 The Employee shall:</p>
        <ul style={{ margin: '2px 0 0 18px' }}>
          <li>Wear designated uniform and dress in smart casual attire (long pants and covered shoes).</li>
          <li>Faithfully perform their duties to the best of their abilities and act in the best interests of the Company.</li>
          <li>Adhere to Company policies, maintain professionalism, avoid misconduct.</li>
          <li>Treat colleagues, customers, and stakeholders with respect.</li>
          <li>Use Company property and resources responsibly.</li>
          <li>Not disclose or misuse any confidential or proprietary information (including but not limited to trade secrets, client data, and internal processes) during employment or after its termination.</li>
        </ul>

        <div style={foot}><span>C.J.K. Employment Contract&nbsp;&nbsp;Page 1 of 4</span><span>Employee’s Initials: ____________</span></div>
      </div>

      {/* ═══════════════ PAGE 2 ═══════════════ */}
      <div className="contract-page" style={pageStyle}>
        <p style={li}>2.2 <b>Misconduct &amp; Disciplinary Action:</b> In cases of misconduct, the Company will follow due process which may include issuing a show cause letter, conducting a domestic inquiry, and issuing warning letters before taking further disciplinary action or termination. Where applicable, the Company also reserves the right to pursue legal action.</p>
        <p style={li}>2.3 <b>Absence Without Notification:</b> Employee absent without prior notification, unless for a reasonable excuse communicated at the earliest opportunity, shall be deemed misconduct and may lead to disciplinary action, including termination, in accordance with the Company’s disciplinary procedure and applicable laws.</p>

        <div style={h}>3. Place of Work &amp; Working Schedule</div>
        <p style={li}>3.1 The Employee shall report to work at the workplace stated in the top half of Page 1 of this Agreement, or at such other location as the Employer may reasonably require. Employee hereby agrees to comply with such permanent or temporary transfer or posting. Unless reasonable explanation is provided, failure or refusal to comply may be treated as misconduct.</p>
        <p style={li}>3.2 Normal working hours shall be as prescribed by the Employer, provided that they do not exceed the maximum hours permitted under applicable laws, excluding meal breaks.</p>
        <p style={li}>3.3 Sundays and public holidays as gazetted by the Government of Sarawak shall be treated as paid rest days.</p>

        <div style={h}>4. Salary (Fixed Monthly Remuneration)</div>
        <p style={li}>4.1 <b>Salary:</b> Shall be paid no less than the minimum wage as prescribed under Malaysian law. The actual amount shall be communicated separately in writing and may be adjusted periodically based on the Employee’s performance, position, or company policy. Salary shall be paid monthly between the 3rd and 5th day of each month.</p>
        <p style={li}>4.2 <b>Salary Advance:</b> Up to 40% of the Employee’s monthly basic salary may be requested, subject to managerial approval. Any advance shall be fully deducted from the Employee’s salary for the month in which the advance is granted, with no interest charged. It will be processed only on the 20th of each month, or the next working day if it falls on a non-working day.</p>

        <div style={h}>5. Incentive &amp; Bonus (Discretionary/Performance-Based Reward)</div>
        <p style={li}>5.1 The incentive and bonus are fully discretionary and do not form part of the Employee’s contractual entitlements. They may be granted based on factors such as individual performance, length of service, or other relevant considerations.</p>
        <p style={li}>5.2 Payment, if any, for a monthly incentive shall be made on the 11th of each month, or the next working day if it falls on a non-working day. The bonus, if any, shall be granted once a year in accordance with 1 main festive occasion observed by the Employee. The Company may determine the amount, timing, and eligibility of such benefits, or withdraw them with reasonable notice.</p>

        <div style={h}>6. Benefits &amp; Leave</div>
        <p style={{ ...li, textDecoration: 'underline', fontWeight: 700 }}>6.1 EPF (Retirement Savings), SOCSO (Accident &amp; Health Protection), and EIS (Job Loss Support)</p>
        <p style={li}>The Employee’s portion will be deducted from their monthly salary, while the Employer will contribute the required amount as per statutory rates.</p>
        <p style={{ ...li, textDecoration: 'underline', fontWeight: 700 }}>6.2 Annual Leave</p>
        <p style={li}>6.2.1 Entitlement: Upon completing 12 months of continuous service.</p>
        <ul style={{ margin: '2px 0 0 18px' }}>
          <li>Service under 2 years: 8 days per year</li>
          <li>Service of 2–5 years: 12 days per year</li>
          <li>Service over 5 years: 16 days per year</li>
        </ul>
        <p style={li}>6.2.2 Conditions: Must be utilized within 12 months and is renewed annually.</p>
        <p style={li}>6.2.3 Application: Must be applied at least 7 days in advance, subject to managerial approval.</p>
        <p style={{ ...li, textDecoration: 'underline', fontWeight: 700 }}>6.3 Medical Leave</p>
        <p style={li}>6.3.1 Entitlement:</p>
        <ul style={{ margin: '2px 0 0 18px' }}>
          <li>Service under 2 years: 14 days per year</li>
          <li>Service of 2–5 years: 18 days per year</li>
          <li>Service over 5 years: 22 days per year</li>
          <li>Hospitalization: Up to 60 days per year (shall be calculated separately)</li>
        </ul>
        <p style={li}>6.3.2 Conditions: Must be supported by a valid medical certificate issued by a registered medical practitioner.</p>
        <p style={li}>6.3.3 Application: Shall notify as soon as reasonably practicable.</p>

        <div style={foot}><span>C.J.K. Employment Contract&nbsp;&nbsp;Page 2 of 4</span><span>Employee’s Initials: ____________</span></div>
      </div>

      {/* ═══════════════ PAGE 3 ═══════════════ */}
      <div className="contract-page" style={pageStyle}>
        <p style={{ ...li, textDecoration: 'underline', fontWeight: 700 }}>6.4 Maternity Leave (for Female Employees)</p>
        <p style={li}>6.4.1 Entitlement: 98 consecutive days of leave (including rest days and public holidays) per confinement, limited to 5 confinements.</p>
        <p style={li}>6.4.2 Conditions:</p>
        <ul style={{ margin: '2px 0 0 18px' }}>
          <li>Must satisfy one of the following:
            <ul style={{ margin: '2px 0 0 18px', listStyleType: 'circle' }}>
              <li>Employed for at least 90 days within the 9 months before confinement; or</li>
              <li>Employed at any time within the 4 months before confinement.</li>
            </ul>
          </li>
          <li>Applies only if the pregnancy reaches 22 weeks; miscarriage or premature birth before 22 weeks is treated as medical leave.</li>
          <li>Must be supported by a medical certificate and child’s birth certificate.</li>
        </ul>
        <p style={li}>6.4.3 Application: Must be applied at least 60 days before the expected confinement date.</p>
        <p style={li}>6.4.4 Leave Duration:</p>
        <ul style={{ margin: '2px 0 0 18px' }}>
          <li>May begin up to 30 days before the expected confinement date.</li>
          <li>Early return shall be subject to medical certification and mutual agreement.</li>
        </ul>
        <p style={{ ...li, textDecoration: 'underline', fontWeight: 700 }}>6.5 Paternity Leave (for Married Male Employees)</p>
        <p style={li}>6.5.1 Entitlement: 7 consecutive days of leave (including rest days and public holidays) per confinement, for up to 5 births.</p>
        <p style={li}>6.5.2 Conditions:</p>
        <ul style={{ margin: '2px 0 0 18px' }}>
          <li>Must have been employed for at least 12 consecutive months immediately before the leave commencement.</li>
          <li>Must be supported by a marriage certificate and child’s birth certificate.</li>
        </ul>
        <p style={li}>6.5.3 Application: Must be applied at least 30 days before the expected confinement date.</p>
        <p style={li}>6.5.4 Leave Duration: Must commence on the actual date of childbirth.</p>

        <div style={h}>7. Termination</div>
        <p style={li}>7.1 Either party may terminate this Agreement by giving written notice, subject to the Company-Specific Notice Periods:</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0', fontSize: 'inherit' }}>
          <thead><tr><th style={{ border: '1px solid #111', padding: '4px 6px', textAlign: 'left' }}>Position</th><th style={{ border: '1px solid #111', padding: '4px 6px', textAlign: 'left', width: '22%' }}>Notice Period</th></tr></thead>
          <tbody>
            <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Probationary General or Junior Roles (e.g. Cashier, Merchandiser, General Worker, Driver etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>7 days</td></tr>
            <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Probationary Administrative or Senior Roles (e.g. Clerk, Supervisor, Assistant Supervisor, Executive etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>1 month</td></tr>
            <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Confirmed General or Junior Roles (e.g. Cashier, Merchandiser, General Worker, Driver etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>1 month</td></tr>
            <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Confirmed Administrative or Senior Roles (e.g. Clerk, Supervisor, Assistant Supervisor, Executive etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>3 months</td></tr>
          </tbody>
        </table>
        <p style={li}>7.2 <b>Payment in Lieu of Notice:</b> Either party may terminate the employment without serving the full notice period by paying wages equivalent to the unserved portion. If the Employee resigns without notice or fails to serve it, the Employer may deduct the equivalent amount from the final salary or recover it through legal means.</p>
        <p style={li}>7.3 <b>Waiver of Notice:</b> If both parties agree in writing, the notice period may be waived without the need to serve notice or make payment in lieu.</p>
        <p style={li}>7.4 <b>Termination for Misconduct:</b> The Company may terminate employment without notice or compensation in cases of serious misconduct, provided that a proper domestic inquiry has been conducted. Serious misconduct includes, but is not limited to, theft, fraud, physical assault, harassment, insubordination, or wilful damage to Company property.</p>
        <p style={li}>7.5 <b>Handover Obligations:</b> The Employee shall properly hand over all duties, documents, records, passwords, company property, and ongoing assignments before the last working day, and shall cooperate with the Company to ensure smooth workflow continuity during the notice period. Failure to comply with reasonable handover obligations may be treated as misconduct and may result in disciplinary action in accordance with the Company’s disciplinary procedures.</p>
        <p style={li}>7.6 <b>Effect of Termination:</b> Once notice is served or payment in lieu is made, the employment shall end. Post-termination obligations including final salary payment and all final statutory contributions such as EPF, SOCSO and EIS, shall remain, and duties relating to confidentiality shall continue to apply.</p>
        <p style={li}>7.7 <b>Retirement:</b> The Company’s mandatory retirement age is 62 years old. Upon the Employee reaching the age of 62, this Agreement shall automatically terminate without the need for notice or compensation, unless both parties mutually agree in writing to extend the employment.</p>

        <div style={foot}><span>C.J.K. Employment Contract&nbsp;&nbsp;Page 3 of 4</span><span>Employee’s Initials: ____________</span></div>
      </div>

      {/* ═══════════════ PAGE 4 ═══════════════ */}
      <div className="contract-page" style={pageStyle}>
        <div style={h}>8. General Provisions</div>
        <p style={li}>8.1 This Agreement is governed by the laws of Malaysia and shall remain in force until terminated in accordance with its terms or applicable employment laws. It applies solely to the Employee and governs the terms of employment throughout their service with the Company.</p>
        <p style={li}>8.2 In the event of any conflict with any prior offer letter or agreement, this Agreement shall prevail. Any dispute shall first be resolved through discussion, and if unresolved, may be referred to mediation or arbitration.</p>
        <p style={li}>8.3 The Company may revise policies from time to time. Where such changes affect the terms of employment, prior notice and mutual agreement will be required.</p>

        <div style={h}>9. Acknowledgement &amp; Agreement</div>
        <p style={li}>I, the undersigned, hereby acknowledge and agree to the terms and conditions outlined in this document.</p>

        <div style={{ display: 'flex', gap: 40, marginTop: 26 }}>
          {/* Left column: Employer Representative, then Employee below (matches the PDF) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>Signed by the Employer Representative:</div>
            <div style={{ borderBottom: '1px solid #111', height: 130, marginTop: 6 }} />
            <div style={{ marginTop: 4 }}>Full Name: Chai Chee Choi</div>
            <div>NRIC No.: 720115-13-5825</div>
            <div>Designation: Managing Director</div>

            <div style={{ fontWeight: 600, marginTop: 34 }}>Signed by the Employee:</div>
            <div style={{ borderBottom: '1px solid #111', height: 130, marginTop: 6 }} />
            <div style={{ marginTop: 4 }}>Full Name: {titleCase(c.name)}</div>
            <div>NRIC No.: {c.nric || ''}</div>
          </div>
          {/* Right column: Witness */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>In the presence of, as witness:</div>
            <div style={{ borderBottom: '1px solid #111', height: 130, marginTop: 6 }} />
            <div style={{ marginTop: 4 }}>Full Name: {outlet.witness.name}</div>
            <div>NRIC No.: {outlet.witness.nric}</div>
            <div>Designation: {outlet.witness.designation}</div>
          </div>
        </div>

        <div style={foot}><span>C.J.K. Employment Contract&nbsp;&nbsp;Page 4 of 4</span><span>Employee’s Initials: ____________</span></div>
      </div>
    </>
  );
}

export default function ContractGenerator() {
  const [outlet, setOutlet] = useState(() => { try { const v = localStorage.getItem(LS_OUTLET); return OUTLET_ORDER.includes(v) ? v : 'HQ'; } catch { return 'HQ'; } });
  const [byOutlet, setByOutlet] = useState(() => {
    const saved = loadJSON(LS_KEY, null);
    const m = (saved && typeof saved === 'object') ? saved : {};
    const base = {};
    for (const k of OUTLET_ORDER) base[k] = (Array.isArray(m[k]) && m[k].length) ? m[k] : [BLANK()];
    return base;
  });
  useEffect(() => { try { localStorage.setItem(LS_OUTLET, outlet); } catch {} }, [outlet]);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(byOutlet)); } catch {} }, [byOutlet]);

  const contracts = byOutlet[outlet] || [BLANK()];
  const setCur = (updater) => setByOutlet(m => ({ ...m, [outlet]: updater(m[outlet] || [BLANK()]) }));
  const onField = (id, k, v) => setCur(cs => cs.map(c => c.id === id ? { ...c, [k]: v } : c));
  const addBlank = () => setCur(cs => [...cs, BLANK()]);
  const removeContract = (id) => setCur(cs => { const n = cs.filter(c => c.id !== id); return n.length ? n : [BLANK()]; });
  const clearAll = () => { if (window.confirm(`Clear all ${outlet} contracts?`)) setCur(() => [BLANK()]); };
  const applyAll = (k, v) => setCur(cs => cs.map(c => ({ ...c, [k]: v })));

  // ── AI auto-fill from IC / ID photos (reuses the invoice-side vision plumbing) ──
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem(AI_CFG.storageKey) || ''; } catch { return ''; } });
  const [keyInput, setKeyInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const [allPos, setAllPos] = useState('');
  const [allDate, setAllDate] = useState('');
  const fileRef = useRef(null);
  const saveKey = () => { const k = keyInput.trim(); if (!k) return; try { localStorage.setItem(AI_CFG.storageKey, k); } catch {} setApiKey(k); setKeyInput(''); };
  const readDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Failed to read file')); r.readAsDataURL(file); });

  const readBatch = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type?.startsWith('image/'));
    if (!files.length) { setError('Please choose image file(s) of the IC / ID.'); return; }
    if (!apiKey) { setError('Enter your Anthropic API key first (box on the right).'); return; }
    setError(null); setProcessing(true); setProg({ done: 0, total: files.length });
    try {
      const results = await pool(files, async (f) => {
        try {
          const raw = await readDataUrl(f);
          let img; try { img = await downsizeBase64ToJPEG(raw, 1280, 0.75); } catch { img = raw; }
          const r = await callAI({ provider: AI_PROVIDER, apiKey, model: AI_CFG.model, imageDataUrl: img, prompt: ID_PROMPT });
          const p = parseAIJson(r.text) || {};
          setProg(s => ({ ...s, done: s.done + 1 }));
          return { name: p.name || '', nric: p.nric || '', address: p.address || '' };
        } catch {
          setProg(s => ({ ...s, done: s.done + 1 }));
          return { name: '', nric: '', address: '', _err: true };
        }
      }, 4);
      const failed = results.filter(r => r._err).length;
      setCur(cs => {
        const base = (cs.length === 1 && isBlank(cs[0])) ? [] : cs;
        return [...base, ...results.map(r => ({ id: uid(), name: r.name, nric: r.nric, address: r.address, position: '', effectiveDate: '' }))];
      });
      if (failed) setError(`${failed} of ${files.length} IC(s) couldn’t be read — those contracts are blank, fill them in manually.`);
    } finally { setProcessing(false); }
  };

  const btn = { padding: '8px 14px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: F };

  return (
    <div style={{ background: '#f3f4f6', minHeight: '100vh', padding: '18px 12px 60px', fontFamily: F }}>

      {/* ── Controls (screen only) ── */}
      <div className="contract-noP" style={{ maxWidth: '210mm', margin: '0 auto 16px' }}>

        {/* Outlet tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {OUTLET_ORDER.map(o => (
            <button key={o} onClick={() => setOutlet(o)}
              style={{ ...btn, padding: '8px 18px', background: outlet === o ? '#111' : '#fff', color: outlet === o ? '#fff' : '#374151', border: '1px solid ' + (outlet === o ? '#111' : '#d1d5db') }}>
              {OUTLETS[o].label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>{OUTLETS[outlet].workplace}</div>
        </div>

        {/* Title + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>Employment Contracts — {outlet}</div>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{contracts.length} contract{contracts.length > 1 ? 's' : ''}</span>
          <div style={{ flex: 1 }} />
          <button onClick={addBlank} style={{ ...btn, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>＋ Add blank</button>
          <button onClick={() => window.print()} style={{ ...btn, background: '#111', color: '#fff' }}>🖨 Print / Save PDF (all)</button>
          <button onClick={clearAll} style={{ ...btn, background: '#fff', color: '#c0392b', border: '1px solid #e6bcbc' }}>🗑 Clear</button>
        </div>

        {/* Batch upload + AI key */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div
            onClick={() => !processing && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); readBatch(e.dataTransfer.files); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', border: '2px dashed ' + (drag ? '#c87b00' : '#c4c4c8'), borderRadius: 8, background: drag ? '#fffbeb' : '#fff', cursor: processing ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}
          >
            📷 {processing ? `Reading ${prog.done}/${prog.total} IC${prog.total > 1 ? 's' : ''}…` : 'Upload IC / ID photos → one contract each (select several)'}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { readBatch(e.target.files); e.target.value = ''; }} />

          {!apiKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="password" placeholder={AI_CFG.placeholder} value={keyInput} onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveKey(); }}
                style={{ width: 170, padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: F }} />
              <button onClick={saveKey} style={{ ...btn, padding: '7px 12px', fontSize: 13, background: '#111', color: '#fff' }}>Save key</button>
            </div>
          )}
          {apiKey && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ AI ready</span>}
          {error && <span style={{ fontSize: 12, color: '#c0392b' }}>{error}</span>}
        </div>

        {/* Apply position / date to every contract in this batch */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: '#374151' }}>
          <span style={{ color: '#6b7280' }}>Set for all:</span>
          <input value={allPos} placeholder="position" onChange={e => setAllPos(e.target.value)}
            style={{ width: 150, padding: '6px 9px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: F }} />
          <button onClick={() => applyAll('position', allPos)} style={{ ...btn, padding: '6px 10px', fontSize: 12, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>→ all</button>
          <input value={allDate} placeholder="start date (DD Month YYYY)" onChange={e => setAllDate(e.target.value)}
            style={{ width: 200, padding: '6px 9px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: F }} />
          <button onClick={() => applyAll('effectiveDate', allDate)} style={{ ...btn, padding: '6px 10px', fontSize: 12, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>→ all</button>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>Position &amp; date aren’t on an IC. IC OCR is never 100% — always double-check before printing.</span>
        </div>
      </div>

      {/* ── Contracts ── */}
      <div className="contract-print">
        {contracts.map((c, i) => (
          <Fragment key={c.id}>
            <div className="contract-noP" style={{ maxWidth: '210mm', margin: '0 auto 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Contract {i + 1} of {contracts.length}</span>
              <span style={{ fontSize: 13, color: '#374151' }}>{c.name || <em style={{ color: '#9ca3af' }}>unnamed</em>} · {outlet}</span>
              <div style={{ flex: 1 }} />
              {contracts.length > 1 && (
                <button onClick={() => removeContract(c.id)} style={{ ...btn, padding: '4px 10px', fontSize: 12, background: '#fff', color: '#c0392b', border: '1px solid #e6bcbc' }}>✕ Remove</button>
              )}
            </div>
            <ContractDoc c={c} outlet={OUTLETS[outlet]} onField={onField} />
          </Fragment>
        ))}
      </div>

      <style>{`
        @media print {
          .contract-noP { display: none !important; }
          .cfield { background: transparent !important; border: none !important; box-shadow: none !important; }
          .contract-page {
            box-shadow: none !important;
            margin: 0 !important;
            width: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            page-break-after: always;
          }
          .contract-page:last-child { page-break-after: auto; }
          @page { size: A4 portrait; margin: 15mm 13mm 13mm 13mm; }
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}

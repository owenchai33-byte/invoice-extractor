import { useState, useEffect } from 'react';
import { LOGO } from './InvoiceExtractor';

// Employment Contract template (CJK). The five yellow-highlighted fields on the
// PDF are the per-employee variables; everything else is fixed boilerplate.
// AI list-scan auto-fill comes later — for now the fields are click-to-type,
// editable, and print clean (no highlight) to A4.

const LS_KEY = 'contract_data_v1';
const BLANK = { name: '', nric: '', address: '', position: '', effectiveDate: '' };
const F = `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif`;
const SERIF = `Georgia, "Times New Roman", Times, serif`;

// Inline editable variable — yellow highlight on screen, plain text in print.
function CField({ value, onChange, placeholder, bold, center, min = 8 }) {
  const shown = value || placeholder || '';
  return (
    <input
      className="cfield"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      size={Math.max(shown.length + 1, min)}
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
      }}
    />
  );
}

export default function ContractGenerator() {
  const [data, setData] = useState(() => {
    try { return { ...BLANK, ...(JSON.parse(localStorage.getItem(LS_KEY)) || {}) }; }
    catch { return { ...BLANK }; }
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {} }, [data]);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const clearAll = () => { if (window.confirm('Clear all contract fields?')) setData({ ...BLANK }); };

  const pageStyle = {
    background: '#fff',
    width: '210mm',
    maxWidth: '100%',
    minHeight: '296mm',
    margin: '0 auto 22px',
    padding: '16mm 17mm',
    boxShadow: '0 1px 10px rgba(0,0,0,0.12)',
    boxSizing: 'border-box',
    fontFamily: SERIF,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#111',
    position: 'relative',
    textAlign: 'justify',
  };
  const foot = { position: 'absolute', bottom: '9mm', left: '17mm', right: '17mm', display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#111' };
  const h = { fontWeight: 700, margin: '12px 0 4px', textAlign: 'left' };
  const li = { margin: '2px 0' };
  const ctr = { textAlign: 'center' };

  return (
    <div style={{ background: '#f3f4f6', minHeight: '100vh', padding: '18px 12px 60px', fontFamily: F }}>

      {/* ── Controls (screen only) ── */}
      <div className="contract-noP" style={{ maxWidth: '210mm', margin: '0 auto 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>Employment Contract</div>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Fill the yellow fields → Print / Save PDF. (Scan-a-list auto-fill coming soon.)</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => window.print()} style={{ padding: '8px 16px', fontSize: 14, fontWeight: 600, background: '#111', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: F }}>🖨 Print / Save PDF</button>
        <button onClick={clearAll} style={{ padding: '8px 14px', fontSize: 14, fontWeight: 600, background: '#fff', color: '#c0392b', border: '1px solid #e6bcbc', borderRadius: 6, cursor: 'pointer', fontFamily: F }}>🗑 Clear</button>
      </div>

      <div className="contract-print">

        {/* ═══════════════ PAGE 1 ═══════════════ */}
        <div className="contract-page" style={pageStyle}>
          {/* Letterhead */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, borderBottom: '2px solid #111', paddingBottom: 8, marginBottom: 14 }}>
            <img src={LOGO} alt="CJK" style={{ height: 46 }} />
            <div style={{ textAlign: 'center', fontFamily: F }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>CHAI JEE KIONG TRADING SDN. BHD. (200901034210)</div>
              <div style={{ fontSize: 11 }}>No. 19, 21, 23, 25, 27, Jalan Petanak, 93100, Kuching, Sarawak.</div>
              <div style={{ fontSize: 11 }}>Tel: 082-427630&nbsp;&nbsp;&nbsp;E-mail: chaijeekionghq@gmail.com</div>
            </div>
          </div>

          <div style={{ ...ctr, fontWeight: 700, fontSize: 16, letterSpacing: 1, margin: '6px 0' }}>EMPLOYMENT CONTRACT</div>
          <div style={ctr}>BETWEEN</div>
          <div style={{ ...ctr, fontWeight: 700, marginTop: 8 }}>CHAI JEE KIONG TRADING SDN. BHD.</div>
          <div style={ctr}>[Company Registration No. 200901034210]</div>
          <div style={{ ...ctr, marginTop: 8 }}>a company incorporated in Malaysia and having its registered office at<br />No. 19-27, Jalan Petanak, 93100, Kuching, Sarawak,</div>
          <div style={{ ...ctr, marginTop: 8, fontWeight: 700 }}>hereinafter referred to as “the Employer” or “the Company”,</div>
          <div style={{ ...ctr, margin: '10px 0' }}>AND</div>

          {/* Variable fields */}
          <div style={{ ...ctr, fontWeight: 700, fontSize: 15 }}>
            <CField value={data.name} onChange={set('name')} placeholder="EMPLOYEE NAME" bold center min={14} />
          </div>
          <div style={{ ...ctr, marginTop: 6 }}>[NRIC No.: <CField value={data.nric} onChange={set('nric')} placeholder="000000-00-0000" center min={14} />]</div>
          <div style={{ ...ctr, marginTop: 6 }}>residing at <CField value={data.address} onChange={set('address')} placeholder="residential address" center min={30} />,</div>
          <div style={{ ...ctr, marginTop: 10 }}>holding the position of <CField value={data.position} onChange={set('position')} placeholder="position" center min={12} />,</div>
          <div style={{ ...ctr, marginTop: 6 }}>with the workplace at<br />No. 19-27, Jalan Petanak, 93100, Kuching, Sarawak,</div>
          <div style={{ ...ctr, marginTop: 8 }}>hereinafter referred to as “the Employee”.</div>
          <div style={{ ...ctr, marginTop: 10 }}>Dated this <CField value={data.effectiveDate} onChange={set('effectiveDate')} placeholder="DD Month YYYY" center min={14} /> <b>(the “Effective Date”).</b></div>

          <hr style={{ border: 'none', borderTop: '1px dashed #999', margin: '12px 0' }} />

          <div style={h}>1. Commencement, Probation &amp; Confirmation</div>
          <p style={li}>1.1 The Employer agrees to employ the Employee, and the Employee agrees to serve the Employer, in the position stated on the top half of Page 1 of this Agreement.</p>
          <p style={li}>1.2 The Employee’s employment commencement date is <CField value={data.effectiveDate} onChange={set('effectiveDate')} placeholder="DD Month YYYY" min={14} />. This Agreement, effective from the Effective Date specified at the top of this page, governs the terms and conditions of employment. The Employee’s period of service shall be recognised for statutory benefits, leave entitlement, and seniority in accordance with applicable laws.</p>
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
          <p style={li}>2.2 Misconduct &amp; Disciplinary Action: In cases of misconduct, the Company will follow due process which may include issuing a show cause letter, conducting a domestic inquiry, and issuing warning letters before taking further disciplinary action or termination. Where applicable, the Company also reserves the right to pursue legal action.</p>
          <p style={li}>2.3 Absence Without Notification: Employee absent without prior notification, unless for a reasonable excuse communicated at the earliest opportunity, shall be deemed misconduct and may lead to disciplinary action, including termination, in accordance with the Company’s disciplinary procedure and applicable laws.</p>

          <div style={h}>3. Place of Work &amp; Working Schedule</div>
          <p style={li}>3.1 The Employee shall report to work at the workplace stated in the top half of Page 1 of this Agreement, or at such other location as the Employer may reasonably require. Employee hereby agrees to comply with such permanent or temporary transfer or posting. Unless reasonable explanation is provided, failure or refusal to comply may be treated as misconduct.</p>
          <p style={li}>3.2 Normal working hours shall be as prescribed by the Employer, provided that they do not exceed the maximum hours permitted under applicable laws, excluding meal breaks.</p>
          <p style={li}>3.3 Sundays and public holidays as gazetted by the Government of Sarawak shall be treated as paid rest days.</p>

          <div style={h}>4. Salary (Fixed Monthly Remuneration)</div>
          <p style={li}>4.1 Salary: Shall be paid no less than the minimum wage as prescribed under Malaysian law. The actual amount shall be communicated separately in writing and may be adjusted periodically based on the Employee’s performance, position, or company policy. Salary shall be paid monthly between the 3rd and 5th day of each month.</p>
          <p style={li}>4.2 Salary Advance: Up to 40% of the Employee’s monthly basic salary may be requested, subject to managerial approval. Any advance shall be fully deducted from the Employee’s salary for the month in which the advance is granted, with no interest charged. It will be processed only on the 20th of each month, or the next working day if it falls on a non-working day.</p>

          <div style={h}>5. Incentive &amp; Bonus (Discretionary/Performance-Based Reward)</div>
          <p style={li}>5.1 The incentive and bonus are fully discretionary and do not form part of the Employee’s contractual entitlements. They may be granted based on factors such as individual performance, length of service, or other relevant considerations.</p>
          <p style={li}>5.2 Payment, if any, for a monthly incentive shall be made on the 11th of each month, or the next working day if it falls on a non-working day. The bonus, if any, shall be granted once a year in accordance with 1 main festive occasion observed by the Employee. The Company may determine the amount, timing, and eligibility of such benefits, or withdraw them with reasonable notice.</p>

          <div style={h}>6. Benefits &amp; Leave</div>
          <p style={{ ...li, textDecoration: 'underline', fontWeight: 600 }}>6.1 EPF (Retirement Savings), SOCSO (Accident &amp; Health Protection), and EIS (Job Loss Support)</p>
          <p style={li}>The Employee’s portion will be deducted from their monthly salary, while the Employer will contribute the required amount as per statutory rates.</p>
          <p style={{ ...li, textDecoration: 'underline', fontWeight: 600 }}>6.2 Annual Leave</p>
          <p style={li}>6.2.1 Entitlement: Upon completing 12 months of continuous service.</p>
          <ul style={{ margin: '2px 0 0 18px' }}>
            <li>Service under 2 years: 8 days per year</li>
            <li>Service of 2–5 years: 12 days per year</li>
            <li>Service over 5 years: 16 days per year</li>
          </ul>
          <p style={li}>6.2.2 Conditions: Must be utilized within 12 months and is renewed annually.</p>
          <p style={li}>6.2.3 Application: Must be applied at least 7 days in advance, subject to managerial approval.</p>
          <p style={{ ...li, textDecoration: 'underline', fontWeight: 600 }}>6.3 Medical Leave</p>
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
          <p style={{ ...li, textDecoration: 'underline', fontWeight: 600 }}>6.4 Maternity Leave (for Female Employees)</p>
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
          <p style={{ ...li, textDecoration: 'underline', fontWeight: 600 }}>6.5 Paternity Leave (for Married Male Employees)</p>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0', fontSize: 11 }}>
            <thead><tr><th style={{ border: '1px solid #111', padding: '4px 6px', textAlign: 'left' }}>Position</th><th style={{ border: '1px solid #111', padding: '4px 6px', textAlign: 'left', width: '22%' }}>Notice Period</th></tr></thead>
            <tbody>
              <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Probationary General or Junior Roles (e.g. Cashier, Merchandiser, General Worker, Driver etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>7 days</td></tr>
              <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Probationary Administrative or Senior Roles (e.g. Clerk, Supervisor, Assistant Supervisor, Executive etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>1 month</td></tr>
              <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Confirmed General or Junior Roles (e.g. Cashier, Merchandiser, General Worker, Driver etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>1 month</td></tr>
              <tr><td style={{ border: '1px solid #111', padding: '4px 6px' }}>Confirmed Administrative or Senior Roles (e.g. Clerk, Supervisor, Assistant Supervisor, Executive etc.)</td><td style={{ border: '1px solid #111', padding: '4px 6px' }}>3 months</td></tr>
            </tbody>
          </table>
          <p style={li}>7.2 Payment in Lieu of Notice: Either party may terminate the employment without serving the full notice period by paying wages equivalent to the unserved portion. If the Employee resigns without notice or fails to serve it, the Employer may deduct the equivalent amount from the final salary or recover it through legal means.</p>
          <p style={li}>7.3 Waiver of Notice: If both parties agree in writing, the notice period may be waived without the need to serve notice or make payment in lieu.</p>
          <p style={li}>7.4 Termination for Misconduct: The Company may terminate employment without notice or compensation in cases of serious misconduct, provided that a proper domestic inquiry has been conducted. Serious misconduct includes, but is not limited to, theft, fraud, physical assault, harassment, insubordination, or wilful damage to Company property.</p>
          <p style={li}>7.5 Handover Obligations: The Employee shall properly hand over all duties, documents, records, passwords, company property, and ongoing assignments before the last working day, and shall cooperate with the Company to ensure smooth workflow continuity during the notice period. Failure to comply with reasonable handover obligations may be treated as misconduct and may result in disciplinary action in accordance with the Company’s disciplinary procedures.</p>
          <p style={li}>7.6 Effect of Termination: Once notice is served or payment in lieu is made, the employment shall end. Post-termination obligations including final salary payment and all final statutory contributions such as EPF, SOCSO and EIS, shall remain, and duties relating to confidentiality shall continue to apply.</p>
          <p style={li}>7.7 Retirement: The Company’s mandatory retirement age is 62 years old. Upon the Employee reaching the age of 62, this Agreement shall automatically terminate without the need for notice or compensation, unless both parties mutually agree in writing to extend the employment.</p>

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
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Signed by the Employer Representative:</div>
              <div style={{ borderBottom: '1px solid #111', height: 46, marginTop: 6 }} />
              <div style={{ marginTop: 4 }}>Full Name: Chai Chee Choi</div>
              <div>NRIC No.: 720115-13-5825</div>
              <div>Designation: Managing Director</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>In the presence of, as witness:</div>
              <div style={{ borderBottom: '1px solid #111', height: 46, marginTop: 6 }} />
              <div style={{ marginTop: 4 }}>Full Name: Sabrina Chai Wen Hui</div>
              <div>NRIC No.: 000606-13-0548</div>
              <div>Designation: Account Executive</div>
            </div>
          </div>

          <div style={{ marginTop: 30, width: '48%' }}>
            <div style={{ fontWeight: 600 }}>Signed by the Employee:</div>
            <div style={{ borderBottom: '1px solid #111', height: 46, marginTop: 6 }} />
            <div style={{ marginTop: 4 }}>Full Name: {data.name || '________________________'}</div>
            <div>NRIC No.: {data.nric || '________________________'}</div>
          </div>

          <div style={foot}><span>C.J.K. Employment Contract&nbsp;&nbsp;Page 4 of 4</span><span>Employee’s Initials: ____________</span></div>
        </div>
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
          @page { size: A4 portrait; margin: 13mm 15mm; }
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}

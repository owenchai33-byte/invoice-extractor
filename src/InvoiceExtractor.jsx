import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';

// ⚠️ PASTE YOUR ORIGINAL `const LOGO = "data:image/png;base64,..."` LINE FROM YOUR LOCAL InvoiceExtractor.jsx HERE.
// The full base64 was ~50KB and got truncated during this rewrite. The reliability patches don't touch the LOGO,
// so just copy your existing LOGO line verbatim and replace this placeholder.
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const SUPPLIERS = {
  'CHOON HUA': {
    name: 'CHOON HUA TRADING CORPORATION SDN BHD',
    rates: [
      { id:'r1', label:'1.5/1.75L x 12', rate:0.50, minVol:1000, maxVol:2000, packSize:12 },
      { id:'r2', label:'500ML x 24', rate:0.50, minVol:450, maxVol:500, packSize:24 },
      { id:'r3', label:'320/300ML x 24', rate:0.40, minVol:290, maxVol:330, packSize:24 },
      { id:'r4', label:'500ML x 12', rate:0.25, minVol:450, maxVol:500, packSize:12 },
      { id:'r5', label:'370/320/300ML x 12', rate:0.20, minVol:290, maxVol:380, packSize:12 },
    ],
    pct1:0.004, pct2:0.002,
  }
};
const CO = { name:'CHAI JEE KIONG TRADING SDN BHD', reg:'(200901034210)',
  addr:'No. 19, 21, 23, 25, 27, Jalan Petanak, 93100, Kuching, Sarawak.',
  tel:'082-427630', email:'chaijeekionghq@gmail.com' };

// ============================================================
// RELIABILITY UTILITIES (PATCH 2)
// ============================================================

// Normalize a date string to DD/MM/YYYY. Returns {date, ok}.
// Tries DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD. Falls back to original.
function normalizeDate(s){
  if(!s||typeof s!=='string') return {date:'',ok:false};
  const t = s.trim();
  let m;
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if(m){
    const d=+m[1], mo=+m[2], y=+m[3];
    if(d>=1&&d<=31&&mo>=1&&mo<=12&&y>=2020&&y<=2099){
      return {date:`${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`,ok:true};
    }
  }
  // YYYY-MM-DD (ISO)
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m){
    const y=+m[1], mo=+m[2], d=+m[3];
    if(d>=1&&d<=31&&mo>=1&&mo<=12){
      return {date:`${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`,ok:true};
    }
  }
  return {date:t,ok:false};
}

// Validate invoice number format: "IN" + 3 or more digits.
function validInvoiceNo(s){
  if(!s||typeof s!=='string') return false;
  return /^IN\d{3,}$/i.test(s.trim());
}

// Parse volume_ml and pack_size from description / product code text.
// Used as ground truth when AI's extracted volume_ml/pack_size disagree.
function parseDesc(desc, code){
  const sources = [desc, code].filter(Boolean);
  for(const src of sources){
    const d = String(src).toUpperCase();
    let volume = null;
    const mlMatch = d.match(/(\d+(?:\.\d+)?)\s*ML/);
    const lMatch = d.match(/(\d+(?:\.\d+)?)\s*L(?![A-Z])/);
    if(mlMatch) volume = parseFloat(mlMatch[1]);
    else if(lMatch) volume = parseFloat(lMatch[1]) * 1000;
    let pack = null;
    const pMatch = d.match(/[X×]\s*(\d+)(?!\d)/);
    if(pMatch) pack = parseInt(pMatch[1]);
    if(volume && pack) return {volume, pack};
  }
  return {volume:null, pack:null};
}

// ============================================================
// UPDATED matchCat WITH DESCRIPTION CROSS-CHECK (PATCH 4)
// ============================================================
// Returns { cat, inconsistent, usedVol, usedPack, aiVol, aiPack, descVol, descPack }
// so the caller can know about AI extraction conflicts.
function matchCat(volume_ml, pack_size, rates, description, code){
  const aiVolNum = Number(volume_ml);
  const aiPackNum = Number(pack_size);
  const aiVol = (volume_ml!==null && volume_ml!==undefined && !isNaN(aiVolNum) && aiVolNum>0) ? aiVolNum : null;
  const aiPack = (pack_size!==null && pack_size!==undefined && !isNaN(aiPackNum) && aiPackNum>0) ? aiPackNum : null;

  // Parse description as ground truth
  const fromDesc = parseDesc(description, code);
  const descVol = fromDesc.volume;
  const descPack = fromDesc.pack;

  // Description wins when present (text parsing more reliable than AI numeric fields)
  const usedVol = descVol || aiVol;
  const usedPack = descPack || aiPack;

  // Detect AI inconsistency (both sides must have a value to compare)
  const volMismatch = !!(descVol && aiVol && descVol !== aiVol);
  const packMismatch = !!(descPack && aiPack && descPack !== aiPack);
  const inconsistent = volMismatch || packMismatch;

  if(!usedVol || !usedPack){
    return {cat:null, inconsistent, usedVol, usedPack, aiVol, aiPack, descVol, descPack};
  }
  const cat = rates.find(r => usedVol>=r.minVol && usedVol<=r.maxVol && r.packSize===usedPack);
  return {cat: cat||null, inconsistent, usedVol, usedPack, aiVol, aiPack, descVol, descPack};
}

function calcSub(amt,groups,p1,p2){
  const c=groups.reduce((s,g)=>s+g.ctn*g.rate,0), r=v=>Math.round(v*100)/100;
  const v1=r((amt-c)*p1), v2=r((amt-c-v1)*p2);
  return {carton:r(c),p1:v1,p2:v2,total:r(c+v1+v2)};
}
const fmt=n=>{if(n===''||n==null)return '';return`RM${Number(n).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;};

// ============================================================
// ISSUES AGGREGATOR (PATCH 5)
// ============================================================
// Returns an array of {kind, severity:'warn'|'error', msg, details?} for an invoice.
function computeIssues({parsed, items, groups, declaredTotal, isDuplicate, extractedCtnSum, manuallyAssigned}){
  const issues = [];

  // 1. Invoice number format
  if(!parsed.invoice_no || !validInvoiceNo(parsed.invoice_no)){
    issues.push({
      kind:'invoice_no',
      severity:'warn',
      msg:`Invoice number "${parsed.invoice_no||'?'}" doesn't match the expected "IN + digits" format. Click to edit.`,
    });
  }

  // 2. Date parse
  const dateCheck = normalizeDate(parsed.invoice_date);
  if(!dateCheck.ok){
    issues.push({
      kind:'date',
      severity:'warn',
      msg:`Date "${parsed.invoice_date||'?'}" couldn't be parsed as DD/MM/YYYY. Click to edit.`,
    });
  }

  // 3. Duplicate invoice_no in batch
  if(isDuplicate){
    issues.push({
      kind:'duplicate',
      severity:'error',
      msg:`Invoice number ${parsed.invoice_no} is already in this batch. Likely a duplicate file — remove one before exporting.`,
    });
  }

  // 4. Unmatched items — skip if user manually assigned a category
  if(!manuallyAssigned){
    const unmatched = items.filter(it=>!it.category);
    if(unmatched.length > 0){
      issues.push({
        kind:'unmatched',
        severity:'warn',
        msg:`${unmatched.length} line item(s) couldn't match any Choon Hua subsidy category. They're excluded from the calc.`,
        details: unmatched.map(it =>
          `${it.description||it.product_code||'unknown'} (qty ${it.qty||0}, parsed ${it._usedVol||'?'}ml × ${it._usedPack||'?'})`
        ),
      });
    }
  }

  // 5. AI volume/pack inconsistency vs description
  const inconsistent = items.filter(it=>it._inconsistent);
  if(inconsistent.length > 0){
    issues.push({
      kind:'extraction_conflict',
      severity:'warn',
      msg:`${inconsistent.length} item(s) had volume/pack-size extraction conflicts. Used description as source of truth.`,
      details: inconsistent.map(it =>
        `${it.description||it.product_code}: AI said ${it._aiVol||'?'}ml × ${it._aiPack||'?'}, description says ${it._descVol||'?'}ml × ${it._descPack||'?'}`
      ),
    });
  }

  // 6. Carton-sum mismatch (auto-correct handles single-category; only warn for multi)
  if(declaredTotal > 0 && extractedCtnSum !== declaredTotal && groups.length > 1){
    issues.push({
      kind:'ctn_mismatch',
      severity:'error',
      msg:`Carton mismatch: extracted ${extractedCtnSum} CTN total, invoice PRODUCT TOTAL = ${declaredTotal}. Multi-category invoice — verify CTN per category manually.`,
    });
  }

  // 7. Line amounts sum vs invoice total
  const itemAmountSum = items.reduce((s,it)=>s+(Number(it.amount)||0),0);
  const decTotal = Number(parsed.total_amount)||0;
  if(decTotal > 0 && Math.abs(itemAmountSum-decTotal) > 0.50){
    issues.push({
      kind:'amount_mismatch',
      severity:'warn',
      msg:`Line amounts sum to RM${itemAmountSum.toFixed(2)} but invoice total is RM${decTotal.toFixed(2)}. AI may have misread a line.`,
    });
  }

  return issues;
}

// Helper: recompute issues for an invoice given full invoice list (for dup check).
function recomputeIssues(inv, allInvoices){
  const isDup = allInvoices.some(other =>
    other.id !== inv.id &&
    other.raw?.invoice_no &&
    inv.raw?.invoice_no &&
    String(other.raw.invoice_no).trim().toUpperCase() === String(inv.raw.invoice_no).trim().toUpperCase()
  );
  const extractedCtnSum = inv.groups.reduce((s,g)=>s+g.ctn, 0);
  return computeIssues({
    parsed: inv.raw,
    items: inv.items,
    groups: inv.groups,
    declaredTotal: inv.declaredTotal,
    isDuplicate: isDup,
    extractedCtnSum,
    manuallyAssigned: inv._manuallyAssigned,
  });
}

// ============================================================
// AI PROMPT (PATCH 1 — strengthened source-side accuracy)
// ============================================================
const PROMPT=`You are an invoice data extractor for Malaysian wholesale distributors. Analyze this invoice image carefully and extract ALL data into this exact JSON format. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.

{"supplier":"full supplier company name from the invoice header","invoice_no":"the document number","invoice_date":"DD/MM/YYYY","items":[{"description":"full product description exactly as printed including the product code like 320MLALSCN1X12","product_code":"product code","qty":20,"unit":"CS","list_price":42.46,"amount":849.20,"volume_ml":1500,"pack_size":12,"is_foc":false}],"total_qty":514,"total_amount":20380.80}

CRITICAL EXTRACTION RULES — read carefully:

1. EXTRACT EVERY SINGLE LINE ITEM. Do not skip any rows in the products table, even if:
   - The amount is 0.00 (these are FOC / free-of-charge items)
   - The list price is 0.00
   - The line looks like a duplicate (same product code repeated is COMMON and INTENTIONAL, treat each as separate)
   - The description appears short or truncated
   - Examples: an invoice with rows "qty 3, qty 170, qty 5" of the SAME product MUST have all 3 rows extracted, not just one.

2. CARTON TOTALS MUST MATCH:
   - The invoice has a "PRODUCT TOTAL" or "TOTAL QTY" line showing total cartons (e.g. "PRODUCT TOTAL 178")
   - This MUST equal the sum of all qty values from line items
   - Set total_qty to this PRODUCT TOTAL value EXACTLY as printed on the invoice
   - If your items[].qty values don't sum to total_qty, you missed some lines — RE-SCAN the invoice
   - DO NOT invent total_qty if the field is absent. If truly absent, set total_qty to the sum of items[].qty values.

3. VOLUME AND PACK SIZE MUST BE CONSISTENT WITH THE DESCRIPTION:
   - volume_ml and pack_size MUST match what the description string says
   - "320MLALSCN1X24" -> volume_ml: 320, pack_size: 24 (NOT 12, NOT some other value)
   - "1.5LPLBTN1X12" -> volume_ml: 1500, pack_size: 12
   - "500MLPETN1X24" -> volume_ml: 500, pack_size: 24
   - "300MLALSCN1X12" -> volume_ml: 300, pack_size: 12
   - "1LPLBTN1X12" -> volume_ml: 1000, pack_size: 12
   - DOUBLE-CHECK: re-read the description before emitting volume_ml/pack_size. They must agree.

4. invoice_no: From "Document No" / "Document No." / "Doc No." field. Typically starts with "IN" followed by digits (e.g. IN93018360). Extract the FULL alphanumeric string including the "IN" prefix. Do NOT use PO numbers, Ref numbers, or Load Ref numbers.

5. invoice_date: From "Invoice Date" or "Document Date" field. Output STRICTLY in DD/MM/YYYY format with leading zeros (e.g. "05/06/2026" not "5/6/2026"). NEVER use YYYY-MM-DD or MM/DD/YYYY formats.

6. qty: "20/0" -> extract only 20. The /0 means zero returns. "3/0" -> 3. "170/0" -> 170.

7. volume_ml is REQUIRED for every line, must be a number, never null. Parse from description per rule 3.

8. pack_size: Look for "X12", "1X12", "X24", "N1X12", "N1X24" patterns. MUST be a number.

9. description: MUST include the full product code string like "320MLALSCN1X24" exactly as printed. Do not abbreviate.

10. is_foc: true ONLY if list_price=0.00 AND amount=0.00. FOC items still count for total_qty.

11. total_amount: Final "Total Amount Due" / "Grand Total" value (the absolute bottom-line MYR amount, NOT the subtotal before tax).

12. supplier: From the TOP HEADER of the invoice (the company that ISSUED the invoice), NOT "Ship To" / "Bill To" / customer address blocks. If unsure, the supplier is usually the largest/most prominent company name at the top.

Be thorough. Missing line items or wrong volume/pack causes incorrect transport subsidy calculations. Return ONLY JSON.`;

const GROQ_MODEL='meta-llama/llama-4-scout-17b-16e-instruct';
const BATCH_DELAY_MS = 6000;
const B='1px solid #000';
const F='Calibri, "Segoe UI", Arial, sans-serif';

// ============================================================
// CLICK-TO-EDIT COMPONENTS
// ============================================================

// Click-to-edit Amount component — always displays formatted RM value, switches to input when clicked
function EditableAmount({value,onCommit,format}){
  const [editing,setEditing]=useState(false);
  const [local,setLocal]=useState(String(value));
  const ref=useRef(null);
  useEffect(()=>{ if(!editing) setLocal(String(value)); },[value,editing]);
  useEffect(()=>{ if(editing&&ref.current){ ref.current.focus(); ref.current.select(); } },[editing]);
  const commit=()=>{
    const n=parseFloat(local);
    if(!isNaN(n)&&n>=0&&n!==value) onCommit(n);
    setEditing(false);
  };
  if(editing){
    return <input ref={ref} type="number" step="0.01" value={local}
      onChange={e=>setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape'){setLocal(String(value));setEditing(false);} }}
      className="noP"
      style={{width:'100%',border:'1px solid #2563eb',borderRadius:3,padding:'3px 4px',fontSize:16,fontFamily:F,textAlign:'center',fontWeight:700,boxSizing:'border-box',background:'#fff'}}/>;
  }
  return <span
    onClick={()=>setEditing(true)}
    className="editable-text"
    title="Click to edit amount"
    style={{display:'block',cursor:'text',padding:'3px 4px',borderRadius:3,fontSize:16,fontWeight:700,textAlign:'center'}}
  >{format(value)}</span>;
}

// Click-to-edit CTN component — always shows plain number, switches to input when clicked
function EditableCtn({value,onCommit}){
  const [editing,setEditing]=useState(false);
  const [local,setLocal]=useState(String(value));
  const ref=useRef(null);
  useEffect(()=>{ if(!editing) setLocal(String(value)); },[value,editing]);
  useEffect(()=>{ if(editing&&ref.current){ ref.current.focus(); ref.current.select(); } },[editing]);
  const commit=()=>{
    const n=parseInt(local);
    if(!isNaN(n)&&n>=0&&n!==value) onCommit(n);
    setEditing(false);
  };
  if(editing){
    return <input ref={ref} type="number" min="0" value={local}
      onChange={e=>setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape'){setLocal(String(value));setEditing(false);} }}
      className="noP"
      style={{width:50,border:'1px solid #2563eb',borderRadius:3,padding:'1px 4px',fontSize:15,fontFamily:F,textAlign:'right',fontWeight:600,verticalAlign:'baseline'}}/>;
  }
  return <span
    onClick={()=>setEditing(true)}
    className="editable-text"
    title="Click to edit CTN count"
    style={{cursor:'text',fontWeight:600,padding:'1px 4px',borderRadius:3}}
  >{value}</span>;
}

// Click-to-edit Text component (PATCH 3) — generic text field for invoice_no, invoice_date
function EditableText({value,onCommit,placeholder='—',invalid=false}){
  const [editing,setEditing]=useState(false);
  const [local,setLocal]=useState(String(value||''));
  const ref=useRef(null);
  useEffect(()=>{ if(!editing) setLocal(String(value||'')); },[value,editing]);
  useEffect(()=>{ if(editing&&ref.current){ ref.current.focus(); ref.current.select(); } },[editing]);
  const commit=()=>{
    const v=local.trim();
    if(v !== String(value||'')) onCommit(v);
    setEditing(false);
  };
  if(editing){
    return <input ref={ref} type="text" value={local}
      onChange={e=>setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape'){setLocal(String(value||''));setEditing(false);} }}
      className="noP"
      style={{width:'100%',border:'1px solid #2563eb',borderRadius:3,padding:'2px 4px',fontSize:15,fontFamily:F,textAlign:'center',boxSizing:'border-box',background:'#fff'}}/>;
  }
  return <span
    onClick={()=>setEditing(true)}
    className="editable-text"
    title="Click to edit"
    style={{
      display:'inline-block',
      cursor:'text',
      padding:'2px 4px',
      borderRadius:3,
      color: invalid ? '#dc2626' : 'inherit',
      fontWeight: invalid ? 600 : 'inherit',
    }}
  >{value || placeholder}</span>;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function InvoiceExtractor() {
  const [invoices,setInvoices]=useState([]);
  const [uploading,setUploading]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [processingCount,setProcessingCount]=useState({done:0,total:0});
  const [error,setError]=useState(null);
  const [drag,setDrag]=useState(false);
  const [cnValues,setCnValues]=useState({});
  const [apiKey,setApiKey]=useState('');
  const [keyInput,setKeyInput]=useState('');
  const [showSettings,setShowSettings]=useState(false);
  const [manualEntry,setManualEntry]=useState({});  // { invId: { rateId, ctn } }
  const fileRef=useRef(null);
  const config=SUPPLIERS['CHOON HUA'];

  useEffect(()=>{
    try{ const k=localStorage.getItem('groq_api_key'); if(k) setApiKey(k); }catch(e){}
  },[]);

  const saveKey=()=>{
    if(!keyInput.trim())return;
    setApiKey(keyInput.trim());
    try{localStorage.setItem('groq_api_key',keyInput.trim());}catch(e){}
    setShowSettings(false);
  };

  const setCn=(id,val)=>setCnValues(prev=>({...prev,[id]:parseFloat(val)||0}));

  // Manually edit the CTN count for a specific category group within an invoice
  const updateGroupCtn=(invId,rateId,newCtn)=>{
    const ctn=parseInt(newCtn);
    if(isNaN(ctn)||ctn<0) return;
    setInvoices(prev=>{
      const updated = prev.map(inv=>{
        if(inv.id!==invId) return inv;
        const groups=inv.groups.map(g=>g.id===rateId?{...g,ctn}:g);
        const sub=calcSub(inv.raw.total_amount,groups,config.pct1,config.pct2);
        return {...inv,groups,subsidy:sub, _issuesDismissed:false};
      });
      return updated.map(inv => ({...inv, issues: recomputeIssues(inv, updated)}));
    });
  };

  // Manually edit total_amount on an invoice
  const updateInvoiceAmount=(invId,newAmount)=>{
    const amt=parseFloat(newAmount);
    if(isNaN(amt)||amt<0) return;
    setInvoices(prev=>{
      const updated = prev.map(inv=>{
        if(inv.id!==invId) return inv;
        const sub=calcSub(amt,inv.groups,config.pct1,config.pct2);
        return {...inv,raw:{...inv.raw,total_amount:amt},subsidy:sub, _issuesDismissed:false};
      });
      return updated.map(inv => ({...inv, issues: recomputeIssues(inv, updated)}));
    });
  };

  // PATCH 7 — Update invoice_no / invoice_date / supplier, with auto-normalize + dup recheck
  const updateInvoiceField=(invId, field, value)=>{
    setInvoices(prev=>{
      const updated = prev.map(inv=>{
        if(inv.id!==invId) return inv;
        let normalized = value;
        if(field==='invoice_date'){
          const dc = normalizeDate(value);
          if(dc.ok) normalized = dc.date;
        }
        return {...inv, raw:{...inv.raw, [field]: normalized}, _issuesDismissed:false};
      });
      // Recompute all issues because invoice_no change affects duplicate status across all invoices
      return updated.map(inv => ({...inv, issues: recomputeIssues(inv, updated)}));
    });
  };

  // PATCH 7 — Dismiss issues banner (user has reviewed them)
  const dismissIssues=(invId)=>{
    setInvoices(prev => prev.map(inv =>
      inv.id===invId ? {...inv, _issuesDismissed:true} : inv
    ));
  };

  // Remove a single invoice from the batch (useful for duplicates)
  const removeInvoice=(invId)=>{
    setInvoices(prev=>{
      const updated = prev.filter(inv => inv.id !== invId);
      // Recompute issues for survivors since removing a dup may clear DUPLICATE flag on others
      return updated.map(inv => ({...inv, issues: recomputeIssues(inv, updated)}));
    });
    setCnValues(prev => {
      const next = {...prev};
      delete next[invId];
      return next;
    });
  };

  // Manually assign a category to an unmatched invoice (groups was empty)
  const assignCategory=(invId,rateId,ctnInput)=>{
    const rate=config.rates.find(r=>r.id===rateId);
    const ctn=parseInt(ctnInput);
    if(!rate||!ctn||ctn<=0) return;
    setInvoices(prev=>{
      const updated = prev.map(inv=>{
        if(inv.id!==invId) return inv;
        const groups=[{...rate,ctn}];
        const sub=calcSub(inv.raw.total_amount,groups,config.pct1,config.pct2);
        return {...inv, groups, subsidy:sub, _manuallyAssigned:true, _issuesDismissed:false};
      });
      return updated.map(inv => ({...inv, issues: recomputeIssues(inv, updated)}));
    });
  };

  const processSingleFile=useCallback(async (file)=>{
    if(!file?.type.startsWith('image/')) throw new Error('Not an image file: '+file.name);
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=async()=>{
        try{
          let lastErr=null;
          for(let attempt=0;attempt<3;attempt++){
            try{
              if(attempt>0) await new Promise(r=>setTimeout(r,5000*(attempt)));
              const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
                method:'POST',
                headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
                body:JSON.stringify({
                  model:GROQ_MODEL,
                  messages:[{role:'user',content:[
                    {type:'image_url',image_url:{url:reader.result}},
                    {type:'text',text:PROMPT}
                  ]}],
                  max_tokens:2000, temperature:0.1,
                }),
              });
              const data=await res.json();
              if(data.error){
                if(data.error.message?.includes('Rate limit')||res.status===429){
                  lastErr=new Error('Rate limit — retrying...');
                  continue;
                }
                throw new Error(data.error.message||JSON.stringify(data.error));
              }
              let txt=(data.choices?.[0]?.message?.content||'').trim().replace(/```json|```/g,'').trim();
              // Fix common JSON issues from AI
              txt=txt.replace(/,\s*}/g,'}').replace(/,\s*]/g,']');
              if(!txt.startsWith('{')) txt=txt.substring(txt.indexOf('{'));
              if(!txt.endsWith('}')) txt=txt.substring(0,txt.lastIndexOf('}')+1);
              const parsed=JSON.parse(txt);

              // PATCH 6 — normalize date at source
              const dc = normalizeDate(parsed.invoice_date);
              if(dc.ok) parsed.invoice_date = dc.date;

              // PATCH 6 — match every item with cross-check metadata
              const items=(parsed.items||[]).map(it=>{
                const m=matchCat(it.volume_ml, it.pack_size, config.rates, it.description, it.product_code);
                return {
                  ...it,
                  category: m.cat,
                  _inconsistent: m.inconsistent,
                  _aiVol: m.aiVol,
                  _aiPack: m.aiPack,
                  _descVol: m.descVol,
                  _descPack: m.descPack,
                  _usedVol: m.usedVol,
                  _usedPack: m.usedPack,
                };
              });

              const unmatched=items.filter(it=>!it.category);
              if(unmatched.length>0){
                console.warn('[Invoice]',parsed.invoice_no,'has',unmatched.length,'unmatched items:',
                  unmatched.map(u=>({desc:u.description,code:u.product_code,vol:u._usedVol,pack:u._usedPack})));
              }

              // SANITY CHECK: extracted items qty sum should equal PRODUCT TOTAL on invoice
              const itemsQtySum = items.reduce((s,it)=>s+(Number(it.qty)||0),0);
              const declaredTotal = Number(parsed.total_qty)||0;
              if(declaredTotal>0 && Math.abs(itemsQtySum-declaredTotal)>0){
                console.warn('[Invoice]',parsed.invoice_no,
                  `CARTON MISMATCH: items sum to ${itemsQtySum} but PRODUCT TOTAL on invoice is ${declaredTotal}. AI likely missed line items.`);
              }

              const gMap={};
              items.forEach(it=>{if(!it.category)return;const k=it.category.id;if(!gMap[k])gMap[k]={...it.category,ctn:0};gMap[k].ctn+=Number(it.qty)||0;});
              const groupKeys=Object.keys(gMap);

              // AUTO-CORRECT: single-category invoice trusts PRODUCT TOTAL over extracted line items
              const extractedCtnSumPreCorrect = Object.values(gMap).reduce((s,g)=>s+g.ctn,0);
              if(groupKeys.length===1 && declaredTotal>0 && declaredTotal!==gMap[groupKeys[0]].ctn){
                console.info('[Invoice]',parsed.invoice_no,'auto-correcting CTN',gMap[groupKeys[0]].ctn,'→',declaredTotal,'based on PRODUCT TOTAL');
                gMap[groupKeys[0]].ctn=declaredTotal;
              }
              const groups=Object.values(gMap);
              const extractedCtnSum=groups.reduce((s,g)=>s+g.ctn,0);

              const sub=calcSub(parsed.total_amount,groups,config.pct1,config.pct2);
              const id='inv_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);

              // PATCH 5/6 — compute initial issues (without dup check yet — that's done in processFiles)
              const issues = computeIssues({
                parsed,
                items,
                groups,
                declaredTotal,
                isDuplicate: false,  // set in processFiles against full batch
                extractedCtnSum,
                manuallyAssigned: false,
              });

              resolve({raw:parsed,items,groups,subsidy:sub,id,issues,declaredTotal, _issuesDismissed:false, _manuallyAssigned:false});
              return;
            }catch(inner){lastErr=inner;}
          }
          reject(lastErr||new Error('Failed after retries'));
        }catch(e){reject(e);}
      };
      reader.onerror=()=>reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },[config,apiKey]);

  const processFiles=useCallback(async (files)=>{
    if(!apiKey){setError('Set your Groq API key first');setShowSettings(true);return;}
    const fileArr=Array.from(files).filter(f=>f.type.startsWith('image/'));
    if(fileArr.length===0){setError('No image files selected');return;}
    // PATCH (bug fix) — do NOT clear existing invoices/cnValues. Append mode for "Add Invoice".
    setError(null);setProcessing(true);
    setProcessingCount({done:0,total:fileArr.length});
    const results=[];
    for(let i=0;i<fileArr.length;i++){
      try{
        if(i>0) await new Promise(r=>setTimeout(r,BATCH_DELAY_MS));
        const inv=await processSingleFile(fileArr[i]);
        results.push(inv);
        setProcessingCount(prev=>({...prev,done:prev.done+1}));
      }catch(e){
        console.error('Error processing',fileArr[i].name,e);
        setError(prev=>(prev?prev+'\n':'')+`Failed: ${fileArr[i].name} — ${e.message}`);
      }
    }
    if(results.length>0){
      // PATCH 6b — merge new results, then recompute issues for everything (catches dups within batch + against existing)
      setInvoices(prev => {
        const merged = [...prev, ...results];
        return merged.map(inv => ({...inv, issues: recomputeIssues(inv, merged)}));
      });
      setCnValues(prev=>{const next={...prev};results.forEach(r=>{if(next[r.id]==null)next[r.id]=0;});return next;});
    }
    setUploading(false);setProcessing(false);
    if(fileRef.current) fileRef.current.value='';
  },[processSingleFile,apiKey]);

  const gT=invoices.reduce((s,i)=>s+i.raw.total_amount,0);
  const gC=invoices.reduce((s,i)=>s+i.subsidy.carton,0);
  const gP1=invoices.reduce((s,i)=>s+i.subsidy.p1,0);
  const gP2=invoices.reduce((s,i)=>s+i.subsidy.p2,0);
  const gS=Math.round((gC+gP1+gP2)*100)/100;
  const totalCn=Object.values(cnValues).reduce((s,v)=>s+v,0);
  const tA=Math.round((gT-gS)*100)/100;
  const tP=Math.round((tA-totalCn)*100)/100;

  // Total open issues (errors only, for the warning badge at the top)
  const openErrorCount = invoices.reduce((s,i)=>
    s + ((i.issues && !i._issuesDismissed) ? i.issues.filter(x=>x.severity==='error').length : 0)
  , 0);
  const openWarnCount = invoices.reduce((s,i)=>
    s + ((i.issues && !i._issuesDismissed) ? i.issues.filter(x=>x.severity==='warn').length : 0)
  , 0);

  const downloadExcel=()=>{
    const wb=XLSX.utils.book_new(),d=[];
    d.push([CO.name+' '+CO.reg]);d.push([CO.addr]);d.push(['Tel: '+CO.tel+'    E-mail: '+CO.email]);
    d.push([]);d.push(['PAYMENT SUMMARY']);d.push(['SUPPLIER: '+config.name]);d.push([]);
    d.push(['NO.','DATE','INVOICE NO.','AMOUNT','CN','','TRANSPORT SUBSIDY','']);
    invoices.forEach((inv,idx)=>{const cn=cnValues[inv.id]||0;inv.groups.forEach((g,gi)=>{
      d.push([gi===0?idx+1:'',gi===0?inv.raw.invoice_date:'',gi===0?inv.raw.invoice_no:'',gi===0?inv.raw.total_amount:'',gi===0&&cn?-cn:'','',g.label,'']);
      d.push(['','','','','','',g.ctn+' CTN x RM'+g.rate.toFixed(2)+' =',g.ctn*g.rate]);
      d.push(['','','','','','','+ 0.4% =',inv.subsidy.p1]);
      d.push(['','','','','','','+ 0.2% =',inv.subsidy.p2]);
    });});
    d.push([]);d.push(['','','','','','','CARTON:',gC]);d.push(['','','','','','','0.4%:',gP1]);d.push(['','','','','','','0.2%:',gP2]);
    if(totalCn)d.push(['','','','','','','CREDIT NOTE:',-totalCn]);
    d.push(['','','','TOTAL:',gT]);d.push([]);
    d.push(['','','','','TOTAL AMOUNT PAYABLE = RM'+tP.toFixed(2)]);
    const ws=XLSX.utils.aoa_to_sheet(d);
    ws['!cols']=[{wch:5},{wch:12},{wch:16},{wch:16},{wch:10},{wch:2},{wch:24},{wch:14}];
    XLSX.utils.book_append_sheet(wb,ws,'Payment Summary');
    XLSX.writeFile(wb,'Payment_Summary_'+config.name.split(' ')[0]+'.xlsx');
  };

  const reset=()=>{setInvoices([]);setUploading(false);setProcessing(false);setError(null);setCnValues({});setManualEntry({});if(fileRef.current)fileRef.current.value='';};
  const showUpload=invoices.length===0||uploading;

  return(
    <div style={{fontFamily:F,fontSize:16,background:'#fff',color:'#000',minHeight:'100vh'}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .editable-text:hover{background:#f0f9ff;outline:1px dashed #93c5fd;outline-offset:-1px}
        .printOnly{display:none}
        @media print{
          .noP{display:none!important}
          .screenOnly{display:none!important;visibility:hidden!important;width:0!important;height:0!important;overflow:hidden!important;position:absolute!important}
          .printOnly{display:inline!important;visibility:visible!important}
          body,html{margin:0;padding:0;background:#fff}
          @page{size:A4 portrait;margin:8mm 8mm}
          .wrap{max-width:100%!important;padding:0!important}
          .print-area{font-size:12px!important}
          .print-area h1,.print-area h2,.print-area h3{font-size:14px!important;margin:4px 0!important}
          .print-area table{font-size:11px!important}
          .print-area td,.print-area th{padding:4px 6px!important}
          .print-area .total-payable{font-size:18px!important;margin-top:10px!important}
          .print-area img{max-height:55px!important}
          .print-area,.print-area table{page-break-inside:avoid}
          .print-area tr{page-break-inside:avoid}
        }
      `}</style>

      <div className="wrap print-area" style={{maxWidth:780,margin:'0 auto',padding:'20px'}}>

        {/* HEADER */}
        <div style={{display:'flex',alignItems:'center',gap:16,paddingBottom:12,borderBottom:'3px solid #000'}}>
          <img src={LOGO} style={{height:80,flexShrink:0,marginLeft:10}} alt="CJK"/>
          <div style={{flex:1,textAlign:'center'}}>
            <div style={{fontSize:18,fontWeight:700}}>{CO.name}</div>
            <div style={{fontSize:18,fontWeight:700}}>{CO.reg}</div>
            <div style={{fontSize:14,marginTop:2}}>{CO.addr}</div>
            <div style={{fontSize:14}}>Tel: {CO.tel} &nbsp;&nbsp;&nbsp; E-mail: <a href={'mailto:'+CO.email} style={{color:'#0056b3'}}>{CO.email}</a></div>
          </div>
          <div className="noP" style={{width:60,flexShrink:0,textAlign:'right'}}>
            <button onClick={()=>setShowSettings(!showSettings)}
              style={{background:'none',border:'1px solid #ccc',borderRadius:4,padding:'3px 8px',cursor:'pointer',fontSize:11,color:'#888'}}>
              ⚙ API
            </button>
          </div>
        </div>

        {/* API KEY */}
        {(showSettings||!apiKey)&&(
          <div className="noP" style={{background:'#f8f8f8',border:'1px solid #ddd',borderRadius:6,padding:'12px 16px',margin:'14px 0'}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>
              Groq API Key {apiKey&&<span style={{color:'#080',fontWeight:400}}>✓ saved</span>}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input type="password" value={keyInput} onChange={e=>setKeyInput(e.target.value)}
                placeholder="gsk_..." onKeyDown={e=>e.key==='Enter'&&saveKey()}
                style={{flex:1,padding:'6px 10px',border:'1px solid #bbb',borderRadius:4,fontSize:14,fontFamily:'monospace'}}/>
              <button onClick={saveKey} style={btn(1)}>Save</button>
              {apiKey&&<button onClick={()=>setShowSettings(false)} style={btn(0)}>Close</button>}
            </div>
            <div style={{fontSize:12,color:'#999',marginTop:5}}>
              Free at <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{color:'#0056b3'}}>console.groq.com</a>
            </div>
          </div>
        )}

        {error&&<div className="noP" style={{background:'#fff0f0',border:'1px solid #d00',borderRadius:6,padding:'10px 14px',color:'#c00',fontSize:14,margin:'10px 0',whiteSpace:'pre-wrap'}}>
          {error}<span style={{float:'right',cursor:'pointer'}} onClick={()=>setError(null)}>✕</span>
        </div>}

        {/* GLOBAL ISSUE COUNTER — shows total unresolved issues across batch */}
        {(openErrorCount>0 || openWarnCount>0) && (
          <div className="noP" style={{
            background: openErrorCount>0 ? '#fef2f2' : '#fffbeb',
            border: `1px solid ${openErrorCount>0 ? '#f87171' : '#fbbf24'}`,
            borderRadius:6,
            padding:'8px 14px',
            margin:'10px 0',
            fontSize:13,
            display:'flex',
            justifyContent:'space-between',
            alignItems:'center',
          }}>
            <span>
              {openErrorCount>0 ? '🛑' : '⚠'} <strong>{openErrorCount+openWarnCount} issue{openErrorCount+openWarnCount>1?'s':''}</strong> across this batch
              {openErrorCount>0 && <span style={{color:'#dc2626',marginLeft:8}}>({openErrorCount} error{openErrorCount>1?'s':''})</span>}
              {openWarnCount>0 && <span style={{color:'#d97706',marginLeft:8}}>({openWarnCount} warning{openWarnCount>1?'s':''})</span>}
            </span>
            <span style={{fontSize:11,color:'#6b7280'}}>scroll down — each invoice with issues has a yellow/red banner</span>
          </div>
        )}

        {/* PAYMENT SUMMARY */}
        {invoices.length>0&&(<>
          <div style={{textAlign:'center',margin:'20px 0 6px'}}>
            <div style={{fontWeight:700,fontSize:22,letterSpacing:1}}>PAYMENT SUMMARY</div>
            <div style={{fontWeight:700,fontSize:16,marginTop:2}}>SUPPLIER: {config.name}</div>
          </div>

          <table style={{width:'100%',borderCollapse:'collapse',marginTop:14}}>
            <thead><tr>
              <th style={{...T.th,width:36}}>NO.</th>
              <th style={{...T.th,width:86}}>DATE</th>
              <th style={{...T.th,width:120}}>INVOICE NO.</th>
              <th style={{...T.th,width:88}}>AMOUNT</th>
              <th style={{...T.th,width:60}}>CN</th>
              <th style={T.th} colSpan={2}>TRANSPORT SUBSIDY</th>
            </tr></thead>
            <tbody>
              {invoices.map((inv,idx)=>{
                const rc=Math.max(inv.groups.length*3,1);
                const cn=cnValues[inv.id]||0;
                const displayNum=idx+1;
                const rows=[];

                const dateInvalid = inv.issues?.some(i=>i.kind==='date' && !inv._issuesDismissed);
                const invNoInvalid = inv.issues?.some(i=>(i.kind==='invoice_no'||i.kind==='duplicate') && !inv._issuesDismissed);

                if(inv.groups.length===0){
                  const me=manualEntry[inv.id]||{rateId:'',ctn:''};
                  rows.push(<tr key={inv.id+'-empty'}>
                    <td style={T.td}>{displayNum}</td>
                    <td style={T.td}>
                      <EditableText
                        value={inv.raw.invoice_date}
                        onCommit={v=>updateInvoiceField(inv.id,'invoice_date',v)}
                        invalid={dateInvalid}
                        placeholder="DD/MM/YYYY"
                      />
                    </td>
                    <td style={T.td}>
                      <EditableText
                        value={inv.raw.invoice_no}
                        onCommit={v=>updateInvoiceField(inv.id,'invoice_no',v)}
                        invalid={invNoInvalid}
                        placeholder="IN..."
                      />
                    </td>
                    <td style={{...T.td,fontWeight:700}}>
                      <EditableAmount
                        value={inv.raw.total_amount}
                        onCommit={v=>updateInvoiceAmount(inv.id,v)}
                        format={fmt}
                      />
                    </td>
                    <td style={{...T.td,padding:4}}>
                      <input type="number" step="0.01" value={cn||''} placeholder="0.00"
                        onChange={e=>setCn(inv.id,e.target.value)} className="noP"
                        style={{width:'100%',border:'1px solid #ccc',borderRadius:3,padding:'3px 4px',fontSize:14,fontFamily:F,textAlign:'right',boxSizing:'border-box'}}/>
                      {cn>0&&<div style={{textAlign:'right',fontSize:13,color:'#c00',marginTop:2}}>-{fmt(cn)}</div>}
                    </td>
                    <td style={{...T.td,padding:8}} colSpan={2}>
                      <div className="noP" style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:12,color:'#888'}}>AI missed this — pick category:</span>
                        <select value={me.rateId}
                          onChange={e=>setManualEntry(p=>({...p,[inv.id]:{...me,rateId:e.target.value}}))}
                          style={{padding:'4px 6px',fontSize:13,border:'1px solid #aaa',borderRadius:3,fontFamily:F}}>
                          <option value="">— Category —</option>
                          {config.rates.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                        <input type="number" placeholder="CTN" value={me.ctn}
                          onChange={e=>setManualEntry(p=>({...p,[inv.id]:{...me,ctn:e.target.value}}))}
                          style={{width:70,padding:'4px 6px',fontSize:13,border:'1px solid #aaa',borderRadius:3,fontFamily:F}}/>
                        <button onClick={()=>assignCategory(inv.id,me.rateId,me.ctn)}
                          disabled={!me.rateId||!me.ctn}
                          style={{padding:'4px 12px',fontSize:13,background:(me.rateId&&me.ctn)?'#111':'#ddd',color:'#fff',border:'none',borderRadius:3,cursor:(me.rateId&&me.ctn)?'pointer':'not-allowed',fontWeight:600}}>
                          Apply
                        </button>
                      </div>
                    </td>
                  </tr>);
                } else {
                inv.groups.forEach((g,gi)=>{
                  rows.push(<tr key={inv.id+'-'+gi+'-c'}>
                    {gi===0&&<td style={T.td} rowSpan={rc}>{displayNum}</td>}
                    {gi===0&&<td style={T.td} rowSpan={rc}>
                      <EditableText
                        value={inv.raw.invoice_date}
                        onCommit={v=>updateInvoiceField(inv.id,'invoice_date',v)}
                        invalid={dateInvalid}
                        placeholder="DD/MM/YYYY"
                      />
                    </td>}
                    {gi===0&&<td style={T.td} rowSpan={rc}>
                      <EditableText
                        value={inv.raw.invoice_no}
                        onCommit={v=>updateInvoiceField(inv.id,'invoice_no',v)}
                        invalid={invNoInvalid}
                        placeholder="IN..."
                      />
                    </td>}
                    {gi===0&&<td style={{...T.td,fontWeight:700,padding:'8px 6px',position:'relative'}} rowSpan={rc}>
                      <EditableAmount
                        value={inv.raw.total_amount}
                        onCommit={v=>updateInvoiceAmount(inv.id,v)}
                        format={fmt}
                      />
                    </td>}
                    {gi===0&&<td style={{...T.td,padding:4}} rowSpan={rc}>
                      <input type="number" step="0.01" value={cn||''} placeholder="0.00"
                        onChange={e=>setCn(inv.id,e.target.value)} className="noP"
                        style={{width:'100%',border:'1px solid #ccc',borderRadius:3,padding:'3px 4px',fontSize:14,fontFamily:F,textAlign:'right',boxSizing:'border-box'}}/>
                      {cn>0&&<div style={{textAlign:'right',fontSize:13,color:'#c00',marginTop:2}}>-{fmt(cn)}</div>}
                    </td>}
                    <td style={{...T.subL,padding:'4px 8px'}}>
                      <span style={{display:'inline-flex',alignItems:'baseline',gap:4,justifyContent:'flex-end',width:'100%',whiteSpace:'nowrap'}}>
                        <EditableCtn
                          value={g.ctn}
                          onCommit={v=>updateGroupCtn(inv.id,g.id,v)}
                        />
                        <span>CTN x RM{g.rate.toFixed(2)} =</span>
                      </span>
                    </td>
                    <td style={T.subR}>{fmt(g.ctn*g.rate)}</td>
                  </tr>);
                  rows.push(<tr key={inv.id+'-'+gi+'-p1'}>
                    <td style={T.subL}>+ 0.4% =</td><td style={T.subR}>{fmt(inv.subsidy.p1)}</td>
                  </tr>);
                  rows.push(<tr key={inv.id+'-'+gi+'-p2'}>
                    <td style={T.subL}>+ 0.2% =</td><td style={T.subR}>{fmt(inv.subsidy.p2)}</td>
                  </tr>);
                });
                }

                // PATCH 8 — issues banner row (replaces the old single-line warning)
                if(inv.issues && inv.issues.length > 0 && !inv._issuesDismissed){
                  const hasError = inv.issues.some(i=>i.severity==='error');
                  rows.push(<tr key={inv.id+'-issues'} className="noP">
                    <td colSpan={7} style={{padding:'10px 12px', background:'#fff'}}>
                      <div style={{
                        background: hasError ? '#fef2f2' : '#fffbeb',
                        border: `1px solid ${hasError ? '#f87171' : '#fbbf24'}`,
                        borderRadius:6,
                        padding:'10px 14px',
                        fontSize:13,
                      }}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,gap:8}}>
                          <strong style={{fontSize:14}}>
                            {hasError ? '🛑' : '⚠'} {inv.issues.length} issue{inv.issues.length>1?'s':''} on invoice {inv.raw.invoice_no||'(no number)'} — verify before exporting
                          </strong>
                          <div style={{display:'flex',gap:6}}>
                            {hasError && (
                              <button onClick={()=>removeInvoice(inv.id)}
                                style={{padding:'3px 10px',fontSize:11,border:'1px solid #dc2626',background:'#fff',color:'#dc2626',borderRadius:4,cursor:'pointer',fontFamily:F}}>
                                Remove
                              </button>
                            )}
                            <button onClick={()=>dismissIssues(inv.id)}
                              style={{padding:'3px 10px',fontSize:11,border:'1px solid #d1d5db',background:'#fff',borderRadius:4,cursor:'pointer',fontFamily:F}}>
                              Dismiss
                            </button>
                          </div>
                        </div>
                        <ul style={{margin:0,paddingLeft:18,lineHeight:1.5}}>
                          {inv.issues.map((iss,i)=>(
                            <li key={i} style={{marginBottom: iss.details ? 6 : 2}}>
                              <span style={{
                                display:'inline-block',padding:'1px 6px',marginRight:6,fontSize:10,fontWeight:700,
                                borderRadius:3,background: iss.severity==='error' ? '#dc2626' : '#d97706',
                                color:'#fff',textTransform:'uppercase',verticalAlign:'middle',letterSpacing:0.3,
                              }}>{iss.kind.replace(/_/g,' ')}</span>
                              {iss.msg}
                              {iss.details && iss.details.length > 0 && (
                                <ul style={{paddingLeft:14,marginTop:3,color:'#6b7280',fontSize:12}}>
                                  {iss.details.slice(0,5).map((d,j)=><li key={j}>{d}</li>)}
                                  {iss.details.length > 5 && <li>…and {iss.details.length - 5} more</li>}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </td>
                  </tr>);
                }

                return <React.Fragment key={inv.id}>{rows}</React.Fragment>;
              })}
              {/* SUMMARY BOX — aligned with table columns above */}
              <tr><td colSpan={7} style={{padding:6,border:'none'}}/></tr>
              <tr>
                <td colSpan={5} style={{border:'none'}}/>
                <td style={T.bxL}>CARTON:</td>
                <td style={T.bxR}>{fmt(gC)}</td>
              </tr>
              <tr>
                <td colSpan={5} style={{border:'none'}}/>
                <td style={T.bxL}>0.4%:</td>
                <td style={T.bxR}>{fmt(gP1)}</td>
              </tr>
              <tr>
                <td colSpan={5} style={{border:'none'}}/>
                <td style={T.bxL}>0.2%:</td>
                <td style={T.bxR}>{fmt(gP2)}</td>
              </tr>
              <tr>
                <td colSpan={5} style={{border:'none'}}/>
                <td style={T.bxL}>CREDIT NOTE:</td>
                <td style={T.bxR}>{totalCn?'-'+fmt(totalCn):'RM0.00'}</td>
              </tr>
              <tr>
                <td colSpan={5} style={{border:'none'}}/>
                <td style={{...T.bxL,borderTop:'2px solid #000'}}>TOTAL:</td>
                <td style={{...T.bxR,borderTop:'2px solid #000',background:'#ffe600',fontSize:18}}>{fmt(gT)}</td>
              </tr>
            </tbody>
          </table>

          {/* TOTAL AMOUNT PAYABLE */}
          <div className="total-payable" style={{marginTop:16,textAlign:'right'}}>
            <div style={{fontSize:22,fontWeight:700,letterSpacing:0.5}}>
              TOTAL AMOUNT PAYABLE = {fmt(tP)}
            </div>
          </div>

          {/* BUTTONS */}
          <div className="noP" style={{display:'flex',gap:8,justifyContent:'center',marginTop:28}}>
            <button style={btn(0)} onClick={()=>setUploading(true)}>+ Add Invoice</button>
            <button style={btn(1)} onClick={()=>window.print()}>🖨 Print / Save PDF</button>
            <button style={btn(0)} onClick={downloadExcel}>↓ Excel</button>
            <button style={{...btn(0),color:'#aaa',borderColor:'#ddd'}} onClick={reset}>Reset</button>
          </div>
        </>)}

        {/* UPLOAD */}
        {showUpload&&!processing&&apiKey&&(
          <div className="noP"
            style={{border:'2px dashed '+(drag?'#c87b00':'#ccc'),borderRadius:8,padding:'48px 20px',textAlign:'center',
              cursor:'pointer',background:drag?'#fffbeb':'#fafafa',marginTop:18}}
            onDragOver={e=>{e.preventDefault();setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer?.files?.length)processFiles(e.dataTransfer.files);}}
            onClick={()=>fileRef.current?.click()}>
            <div style={{fontSize:32,marginBottom:8,opacity:.3}}>📄</div>
            <div style={{fontSize:16,fontWeight:600}}>
              {invoices.length>0?'Add more invoices':'Drop invoice photos here'}</div>
            <div style={{fontSize:13,color:'#999',marginTop:3}}>or click to browse — select multiple JPG, PNG</div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{display:'none'}}
              onChange={e=>{if(e.target.files?.length)processFiles(e.target.files);e.target.value='';}}/>
            {invoices.length>0&&<button style={{...btn(0),marginTop:12}} onClick={e=>{e.stopPropagation();setUploading(false);}}>Cancel</button>}
          </div>
        )}

        {processing&&(
          <div className="noP" style={{textAlign:'center',padding:'60px 20px'}}>
            <div style={{width:32,height:32,border:'3px solid #eee',borderTop:'3px solid #000',borderRadius:'50%',margin:'0 auto 12px',animation:'spin .7s linear infinite'}}/>
            <div style={{fontSize:14,color:'#888'}}>
              Extracting with Groq...{processingCount.total>1&&` (${processingCount.done}/${processingCount.total})`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const T={
  th:{border:B,padding:'10px 8px',fontWeight:700,fontSize:16,textAlign:'center',background:'#f0f0f0',fontFamily:F},
  td:{border:B,padding:'8px 10px',fontSize:16,textAlign:'center',verticalAlign:'middle',fontFamily:F},
  cat:{border:B,padding:'6px 8px',fontSize:16,fontWeight:700,textDecoration:'underline',textAlign:'center',fontFamily:F},
  subL:{border:B,padding:'6px 12px',fontSize:16,textAlign:'right',fontFamily:F,fontVariantNumeric:'tabular-nums'},
  subR:{border:B,padding:'6px 12px',fontSize:16,textAlign:'left',fontWeight:700,fontFamily:F,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',width:110},
  bxL:{border:B,padding:'6px 14px',fontSize:16,fontWeight:700,textAlign:'right',background:'#f0f0f0',fontFamily:F},
  bxR:{border:B,padding:'6px 14px',fontSize:16,fontWeight:700,textAlign:'left',fontFamily:F,minWidth:110,width:110,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'},
};
const btn=p=>({padding:'8px 18px',borderRadius:5,border:p?'none':'1px solid #aaa',fontWeight:600,fontSize:14,cursor:'pointer',background:p?'#111':'#fff',color:p?'#fff':'#333',fontFamily:F});

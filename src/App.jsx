import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';

const LOGO = "data:image/png;base64,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";

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

function matchCat(v,p,rates){ return rates.find(r=>v>=r.minVol&&v<=r.maxVol&&p===r.packSize)||null; }
function calcSub(amt,groups,p1,p2){
  const c=groups.reduce((s,g)=>s+g.ctn*g.rate,0), r=v=>Math.round(v*100)/100;
  const v1=r((amt-c)*p1), v2=r((amt-c-v1)*p2);
  return {carton:r(c),p1:v1,p2:v2,total:r(c+v1+v2)};
}
const fmt=n=>{if(n===''||n==null)return '';return`RM${Number(n).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;};

const PROMPT=`You are an invoice data extractor for Malaysian wholesale distributors. Analyze this invoice image carefully and extract ALL data into this exact JSON format. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.

{"supplier":"full supplier company name from the invoice header","invoice_no":"the document number","invoice_date":"DD/MM/YYYY","items":[{"description":"full product description exactly as printed","product_code":"product code","qty":20,"unit":"CS","list_price":42.46,"amount":849.20,"volume_ml":1500,"pack_size":12,"is_foc":false}],"total_qty":514,"total_amount":20380.80}

CRITICAL RULES:
- invoice_no: Look for the field labeled "Document No", "Document No.", or "Doc No." on the invoice. This is the invoice number. It typically starts with "IN" followed by digits (e.g. IN93018360). Do NOT use PO numbers, Ref numbers, or Load Ref numbers. READ THE EXACT CHARACTERS CAREFULLY.
- invoice_date: Use the "Invoice Date" or "Document Date" field. Format as DD/MM/YYYY.
- qty: If shown as "20/0", extract ONLY the first number (20). The /0 means zero returns.
- volume_ml: Convert the volume from the product description to milliliters (1.5L=1500, 1.75L=1750, 500ML=500, 320ML=320, 300ML=300, 1L=1000, 250ML=250, 370ML=370).
- pack_size: Extract from description patterns like "1X12" or "X12" = 12, "1X24" or "X24" = 24.
- is_foc: Set to true ONLY if list_price is 0.00 AND amount is 0.00 (Free Of Charge).
- total_amount: Use the final "Total Amount Due" or "Total Amt" value.
- supplier: The supplier company name is in the TOP HEADER of the invoice, NOT the "Ship To" or "Bill To" address.
- Include ALL line items including FOC items.
- Return ONLY the JSON object, nothing else.`;

const GROQ_MODEL='meta-llama/llama-4-scout-17b-16e-instruct';
const B='1px solid #000';

export default function App(){
  const [invoices,setInvoices]=useState([]);
  const [uploading,setUploading]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [error,setError]=useState(null);
  const [drag,setDrag]=useState(false);
  const [creditNote,setCreditNote]=useState(0);
  const [apiKey,setApiKey]=useState('');
  const [keyInput,setKeyInput]=useState('');
  const [showSettings,setShowSettings]=useState(false);
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

  const processFile=useCallback(async file=>{
    if(!file?.type.startsWith('image/')){setError('Upload an image file');return;}
    if(!apiKey){setError('Set your Groq API key first');setShowSettings(true);return;}
    setError(null);setProcessing(true);
    const reader=new FileReader();
    reader.onload=async()=>{
      const dataUrl=reader.result;
      try{
        const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
          body:JSON.stringify({
            model:GROQ_MODEL,
            messages:[{role:'user',content:[
              {type:'image_url',image_url:{url:dataUrl}},
              {type:'text',text:PROMPT}
            ]}],
            max_tokens:2000, temperature:0.1,
          }),
        });
        const data=await res.json();
        if(data.error) throw new Error(data.error.message||JSON.stringify(data.error));
        const txt=(data.choices?.[0]?.message?.content||'').trim().replace(/\`\`\`json|\`\`\`/g,'').trim();
        const parsed=JSON.parse(txt);
        const items=(parsed.items||[]).map(it=>({...it,category:matchCat(it.volume_ml,it.pack_size,config.rates)}));
        const gMap={};
        items.forEach(it=>{if(!it.category)return;const k=it.category.id;if(!gMap[k])gMap[k]={...it.category,ctn:0};gMap[k].ctn+=it.qty;});
        const groups=Object.values(gMap);
        const sub=calcSub(parsed.total_amount,groups,config.pct1,config.pct2);
        setInvoices(prev=>[...prev,{raw:parsed,items,groups,subsidy:sub,num:prev.length+1}]);
        setUploading(false);setProcessing(false);
        // Reset file input so same file can be re-selected
        if(fileRef.current) fileRef.current.value='';
      }catch(e){console.error(e);setError(`Extraction failed: ${e.message}`);setProcessing(false);}
    };
    reader.readAsDataURL(file);
  },[config,apiKey]);

  const gT=invoices.reduce((s,i)=>s+i.raw.total_amount,0);
  const gC=invoices.reduce((s,i)=>s+i.subsidy.carton,0);
  const gP1=invoices.reduce((s,i)=>s+i.subsidy.p1,0);
  const gP2=invoices.reduce((s,i)=>s+i.subsidy.p2,0);
  const gS=Math.round((gC+gP1+gP2)*100)/100;
  const tA=Math.round((gT-gS)*100)/100;
  const tP=Math.round((tA-creditNote)*100)/100;

  const downloadExcel=()=>{
    const wb=XLSX.utils.book_new(),d=[];
    d.push([CO.name,'','',CO.reg]);d.push([CO.addr]);d.push([`Tel: ${CO.tel}`,'',`E-mail: ${CO.email}`]);
    d.push([]);d.push(['PAYMENT SUMMARY']);d.push([`SUPPLIER: ${config.name}`]);d.push([]);
    d.push(['NO.','DATE','INVOICE NO.','AMOUNT','','TRANSPORT SUBSIDY','']);
    invoices.forEach(inv=>{inv.groups.forEach((g,gi)=>{
      d.push([gi===0?inv.num:'',gi===0?inv.raw.invoice_date:'',gi===0?inv.raw.invoice_no:'',gi===0?inv.raw.total_amount:'','',g.label,'']);
      d.push(['','','','','',`${g.ctn} CTN x RM${g.rate.toFixed(2)} =`,g.ctn*g.rate]);
      d.push(['','','','','','+ 0.4% =',gi===0?inv.subsidy.p1:'']);
      d.push(['','','','','','+ 0.2% =',gi===0?inv.subsidy.p2:'']);
    });});
    d.push([]);d.push(['','','','','','CARTON:',gC]);d.push(['','','','','','0.4%:',gP1]);d.push(['','','','','','0.2%:',gP2]);
    if(creditNote)d.push(['','','','','','CREDIT NOTE:',-Math.abs(creditNote)]);
    d.push(['','','TOTAL:',gT,'','',gS+(creditNote?creditNote:0)]);d.push([]);
    d.push(['','','','',`TOTAL AMOUNT = RM${tA.toFixed(2)}`]);
    d.push(['','','','',`TOTAL AMOUNT PAYABLE = RM${tP.toFixed(2)}`]);
    const ws=XLSX.utils.aoa_to_sheet(d);
    ws['!cols']=[{wch:5},{wch:12},{wch:16},{wch:16},{wch:2},{wch:24},{wch:14}];
    XLSX.utils.book_append_sheet(wb,ws,'Payment Summary');
    XLSX.writeFile(wb,`Payment_Summary_${config.name.split(' ')[0]}.xlsx`);
  };

  const reset=()=>{setInvoices([]);setUploading(false);setProcessing(false);setError(null);setCreditNote(0);if(fileRef.current)fileRef.current.value='';};
  const showUpload=invoices.length===0||uploading;

  const subRows=(inv)=>{
    const rows=[],rc=inv.groups.length*4;
    inv.groups.forEach((g,gi)=>{
      rows.push(<tr key={`${inv.num}-${gi}-h`}>
        {gi===0&&<td style={T.td} rowSpan={rc}>{inv.num}</td>}
        {gi===0&&<td style={T.td} rowSpan={rc}>{inv.raw.invoice_date}</td>}
        {gi===0&&<td style={T.td} rowSpan={rc}>{inv.raw.invoice_no}</td>}
        {gi===0&&<td style={{...T.td,...T.amt}} rowSpan={rc}>{fmt(inv.raw.total_amount)}</td>}
        <td style={T.cat} colSpan={2}>{g.label}</td>
      </tr>);
      rows.push(<tr key={`${inv.num}-${gi}-c`}>
        <td style={T.subL}>{g.ctn} CTN x RM{g.rate.toFixed(2)} =</td>
        <td style={T.subR}>{fmt(g.ctn*g.rate)}</td>
      </tr>);
      rows.push(<tr key={`${inv.num}-${gi}-p1`}>
        <td style={T.subL}>+ 0.4% =</td><td style={T.subR}>{fmt(inv.subsidy.p1)}</td>
      </tr>);
      rows.push(<tr key={`${inv.num}-${gi}-p2`}>
        <td style={T.subL}>+ 0.2% =</td><td style={T.subR}>{fmt(inv.subsidy.p2)}</td>
      </tr>);
    });
    return rows;
  };

  return(
    <div style={{fontFamily:'"Times New Roman",Times,serif',background:'#fff',color:'#000',minHeight:'100vh'}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @media print{
          .noP{display:none!important}
          body,html{margin:0;padding:0;background:#fff}
          @page{size:A4 portrait;margin:12mm 10mm}
          .wrap{max-width:100%!important;padding:0!important}
        }
      `}</style>

      <div className="wrap" style={{maxWidth:780,margin:'0 auto',padding:'20px'}}>

        {/* ── HEADER ── */}
        <table style={{width:'100%',borderCollapse:'collapse',borderBottom:'3px solid #000',paddingBottom:8}}>
          <tbody><tr>
            <td style={{width:72,paddingBottom:10,verticalAlign:'middle'}}>
              <img src={LOGO} style={{height:60}} alt="CJK"/>
            </td>
            <td style={{paddingBottom:10,paddingLeft:14,verticalAlign:'middle'}}>
              <div style={{fontSize:16,fontWeight:700}}>{CO.name}</div>
              <div style={{fontSize:16,fontWeight:700}}>{CO.reg}</div>
              <div style={{fontSize:12,marginTop:2}}>{CO.addr}</div>
              <div style={{fontSize:12}}>Tel: {CO.tel} &nbsp;&nbsp;&nbsp; E-mail: <a href={`mailto:${CO.email}`} style={{color:'#0056b3'}}>{CO.email}</a></div>
            </td>
            <td className="noP" style={{width:60,verticalAlign:'top',textAlign:'right'}}>
              <button onClick={()=>setShowSettings(!showSettings)}
                style={{background:'none',border:'1px solid #ccc',borderRadius:4,padding:'3px 8px',cursor:'pointer',fontSize:11,fontFamily:'Arial',color:'#888'}}>
                ⚙ API
              </button>
            </td>
          </tr></tbody>
        </table>

        {/* ── API KEY ── */}
        {(showSettings||!apiKey)&&(
          <div className="noP" style={{background:'#f8f8f8',border:'1px solid #ddd',borderRadius:6,padding:'12px 16px',margin:'14px 0'}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6,fontFamily:'Arial'}}>
              Groq API Key {apiKey&&<span style={{color:'#080',fontWeight:400}}>✓ saved</span>}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input type="password" value={keyInput} onChange={e=>setKeyInput(e.target.value)}
                placeholder="gsk_..." onKeyDown={e=>e.key==='Enter'&&saveKey()}
                style={{flex:1,padding:'6px 10px',border:'1px solid #bbb',borderRadius:4,fontSize:13,fontFamily:'monospace'}}/>
              <button onClick={saveKey} style={btn(1)}>Save</button>
              {apiKey&&<button onClick={()=>setShowSettings(false)} style={btn(0)}>Close</button>}
            </div>
            <div style={{fontSize:11,color:'#999',marginTop:5,fontFamily:'Arial'}}>
              Free at <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{color:'#0056b3'}}>console.groq.com</a>
            </div>
          </div>
        )}

        {error&&<div className="noP" style={{background:'#fff0f0',border:'1px solid #d00',borderRadius:6,padding:'10px 14px',color:'#c00',fontSize:13,margin:'10px 0'}}>
          {error}<span style={{float:'right',cursor:'pointer'}} onClick={()=>setError(null)}>✕</span>
        </div>}

        {/* ── PAYMENT SUMMARY ── */}
        {invoices.length>0&&(<>
          <div style={{textAlign:'center',margin:'20px 0 4px'}}>
            <div style={{fontWeight:700,fontSize:19,letterSpacing:1}}>PAYMENT SUMMARY</div>
            <div style={{fontWeight:700,fontSize:14,marginTop:2}}>SUPPLIER: {config.name}</div>
          </div>

          <table style={{width:'100%',borderCollapse:'collapse',marginTop:14}}>
            <thead><tr>
              <th style={{...T.th,width:36}}>NO.</th>
              <th style={{...T.th,width:86}}>DATE</th>
              <th style={{...T.th,width:120}}>INVOICE NO.</th>
              <th style={{...T.th,width:120}}>AMOUNT</th>
              <th style={T.th} colSpan={2}>TRANSPORT SUBSIDY</th>
            </tr></thead>
            <tbody>
              {invoices.map(inv=>(
                <React.Fragment key={inv.num}>{subRows(inv)}</React.Fragment>
              ))}
            </tbody>
          </table>

          {/* ── BOTTOM SUMMARY ── */}
          <div style={{marginTop:16}}>
            <table style={{borderCollapse:'collapse',marginLeft:'auto'}}>
              <tbody>
                <tr><td style={T.bxL}>CARTON:</td><td style={T.bxR}>{fmt(gC)}</td></tr>
                <tr><td style={T.bxL}>0.4%:</td><td style={T.bxR}>{fmt(gP1)}</td></tr>
                <tr><td style={T.bxL}>0.2%:</td><td style={T.bxR}>{fmt(gP2)}</td></tr>
                {/* CREDIT NOTE right below 0.2% */}
                <tr>
                  <td style={{...T.bxL,background:'#fff'}}>
                    <span>CREDIT NOTE:</span>
                  </td>
                  <td style={{...T.bxR,background:'#fff'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:4}}>
                      <input type="number" step="0.01" value={creditNote||''} placeholder="0.00"
                        onChange={e=>setCreditNote(parseFloat(e.target.value)||0)} className="noP"
                        style={{background:'#f5f5f5',border:'1px solid #999',borderRadius:3,padding:'2px 6px',fontFamily:'Arial',fontSize:13,width:90,textAlign:'right'}}/>
                      <span>{creditNote?'-'+fmt(Math.abs(creditNote)):'RM0.00'}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <table style={{borderCollapse:'collapse',marginLeft:'auto',marginTop:10}}>
              <tbody><tr>
                <td style={{padding:'7px 12px',fontWeight:700,fontSize:14,textAlign:'right'}}>TOTAL:</td>
                <td style={{padding:'7px 12px',fontWeight:700,fontSize:14,border:'2px solid #000',background:'#ffe600',textAlign:'right',fontFamily:'Arial',minWidth:110}}>{fmt(gT)}</td>
                <td style={{width:16}}/>
                <td style={{padding:'7px 12px',fontWeight:700,fontSize:14,background:'#000',color:'#fff',textAlign:'right',fontFamily:'Arial',minWidth:100}}>{fmt(gS)}</td>
              </tr></tbody>
            </table>
          </div>

          {/* ── FINAL AMOUNTS ── */}
          <div style={{marginTop:24,textAlign:'center'}}>
            <div style={{fontSize:16,fontWeight:700,margin:'8px 0'}}>TOTAL AMOUNT = {fmt(tA)}</div>
            <div style={{fontSize:18,fontWeight:700,margin:'8px 0'}}>TOTAL AMOUNT PAYABLE = {fmt(tP)}</div>
          </div>

          {/* ── BUTTONS ── */}
          <div className="noP" style={{display:'flex',gap:8,justifyContent:'center',marginTop:24}}>
            <button style={btn(0)} onClick={()=>setUploading(true)}>+ Add Invoice</button>
            <button style={btn(1)} onClick={()=>window.print()}>🖨 Print / Save PDF</button>
            <button style={btn(0)} onClick={downloadExcel}>↓ Excel</button>
            <button style={{...btn(0),color:'#aaa',borderColor:'#ddd'}} onClick={reset}>Reset</button>
          </div>
        </>)}

        {/* ── UPLOAD ── */}
        {showUpload&&!processing&&apiKey&&(
          <div className="noP"
            style={{border:`2px dashed ${drag?'#c87b00':'#ccc'}`,borderRadius:8,padding:'48px 20px',textAlign:'center',
              cursor:'pointer',background:drag?'#fffbeb':'#fafafa',marginTop:18}}
            onDragOver={e=>{e.preventDefault();setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault();setDrag(false);processFile(e.dataTransfer?.files?.[0]);}}
            onClick={()=>fileRef.current?.click()}>
            <div style={{fontSize:32,marginBottom:8,opacity:.3}}>📄</div>
            <div style={{fontSize:15,fontWeight:600,fontFamily:'Arial'}}>
              {invoices.length>0?'Add another invoice':'Drop invoice photo here'}</div>
            <div style={{fontSize:12,color:'#999',marginTop:3,fontFamily:'Arial'}}>or click to browse — JPG, PNG</div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
              onChange={e=>{processFile(e.target.files?.[0]);e.target.value='';}}/>
            {invoices.length>0&&<button style={{...btn(0),marginTop:12}} onClick={e=>{e.stopPropagation();setUploading(false);}}>Cancel</button>}
          </div>
        )}

        {processing&&(
          <div className="noP" style={{textAlign:'center',padding:'60px 20px'}}>
            <div style={{width:32,height:32,border:'3px solid #eee',borderTop:'3px solid #000',borderRadius:'50%',margin:'0 auto 12px',animation:'spin .7s linear infinite'}}/>
            <div style={{fontSize:13,color:'#888',fontFamily:'Arial'}}>Extracting with Groq...</div>
          </div>
        )}
      </div>
    </div>
  );
}

const T={
  th:{border:B,padding:'8px 6px',fontWeight:700,fontSize:13,textAlign:'center',background:'#f2f2f2'},
  td:{border:B,padding:'6px 8px',fontSize:13,textAlign:'center',verticalAlign:'middle'},
  amt:{textAlign:'right',fontWeight:700,fontFamily:'Arial',paddingRight:10},
  cat:{border:B,padding:'4px 6px',fontSize:13,fontWeight:700,textDecoration:'underline',textAlign:'center'},
  subL:{border:B,padding:'4px 10px',fontSize:13,textAlign:'right'},
  subR:{border:B,padding:'4px 10px',fontSize:13,textAlign:'right',fontWeight:700,fontFamily:'Arial'},
  bxL:{border:B,padding:'4px 12px',fontSize:13,fontWeight:700,textAlign:'right',background:'#f2f2f2'},
  bxR:{border:B,padding:'4px 12px',fontSize:13,fontWeight:700,textAlign:'right',fontFamily:'Arial',minWidth:100},
};
const btn=p=>({padding:'7px 16px',borderRadius:5,border:p?'none':'1px solid #aaa',fontWeight:600,fontSize:13,cursor:'pointer',background:p?'#111':'#fff',color:p?'#fff':'#333',fontFamily:'Arial'});

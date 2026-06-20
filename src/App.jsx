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
- invoice_no: Look for "Document No", "Document No." or "Doc No." field. Typically starts with "IN" followed by digits (e.g. IN93018360). Do NOT use PO numbers, Ref numbers, or Load Ref numbers. READ THE EXACT CHARACTERS CAREFULLY.
- invoice_date: Use "Invoice Date" or "Document Date". Format DD/MM/YYYY.
- qty: "20/0" -> extract only 20. The /0 means zero returns.
- volume_ml: Convert from description (1.5L=1500, 1.75L=1750, 500ML=500, 320ML=320, 300ML=300, 1L=1000).
- pack_size: "1X12"=12, "X24"=24.
- is_foc: true only if list_price=0.00 AND amount=0.00.
- total_amount: Final "Total Amount Due" value.
- supplier: Company name from TOP HEADER, NOT "Ship To"/"Bill To".
- Include ALL items including FOC. Return ONLY JSON.`;

const GROQ_MODEL='meta-llama/llama-4-scout-17b-16e-instruct';
const B='1px solid #000';
const F='Calibri, "Segoe UI", Arial, sans-serif';

export default function App(){
  const [invoices,setInvoices]=useState([]);
  const [uploading,setUploading]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [error,setError]=useState(null);
  const [drag,setDrag]=useState(false);
  const [cnValues,setCnValues]=useState({});
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

  const setCn=(num,val)=>setCnValues(prev=>({...prev,[num]:parseFloat(val)||0}));

  const processFile=useCallback(async file=>{
    if(!file?.type.startsWith('image/')){setError('Upload an image file');return;}
    if(!apiKey){setError('Set your Groq API key first');setShowSettings(true);return;}
    setError(null);setProcessing(true);
    const reader=new FileReader();
    reader.onload=async()=>{
      try{
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
        if(data.error) throw new Error(data.error.message||JSON.stringify(data.error));
        const txt=(data.choices?.[0]?.message?.content||'').trim().replace(/\`\`\`json|\`\`\`/g,'').trim();
        const parsed=JSON.parse(txt);
        const items=(parsed.items||[]).map(it=>({...it,category:matchCat(it.volume_ml,it.pack_size,config.rates)}));
        const gMap={};
        items.forEach(it=>{if(!it.category)return;const k=it.category.id;if(!gMap[k])gMap[k]={...it.category,ctn:0};gMap[k].ctn+=it.qty;});
        const groups=Object.values(gMap);
        const sub=calcSub(parsed.total_amount,groups,config.pct1,config.pct2);
        const num=invoices.length+1;
        setInvoices(prev=>[...prev,{raw:parsed,items,groups,subsidy:sub,num}]);
        setCnValues(prev=>({...prev,[num]:0}));
        setUploading(false);setProcessing(false);
        if(fileRef.current) fileRef.current.value='';
      }catch(e){console.error(e);setError(`Extraction failed: ${e.message}`);setProcessing(false);}
    };
    reader.readAsDataURL(file);
  },[config,apiKey,invoices.length]);

  const gT=invoices.reduce((s,i)=>s+i.raw.total_amount,0);
  const gC=invoices.reduce((s,i)=>s+i.subsidy.carton,0);
  const gP1=invoices.reduce((s,i)=>s+i.subsidy.p1,0);
  const gP2=invoices.reduce((s,i)=>s+i.subsidy.p2,0);
  const gS=Math.round((gC+gP1+gP2)*100)/100;
  const totalCn=Object.values(cnValues).reduce((s,v)=>s+v,0);
  const tA=Math.round((gT-gS)*100)/100;
  const tP=Math.round((tA-totalCn)*100)/100;

  const downloadExcel=()=>{
    const wb=XLSX.utils.book_new(),d=[];
    d.push([CO.name+' '+CO.reg]);d.push([CO.addr]);d.push(['Tel: '+CO.tel+'    E-mail: '+CO.email]);
    d.push([]);d.push(['PAYMENT SUMMARY']);d.push(['SUPPLIER: '+config.name]);d.push([]);
    d.push(['NO.','DATE','INVOICE NO.','AMOUNT','CN','','TRANSPORT SUBSIDY','']);
    invoices.forEach(inv=>{const cn=cnValues[inv.num]||0;inv.groups.forEach((g,gi)=>{
      d.push([gi===0?inv.num:'',gi===0?inv.raw.invoice_date:'',gi===0?inv.raw.invoice_no:'',gi===0?inv.raw.total_amount:'',gi===0&&cn?-cn:'','',g.label,'']);
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

  const reset=()=>{setInvoices([]);setUploading(false);setProcessing(false);setError(null);setCnValues({});if(fileRef.current)fileRef.current.value='';};
  const showUpload=invoices.length===0||uploading;

  return(
    <div style={{fontFamily:F,fontSize:16,background:'#fff',color:'#000',minHeight:'100vh'}}>
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

        {/* ═══ HEADER ═══ */}
        <div style={{display:'flex',alignItems:'center',gap:16,paddingBottom:12,borderBottom:'3px solid #000'}}>
          <img src={LOGO} style={{height:60,flexShrink:0}} alt="CJK"/>
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

        {/* ═══ API KEY ═══ */}
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

        {error&&<div className="noP" style={{background:'#fff0f0',border:'1px solid #d00',borderRadius:6,padding:'10px 14px',color:'#c00',fontSize:14,margin:'10px 0'}}>
          {error}<span style={{float:'right',cursor:'pointer'}} onClick={()=>setError(null)}>✕</span>
        </div>}

        {/* ═══ PAYMENT SUMMARY ═══ */}
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
              <th style={{...T.th,width:120}}>AMOUNT</th>
              <th style={{...T.th,width:70}}>CN</th>
              <th style={T.th} colSpan={2}>TRANSPORT SUBSIDY</th>
            </tr></thead>
            <tbody>
              {invoices.map(inv=>{
                const rc=inv.groups.length*4;
                const cn=cnValues[inv.num]||0;
                const rows=[];
                inv.groups.forEach((g,gi)=>{
                  rows.push(<tr key={inv.num+'-'+gi+'-h'}>
                    {gi===0&&<td style={T.td} rowSpan={rc}>{inv.num}</td>}
                    {gi===0&&<td style={T.td} rowSpan={rc}>{inv.raw.invoice_date}</td>}
                    {gi===0&&<td style={T.td} rowSpan={rc}>{inv.raw.invoice_no}</td>}
                    {gi===0&&<td style={{...T.td,textAlign:'right',fontWeight:700,paddingRight:10}} rowSpan={rc}>{fmt(inv.raw.total_amount)}</td>}
                    {gi===0&&<td style={{...T.td,padding:4}} rowSpan={rc}>
                      <input type="number" step="0.01" value={cn||''} placeholder="0.00"
                        onChange={e=>setCn(inv.num,e.target.value)} className="noP"
                        style={{width:'100%',border:'1px solid #ccc',borderRadius:3,padding:'3px 4px',fontSize:14,fontFamily:F,textAlign:'right',boxSizing:'border-box'}}/>
                      {cn>0&&<div style={{textAlign:'right',fontSize:13,color:'#c00',marginTop:2}}>-{fmt(cn)}</div>}
                    </td>}
                    <td style={T.cat} colSpan={2}>{g.label}</td>
                  </tr>);
                  rows.push(<tr key={inv.num+'-'+gi+'-c'}>
                    <td style={T.subL}>{g.ctn} CTN x RM{g.rate.toFixed(2)} =</td>
                    <td style={T.subR}>{fmt(g.ctn*g.rate)}</td>
                  </tr>);
                  rows.push(<tr key={inv.num+'-'+gi+'-p1'}>
                    <td style={T.subL}>+ 0.4% =</td><td style={T.subR}>{fmt(inv.subsidy.p1)}</td>
                  </tr>);
                  rows.push(<tr key={inv.num+'-'+gi+'-p2'}>
                    <td style={T.subL}>+ 0.2% =</td><td style={T.subR}>{fmt(inv.subsidy.p2)}</td>
                  </tr>);
                });
                return <React.Fragment key={inv.num}>{rows}</React.Fragment>;
              })}
            </tbody>
          </table>

          {/* ═══ SUMMARY BOX ═══ */}
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:16}}>
            <table style={{borderCollapse:'collapse'}}>
              <tbody>
                <tr><td style={T.bxL}>CARTON:</td><td style={T.bxR}>{fmt(gC)}</td></tr>
                <tr><td style={T.bxL}>0.4%:</td><td style={T.bxR}>{fmt(gP1)}</td></tr>
                <tr><td style={T.bxL}>0.2%:</td><td style={T.bxR}>{fmt(gP2)}</td></tr>
                <tr><td style={T.bxL}>CREDIT NOTE:</td><td style={T.bxR}>{totalCn?'-'+fmt(totalCn):'RM0.00'}</td></tr>
              </tbody>
            </table>
          </div>

          {/* ═══ TOTAL ROW ═══ */}
          <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',marginTop:10,gap:8}}>
            <span style={{fontWeight:700,fontSize:16}}>TOTAL:</span>
            <span style={{fontWeight:700,fontSize:16,background:'#ffe600',border:'2px solid #000',padding:'6px 14px',textAlign:'right',minWidth:110,display:'inline-block'}}>{fmt(gT)}</span>
          </div>

          {/* ═══ TOTAL AMOUNT PAYABLE ═══ */}
          <div style={{marginTop:24,textAlign:'center'}}>
            <div style={{fontSize:24,fontWeight:700,letterSpacing:0.5}}>
              TOTAL AMOUNT PAYABLE = {fmt(tP)}
            </div>
          </div>

          {/* ═══ BUTTONS ═══ */}
          <div className="noP" style={{display:'flex',gap:8,justifyContent:'center',marginTop:28}}>
            <button style={btn(0)} onClick={()=>setUploading(true)}>+ Add Invoice</button>
            <button style={btn(1)} onClick={()=>window.print()}>🖨 Print / Save PDF</button>
            <button style={btn(0)} onClick={downloadExcel}>↓ Excel</button>
            <button style={{...btn(0),color:'#aaa',borderColor:'#ddd'}} onClick={reset}>Reset</button>
          </div>
        </>)}

        {/* ═══ UPLOAD ═══ */}
        {showUpload&&!processing&&apiKey&&(
          <div className="noP"
            style={{border:'2px dashed '+(drag?'#c87b00':'#ccc'),borderRadius:8,padding:'48px 20px',textAlign:'center',
              cursor:'pointer',background:drag?'#fffbeb':'#fafafa',marginTop:18}}
            onDragOver={e=>{e.preventDefault();setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault();setDrag(false);processFile(e.dataTransfer?.files?.[0]);}}
            onClick={()=>fileRef.current?.click()}>
            <div style={{fontSize:32,marginBottom:8,opacity:.3}}>📄</div>
            <div style={{fontSize:16,fontWeight:600}}>
              {invoices.length>0?'Add another invoice':'Drop invoice photo here'}</div>
            <div style={{fontSize:13,color:'#999',marginTop:3}}>or click to browse — JPG, PNG</div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
              onChange={e=>{processFile(e.target.files?.[0]);e.target.value='';}}/>
            {invoices.length>0&&<button style={{...btn(0),marginTop:12}} onClick={e=>{e.stopPropagation();setUploading(false);}}>Cancel</button>}
          </div>
        )}

        {processing&&(
          <div className="noP" style={{textAlign:'center',padding:'60px 20px'}}>
            <div style={{width:32,height:32,border:'3px solid #eee',borderTop:'3px solid #000',borderRadius:'50%',margin:'0 auto 12px',animation:'spin .7s linear infinite'}}/>
            <div style={{fontSize:14,color:'#888'}}>Extracting with Groq...</div>
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
  subL:{border:B,padding:'6px 12px',fontSize:16,textAlign:'right',fontFamily:F},
  subR:{border:B,padding:'6px 12px',fontSize:16,textAlign:'right',fontWeight:700,fontFamily:F,whiteSpace:'nowrap'},
  bxL:{border:B,padding:'6px 14px',fontSize:16,fontWeight:700,textAlign:'right',background:'#f0f0f0',fontFamily:F},
  bxR:{border:B,padding:'6px 14px',fontSize:16,fontWeight:700,textAlign:'right',fontFamily:F,minWidth:110,whiteSpace:'nowrap'},
};
const btn=p=>({padding:'8px 18px',borderRadius:5,border:p?'none':'1px solid #aaa',fontWeight:600,fontSize:14,cursor:'pointer',background:p?'#111':'#fff',color:p?'#fff':'#333',fontFamily:F});

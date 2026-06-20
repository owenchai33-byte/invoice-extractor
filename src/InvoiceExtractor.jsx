import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIwAAACCCAYAAACUyiBOAAA/iklEQVR42u2dd3hVVdb/v/uU22967wkhgRBqQKokKCgWQNREx8ZYBkcddBQdfW1J7H10xIIVUFETlCogLQm9hZpCekhCQnq99Zyz1++PJA7jq846o+O8v/t5nvskOefcs/c+a+21115r7RPAgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPHjx48ODBgwcPvwn+HxBDgUNjg291AAAAAElFTkSuQmCC";

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

  const processSingleFile=useCallback(async (file)=>{
    if(!file?.type.startsWith('image/')) throw new Error('Not an image file: '+file.name);
    return new Promise((resolve,reject)=>{
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
          const id='inv_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
          resolve({raw:parsed,items,groups,subsidy:sub,id});
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
    setError(null);setProcessing(true);
    setProcessingCount({done:0,total:fileArr.length});
    const results=[];
    for(let i=0;i<fileArr.length;i++){
      try{
        const inv=await processSingleFile(fileArr[i]);
        results.push(inv);
        setProcessingCount(prev=>({...prev,done:prev.done+1}));
      }catch(e){
        console.error('Error processing',fileArr[i].name,e);
        setError(prev=>(prev?prev+'\n':'')+`Failed: ${fileArr[i].name} — ${e.message}`);
      }
    }
    if(results.length>0){
      setInvoices(prev=>[...prev,...results]);
      setCnValues(prev=>{const next={...prev};results.forEach(r=>{next[r.id]=0;});return next;});
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
              <th style={{...T.th,width:120}}>AMOUNT</th>
              <th style={{...T.th,width:70}}>CN</th>
              <th style={T.th} colSpan={2}>TRANSPORT SUBSIDY</th>
            </tr></thead>
            <tbody>
              {invoices.map((inv,idx)=>{
                const rc=inv.groups.length*4;
                const cn=cnValues[inv.id]||0;
                const displayNum=idx+1;
                const rows=[];
                inv.groups.forEach((g,gi)=>{
                  rows.push(<tr key={inv.id+'-'+gi+'-h'}>
                    {gi===0&&<td style={T.td} rowSpan={rc}>{displayNum}</td>}
                    {gi===0&&<td style={T.td} rowSpan={rc}>{inv.raw.invoice_date}</td>}
                    {gi===0&&<td style={T.td} rowSpan={rc}>{inv.raw.invoice_no}</td>}
                    {gi===0&&<td style={{...T.td,textAlign:'right',fontWeight:700,paddingRight:10}} rowSpan={rc}>{fmt(inv.raw.total_amount)}</td>}
                    {gi===0&&<td style={{...T.td,padding:4}} rowSpan={rc}>
                      <input type="number" step="0.01" value={cn||''} placeholder="0.00"
                        onChange={e=>setCn(inv.id,e.target.value)} className="noP"
                        style={{width:'100%',border:'1px solid #ccc',borderRadius:3,padding:'3px 4px',fontSize:14,fontFamily:F,textAlign:'right',boxSizing:'border-box'}}/>
                      {cn>0&&<div style={{textAlign:'right',fontSize:13,color:'#c00',marginTop:2}}>-{fmt(cn)}</div>}
                    </td>}
                    <td style={T.cat} colSpan={2}>{g.label}</td>
                  </tr>);
                  rows.push(<tr key={inv.id+'-'+gi+'-c'}>
                    <td style={T.subL}>{g.ctn} CTN x RM{g.rate.toFixed(2)} =</td>
                    <td style={T.subR}>{fmt(g.ctn*g.rate)}</td>
                  </tr>);
                  rows.push(<tr key={inv.id+'-'+gi+'-p1'}>
                    <td style={T.subL}>+ 0.4% =</td><td style={T.subR}>{fmt(inv.subsidy.p1)}</td>
                  </tr>);
                  rows.push(<tr key={inv.id+'-'+gi+'-p2'}>
                    <td style={T.subL}>+ 0.2% =</td><td style={T.subR}>{fmt(inv.subsidy.p2)}</td>
                  </tr>);
                });
                return <React.Fragment key={inv.id}>{rows}</React.Fragment>;
              })}
            </tbody>
          </table>

          {/* SUMMARY + TOTAL */}
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <tbody>
              <tr><td colSpan={5} style={{padding:6}}/><td style={T.bxL}>CARTON:</td><td style={T.bxR}>{fmt(gC)}</td></tr>
              <tr><td colSpan={5}/><td style={T.bxL}>0.4%:</td><td style={T.bxR}>{fmt(gP1)}</td></tr>
              <tr><td colSpan={5}/><td style={T.bxL}>0.2%:</td><td style={T.bxR}>{fmt(gP2)}</td></tr>
              <tr><td colSpan={5}/><td style={T.bxL}>CREDIT NOTE:</td><td style={T.bxR}>{totalCn?'-'+fmt(totalCn):'RM0.00'}</td></tr>
              <tr>
                <td colSpan={5}/>
                <td style={{...T.bxL,borderTop:'2px solid #000'}}>TOTAL:</td>
                <td style={{...T.bxR,borderTop:'2px solid #000',background:'#ffe600',fontSize:18}}>{fmt(gT)}</td>
              </tr>
            </tbody>
          </table>

          {/* TOTAL AMOUNT PAYABLE */}
          <div style={{marginTop:24,textAlign:'right',paddingRight:4}}>
            <div style={{fontSize:24,fontWeight:700,letterSpacing:0.5}}>
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

        {/* UPLOAD — now supports multiple images */}
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
  subL:{border:B,padding:'6px 12px',fontSize:16,textAlign:'right',fontFamily:F},
  subR:{border:B,padding:'6px 12px',fontSize:16,textAlign:'center',fontWeight:700,fontFamily:F,whiteSpace:'nowrap'},
  bxL:{border:B,padding:'6px 14px',fontSize:16,fontWeight:700,textAlign:'right',background:'#f0f0f0',fontFamily:F},
  bxR:{border:B,padding:'6px 14px',fontSize:16,fontWeight:700,textAlign:'right',fontFamily:F,minWidth:110,whiteSpace:'nowrap'},
};
const btn=p=>({padding:'8px 18px',borderRadius:5,border:p?'none':'1px solid #aaa',fontWeight:600,fontSize:14,cursor:'pointer',background:p?'#111':'#fff',color:p?'#fff':'#333',fontFamily:F});

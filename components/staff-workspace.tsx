'use client';
import {useCallback,useEffect,useState,useRef} from 'react';
import {ArrowLeft,ArrowRight,RefreshCw,Inbox} from 'lucide-react';
type RequestItem={id:string;quantity:number;name:string};
type RequestData={name?:string;email?:string;phone?:string;city?:string;address?:string;digitalAddress?:string;message?:string;service?:string;items?:RequestItem[]};
type RequestMessage={id:string;message?:string;body?:string;created:string};
type RequestRow={id:string;kind:string;status:string;created:string;data:RequestData;messages?:RequestMessage[]};
type ListResponse={error?:string;requests?:RequestRow[];nextCursor?:string|null;statuses?:string[]};
type DetailResponse={error?:string;request?:RequestRow;messages?:RequestMessage[]};
type UpdateResponse={error?:string};
export default function StaffWorkspace({onAccount}:{onAccount:()=>void}){
 const listSequence=useRef(0),detailSequence=useRef(0),operation=useRef<{payload:string;key:string}|null>(null);
 const [rows,setRows]=useState<RequestRow[]>([]),[next,setNext]=useState<string|null>(null),[statuses,setStatuses]=useState<string[]>([]),[filter,setFilter]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(true),[selected,setSelected]=useState<RequestRow|null>(null),[reply,setReply]=useState(''),[notice,setNotice]=useState(''),[detailReady,setDetailReady]=useState(false);
 const invalidateRequests=useCallback(()=>{++listSequence.current;++detailSequence.current},[]);
 const clearAccess=useCallback(()=>{invalidateRequests();operation.current=null;setRows([]);setNext(null);setStatuses([]);setSelected(null);setDetailReady(false);setReply('');setNotice('');setBusy(false)},[invalidateRequests]);
 const load=useCallback((cursor='')=>{
  const sequence=++listSequence.current;
  const q=new URLSearchParams({limit:'20'});if(cursor)q.set('cursor',cursor);if(filter)q.set('status',filter);
  return fetch('/api/admin?'+q).then(async r=>{
   const d=await r.json().catch(()=>({})) as ListResponse;
   if(sequence!==listSequence.current)return false;
   if(r.status===401||r.status===403){clearAccess();setError(d.error||'Staff access is required.');return false}
   if(!r.ok||!Array.isArray(d.requests))throw Error(d.error||'Unable to load requests.');
   const requests=d.requests;
   setRows(old=>cursor?[...old,...requests]:requests);setNext(d.nextCursor||null);setStatuses(d.statuses||[]);return true;
  }).catch(e=>{if(sequence===listSequence.current)setError(e instanceof Error?e.message:'Unable to load requests.');return false})
    .finally(()=>{if(sequence===listSequence.current)setBusy(false)});
 },[filter,clearAccess]);
 useEffect(()=>{void load();return invalidateRequests},[load,invalidateRequests]);
 const reload=(cursor='')=>{setBusy(true);setError('');void load(cursor)};
 const open=async(row:RequestRow)=>{
  const sequence=++detailSequence.current;setSelected(row);setDetailReady(false);setReply('');setNotice('');setError('');
  try{
   const r=await fetch('/api/admin?id='+encodeURIComponent(row.id)),d=await r.json().catch(()=>({})) as DetailResponse;
   if(sequence!==detailSequence.current)return false;
   if(r.status===401||r.status===403){clearAccess();setError(d.error||'Staff access is required.');return false}
   if(!r.ok||!d.request)throw Error(d.error||'Unable to load request.');
   setSelected({...d.request,messages:d.messages});setDetailReady(true);return true;
  }catch(e){if(sequence===detailSequence.current)setError(e instanceof Error?e.message:'Unable to load request. Please select it again.');return false}
 };
 const update=async(body:Record<string,string>)=>{
  if(!selected||!detailReady)return;setBusy(true);setError('');setNotice('');
  try{
   const payload=JSON.stringify({...body,id:selected.id});if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};
   const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,id:selected.id,idempotencyKey:operation.current.key})}),d=await r.json().catch(()=>({})) as UpdateResponse;
   if(r.status===401||r.status===403){clearAccess();setError(d.error||'Staff access is required.');return}
   if(!r.ok)throw Error(d.error||'Unable to save.');operation.current=null;
   if(!await open(selected)||!await load())return;
   setReply('');setNotice(body.action==='customer-reply'?'Reply saved to the customer’s request.':'Request status updated.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save.')}
  finally{setBusy(false)}
 };
 return <section className="section staff-workspace"><button className="text-button" onClick={onAccount}><ArrowLeft size={16}/>My account</button><div className="page-intro"><span className="eyebrow orange">STRIDE OPERATIONS</span><h1>Every request.<br/>A next step.</h1><p>Review enquiries, update their status and leave customer-visible replies.</p></div><div className="staff-toolbar"><label>Request status<select value={filter} disabled={busy} onChange={e=>{setBusy(true);setError('');setFilter(e.target.value)}}><option value="">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><button className="button outline-button" disabled={busy} onClick={()=>reload()}><RefreshCw size={16}/>Refresh</button></div>{error&&<p role="alert" className="auth-error">{error}</p>}{notice&&<p role="status">{notice}</p>}<div className="staff-layout"><div className="staff-requests">{rows.map(row=><button key={row.id} disabled={busy} className={'staff-request '+(selected?.id===row.id?'active':'')} onClick={()=>open(row)}><span className="eyebrow">{row.kind}</span><strong>{row.data.name||'Customer request'}</strong><span>{row.data.service||row.id}</span><small>{row.status} · {new Date(row.created).toLocaleDateString()}</small><ArrowRight size={17}/></button>)}{!rows.length&&!busy&&!error&&<div className="empty-state"><Inbox size={35}/><h2>Your inbox is clear.</h2><p>New enquiries will appear here.</p></div>}{next&&<button className="button outline-button" disabled={busy} onClick={()=>reload(next)}>Load more</button>}</div><div className="staff-detail">{selected?<><span className="eyebrow">{selected.id}</span><h2>{selected.data.service||'Product quotation'}</h2><p><strong>{selected.data.name}</strong><br/>{selected.data.email}<br/>{selected.data.phone}<br/>{[selected.data.city,selected.data.address,selected.data.digitalAddress].filter(Boolean).join(' · ')}</p><p>{selected.data.message}</p>{selected.data.items&&<ul>{selected.data.items.map(item=><li key={item.id}>{item.quantity} × {item.name}</li>)}</ul>}<label>Update status<select value={selected.status} disabled={busy||!detailReady} onChange={e=>update({action:'status',status:e.target.value})}>{[...new Set([selected.status,...statuses])].map(s=><option key={s}>{s}</option>)}</select></label><div className="request-messages">{selected.messages?.map(m=><article key={m.id}><small>{new Date(m.created).toLocaleString()}</small><p>{m.message||m.body}</p></article>)}</div><form onSubmit={e=>{e.preventDefault();update({action:'customer-reply',message:reply.trim()})}}><label>Reply visible to the customer<textarea disabled={busy||!detailReady} value={reply} onChange={e=>setReply(e.target.value)} required minLength={1} maxLength={3000} rows={5}/></label><p className="muted">Replies are saved to My requests. Email delivery depends on the configured notification service.</p><button className="button orange-button" disabled={busy||!detailReady||!reply.trim()}>Save reply<ArrowRight size={17}/></button></form></>:<div className="empty-state"><Inbox size={35}/><h2>A clear view of the details.</h2><p>Select a request to review it.</p></div>}</div></div></section>;
}

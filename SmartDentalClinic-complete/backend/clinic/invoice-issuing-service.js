'use strict';
// v27.6: invoice draft/issue. All prices are server-read immutable booking/procedure snapshots.
// There are no arbitrary editable prices. Extras must be explicitly selected as non-included.
const ID=/^[1-9]\d{0,17}$/;
const patientNotices=require('../patient/workspace/event-notifications');
const MONEY=/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const validId=v=>ID.test(String(v??''));
const asCents=value=>{
 const n=Number(value);
 if(!Number.isFinite(n)||n<0||n>9999999999.99)return null;
 const result=Math.round(n*100);
 return Number.isSafeInteger(result)?result:null;
};
const format=c=>(c/100).toFixed(2);
const detailPrefix=id=>`إجراء إضافي (#${id}): `;
const baseDescription=name=>`الخدمة المحجوزة: ${name}`;
function parseDraft(body){
 const visitId=String(body.visit_id||'');
 const raw=body.extra_ids===undefined?[]:Array.isArray(body.extra_ids)?body.extra_ids:[body.extra_ids];
 const discount=String(body.discount??'0').trim();
 if(!validId(visitId)||!MONEY.test(discount)||raw.length>80||raw.some(v=>!validId(v))||new Set(raw).size!==raw.length)return null;
 return {visitId,extraIds:raw,discountCents:asCents(discount)};
}
const rollback=async c=>{try{await c.query('ROLLBACK');}catch{}};
async function invoiceCandidates(pool,clinic){
 const {rows}=await pool.query(`SELECT v."Visit_ID"::text id,b."Booking_ID"::text booking_id,b."Service_ID"::text service_id,
 b."Service_Price_Snapshot"::text base_price,to_char(b."Appointment_Date",'DD/MM/YYYY') AS "day",
 s."Service_Name" service_name,
 EXISTS(SELECT 1 FROM sdc."PROCEDURE" original
  WHERE original."Visit_ID"=v."Visit_ID" AND original."Service_ID"=b."Service_ID"
  AND original."Procedure_Status"='completed') AS base_performed,
 pu."First_Name"||' '||pu."Last_Name" patient,
 du."First_Name"||' '||du."Last_Name" doctor,i."Invoice_ID"::text invoice_id,i."Invoice_Status" invoice_status
 FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
 JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"
 JOIN sdc."PATIENT" pat ON pat."Patient_ID"=b."Patient_ID" JOIN sdc."USER" pu ON pu."User_ID"=pat."User_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
 LEFT JOIN sdc."INVOICE" i ON i."Visit_ID"=v."Visit_ID"
 WHERE b."Clinic_ID"=$1::bigint AND b."Booking_Status"='completed' AND v."Visit_Status"='completed'
 AND (i."Invoice_ID" IS NULL OR i."Invoice_Status"='draft')
 ORDER BY b."Appointment_Date" DESC,v."Visit_ID" DESC LIMIT 100`,[clinic]);
 if(!rows.length)return [];
 const ids=rows.map(r=>r.id);
 const [procedures,draftLines]=await Promise.all([
  pool.query(`SELECT pr."Visit_ID"::text visit_id,pr."Procedure_ID"::text id,pr."Quantity"::text qty,
   pr."Unit_Price_Snapshot"::text price,pr."Tooth_Number" tooth,s."Service_Name" name
   FROM sdc."PROCEDURE" pr JOIN sdc."SERVICE" s ON s."Service_ID"=pr."Service_ID"
   JOIN sdc."VISIT" v ON v."Visit_ID"=pr."Visit_ID" JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
   WHERE pr."Visit_ID"=ANY($1::bigint[]) AND pr."Procedure_Status"='completed'
   AND pr."Service_ID"<>b."Service_ID" ORDER BY pr."Visit_ID",pr."Procedure_ID"`,[ids]),
  pool.query(`SELECT i."Visit_ID"::text visit_id,x."Description" description,x."Discount_Amount"::text discount
   FROM sdc."INVOICE" i JOIN sdc."INVOICE_INVOICE_ITEMS" x ON x."Invoice_ID"=i."Invoice_ID"
   WHERE i."Visit_ID"=ANY($1::bigint[]) AND i."Invoice_Status"='draft' ORDER BY x."Item_ID"`,[ids])
 ]);
 return rows.map(r=>{
  const existing=draftLines.rows.filter(l=>l.visit_id===r.id);
  const selected=new Set(existing.map(l=>/^إجراء إضافي \(#(\d+)\): /.exec(l.description)?.[1]).filter(Boolean));
  return {...r,procedures:procedures.rows.filter(p=>p.visit_id===r.id).map(p=>({...p,selected:selected.has(p.id)})),
   discount:format(existing.reduce((sum,l)=>sum+(asCents(l.discount)||0),0))};
 });
}
async function startTx(pool,actor){
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query("SELECT set_config('sdc.user_id',$1,true)",[String(actor)]);return client;}
 catch(e){await rollback(client);client.release();throw e;}
}
async function authorized(client,clinic,actor){
 const result=await client.query(`SELECT sdc.sdc_can($1::bigint,$2::bigint,'invoices.issue') AS allowed`,[actor,clinic]);
 return result.rows[0]?.allowed===true;
}
async function lockedVisit(client,clinic,visitId){
 const {rows}=await client.query(`SELECT v."Visit_ID"::text id,v."Visit_Status" visit_status,
 b."Booking_Status" booking_status,b."Clinic_ID"::text clinic_id,b."Patient_ID"::text patient_id,
 b."Service_ID"::text service_id,b."Service_Price_Snapshot"::text base_price,s."Service_Name" service_name,
 EXISTS(SELECT 1 FROM sdc."PROCEDURE" original
  WHERE original."Visit_ID"=v."Visit_ID" AND original."Service_ID"=b."Service_ID"
  AND original."Procedure_Status"='completed') AS base_performed
 FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
 JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"
 WHERE v."Visit_ID"=$1::bigint AND b."Clinic_ID"=$2::bigint FOR UPDATE OF v,b`,[visitId,clinic]);
 return rows[0]||null;
}
async function invoiceForVisit(client,visitId){
 const {rows}=await client.query(`SELECT "Invoice_ID"::text id,"Invoice_Status" status FROM sdc."INVOICE" WHERE "Visit_ID"=$1::bigint FOR UPDATE`,[visitId]);
 return rows[0]||null;
}
async function currentExtras(db,visitId,serviceId,ids){
 if(!ids.length)return [];
 const {rows}=await db.query(`SELECT pr."Procedure_ID"::text id,pr."Quantity"::text qty,
 pr."Unit_Price_Snapshot"::text price,s."Service_Name" name
 FROM sdc."PROCEDURE" pr JOIN sdc."SERVICE" s ON s."Service_ID"=pr."Service_ID"
 WHERE pr."Visit_ID"=$1::bigint AND pr."Procedure_Status"='completed'
 AND pr."Service_ID"<>$2::bigint AND pr."Procedure_ID"=ANY($3::bigint[])
 ORDER BY pr."Procedure_ID"`,[visitId,serviceId,ids]);
 if(rows.length!==ids.length) return null;
 return rows;
}
function buildLines(visit,extras,discountCents){
 // A booked service is billable only when an actual completed procedure
 // documents its delivery. An alternative performed procedure can be invoiced
 // without charging for the unperformed original booking.
 const prices=[...(visit.base_performed===true?[{description:baseDescription(visit.service_name),qty:'1',unitPrice:visit.base_price}]:[]),
  ...extras.map(p=>({description:detailPrefix(p.id)+p.name,qty:p.qty,unitPrice:p.price}))];
 if(!prices.length)return null;
 const gross=prices.map(p=>{
  const qty=Number(p.qty),unit=asCents(p.unitPrice);
  const amount=unit===null?null:Math.round(qty*unit);
  return Number.isSafeInteger(amount)&&amount>=0&&amount<=999999999999?amount:null;
 });
 if(gross.some(n=>n===null))return null;
 const total=gross.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(total)||total>999999999999||discountCents===null||discountCents>total)return null;
 let balance=discountCents;
 return prices.map((p,i)=>{
  const d=Math.min(balance,gross[i]);balance-=d;
  return {...p,discount:format(d)};
 });
}
async function saveDraft(pool,clinic,actor,body){
 const data=parseDraft(body);
 if(!data)return {status:'invalid'};
 const client=await startTx(pool,actor);
 try{
  if(!await authorized(client,clinic,actor)){await rollback(client);return {status:'forbidden'};}
  const visit=await lockedVisit(client,clinic,data.visitId);
  if(!visit){await rollback(client);return {status:'not_found'};}
  if(visit.visit_status!=='completed'||visit.booking_status!=='completed'){await rollback(client);return {status:'not_completed'};}
  const prev=await invoiceForVisit(client,visit.id);
  if(prev&&prev.status!=='draft'){await rollback(client);return {status:'finalized'};}
  const extras=await currentExtras(client,visit.id,visit.service_id,data.extraIds);
  if(extras===null){await rollback(client);return {status:'stale_procedures'};}
  const lines=buildLines(visit,extras,data.discountCents);
  if(!lines){await rollback(client);return {status:!visit.base_performed&&!extras.length?'no_billable_procedures':'invalid_amount'};}
  let invoiceId=prev?.id;
  if(invoiceId){
   await client.query(`DELETE FROM sdc."INVOICE_INVOICE_ITEMS" WHERE "Invoice_ID"=$1::bigint`,[invoiceId]);
  }else{
   const ins=await client.query(`INSERT INTO sdc."INVOICE"("Created_At","Invoice_Status","Patient_ID","Clinic_ID","Visit_ID")
    VALUES(LOCALTIMESTAMP,'draft',$1::bigint,$2::bigint,$3::bigint) RETURNING "Invoice_ID"::text id`,[visit.patient_id,clinic,visit.id]);
   invoiceId=ins.rows[0].id;
  }
  for(const l of lines)await client.query(`INSERT INTO sdc."INVOICE_INVOICE_ITEMS"("Description","Quantity","Unit_Price","Discount_Amount","Invoice_ID")
   VALUES($1,$2::numeric(12,2),$3::numeric(12,2),$4::numeric(12,2),$5::bigint)`,[l.description,l.qty,l.unitPrice,l.discount,invoiceId]);
  await client.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES(LOCALTIMESTAMP,'invoice.draft.saved','Invoice',$1,'حفظ/تحديث مسودة الفاتورة بناءً على الإجراءات المنفذة والمثبتة',$2::bigint)`,[invoiceId,actor]);
  await client.query('COMMIT');return {status:'ok',id:invoiceId};
 }catch(e){await rollback(client);throw e;}finally{client.release();}
}
async function issueDraft(pool,clinic,actor,body){
 const id=String(body.invoice_id||'');
 if(!validId(id)||body.service_delivered!=='on')return {status:'not_confirmed'};
 const client=await startTx(pool,actor);
 try{
  if(!await authorized(client,clinic,actor)){await rollback(client);return {status:'forbidden'};}
  // Lock visit and booking before invoice, matching the saveDraft lock order.
  const b=await client.query(`SELECT "Visit_ID"::text id FROM sdc."INVOICE" WHERE "Invoice_ID"=$1::bigint AND "Clinic_ID"=$2::bigint`,[id,clinic]);
  if(!b.rowCount){await rollback(client);return {status:'not_found'};}
  const visit=await lockedVisit(client,clinic,b.rows[0].id);
  if(!visit){await rollback(client);return {status:'not_found'};}
  if(visit.visit_status!=='completed'||visit.booking_status!=='completed'){await rollback(client);return {status:'not_completed'};}
  const invoice=await invoiceForVisit(client,visit.id);
  if(!invoice||invoice.id!==id){await rollback(client);return {status:'not_found'};}
  if(invoice.status!=='draft'){await rollback(client);return {status:'finalized'};}
  const {rows:lines}=await client.query(`SELECT "Description" description,"Quantity"::text qty,"Unit_Price"::text unit_price,"Discount_Amount"::text discount
   FROM sdc."INVOICE_INVOICE_ITEMS" WHERE "Invoice_ID"=$1::bigint ORDER BY "Item_ID" FOR UPDATE`,[id]);
  // Recheck clinical execution at issue time: a stale draft must never bill
  // the original booking when the corresponding procedure was not completed.
  const baseLine=lines[0]?.description===baseDescription(visit.service_name);
  if(!lines.length||baseLine!==visit.base_performed||
   (baseLine&&(Number(lines[0].qty)!==1||asCents(lines[0].unit_price)!==asCents(visit.base_price)))){
   await rollback(client);return {status:'stale_draft'};
  }
  const extrasLines=lines.slice(baseLine?1:0);
  const pids=[];
  for(const l of extrasLines){
   const m=/^إجراء إضافي \(#(\d+)\): /.exec(l.description);
   if(!m||!validId(m[1])||pids.includes(m[1])){await rollback(client);return {status:'stale_draft'};}
   pids.push(m[1]);
  }
  const extras=await currentExtras(client,visit.id,visit.service_id,pids);
  if(extras===null){await rollback(client);return {status:'stale_draft'};}
  const byId=new Map(extras.map(x=>[x.id,x]));
  for(const [i,pid] of pids.entries()){
   const l=extrasLines[i],p=byId.get(pid);
   if(!p||l.description!==detailPrefix(pid)+p.name||Number(l.qty)!==Number(p.qty)||asCents(l.unit_price)!==asCents(p.price)){
    await rollback(client);return {status:'stale_draft'};
   }
  }
  if(lines.some(l=>asCents(l.discount)===null||asCents(l.unit_price)===null||
   asCents(l.discount)>Math.round(Number(l.qty)*asCents(l.unit_price)))){
   await rollback(client);return {status:'stale_draft'};
  }
  await client.query(`UPDATE sdc."INVOICE" SET "Invoice_Status"='issued',"Issued_At"=GREATEST(LOCALTIMESTAMP,"Created_At"),
   "Issued_By_User_ID"=$2::bigint WHERE "Invoice_ID"=$1::bigint AND "Clinic_ID"=$3::bigint`,[id,actor,clinic]);
  await client.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES(LOCALTIMESTAMP,'invoice.issued','Invoice',$1,'إصدار فاتورة زيارة مكتملة بعد التحقق من مطابقة بنودها للإجراءات المنفذة',$2::bigint)`,[id,actor]);
  await patientNotices.emit(client,{patientId:visit.patient_id,type:'patient.invoice.issued',
   title:'صدرت فاتورة زيارتك',body:'تم إصدار فاتورة جديدة لزيارتك. يمكنك الاطلاع على تفاصيلها والمدفوعات من قسم فواتيري.',
   targetType:'Invoice',targetId:id});
  await require('../staff/event-notifications').emit(client,{clinicId:clinic,actorId:actor,type:'Invoice',targetId:id,title:'فاتورة صادرة',body:'تم إصدار فاتورة زيارة جديدة. افتح الفواتير لمراجعة تفاصيلها.'});
  await client.query('COMMIT');return {status:'ok',id};
 }catch(e){await rollback(client);throw e;}finally{client.release();}
}
module.exports={invoiceCandidates,saveDraft,issueDraft,parseDraft,buildLines,baseDescription,asCents};

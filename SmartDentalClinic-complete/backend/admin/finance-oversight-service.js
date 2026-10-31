'use strict';
// v27.21.1: platform admin creates settlements and records received clinic commissions.
// Patient invoices and patient payments remain clinic-owned.
const commission = require('../clinic/commission-service');
const ID=/^[1-9]\d{0,17}$/;
const PAGE_SIZE=20;
const validId=x=>typeof x==='string'&&ID.test(x);
const validReason=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=1000&&!/[\u0000-\u001f\u007f]/.test(x);
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
const statusSet=new Set(['unpaid','partial','paid','void']);
const settlementStatusSet=new Set(['unpaid','partial','paid']);
function filters(q={}){
 const str=x=>typeof x==='string'?x:'';
 const page=x=>/^\d{1,5}$/.test(str(x))?Math.max(1,Math.min(10000,Number(x))):1;
 const tab=str(q.tab)==='invoices'?'invoices':'settlements';
 const search=str(q.q).trim().slice(0,80);
 return {tab,q:search,clinic:validId(q.clinic)?q.clinic:'',status:(tab==='invoices'?statusSet:settlementStatusSet).has(q.status)?q.status:'',from:validDate(q.from)?q.from:'',to:validDate(q.to)?q.to:'',page:page(q.page)};
}
const escaped=x=>x.replace(/[\\%_]/g,'\\$&');
const SETTLEMENT_FROM=` FROM sdc."SETTLEMENT" s
 JOIN sdc."CLINIC" c ON c."Clinic_ID"=s."Clinic_ID"
 LEFT JOIN LATERAL (SELECT COALESCE(sum(bc.commission_amount),0)::numeric(16,2) due,
 COALESCE(sum(bc."Service_Price_Snapshot"),0)::numeric(16,2) service_total,
 count(*)::integer bookings
 FROM sdc.booking_commissions bc JOIN sdc."BOOKING" b ON b."Booking_ID"=bc."Booking_ID"
 WHERE bc."Settlement_ID"=s."Settlement_ID" AND bc.eligible IS TRUE
 AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
  WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')) x ON TRUE
 LEFT JOIN LATERAL (SELECT COALESCE(sum(p."Amount"),0)::numeric(16,2) received
 FROM sdc."RECORDS_SETTLEMENT_PAYMENT" p WHERE p."Settlement_ID"=s."Settlement_ID") pay ON TRUE`;
const SETTLEMENT_COLS=`s."Settlement_ID"::text id,s."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic_name,
 to_char(s."Period_Start",'YYYY-MM-DD') start,to_char(s."Period_End",'YYYY-MM-DD') finish,
 to_char(s."Due_Date",'YYYY-MM-DD') due_date,
 x.due,x.service_total,x.bookings,pay.received,
 GREATEST(x.due-pay.received,0)::numeric(16,2) remaining,
 CASE WHEN x.due>0 AND pay.received>=x.due THEN 'paid' WHEN pay.received>0 THEN 'partial' ELSE 'unpaid' END state`;
function settlementWhere(f){
 const clauses=[],args=[];const add=(sql,val)=>{args.push(val);clauses.push(sql.replace('?',`$${args.length}`));};
 if(f.q){const query='%'+escaped(f.q)+'%';args.push(query);clauses.push(`(c."Clinic_Name" ILIKE $${args.length} ESCAPE '\\' OR s."Settlement_ID"::text ILIKE $${args.length} ESCAPE '\\')`);}
 if(f.clinic)add(`s."Clinic_ID"=?::bigint`,f.clinic);
 if(f.from)add(`s."Period_End">=?::date`,f.from);
 if(f.to)add(`s."Period_Start"<=?::date`,f.to);
 if(f.status){const expr=`(CASE WHEN x.due>0 AND pay.received>=x.due THEN 'paid' WHEN pay.received>0 THEN 'partial' ELSE 'unpaid' END)`;add(`${expr}=?`,f.status);}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}
const INVOICE_FROM=` FROM sdc.invoice_balances i
 JOIN sdc."CLINIC" c ON c."Clinic_ID"=i."Clinic_ID"
 JOIN sdc."PATIENT" p ON p."Patient_ID"=i."Patient_ID"
 JOIN sdc."USER" u ON u."User_ID"=p."User_ID"`;
const INVOICE_COLS=`i."Invoice_ID"::text id,i."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic_name,
 i."Patient_ID"::text patient_id,concat_ws(' ',u."First_Name",u."Last_Name") patient_name,
 i."Visit_ID"::text visit_id,i."Invoice_Status" invoice_status,i.payment_status state,
 to_char(i."Created_At",'YYYY-MM-DD') created,i.total_amount total,
 i.paid_amount paid,i.remaining_amount remaining`;
function invoiceWhere(f){
 const clauses=[],args=[];const add=(sql,val)=>{args.push(val);clauses.push(sql.replace('?',`$${args.length}`));};
 if(f.q){const q='%'+escaped(f.q)+'%';args.push(q);const at=`$${args.length}`;clauses.push(`(i."Invoice_ID"::text ILIKE ${at} ESCAPE '\\' OR c."Clinic_Name" ILIKE ${at} ESCAPE '\\' OR concat_ws(' ',u."First_Name",u."Last_Name") ILIKE ${at} ESCAPE '\\')`);}
 if(f.clinic)add(`i."Clinic_ID"=?::bigint`,f.clinic);
 if(f.from)add(`i."Created_At">=?::date`,f.from);
 if(f.to)add(`i."Created_At"<?::date + interval '1 day'`,f.to);
 if(f.status)add(`i.payment_status=?`,f.status);
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}
async function list(pool,raw={}){
 const f=filters(raw);const invoice=f.tab==='invoices';
 const from=invoice?INVOICE_FROM:SETTLEMENT_FROM;
 const columns=invoice?INVOICE_COLS:SETTLEMENT_COLS;
 const order=invoice?'i."Created_At" DESC,i."Invoice_ID" DESC':'s."Period_End" DESC,s."Settlement_ID" DESC';
 const cond=(invoice?invoiceWhere:settlementWhere)(f);
 const [counter,clinics,totals]=await Promise.all([
  pool.query(`SELECT COUNT(*)::integer total ${from}${cond.sql}`,cond.args),
  pool.query(`SELECT "Clinic_ID"::text id,"Clinic_Name" name FROM sdc."CLINIC" ORDER BY "Clinic_Name","Clinic_ID"`),
  pool.query(`SELECT COALESCE(sum(x.due),0)::numeric(16,2) due,COALESCE(sum(pay.received),0)::numeric(16,2) received,
    COALESCE(sum(GREATEST(x.due-pay.received,0)),0)::numeric(16,2) remaining,
    count(*) FILTER (WHERE x.due>0 AND pay.received>=x.due)::integer settled
    ${SETTLEMENT_FROM}`)
 ]);
 const total=Number(counter.rows[0]?.total||0),pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),page=Math.min(pages,f.page);
 const rows=await pool.query(`SELECT ${columns} ${from}${cond.sql} ORDER BY ${order} LIMIT $${cond.args.length+1} OFFSET $${cond.args.length+2}`,[...cond.args,PAGE_SIZE,(page-1)*PAGE_SIZE]);
 let details=null;
 const settlementId=typeof raw.settlement==='string'?raw.settlement:'';
 if(!invoice&&validId(settlementId))details=await settlementDetail(pool,settlementId);
 const preview=await pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name FROM sdc."CLINIC" c WHERE c."Approval_Status"='approved' AND c."Clinic_Status"='active' ORDER BY c."Clinic_Name",c."Clinic_ID"`);
 return {financeRows:rows.rows,financeFilters:{...f,page},financeTotal:total,financePages:pages,financePage:page,
 financeClinics:clinics.rows,financeActiveClinics:preview.rows,financeTotals:totals.rows[0],financeSettlementDetail:details};
}
async function settlementDetail(pool,id){
 if(!validId(id))return null;
 const s=await pool.query(`SELECT ${SETTLEMENT_COLS} ${SETTLEMENT_FROM} WHERE s."Settlement_ID"=$1::bigint`,[id]);
 if(!s.rowCount)return null;
 const [bookings,payments]=await Promise.all([
  pool.query(`SELECT b."Booking_ID"::text id,to_char(b."Appointment_Date",'YYYY-MM-DD') date,
   bc."Service_Price_Snapshot" price,bc."Commission_Rate_Snapshot" rate,bc.commission_amount amount
   FROM sdc.booking_commissions bc JOIN sdc."BOOKING" b ON b."Booking_ID"=bc."Booking_ID"
   WHERE bc."Settlement_ID"=$1::bigint AND bc.eligible IS TRUE
   AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
    WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')
   ORDER BY b."Booking_ID" DESC LIMIT 200`,[id]),
  pool.query(`SELECT p."Settlement_Payment_ID"::text id,to_char(p."Paid_At",'YYYY-MM-DD HH24:MI') at,
   p."Amount" amount,p."Payment_Method" method,p."Reference_Number" reference,
   concat_ws(' ',u."First_Name",u."Last_Name") actor
   FROM sdc."RECORDS_SETTLEMENT_PAYMENT" p LEFT JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
   WHERE p."Settlement_ID"=$1::bigint ORDER BY p."Paid_At" DESC,p."Settlement_Payment_ID" DESC LIMIT 200`,[id])
 ]);
 return {settlement:s.rows[0],bookings:bookings.rows,payments:payments.rows};
}
async function invoiceDetail(pool,id){
 if(!validId(id))return null;
 const r=await pool.query(`SELECT ${INVOICE_COLS} ${INVOICE_FROM} WHERE i."Invoice_ID"=$1::bigint`,[id]);
 if(!r.rowCount)return null;
 const [payments,summary,events]=await Promise.all([
  pool.query(`SELECT rp."Payment_ID"::text id,to_char(rp."Paid_At",'YYYY-MM-DD HH24:MI') at,
   rp."Amount" amount,rp."Payment_Method" method,rp."Reference_Number" reference,
   concat_ws(' ',actor."First_Name",actor."Last_Name") actor
   FROM sdc."RECORDS_PAYMENT" rp LEFT JOIN sdc."USER" actor ON actor."User_ID"=rp."User_ID"
   WHERE rp."Invoice_ID"=$1::bigint ORDER BY rp."Paid_At" DESC,rp."Payment_ID" DESC LIMIT 100`,[id]),
  pool.query(`SELECT count(*)::integer item_count,
   COALESCE(sum("Quantity"*"Unit_Price"),0)::numeric(16,2) subtotal,
   COALESCE(sum("Discount_Amount"),0)::numeric(16,2) discounts
   FROM sdc."INVOICE_INVOICE_ITEMS" WHERE "Invoice_ID"=$1::bigint`,[id]),
  pool.query(`SELECT a."Log_ID"::text id,to_char(a."Occurred_At",'YYYY-MM-DD HH24:MI') at,
   a."Action_Type" action,CASE WHEN a."Action_Type"='invoice.admin.oversight_note' THEN a."Reason" ELSE NULL END reason
   FROM sdc."AUDIT_LOG" a WHERE a."Target_Type"='Invoice' AND a."Target_Reference"=$1::varchar(512)
   ORDER BY a."Occurred_At" DESC,a."Log_ID" DESC LIMIT 30`,[id])
 ]);
 return {invoice:r.rows[0],invoicePayments:payments.rows,invoiceItemSummary:summary.rows[0]||{item_count:0,subtotal:0,discounts:0},invoiceEvents:events.rows};
}
async function note(pool,{invoiceId,adminId,reason}){
 if(!validId(String(invoiceId))||!validId(String(adminId))||!validReason(reason))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(auth.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const exists=await db.query('SELECT 1 FROM sdc."INVOICE" WHERE "Invoice_ID"=$1::bigint FOR SHARE',[invoiceId]);
  if(!exists.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'invoice.admin.oversight_note','Invoice',$1::varchar(512),$2,$3,$4::bigint)`,
   [invoiceId,'ملاحظة رقابية مالية، دون تعديل الفاتورة أو دفعات المريض',reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
// CSV is read-only, bounded, escaped and resistant to spreadsheet formula injection.
function csvCell(value){let s=String(value??'').replace(/\r|\n/g,' ');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
async function exportData(pool,raw={}){
 const f=filters(raw),invoice=f.tab==='invoices';const from=invoice?INVOICE_FROM:SETTLEMENT_FROM;
 const where=(invoice?invoiceWhere:settlementWhere)(f),col=invoice?INVOICE_COLS:SETTLEMENT_COLS;
 const cnt=await pool.query(`SELECT count(*)::integer total ${from}${where.sql}`,where.args);
 if(Number(cnt.rows[0]?.total||0)>3000)return {tooMany:true};
 const result=await pool.query(`SELECT ${col} ${from}${where.sql} ORDER BY ${invoice?'i."Invoice_ID" DESC':'s."Settlement_ID" DESC'} LIMIT 3001`,where.args);
 const keys=invoice?['id','clinic_name','patient_name','created','invoice_status','state','total','paid','remaining']:['id','clinic_name','start','finish','bookings','service_total','due','received','remaining','state'];
 const csv='\uFEFF'+[keys.map(csvCell).join(','),...result.rows.map(r=>keys.map(k=>csvCell(r[k])).join(','))].join('\r\n')+'\r\n';
 return {tooMany:false,csv};
}
module.exports={validId,validReason,validDate,filters,settlementWhere,invoiceWhere,list,settlementDetail,invoiceDetail,note,exportData,commission,PAGE_SIZE};

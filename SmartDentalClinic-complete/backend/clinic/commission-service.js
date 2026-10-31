'use strict';
// Commission ledger for clinic owners and settlement generation by the Super Admin.
// The commission base is always the immutable original booking service price.
const ID=/^[1-9]\d{0,17}$/;
const MONEY=/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const RATE=/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/;
const METHODS=new Set(['cash','card','bank_transfer']);
const numeric=v=>Number(v||0);
const cents=v=>Math.round(numeric(v)*100);
const validId=v=>ID.test(String(v||''));
const dateOnly=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const rollback=async client=>{try{await client.query('ROLLBACK')}catch{}};

async function list(pool,clinic){
 const [headers,bookings,payments,unsettled]=await Promise.all([
  pool.query(`SELECT s."Settlement_ID"::text id,to_char(s."Period_Start",'DD/MM/YYYY') start,
   to_char(s."Period_End",'DD/MM/YYYY') finish,to_char(s."Due_Date",'DD/MM/YYYY') due_date,COALESCE(c.base,0)::numeric base,
   COALESCE(c.due,0)::numeric due,COALESCE(p.paid,0)::numeric paid
   FROM sdc."SETTLEMENT" s
   LEFT JOIN LATERAL (SELECT sum(b."Service_Price_Snapshot") base,sum(bc.commission_amount) due
    FROM sdc.booking_commissions bc JOIN sdc."BOOKING" b ON b."Booking_ID"=bc."Booking_ID"
    WHERE bc."Settlement_ID"=s."Settlement_ID" AND bc.eligible IS TRUE
    AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
      WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')) c ON TRUE
   LEFT JOIN LATERAL (SELECT sum("Amount") paid FROM sdc."RECORDS_SETTLEMENT_PAYMENT"
    WHERE "Settlement_ID"=s."Settlement_ID") p ON TRUE
   WHERE s."Clinic_ID"=$1::bigint ORDER BY s."Period_End" DESC,s."Settlement_ID" DESC LIMIT 100`,[clinic]),
  pool.query(`SELECT b."Settlement_ID"::text id,b."Booking_ID"::text booking_id,
   b."Service_Price_Snapshot" price,b."Commission_Rate_Snapshot" rate,
   bc.commission_amount commission,to_char(b."Appointment_Date",'DD/MM/YYYY') date,
   u."First_Name"||' '||u."Last_Name" patient
   FROM sdc."BOOKING" b JOIN sdc.booking_commissions bc USING("Booking_ID")
   JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
   JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
   WHERE b."Clinic_ID"=$1::bigint AND b."Settlement_ID" IS NOT NULL AND bc.eligible IS TRUE
   AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
    WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')
   ORDER BY b."Appointment_Date" DESC,b."Booking_ID" DESC LIMIT 1000`,[clinic]),
  pool.query(`SELECT p."Settlement_ID"::text id,to_char(p."Paid_At",'DD/MM/YYYY HH24:MI') at,
   p."Amount" amount,p."Payment_Method" method,p."Reference_Number" ref,
   u."First_Name"||' '||u."Last_Name" actor
   FROM sdc."RECORDS_SETTLEMENT_PAYMENT" p
   JOIN sdc."SETTLEMENT" s ON s."Settlement_ID"=p."Settlement_ID"
   JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
   WHERE s."Clinic_ID"=$1::bigint ORDER BY p."Paid_At" DESC,p."Settlement_Payment_ID" DESC LIMIT 1000`,[clinic]),
  pool.query(`SELECT count(*)::int count,COALESCE(sum(b."Service_Price_Snapshot"),0)::numeric base
   FROM sdc.booking_commissions bc JOIN sdc."BOOKING" b USING("Booking_ID")
   WHERE bc."Clinic_ID"=$1::bigint AND bc."Settlement_ID" IS NULL AND bc.eligible IS TRUE
   AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
    WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')`,[clinic])
 ]);
 const bookingsById=new Map(),paymentsById=new Map();
 for(const b of bookings.rows){if(!bookingsById.has(b.id))bookingsById.set(b.id,[]);bookingsById.get(b.id).push(b);}
 for(const p of payments.rows){if(!paymentsById.has(p.id))paymentsById.set(p.id,[]);paymentsById.get(p.id).push(p);}
 const settlements=headers.rows.map(r=>({
  ...r,base:numeric(r.base),due:numeric(r.due),paid:numeric(r.paid),
  remaining:Math.max(0,(cents(r.due)-cents(r.paid))/100),
  bookings:bookingsById.get(r.id)||[],payments:paymentsById.get(r.id)||[]
 }));
 return {settlements,unsettled:{count:Number(unsettled.rows[0]?.count||0),base:numeric(unsettled.rows[0]?.base)}};
}

function paymentInput(body){
 const settlementId=String(body.settlement_id??'');
 const amount=String(body.amount??'').trim(),method=String(body.method??'');
 const reference=String(body.reference??'').trim();
 if(!validId(settlementId)||!MONEY.test(amount)||cents(amount)<=0||!METHODS.has(method)||
    reference.length<4||reference.length>80||!/^[\p{L}\p{N}_ .\/-]+$/u.test(reference)||
    String(body.confirm_transfer||'')!=='yes')return null;
 return {settlementId,amount,method,reference};
}
// The clinic's legacy write API is intentionally closed. Settlement receipts are
// recorded only from Super Admin, never from a clinic account.
async function recordPayment(){return {status:'forbidden'};}
async function recordAdminPayment(pool,actor,body){
 const input=paymentInput(body);
 if(!input||!validId(actor))return {status:'invalid'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('sdc.user_id',$1,true)",[actor]);
  const admin=await client.query(`SELECT sdc.sdc_is_superadmin($1::bigint) allowed`,[actor]);
  if(admin.rows[0]?.allowed!==true){await rollback(client);return {status:'forbidden'};}
  const settlement=await client.query(`SELECT "Settlement_ID","Clinic_ID" FROM sdc."SETTLEMENT"
    WHERE "Settlement_ID"=$1::bigint FOR UPDATE`,[input.settlementId]);
  if(!settlement.rowCount){await rollback(client);return {status:'not_found'};}
  const existing=await client.query(`SELECT 1 FROM sdc."RECORDS_SETTLEMENT_PAYMENT"
    WHERE "Settlement_ID"=$1::bigint AND lower(btrim("Reference_Number"))=lower($2::text) LIMIT 1`,[input.settlementId,input.reference]);
  if(existing.rowCount){await rollback(client);return {status:'duplicate'};}
  const balance=await client.query(`SELECT COALESCE(sum(bc.commission_amount),0)::numeric due
   FROM sdc.booking_commissions bc JOIN sdc."BOOKING" b ON b."Booking_ID"=bc."Booking_ID"
   WHERE bc."Settlement_ID"=$1::bigint AND bc.eligible IS TRUE
   AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
    WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')`,[input.settlementId]);
  const payments=await client.query(`SELECT COALESCE(sum("Amount"),0)::numeric paid
   FROM sdc."RECORDS_SETTLEMENT_PAYMENT" WHERE "Settlement_ID"=$1::bigint`,[input.settlementId]);
  const rest=cents(balance.rows[0]?.due)-cents(payments.rows[0]?.paid);
  if(rest<=0){await rollback(client);return {status:'settled'};}
  if(cents(input.amount)>rest){await rollback(client);return {status:'excess'};}
  await client.query(`INSERT INTO sdc."RECORDS_SETTLEMENT_PAYMENT"
   ("Amount","Payment_Method","Paid_At","Reference_Number","Settlement_ID","User_ID")
   VALUES($1::numeric,$2,LOCALTIMESTAMP,$3,$4::bigint,$5::bigint)`,
   [input.amount,input.method,input.reference,input.settlementId,actor]);
  await client.query(`INSERT INTO sdc."AUDIT_LOG"
   ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES(LOCALTIMESTAMP,'platform.settlement.payment.received','Settlement',$1,$2,$3::bigint)`,
   [input.settlementId,`استلام دفعة عمولة من العيادة ${settlement.rows[0].Clinic_ID}: ${input.amount} ₪، الطريقة ${input.method}، المرجع ${input.reference}`,actor]);
  await client.query('COMMIT');return {status:'ok'};
 }catch(e){await rollback(client);throw e;}finally{client.release();}
}

function creationInput(data){
 const actor=String(data.actor??''),clinic=String(data.clinic??'');
 const start=String(data.start??''),end=String(data.end??'');
 const rate=String(data.rate??'').trim();
 const dueDays=data.dueDays===undefined?null:Number(data.dueDays);
 if(!validId(actor)||!validId(clinic)||!dateOnly(start)||!dateOnly(end)||end<start||
    !RATE.test(rate)||Number(rate)<=0||Number(rate)>100||
    (dueDays!==null && ![7,14,30].includes(dueDays)))return null;
 return dueDays===null?{actor,clinic,start,end,rate}:{actor,clinic,start,end,rate,dueDays};
}
async function createSettlement(pool,data){
 const v=creationInput(data);if(!v)return {status:'invalid'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('sdc.user_id',$1,true)",[v.actor]);
  const admin=await client.query(`SELECT sdc.sdc_is_superadmin($1::bigint) allowed`,[v.actor]);
  if(admin.rows[0]?.allowed!==true){await rollback(client);return {status:'forbidden'};}
  const clinic=await client.query(`SELECT "Clinic_ID" FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint
   AND "Clinic_Status"='active' AND "Approval_Status"='approved' FOR UPDATE`,[v.clinic]);
  if(!clinic.rowCount){await rollback(client);return {status:'no_clinic'};}
  // One settlement per clinic/period prevents ambiguous overlapping billing windows.
  const overlap=await client.query(`SELECT 1 FROM sdc."SETTLEMENT" WHERE "Clinic_ID"=$1::bigint
    AND "Period_Start"<=$3::date AND "Period_End">=$2::date LIMIT 1`,[v.clinic,v.start,v.end]);
  if(overlap.rowCount){await rollback(client);return {status:'overlap'};}
  const eligible=await client.query(`SELECT b."Booking_ID"::text id
   FROM sdc."BOOKING" b JOIN sdc.booking_commissions bc ON bc."Booking_ID"=b."Booking_ID"
   WHERE b."Clinic_ID"=$1::bigint AND b."Appointment_Date" BETWEEN $2::date AND $3::date
   AND b."Settlement_ID" IS NULL AND bc.eligible IS TRUE
   AND EXISTS (SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
    WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID"
    AND pr."Procedure_Status"='completed')
   ORDER BY b."Booking_ID" FOR UPDATE OF b`,[v.clinic,v.start,v.end]);
  if(!eligible.rowCount){await rollback(client);return {status:'empty'};}
  const created=await client.query(`INSERT INTO sdc."SETTLEMENT"
   ("Period_Start","Period_End","Created_At","Clinic_ID","Due_Date")
   VALUES($1::date,$2::date,LOCALTIMESTAMP,$3::bigint,CASE WHEN $4::integer IS NULL THEN NULL ELSE (now() AT TIME ZONE 'Asia/Hebron')::date+$4::integer END)
   RETURNING "Settlement_ID"::text id`,[v.start,v.end,v.clinic,v.dueDays]);
  const id=created.rows[0].id;
  const ids=eligible.rows.map(b=>b.id);
  // The DB snapshots new bookings at creation. COALESCE only covers legacy
  // bookings created before migration 009 with no historical rate stored.
  // Never replace a real booking-time commission snapshot at settlement.
  const updated=await client.query(`UPDATE sdc."BOOKING" SET "Settlement_ID"=$1::bigint,
   "Commission_Rate_Snapshot"=COALESCE("Commission_Rate_Snapshot",$2::numeric)
   WHERE "Booking_ID"=ANY($3::bigint[])
   AND "Clinic_ID"=$4::bigint AND "Settlement_ID" IS NULL`,[id,v.rate,ids,v.clinic]);
  if(updated.rowCount!==ids.length)throw new Error('Settlement membership changed while creating the settlement');
  await client.query(`INSERT INTO sdc."AUDIT_LOG"
   ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES(LOCALTIMESTAMP,'platform.settlement.created','Settlement',$1,$2,$3::bigint)`,
   [id,`إنشاء تسوية للعيادة ${v.clinic} للفترة ${v.start} - ${v.end} لعدد ${ids.length} حجز، باستخدام النسب المثبتة وقت الحجز (النسبة ${v.rate}% فقط للحجوزات القديمة التي لا تملك نسبة تاريخية)`,v.actor]);
  await client.query('COMMIT');return {status:'ok',id,count:ids.length};
 }catch(e){await rollback(client);throw e;}finally{client.release();}
}
module.exports={list,paymentInput,recordPayment,recordAdminPayment,creationInput,createSettlement,cents};

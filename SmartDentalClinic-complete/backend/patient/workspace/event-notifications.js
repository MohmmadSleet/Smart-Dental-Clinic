'use strict';
// Patient in-app notices. Called inside the SAME transaction as the persisted event.
// The advisory lock and existence check make event replay idempotent across workers;
// no DB migration or new table is needed. Preserve ordinary notification records.
const ID=/^[1-9]\d{0,17}$/;
const TYPE=/^patient\.[a-z0-9.]{1,110}$/;
const TARGETS=new Set(['Booking','Visit','Invoice','Payment']);
async function emit(db,{patientId,userId,type,title,body,targetType,targetId}){
 if(!TYPE.test(type)||!TARGETS.has(targetType)||!ID.test(String(targetId))||
    typeof title!=='string'||title.length>150||!title.trim()||
    typeof body!=='string'||!body.trim()||!ID.test(String(patientId||userId)))throw new Error('Invalid patient notification');
 let recipient=userId;
 if(patientId){
  const r=await db.query(`SELECT "User_ID"::text id FROM sdc."PATIENT" WHERE "Patient_ID"=$1::bigint`,[patientId]);
  if(!r.rowCount)return false;recipient=r.rows[0].id;
 }
 if(!ID.test(String(recipient)))return false;
 // Lock key is recipient+type+entity, so distinct payments and dates stay distinct.
 // An immutable audit marker suppresses re-delivery even if the patient deletes
 // the inbox row. This also avoids migrations and survives server restarts.
 const key=`${recipient}|${type}|${targetType}|${targetId}`;
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',[key]);
 const prior=await db.query(`SELECT 1 FROM sdc."AUDIT_LOG" WHERE "Action_Type"='patient.notification.dispatched'
  AND "Target_Type"='NotificationEvent' AND "Target_Reference"=$1::varchar(512) LIMIT 1`,[key]);
 if(prior.rowCount)return false;
 const saved=await db.query(`INSERT INTO sdc."NOTIFICATION"
   ("Title","Body","Notification_Type","Created_At","User_ID","Target_Type","Target_Reference")
   SELECT $1::varchar(150),$2::text,$3::varchar(150),LOCALTIMESTAMP,$4::bigint,$5::varchar(150),$6::varchar(512)
   WHERE NOT EXISTS(SELECT 1 FROM sdc."NOTIFICATION" WHERE "User_ID"=$4::bigint
   AND "Notification_Type"=$3::varchar(150) AND "Target_Type"=$5::varchar(150)
   AND "Target_Reference"=$6::varchar(512)) RETURNING "Notification_ID"`,
   [title,body,type,String(recipient),targetType,String(targetId)]);
 if(saved.rowCount){
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES(LOCALTIMESTAMP,'patient.notification.dispatched','NotificationEvent',$1::varchar(512),
   'إرسال إشعار تلقائي للمريض من حدث محفوظ في النظام',$2::bigint)`,[key,String(recipient)]);
 }
 return saved.rowCount>0;
}
const nextDay=(day)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const isDay=d=>/^\d{4}-\d\d-\d\d$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
let ticking=false;
async function runReminders(pool,{date}={}){
 if(ticking)return {status:'busy'};
 ticking=true;
 try{
  const today=date??require('../../appointments/service').localNow().date;
  if(!isDay(today))throw new Error('Invalid reminder date');
  const tomorrow=nextDay(today);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   // Serialize *all* reminder scans across multiple running server instances.
   const locked=await db.query('SELECT pg_try_advisory_xact_lock(534443,274421) AS locked');
   if(!locked.rows[0]?.locked){await db.query('ROLLBACK');return {status:'busy'};}
   const bookings=await db.query(`SELECT b."Booking_ID"::text booking_id,p."User_ID"::text user_id,
    to_char(b."Start_Time",'HH24:MI') time,c."Clinic_Name" clinic
    FROM sdc."BOOKING" b JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
    JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID"
    WHERE b."Booking_Status"='confirmed' AND b."Appointment_Date"=$1::date
    ORDER BY b."Booking_ID"`,[tomorrow]);
   let created=0;
   for(const b of bookings.rows){
    if(await emit(db,{userId:b.user_id,type:`patient.booking.reminder.${tomorrow.replace(/-/g,'')}`,
     title:'تذكير بموعدك غدًا',body:`لديك موعد غدًا الساعة ${b.time} في ${b.clinic}.`,
     targetType:'Booking',targetId:b.booking_id}))created++;
   }
   await db.query('COMMIT');return {status:'ok',date:tomorrow,checked:bookings.rowCount,created};
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
 }finally{ticking=false;}
}
function start(pool,logger=console){
 const tick=()=>runReminders(pool).then(r=>{if(r.created)logger.info('[PATIENT_REMINDERS]',r.created,r.date);})
   .catch(e=>logger.error('[PATIENT_REMINDERS_FAILED]',e.code||e.message));
 void tick();const t=setInterval(tick,60*60*1000);t.unref?.();return t;
}
module.exports={emit,runReminders,start,nextDay};

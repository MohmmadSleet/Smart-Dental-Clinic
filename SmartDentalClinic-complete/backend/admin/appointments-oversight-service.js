'use strict';
// v27.19 — Cross-clinic booking oversight. Admin cannot mutate booking or change requests.
const ID=/^[1-9]\d{0,17}$/;
const STATUSES=new Set(['pending','confirmed','in_progress','completed','cancelled','rejected','no_show']);
const SOURCES=new Set(['manual','ai']);
const PAGE_SIZE=25;
const validId=x=>typeof x==='string'&&ID.test(x);
const validReason=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=1000;
const cleanDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:'';
const cleanSearch=x=>typeof x==='string'?x.trim().slice(0,100):'';
function parseFilters(query={}){
 const p=typeof query.page==='string'&&/^\d{1,5}$/.test(query.page)?Number(query.page):1;
 return {q:cleanSearch(query.q),clinic:validId(query.clinic)?query.clinic:'',status:STATUSES.has(query.status)?query.status:'',source:SOURCES.has(query.source)?query.source:'',from:cleanDate(query.from),to:cleanDate(query.to),page:Math.max(1,Math.min(10000,p))};
}
const JOINS=` FROM sdc."BOOKING" b
 JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID"
 JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 JOIN sdc."USER" pu ON pu."User_ID"=p."User_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID"
 JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
 JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"`;
const COLS=`b."Booking_ID"::text id,b."Appointment_Date"::text appointment_date,
 to_char(b."Start_Time",'HH24:MI') appointment_time,b."Booking_Status" status,b."Booking_Source" source,
 b."Duration_Minutes_Snapshot" duration_minutes,b."Service_Price_Snapshot" price,
 b."Requested_Date"::text requested_date,to_char(b."Requested_Start_Time",'HH24:MI') requested_time,
 b."Request_Status" request_status,b."Request_Source" request_source,b."Change_Request_Reason" request_reason,
 b."Requested_At" requested_at,b."Resolved_At" resolved_at,b."Created_At" created_at,
 b."Patient_Notes" patient_notes,b."Administrative_Notes" administrative_notes,
 b."Patient_ID"::text patient_id,pu."User_ID"::text patient_user_id,
 concat_ws(' ',pu."First_Name",pu."Last_Name") patient_name,
 b."Doctor_ID"::text doctor_id,concat_ws(' ',du."First_Name",du."Last_Name") doctor_name,
 b."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic_name,b."Service_ID"::text service_id,s."Service_Name" service_name,
 b."Created_By_User_ID"::text created_by_user_id,b."Recommendation_ID"::text recommendation_id,
 b."Follow_Up_Of_Visit_ID"::text follow_up_of_visit_id`;
function conditions(filters){
 const clauses=[],values=[];
 const append=(sql,v)=>{values.push(v);clauses.push(sql.replace(/\?/g,'$'+values.length));};
 if(filters.q){append(`concat_ws(' ',b."Booking_ID"::text,c."Clinic_Name",pu."First_Name",pu."Last_Name",du."First_Name",du."Last_Name",s."Service_Name") ILIKE ? ESCAPE '\\'`,'%'+filters.q.replace(/[\\%_]/g,'\\$&')+'%');}
 if(filters.clinic)append(`b."Clinic_ID"=?::bigint`,filters.clinic);
 if(filters.status)append(`b."Booking_Status"=?`,filters.status);
 if(filters.source)append(`b."Booking_Source"=?`,filters.source);
 if(filters.from)append(`b."Appointment_Date">=?::date`,filters.from);
 if(filters.to)append(`b."Appointment_Date"<=?::date`,filters.to);
 return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',values};
}
async function list(pool,q={}){
 const f=parseFilters(q),{where,values}=conditions(f);
 const [totalResult,clinics]=await Promise.all([
  pool.query(`SELECT count(*)::integer AS total ${JOINS}${where}`,values),
  pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name FROM sdc."CLINIC" c ORDER BY c."Clinic_Name",c."Clinic_ID"`)
 ]);
 const total=Number(totalResult.rows[0]?.total)||0,pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),page=Math.min(f.page,pages);
 const result=await pool.query(`SELECT ${COLS} ${JOINS}${where}
  ORDER BY b."Appointment_Date" DESC,b."Start_Time" DESC,b."Booking_ID" DESC
  LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,PAGE_SIZE,(page-1)*PAGE_SIZE]);
 return {appointments:result.rows,appointmentClinics:clinics.rows,appointmentFilters:{...f,page},appointmentTotal:total,appointmentPages:pages,appointmentPage:page};
}
async function detail(pool,id){
 if(!validId(id))return null;
 const result=await pool.query(`SELECT ${COLS} ${JOINS} WHERE b."Booking_ID"=$1::bigint`,[id]);
 if(!result.rowCount)return null;
 const [visitResult,logsResult]=await Promise.all([
  pool.query(`SELECT v."Visit_ID"::text id,v."Visit_Status" status,v."Report_Approved_At" report_approved_at
    FROM sdc."VISIT" v WHERE v."Booking_ID"=$1::bigint LIMIT 1`,[id]),
  pool.query(`SELECT a."Log_ID"::text id,a."Occurred_At" occurred_at,a."Action_Type" action,
   a."Description" description,a."Reason" reason,concat_ws(' ',u."First_Name",u."Last_Name") actor
   FROM sdc."AUDIT_LOG" a LEFT JOIN sdc."USER" u ON u."User_ID"=a."User_ID"
   WHERE a."Target_Reference"=$1::varchar(512) AND a."Target_Type" IN ('Booking','Appointment')
   ORDER BY a."Occurred_At" DESC,a."Log_ID" DESC LIMIT 30`,[id])
 ]);
 return {appointment:result.rows[0],appointmentVisit:visitResult.rows[0]||null,appointmentAudit:logsResult.rows};
}
async function note(pool,{bookingId,adminId,reason}){
 if(!validId(String(bookingId))||!validId(String(adminId))||!validReason(reason))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const allowed=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(allowed.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const exists=await db.query('SELECT 1 FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint FOR SHARE',[bookingId]);
  if(!exists.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
  VALUES(LOCALTIMESTAMP,'booking.admin.oversight_note','Booking',$1::varchar(512),$2,$3,$4::bigint)`,
  [bookingId,'ملاحظة رقابية على حجز من المشرف العام، دون تغيير حالته أو موعده',reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}

// Editing nonclinical administrative notes only. Never change booking status,
// date, service, price, visit or finance references from this workspace.
async function updateAdministrativeNote(pool,{bookingId,adminId,reason,note}){
 if(!validId(String(bookingId))||!validId(String(adminId))||!validReason(reason)||typeof note!=='string'||!note.trim()||note.trim().length>1200)return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const allowed=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(allowed.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const current=await db.query('SELECT "Administrative_Notes" FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint FOR UPDATE',[bookingId]);
  if(!current.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  if(current.rows[0].Administrative_Notes===note.trim()){await db.query('ROLLBACK');return {status:'unchanged'};}
  await db.query('UPDATE sdc."BOOKING" SET "Administrative_Notes"=$2 WHERE "Booking_ID"=$1::bigint',[bookingId,note.trim()]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'booking.admin.notes_updated','Booking',$1::varchar(512),
   'تعديل ملاحظات الحجز الإدارية بواسطة المشرف العام دون تغيير البيانات الطبية أو الموعد أو الحالة',$2,$3::bigint)`,
   [bookingId,reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={PAGE_SIZE,validId,validReason,parseFilters,conditions,list,detail,note,updateAdministrativeNote};

'use strict';
// Laboratory master data is platform-scoped. Clinic memberships are independent.
const ID=/^[1-9]\d{0,17}$/;
const validId=x=>typeof x==='string'&&ID.test(x);
// HTML form values can contain incidental leading/trailing whitespace.
// Normalize them before validation; never reject a legitimate form for spaces alone.
const input=(v,max)=>typeof v==='string' ? v.trim().slice(0,max+1) : null;
const safeText=(v,max)=>{const val=input(v,max);return val && val.length<=max && val.length ? val : null;};
const reasons=(v)=>{const value=safeText(v,1000);return value&&value.length>=8?value:null;};
async function labList(pool){
 const r=await pool.query(`SELECT l."Laboratory_ID",l."Laboratory_Name",l."Phone",l."Address",l."Additional_Contact",l."Is_Active",
   (SELECT COUNT(*)::int FROM sdc."LAB_ORDER" o WHERE o."Laboratory_ID"=l."Laboratory_ID") AS case_total,
   (SELECT COUNT(*)::int FROM sdc."LAB_ORDER" o WHERE o."Laboratory_ID"=l."Laboratory_ID" AND o."Order_Status" IN ('draft','sent')) AS open_cases,
   (SELECT COUNT(*)::int FROM sdc."LAB_ORDER" o WHERE o."Laboratory_ID"=l."Laboratory_ID" AND o."Order_Status"='received') AS received_cases,
   (SELECT COUNT(*)::int FROM sdc."LAB_ORDER" o WHERE o."Laboratory_ID"=l."Laboratory_ID" AND o."Order_Status" IN ('draft','sent') AND o."Expected_Delivery_Date"<CURRENT_DATE) AS overdue_cases,
   COALESCE((SELECT string_agg(c."Clinic_Name",'، ' ORDER BY c."Clinic_Name") FROM sdc."WORKS_WITH" w JOIN sdc."CLINIC" c USING("Clinic_ID") WHERE w."Laboratory_ID"=l."Laboratory_ID"),'') AS clinics
 FROM sdc."LABORATORY" l ORDER BY l."Laboratory_ID" DESC`);
 const labs=r.rows;return {labs,stats:{total:labs.length,active:labs.filter(l=>l.Is_Active).length,inactive:labs.filter(l=>!l.Is_Active).length,open:labs.reduce((n,l)=>n+Number(l.open_cases||0),0)}};
}
async function labDetail(pool,id){
 if(!validId(id))return null;
 const {labs}=await labList(pool);const lab=labs.find(l=>String(l.Laboratory_ID)===id);if(!lab)return null;
 const result=await pool.query(`SELECT o."Lab_Order_ID",o."Order_Status",to_char(o."Expected_Delivery_Date",'YYYY-MM-DD') AS due,
    COALESCE(string_agg(DISTINCT i."Work_Type",'، '),'—') AS work,
    concat_ws(' ',pu."First_Name",pu."Last_Name") AS patient,
    concat_ws(' ',du."First_Name",du."Last_Name") AS doctor
 FROM sdc."LAB_ORDER" o JOIN sdc."VISIT" v ON v."Visit_ID"=o."Visit_ID"
 JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
 JOIN sdc."PATIENT" pa ON pa."Patient_ID"=b."Patient_ID" JOIN sdc."USER" pu ON pu."User_ID"=pa."User_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
 LEFT JOIN sdc."LAB_ORDER_ITEMS" i ON i."Lab_Order_ID"=o."Lab_Order_ID"
 WHERE o."Laboratory_ID"=$1::bigint
 GROUP BY o."Lab_Order_ID",pu."User_ID",du."User_ID"
 ORDER BY o."Lab_Order_ID" DESC LIMIT 200`,[id]);
 return {lab,cases:result.rows};
}
async function mutate(pool,adminId,action,id,body){
 if(!validId(String(adminId))||!['create','update','activate','deactivate','delete'].includes(action))return {status:'invalid'};
 if(action!=='create'&&!validId(String(id)))return {status:'invalid'};
 const reason=reasons(body?.reason);
 if(!reason)return {status:'invalid'};
 const fields=action==='create'||action==='update'?{
   name:safeText(body?.name,150),phone:safeText(body?.phone,30),address:safeText(body?.address,150),
   contact:typeof body?.contact==='string'&&body.contact.trim().length<=150?body.contact.trim()||null:undefined
 }:null;
 if(fields&&(!fields.name||!fields.phone||!fields.address||fields.contact===undefined))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const permit=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(permit.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  let record;
  if(action==='create'){
    // Avoid easy accidental duplicate master records; DB remains ultimate authority.
    const dup=await db.query(`SELECT 1 FROM sdc."LABORATORY" WHERE lower(btrim("Laboratory_Name"))=lower($1) AND "Phone"=$2 LIMIT 1`,[fields.name,fields.phone]);
    if(dup.rowCount){await db.query('ROLLBACK');return {status:'duplicate'};}
    const r=await db.query(`INSERT INTO sdc."LABORATORY"("Laboratory_Name","Phone","Address","Additional_Contact","Is_Active")
      VALUES($1,$2,$3,$4,TRUE) RETURNING "Laboratory_ID"`,[fields.name,fields.phone,fields.address,fields.contact]);
    record=r.rows[0].Laboratory_ID;
  }else{
    const found=await db.query(`SELECT "Laboratory_ID","Is_Active" FROM sdc."LABORATORY" WHERE "Laboratory_ID"=$1::bigint FOR UPDATE`,[id]);
    if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
    record=id;
    if(action==='delete'){
      const refs=await db.query(`SELECT
        EXISTS(SELECT 1 FROM sdc."LAB_ORDER" WHERE "Laboratory_ID"=$1::bigint) AS has_orders,
        EXISTS(SELECT 1 FROM sdc."WORKS_WITH" WHERE "Laboratory_ID"=$1::bigint) AS has_clinics`,[id]);
      if(refs.rows[0]?.has_orders||refs.rows[0]?.has_clinics){await db.query('ROLLBACK');return {status:'in_use'};}
      await db.query(`DELETE FROM sdc."LABORATORY" WHERE "Laboratory_ID"=$1::bigint`,[id]);
    }else if(action==='update'){
      await db.query(`UPDATE sdc."LABORATORY" SET "Laboratory_Name"=$2,"Phone"=$3,"Address"=$4,"Additional_Contact"=$5 WHERE "Laboratory_ID"=$1::bigint`,[id,fields.name,fields.phone,fields.address,fields.contact]);
    }else{
      if(found.rows[0].Is_Active===(action==='activate')){await db.query('ROLLBACK');return {status:'unchanged'};}
      await db.query(`UPDATE sdc."LABORATORY" SET "Is_Active"=$2 WHERE "Laboratory_ID"=$1::bigint`,[id,action==='activate']);
    }
  }
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,$1,'Laboratory',$2,$3,$4,$5)`,[
    `laboratory.${action}`,String(record),{create:'إنشاء مختبر',update:'تعديل بيانات مختبر',activate:'تفعيل مختبر',deactivate:'تعطيل مختبر',delete:'حذف مختبر غير مرتبط بأي عيادة أو حالة'}[action],reason,adminId]);
  await db.query('COMMIT');return {status:'ok',id:String(record)};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={labList,labDetail,mutate};

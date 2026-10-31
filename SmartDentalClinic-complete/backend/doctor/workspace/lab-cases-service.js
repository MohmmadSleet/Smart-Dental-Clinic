'use strict';
// Doctor laboratory work. No permissions to dispatch/receive laboratory orders:
// these operations remain on the clinic side. No new tables or status values.
const {validId}=require('./service');

const KNOWN_STATUS=new Set(['draft','sent','received','cancelled','archived']);
function statusFor(order){
  const raw=order.status;
  if(raw==='received'&&order.items.length>0&&order.items.every(i=>i.installed_at))return 'installed';
  return KNOWN_STATUS.has(raw)?raw:'other';
}
async function labCases(pool,doctorId,clinicId){
  const result=await pool.query(`/* doctor lab cases: per-clinic, per-doctor scoping precedes LIMIT */
    WITH scoped AS (
     SELECT o."Lab_Order_ID",o."Laboratory_ID",o."Visit_ID",o."Created_At",o."Expected_Delivery_Date",
            o."Order_Status",o."Sent_At",o."Received_At",o."Notes",b."Booking_ID",b."Patient_ID",
            l."Laboratory_Name",u."First_Name"||' '||u."Last_Name" AS patient_name
       FROM sdc."LAB_ORDER" o
       JOIN sdc."VISIT" v ON v."Visit_ID"=o."Visit_ID"
       JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
       JOIN sdc."LABORATORY" l ON l."Laboratory_ID"=o."Laboratory_ID"
       JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
       JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
      WHERE b."Doctor_ID"=$1::bigint AND b."Clinic_ID"=$2::bigint
      ORDER BY o."Created_At" DESC,o."Lab_Order_ID" DESC LIMIT 250
    )
    SELECT s."Lab_Order_ID"::text AS id,s."Laboratory_ID"::text AS laboratory_id,
      s."Booking_ID"::text AS booking_id,s."Patient_ID"::text AS patient_id,
      s."Laboratory_Name" AS laboratory,s.patient_name,
      s."Order_Status" AS status,to_char(s."Created_At",'YYYY-MM-DD HH24:MI') AS created_at,
      to_char(s."Expected_Delivery_Date",'YYYY-MM-DD') AS due,
      to_char(s."Sent_At",'YYYY-MM-DD HH24:MI') AS sent_at,
      to_char(s."Received_At",'YYYY-MM-DD HH24:MI') AS received_at,
      s."Notes" AS notes,
      i."Lab_Item_ID"::text AS item_id,i."Work_Type" AS work,
      i."Tooth_Number" AS tooth,i."Region_Description" AS area,
      i."Material" AS material,i."Shade" AS shade,i."Quantity"::text AS quantity,
      i."Instructions" AS instructions,to_char(i."Installed_At",'YYYY-MM-DD HH24:MI') AS installed_at
      FROM scoped s LEFT JOIN sdc."LAB_ORDER_ITEMS" i ON i."Lab_Order_ID"=s."Lab_Order_ID"
     ORDER BY s."Created_At" DESC,s."Lab_Order_ID" DESC,i."Lab_Item_ID"`,[doctorId,clinicId]);
  const orders=new Map();
  for(const r of result.rows){
    if(!orders.has(r.id))orders.set(r.id,{id:r.id,laboratory_id:r.laboratory_id,booking_id:r.booking_id,
      patient_id:r.patient_id,laboratory:r.laboratory,patient_name:r.patient_name,status:r.status,created_at:r.created_at,
      due:r.due,sent_at:r.sent_at,received_at:r.received_at,notes:r.notes,items:[]});
    if(r.item_id)orders.get(r.id).items.push({id:r.item_id,work:r.work,tooth:r.tooth,area:r.area,
      material:r.material,shade:r.shade,quantity:r.quantity,instructions:r.instructions,installed_at:r.installed_at});
  }
  const cases=Array.from(orders.values()).map(r=>({...r,display_status:statusFor(r),
    installed_count:r.items.filter(i=>i.installed_at).length,
    total_items:r.items.length}));
  const labs=Array.from(new Map(cases.map(c=>[c.laboratory_id,{id:c.laboratory_id,name:c.laboratory}])).values())
    .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  const stats={total:cases.length,draft:0,sent:0,received:0,installed:0};
  for(const r of cases)if(Object.prototype.hasOwnProperty.call(stats,r.display_status))stats[r.display_status]++;
  return {cases,labs,stats};
}
async function installLabItem(pool,context,orderId,itemId){
  if(!validId(orderId)||!validId(itemId)||!validId(context.doc)||!validId(context.id)||!validId(context.user))return {status:'invalid'};
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    await db.query("SELECT set_config('sdc.user_id',$1::text,true)",[context.user]);
    // Lock order first: clinic receipt/transfer updates use the same lock.
    const found=await db.query(`SELECT o."Order_Status" AS status,o."Received_At" AS received,
        i."Installed_At" AS installed,(o."Received_At"<=LOCALTIMESTAMP) AS receipt_time_valid
       FROM sdc."LAB_ORDER" o
       JOIN sdc."LAB_ORDER_ITEMS" i ON i."Lab_Order_ID"=o."Lab_Order_ID"
       JOIN sdc."VISIT" v ON v."Visit_ID"=o."Visit_ID"
       JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
      WHERE o."Lab_Order_ID"=$1::bigint AND i."Lab_Item_ID"=$2::bigint
        AND b."Doctor_ID"=$3::bigint AND b."Clinic_ID"=$4::bigint
      FOR UPDATE OF o,i`,[orderId,itemId,context.doc,context.id]);
    if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
    const current=found.rows[0];
    if(current.installed){await db.query('ROLLBACK');return {status:'already_installed'};}
    if(current.status!=='received'||!current.received||!current.receipt_time_valid){await db.query('ROLLBACK');return {status:'not_received'};}
    // Database trigger also verifies installation time >= clinic receipt time.
    const update=await db.query(`UPDATE sdc."LAB_ORDER_ITEMS"
       SET "Installed_At"=LOCALTIMESTAMP
       WHERE "Lab_Item_ID"=$1::bigint AND "Installed_At" IS NULL RETURNING "Lab_Item_ID"`,[itemId]);
    if(!update.rowCount){await db.query('ROLLBACK');return {status:'already_installed'};}
    await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
        VALUES(LOCALTIMESTAMP,'lab.item.installed','Lab_Order_Item',$1,$2,$3::bigint)`,
      [String(itemId),`الطبيب سجّل تركيب عمل مخبري؛ رقم الطلب ${orderId}`,context.user]);
    await db.query('COMMIT');return {status:'ok'};
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
module.exports={labCases,installLabItem,statusFor};

'use strict';
// Transaction-only notification writer; no Express / session dependency.
const ID=/^[1-9]\d{0,17}$/;
const PERMISSIONS={Booking:['appointments.view','appointments.manage'],Invoice:['invoices.view','invoices.issue','payments.record'],Lab_Order:['lab_orders.view','lab_orders.update_delivery']};
const KINDS={Booking:'booking',Invoice:'invoice',Lab_Order:'lab'};
async function emit(db,{clinicId,actorId,type,targetId,title,body}){
 const perm=PERMISSIONS[type],kind=KINDS[type];
 if(!perm||!ID.test(String(clinicId))||!ID.test(String(targetId))||!ID.test(String(actorId)))throw new Error('Invalid staff notification target');
 await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID")
 SELECT DISTINCT $1::varchar(150),$2::text,$3::varchar(150),LOCALTIMESTAMP,$4::varchar(150),$5::varchar(512),s."User_ID"
 FROM sdc."STAFF_AT" s JOIN sdc."STAFF_PERMISSIONS" p ON p."User_ID"=s."User_ID" AND p."Clinic_ID"=s."Clinic_ID"
 JOIN sdc."USER" u ON u."User_ID"=s."User_ID"
 WHERE s."Clinic_ID"=$6::bigint AND s."Membership_Status"='active' AND p."Permission_Code"=ANY($7::varchar[])
 AND u."Account_Status"='active' AND u."Login_Enabled"=TRUE AND s."User_ID"<>$8::bigint`,
 [String(title).slice(0,150),String(body),`staff.${kind}.updated`,type,String(targetId),clinicId,perm,actorId]);
}
module.exports={emit};

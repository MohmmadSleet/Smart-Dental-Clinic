'use strict';
// Super Admin dashboard: real read-only counts. No medical notes, demographics, or fake statistics.
async function load(pool){
 const [users,doctors,appointments,clinics,audits]=await Promise.all([
  pool.query(`SELECT COUNT(*)::integer AS n FROM sdc."USER"`),
  pool.query(`SELECT COUNT(*)::integer AS n FROM sdc."DOCTOR" WHERE "License_Status"='pending'`),
  pool.query(`SELECT COUNT(*)::integer AS n FROM sdc."BOOKING" WHERE "Appointment_Date"=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Hebron')::date`),
  pool.query(`SELECT COUNT(*)::integer AS n FROM sdc."CLINIC" WHERE "Approval_Status"='approved' AND "Clinic_Status"='active'`),
  pool.query(`SELECT "Log_ID"::text AS id,"Action_Type" AS action,"Target_Type" AS target,
    to_char("Occurred_At",'YYYY-MM-DD HH24:MI') AS occurred
    FROM sdc."AUDIT_LOG" WHERE COALESCE("Target_Type",'') !~* '(patient|medical|visit|procedure|report|prescription|health|diagnos)'
    ORDER BY "Occurred_At" DESC,"Log_ID" DESC LIMIT 5`)
 ]);
 const num=(r)=>Number(r.rows[0]?.n||0);
 return {totalUsers:num(users),pendingDoctors:num(doctors),todayAppointments:num(appointments),activeClinics:num(clinics),recentEvents:audits.rows};
}
module.exports={load};

'use strict';
// Aggregated operational/financial metrics only; no clinical or patient details.
const {localDateNow}=require('./finance-automation-service');
const ID=/^[1-9]\d{0,17}$/;
const DAY=86400000;
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const iso=d=>d.toISOString().slice(0,10);
function filter(raw={},today=localDateNow()){
 const period=['today','week','month','year','custom'].includes(raw.period)?raw.period:'month';
 const clinic=ID.test(String(raw.clinic||''))?String(raw.clinic):'';
 const current=new Date(today+'T00:00:00Z');let from=iso(current),to=iso(current);
 if(period==='week'){
  const first=new Date(current);first.setUTCDate(first.getUTCDate()-(first.getUTCDay()+6)%7);from=iso(first);
 } else if(period==='month')from=today.slice(0,7)+'-01';
 else if(period==='year')from=today.slice(0,4)+'-01-01';
 else if(period==='custom'){
  if(!validDate(raw.from)||!validDate(raw.to)||raw.from>raw.to||
    (Date.parse(raw.to)-Date.parse(raw.from))/DAY>366) return null;
  from=raw.from;to=raw.to;
 }
 return {period,clinic,from,to};
}
function n(v){return Number(v||0)}
async function compute(pool,raw={},today=localDateNow()){
 const f=filter(raw,today);if(!f)return null;
 const args=[f.from,f.to,f.clinic||null],bounded=`b."Appointment_Date" BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR b."Clinic_ID"=$3::bigint)`;
 const [clinics,summary,perClinic,services,financeByClinic]=await Promise.all([
  pool.query(`SELECT "Clinic_ID"::text id,"Clinic_Name" name FROM sdc."CLINIC" ORDER BY "Clinic_Name","Clinic_ID"`),
  pool.query(`SELECT count(*)::integer total,
   count(*) FILTER (WHERE b."Booking_Status"='confirmed')::integer confirmed,
   count(*) FILTER (WHERE b."Booking_Status"='completed')::integer completed,
   count(*) FILTER (WHERE b."Booking_Status"='cancelled')::integer cancelled,
   count(*) FILTER (WHERE b."Booking_Status"='no_show')::integer no_show,
   count(DISTINCT b."Patient_ID") FILTER (WHERE u."Created_At"::date BETWEEN $1::date AND $2::date)::integer new_patients
   FROM sdc."BOOKING" b JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
   JOIN sdc."USER" u ON u."User_ID"=p."User_ID" WHERE ${bounded}`,args),
  pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name,count(*)::integer bookings,
   count(*) FILTER (WHERE b."Booking_Status"='completed')::integer completed,
   count(*) FILTER (WHERE b."Booking_Status"='no_show')::integer no_show
   FROM sdc."BOOKING" b JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID"
   WHERE ${bounded} GROUP BY c."Clinic_ID",c."Clinic_Name" ORDER BY bookings DESC,c."Clinic_Name" LIMIT 100`,args),
  pool.query(`SELECT s."Service_Name" name,count(*)::integer bookings FROM sdc."BOOKING" b
   JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID" WHERE ${bounded}
   GROUP BY s."Service_ID",s."Service_Name" ORDER BY bookings DESC,s."Service_Name" LIMIT 8`,args),
  pool.query(`SELECT s."Clinic_ID"::text clinic_id,
   COALESCE(sum(x.due),0)::numeric due,COALESCE(sum(x.received),0)::numeric received
   FROM sdc."SETTLEMENT" s
   LEFT JOIN LATERAL(SELECT COALESCE(sum(bc.commission_amount),0) due
    FROM sdc.booking_commissions bc JOIN sdc."BOOKING" b ON b."Booking_ID"=bc."Booking_ID"
    WHERE bc."Settlement_ID"=s."Settlement_ID" AND bc.eligible IS TRUE
    AND EXISTS(SELECT 1 FROM sdc."VISIT" v JOIN sdc."PROCEDURE" pr ON pr."Visit_ID"=v."Visit_ID"
     WHERE v."Booking_ID"=b."Booking_ID" AND pr."Service_ID"=b."Service_ID" AND pr."Procedure_Status"='completed')) c ON TRUE
   LEFT JOIN LATERAL(SELECT COALESCE(sum(p."Amount"),0) received FROM sdc."RECORDS_SETTLEMENT_PAYMENT" p
    WHERE p."Settlement_ID"=s."Settlement_ID") p ON TRUE
   CROSS JOIN LATERAL (SELECT c.due,p.received) x
   WHERE s."Period_End" BETWEEN $1::date AND $2::date
   AND ($3::bigint IS NULL OR s."Clinic_ID"=$3::bigint)
   GROUP BY s."Clinic_ID"`,args)
 ]);
 const finance=new Map(financeByClinic.rows.map(x=>[x.clinic_id,x]));
 const clinicRows=perClinic.rows.map(r=>({
  ...r,bookings:n(r.bookings),completed:n(r.completed),no_show:n(r.no_show),
  completion_pct:n(r.bookings)?Math.round(n(r.completed)*1000/n(r.bookings))/10:0,
  no_show_pct:n(r.bookings)?Math.round(n(r.no_show)*1000/n(r.bookings))/10:0,
  due:n(finance.get(r.id)?.due),received:n(finance.get(r.id)?.received)
 }));
 const totals=financeByClinic.rows.reduce((a,r)=>({due:a.due+n(r.due),received:a.received+n(r.received)}),{due:0,received:0});
 const stats=summary.rows[0]||{};
 const funnel=[{label:'جميع الحجوزات',count:n(stats.total)},
  {label:'مؤكدة',count:n(stats.confirmed)},{label:'مكتملة',count:n(stats.completed)},
  {label:'ملغاة',count:n(stats.cancelled)},{label:'لم يحضر',count:n(stats.no_show)}];
 return {reportFilters:f,reportClinics:clinics.rows,reportStats:{...stats,total:n(stats.total),new_patients:n(stats.new_patients),no_show:n(stats.no_show)},
  reportFunnel:funnel,reportClinicRows:clinicRows,reportServices:services.rows.map(r=>({...r,bookings:n(r.bookings)})),
  reportMoney:{...totals,remaining:Math.max(0,totals.due-totals.received)}};
}
function csvCell(x){let s=String(x??'').replace(/[\r\n]/g,' ');if(/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function csv(data){
 const rows=[['العيادة','الحجوزات','المكتملة','لم يحضر','العمولة المستحقة (₪)','المستلم (₪)'],
  ...data.reportClinicRows.map(x=>[x.name,x.bookings,x.completed,x.no_show,x.due,x.received])];
 return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
module.exports={validDate,filter,compute,csv};

'use strict';
// Super Admin clinic-scoped actions.  No session/role impersonation: the
// real admin identity is used by the existing domain services and audit log.
const express=require('express');
const {validateCsrf}=require('../security/csrf');
const staffService=require('../clinic/staff/service');
const doctorService=require('../clinic/doctors/service');
const bookingService=require('../appointments/service');
const ID=/^[1-9]\d{0,17}$/;
const allowedBookingActions=new Set(['confirm','reject','cancel','move','approve_change','reject_change']);
const safeReason=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=1000;
function attach(router,{getPool,adminPageLocals}){
 const BODY=express.urlencoded({extended:false,limit:'24kb',parameterLimit:70});
 const base=(id,tab='staff')=>`/admin/clinic-details?id=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}`;
 const errorStatus=e=>['23503','23514','23505','23P01'].includes(e.code)?'conflict':'failed';
 async function clinicById(id){if(!ID.test(String(id)))return null;const r=await getPool().query(`SELECT "Clinic_ID"::text id,"Clinic_Name" name,"Clinic_Status" status,"Approval_Status" approval,"Manager_Doctor_ID"::text manager FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint`,[id]);return r.rows[0]||null;}
 async function redirectOperation(req,res,perform){
   const clinic=await clinicById(req.params.id);if(!clinic)return res.sendStatus(404);
   if(!validateCsrf(req,'admin'))return res.status(403).send('انتهت صلاحية النموذج، حدّث الصفحة.');
   const tab=req.path.includes('/staff')?'staff':req.path.includes('/doctors/')?'doctors':req.path.includes('/services/')?'services':req.path.includes('/inventory/')?'inventory':req.path.includes('/patients/')?'patients':req.path.includes('/labs/')?'labs':'appointments';
   if(!safeReason(req.body?.reason))return res.redirect(303,`${base(clinic.id,tab)}&result=invalid`);
   try{
    const out=await perform(clinic);
    if(out.status==='forbidden'||out.status==='unauthorized')return res.sendStatus(403);
    if(out.status==='not_found')return res.sendStatus(404);
    if(req.body?.return_to==='appointment'&&tab==='appointments'&&ID.test(String(req.body.booking_id||''))){
      if(out.status==='ok'&&req.path.endsWith('/bookings/delete'))return res.redirect(303,'/admin/appointments?result=deleted');
      return res.redirect(303,`/admin/appointment-details?id=${req.body.booking_id}&result=${encodeURIComponent(out.status)}`);
    }
    const selected=tab==='doctors'&&ID.test(String(req.body.doctor_id||''))?'&doctor_id='+req.body.doctor_id:tab==='labs'&&ID.test(String(req.params.lab||''))?'&lab_id='+req.params.lab:'';
    return res.redirect(303,`${base(clinic.id,tab)}&result=${encodeURIComponent(out.status)}${selected}`);
   }catch(e){console.error('[ADMIN_CLINIC_CONTROL_FAILED]',e.code||'UNKNOWN',e.constraint||'');return res.redirect(303,`${base(clinic.id,tab)}&result=${errorStatus(e)}`);}
 }
 // An old bookmark must no longer render a second administration page.
 router.get('/clinics/:id/manage',(req,res)=>{
   if(!ID.test(String(req.params.id)))return res.sendStatus(404);
   const q=new URLSearchParams({id:String(req.params.id),tab:'profile'});
   for(const key of ['doctor_id','service_id','appointment_date'])if(typeof req.query[key]==='string')q.set(key,req.query[key]);
   return res.redirect(303,`/admin/clinic-details?${q.toString()}`);
 });
 router.post('/clinics/:id/staff',BODY,(req,res)=>req.body?.action==='create'?res.status(403).send('إنشاء الموظفين من مسؤوليات العيادة.'):redirectOperation(req,res,c=>staffService.save(getPool(),c.id,req.adminUserId,req.body,{adminOverride:true,reason:req.body.reason})));
 router.post('/clinics/:id/doctors/invite',BODY,(req,res)=>redirectOperation(req,res,c=>doctorService.invitation(getPool(),c.id,c.manager,req.adminUserId,req.body,{adminOverride:true,reason:req.body.reason})));
 router.post('/clinics/:id/doctors/membership',BODY,(req,res)=>redirectOperation(req,res,c=>doctorService.manage(getPool(),c.id,c.manager,req.adminUserId,req.body.doctor_id,req.body.action,{adminOverride:true,reason:req.body.reason})));
 router.post('/clinics/:id/bookings/delete',BODY,(req,res)=>redirectOperation(req,res,c=>bookingService.adminDeletePending(getPool(),{clinicId:c.id,bookingId:req.body.booking_id,adminId:req.adminUserId,reason:req.body.reason})));
 // Additional role workflows share the existing clinic detail page; no duplicate public UI.
 router.post('/clinics/:id/bookings/action',BODY,(req,res)=>redirectOperation(req,res,c=>{
  if(!allowedBookingActions.has(String(req.body.action)))return {status:'invalid'};
  return bookingService.action(getPool(),{...req.sdcActor,role:'admin'},c.id,req.body);
 }));
}
async function loadClinicTab(pool,clinic,tab,search={}){
 const staffService=require('../clinic/staff/service');
 const doctorService=require('../clinic/doctors/service');
 const bookingService=require('../appointments/service');
 const clinicClinical=require('../clinic/clinical-service');
   const common={clinic:{id:String(clinic.Clinic_ID),name:clinic.Clinic_Name,status:clinic.Clinic_Status,approval:clinic.Approval_Status,manager:String(clinic.Manager_Doctor_ID||'')},
   staffRoles:staffService.ROLES,staffPermissions:staffService.PERMISSIONS};
 if(tab==='staff')return {...common,staff:await staffService.list(pool,common.clinic.id)};
 if(tab==='doctors'){
   const [active,candidates]=await Promise.all([
     pool.query(`SELECT w."Doctor_ID"::text id,w."Membership_Status" status,concat_ws(' ',u."First_Name",u."Last_Name") name, w."Doctor_ID"=c."Manager_Doctor_ID" manager
      FROM sdc."WORKS_AT" w JOIN sdc."DOCTOR" d ON d."Doctor_ID"=w."Doctor_ID" JOIN sdc."USER" u ON u."User_ID"=d."User_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=w."Clinic_ID"
      WHERE w."Clinic_ID"=$1::bigint ORDER BY w."Membership_Status",name LIMIT 200`,[common.clinic.id]),
     doctorService.candidates(pool,common.clinic.id)
   ]);
   return {...common,doctors:active.rows,candidates};
 }
 if(tab==='appointments'){
   const [bookings,recalls]=await Promise.all([
     bookingService.clinicList(pool,common.clinic.id),clinicClinical.listRecalls(pool,common.clinic.id,new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Hebron'}).format(new Date()))
   ]);
   return {...common,bookings:bookings.slice(0,60),recalls};
 }
 return common;
}
module.exports={attach,loadClinicTab,safeReason,allowedBookingActions};

'use strict';
const express=require('express');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {getPool}=require('../../db/pool');
const {documentPath,docType}=require('../clinic/onboarding/service');
const router=express.Router();
const NUM=/^[1-9]\d{0,17}$/;
const PHOTO_ROOT=path.resolve(process.env.SDC_DOCTOR_PHOTOS_DIR||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.smart-dental-clinic'),'SmartDentalClinic','doctor-photos'));
function doctorPhotoPath(id){return NUM.test(String(id||''))?path.join(PHOTO_ROOT,`doctor-${id}.img`):null;}
const placeholder=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="18" fill="#eaf2f6"/><circle cx="64" cy="45" r="23" fill="#90b0c4"/><path d="M22 121c2-29 17-46 42-46s40 17 42 46" fill="#90b0c4"/></svg>`);
function defaultDoctor(res){res.set({'Content-Type':'image/svg+xml; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=120','Content-Security-Policy':"default-src 'none'; sandbox"});return res.send(placeholder);}
router.get('/clinics/:id/:kind',async(req,res,next)=>{
 const id=req.params.id,kind=req.params.kind;
 if(!NUM.test(id)||!['logo','cover'].includes(kind))return res.sendStatus(404);
 try{
  const r=await getPool().query(`SELECT doc."File_Reference" AS ref FROM sdc."CLINIC" c JOIN sdc."CLINIC_DOCUMENTS" doc ON doc."Clinic_ID"=c."Clinic_ID" WHERE c."Clinic_ID"=$1::bigint AND c."Approval_Status"='approved' AND c."Clinic_Status"='active' AND doc."Document_Type"=$2 AND doc."Is_Current"=true AND doc."Review_Status" IN ('approved','uploaded') LIMIT 1`,[id,'clinic_'+kind]);
  if(!r.rowCount)return res.sendStatus(404);
  const file=documentPath(r.rows[0].ref);if(!file||!/(\.png|\.jpg)$/i.test(file))return res.sendStatus(404);
  const bytes=await fs.readFile(file).catch(()=>null),kindFromBytes=bytes&&docType(bytes);
  if(!kindFromBytes||!['.png','.jpg'].includes(kindFromBytes.extension))return res.sendStatus(404);
  res.set({'Content-Type':kindFromBytes.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=120','Content-Disposition':'inline'});
  return res.send(bytes);
 }catch(e){next(e);}
});
router.get('/doctors/:id/photo',async(req,res,next)=>{
 const id=req.params.id;if(!NUM.test(id))return res.sendStatus(404);
 try{
  const publicProfile=await getPool().query(`SELECT 1 FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID" WHERE d."Doctor_ID"=$1::bigint AND ((d."License_Status"='verified' AND u."Account_Status"='active' AND u."Login_Enabled" AND EXISTS(SELECT 1 FROM sdc."WORKS_AT" w JOIN sdc."CLINIC" c ON c."Clinic_ID"=w."Clinic_ID" WHERE w."Doctor_ID"=d."Doctor_ID" AND w."Membership_Status"='active' AND c."Clinic_Status"='active' AND c."Approval_Status"='approved')) OR d."User_ID"=$2::bigint) LIMIT 1`,[id,require('../auth/session').getSession(req)?.userId||null]);
  if(!publicProfile.rowCount)return defaultDoctor(res);
  const bytes=await fs.readFile(doctorPhotoPath(id)).catch(()=>null),kind=bytes&&docType(bytes);
  if(!kind||!['.png','.jpg'].includes(kind.extension))return defaultDoctor(res);
  res.set({'Content-Type':kind.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=120','Content-Disposition':'inline'});return res.send(bytes);
 }catch(e){next(e);}
});
module.exports={router,doctorPhotoPath,PHOTO_ROOT};

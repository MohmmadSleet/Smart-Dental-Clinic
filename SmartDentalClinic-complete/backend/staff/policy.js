'use strict';
// Single allowlist used for server rendering and request authorization.
// Never infer authority from HTML attributes or client-side JavaScript.
const VIEW_PERMISSIONS=Object.freeze({
 '/appointments':'appointments.view',
 '/patients':'patients.page',
 '/invoices':'invoices.view',
 '/lab-cases':'lab_orders.view',
 '/lab-details':'lab_orders.view',
 '/workspace/patient':'patients.create',
 '/workspace/payment':'payments.record',
 '/workspace/invoice-draft':'invoices.issue',
 '/workspace/invoice-issue':'invoices.issue',
 '/workspace/lab-action':'lab_orders.update_delivery',
 '/workspace/profile':null,
 '/workspace/appointment':'appointments.manage',
 '/workspace/booking-action':'appointments.manage'
});
const SAFE_ACCOUNT_PAGES=new Set(['/index','/profile','/choose-clinic']);
function parsePermissions(value){
 return new Set(Array.isArray(value)?value.filter(Boolean):String(value||'').split(/\s+/).filter(Boolean));
}
const READ_FROM_ACTION=Object.freeze({
 'appointments.view':['appointments.manage'],
 'invoices.view':['invoices.issue','payments.record'],
 'lab_orders.view':['lab_orders.update_delivery']
});
function can(value,permission){
 const grants=parsePermissions(value);
 // Every write permission includes the minimum read access needed to perform it.
 // No such implication applies to the sensitive patient directory.
 if((READ_FROM_ACTION[permission]||[]).some(p=>grants.has(p)))return true;
 // Transitional legacy grants can view only the new redacted patient directory.
 if(permission==='patients.view_directory')return grants.has(permission)||grants.has('patients.view_admin');
 if(permission==='patients.page')return grants.has('patients.create')||grants.has('patients.view_directory')||grants.has('patients.view_admin');
 return grants.has(permission);
}
function accessFor(method,path){
 const verb=String(method||'').toUpperCase();
 if(verb==='GET'||verb==='HEAD'){
  if(SAFE_ACCOUNT_PAGES.has(path))return {publicWithinStaff:true};
  if(Object.prototype.hasOwnProperty.call(VIEW_PERMISSIONS,path))return {permission:VIEW_PERMISSIONS[path]};
  return {deny:true};
 }
 // This existing endpoint also checks appointments.manage and CSRF internally.
 if(verb==='POST'&&path.startsWith('/workspace/')&&Object.prototype.hasOwnProperty.call(VIEW_PERMISSIONS,path))return VIEW_PERMISSIONS[path]?{permission:VIEW_PERMISSIONS[path]}:{publicWithinStaff:true};
 if(verb==='POST'&&(path==='/notifications/read-all'||/^\/notifications\/[1-9]\d{0,17}\/(?:read|open|delete)$/.test(path)))return {publicWithinStaff:true};
 if(verb==='POST'&&path==='/operations/action')return {permission:'appointments.manage'};
 return {deny:true};
}
module.exports={VIEW_PERMISSIONS,READ_FROM_ACTION,parsePermissions,can,accessFor};

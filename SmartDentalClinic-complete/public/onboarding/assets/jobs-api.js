'use strict';
// Adapter for the existing same-origin application preview; the server owns all validation and persistence.
window.SDC_JOB_API={submitApplication:async form=>{
 const id=String(form.get('job_id')||'');if(!/^[1-9]\d{0,17}$/.test(id))throw Error('invalid job');
 const response=await fetch('/onboarding/doctor/jobs/'+id+'/apply',{
  method:'POST',body:form,credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest','Accept':'application/json'}
 });
 if(!response.ok)throw Error(await response.text());return response.json();
}};

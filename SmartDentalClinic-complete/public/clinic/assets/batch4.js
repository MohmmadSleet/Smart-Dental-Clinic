/* v24: DOM interactions only; real records/ids come exclusively from EJS. */
(()=>{'use strict';
 const run=()=>{
  const q=(s,p=document)=>p.querySelector(s),qa=(s,p=document)=>[...p.querySelectorAll(s)];
  // Search and status selectors must be applied together to the same SSR records.
  // No data is manufactured or persisted by these browser-only filters.
  const filterLabs=()=>{
   const text=(q('#labSearch')?.value||'').trim().toLocaleLowerCase();
   const status=q('[data-lab-filter].active')?.dataset.labFilter||'active';
   let count=0;
   qa('[data-lab-card]').forEach(n=>{
    const match=(status==='all'||n.dataset.status===status)&&(!text||n.textContent.toLocaleLowerCase().includes(text));
    n.hidden=!match;
    if(match)count++;
   });
   q('#labsEmpty')?.classList.toggle('d-none',count>0);
  };
  if(q('#labsGrid')){
   const buttons=qa('[data-lab-filter]');
   const setStatus=(status)=>{
    buttons.forEach(b=>{
     const active=b.dataset.labFilter===status;
     b.classList.toggle('active',active);
     b.classList.toggle('btn-primary',active);
     b.classList.toggle('btn-light',!active);
    });
    filterLabs();
   };
   buttons.forEach(b=>b.addEventListener('click',()=>setStatus(b.dataset.labFilter)));
   q('#labSearch')?.addEventListener('input',filterLabs);
   setStatus('active');
  }
  const filterJobs=()=>{
   const text=(q('#jobSearch')?.value||'').trim().toLocaleLowerCase();
   const status=q('#jobStatus')?.value||'all';
   qa('.job-item').forEach(n=>{
    n.hidden=!(status==='all'||n.dataset.status===status)||(!!text&&!n.textContent.toLocaleLowerCase().includes(text));
   });
  };
  ['input','change'].forEach(event=>q('#jobSearch')?.addEventListener(event,filterJobs));
  q('#jobStatus')?.addEventListener('change',filterJobs);
  filterJobs();
  const filterCases=()=>{
   const text=(q('#labCaseSearch')?.value||'').trim().toLocaleLowerCase();
   const status=q('#labCaseStatus')?.value||'all';
   const doctor=q('#labCaseDoctor')?.value||'all';
   let visible=0;
   qa('[data-lab-case]').forEach(n=>{
    const match=(status==='all'||n.dataset.status===status)&&(doctor==='all'||n.dataset.doctor===doctor)&&(!text||n.textContent.toLocaleLowerCase().includes(text));
    n.hidden=!match;
    if(match)visible++;
   });
   q('#labCasesEmpty')?.classList.toggle('d-none',visible>0);
  };
  q('#labCaseSearch')?.addEventListener('input',filterCases);
  q('#labCaseStatus')?.addEventListener('change',filterCases);
  q('#labCaseDoctor')?.addEventListener('change',filterCases);
  filterCases();
  const filterApplicants=()=>{
   const text=(q('#applicantSearch')?.value||'').trim().toLocaleLowerCase();
   const status=q('#applicantStatusFilter')?.value||'all';
   qa('.applicant-row').forEach(n=>{
    n.hidden=!(status==='all'||n.dataset.status===status)||(!!text&&!n.textContent.toLocaleLowerCase().includes(text));
   });
  };
  q('#applicantSearch')?.addEventListener('input',filterApplicants);
  q('#applicantStatusFilter')?.addEventListener('change',filterApplicants);
  filterApplicants();
  // The server also validates this. Prevent a missing rejection reason from
  // navigating away to a generic 422 page, and explain the required field inline.
  qa('form[action^="/clinic/job-applicants/"], form[action^="/clinic/application-details/"]').forEach(form=>{
   form.addEventListener('submit',event=>{
    const status=qa('select[name="status"]').find(select=>select.form===form);
    const feedback=qa('input[name="feedback"], textarea[name="feedback"]').find(input=>input.form===form);
    if(!status||!feedback)return;
    const bad=status.value==='rejected'&&feedback.value.trim().length<3;
    const error=feedback.parentElement?.querySelector('[data-job-rejection-error]')||q('[data-job-rejection-error]');
    if(error)error.classList.toggle('d-none',!bad);
    feedback.classList.toggle('is-invalid',bad);
    if(bad){event.preventDefault();feedback.focus();}
   });
  });
  const f=q('#backend-form-2'),jobModal=q('#jobModal');
  function resetJob(){if(!jobModal||!f)return;qa('[form="backend-form-2"]',jobModal).forEach(n=>{if(n.matches('input,textarea'))n.value='';if(n.matches('select'))n.selectedIndex=0;});f.elements.job_id.value='';q('#clinicJobModalTitle').textContent='إضافة وظيفة';}
  q('[data-job-new]')?.addEventListener('click',resetJob);
  qa('[data-job-edit]').forEach(b=>b.addEventListener('click',()=>{
   const n=b.closest('.job-item');if(!n||!f)return;resetJob();f.elements.job_id.value=n.dataset.jobCode;
   const values={clinicJobTitle:n.dataset.jobTitle,clinicJobSpecialty:n.dataset.jobSpecialty,clinicJobType:n.dataset.jobType,clinicJobExperience:n.dataset.jobExperience,clinicJobDeadline:n.dataset.jobDeadline,clinicJobHours:n.dataset.jobHours,clinicJobSalary:n.dataset.jobSalary};
   for(const [id,v] of Object.entries(values)){const c=q('#'+id);if(c)c.value=v||'';}
   const records=q('[data-job-html-record]',n),copy=(id,selector)=>{const element=q(id);if(element)element.value=q(selector,records)?.textContent.trim()||'';};
   copy('#clinicJobDescription','[data-job-description]');copy('#clinicJobResponsibilities','[data-job-responsibilities]');copy('#clinicJobRequirements','[data-job-requirements]');q('#clinicJobModalTitle').textContent='تعديل وظيفة';
  }));
  qa('[data-job-archive]').forEach(b=>b.addEventListener('click',()=>{const f=q('#archiveJobForm');if(f)f.action='/clinic/jobs/'+encodeURIComponent(b.dataset.jobArchive)+'/archive';}));
  qa('[data-lab-transfer]').forEach(b=>b.addEventListener('click',()=>{const f=q('#backend-form-2');if(f)f.action=f.action.replace(/\/case\/\d+(?:\?.*)?$/,'/case/'+encodeURIComponent(b.dataset.labTransfer));q('#transferLabCaseLabel').textContent='نقل الحالة LC-'+b.dataset.labTransfer+' إلى مختبر نشط';}));
  const reportPeriod=q('#clinicReportPeriod'),dates=q('#clinicCustomReportDates');const showDates=()=>dates?.classList.toggle('d-none',reportPeriod?.value!=='custom');reportPeriod?.addEventListener('change',()=>{showDates();if(reportPeriod.value!=='custom'){q('#backend-form-1')?.requestSubmit();}});showDates();
  q('#applyClinicCustomReport')?.addEventListener('click',()=>q('#backend-form-1')?.requestSubmit());
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();

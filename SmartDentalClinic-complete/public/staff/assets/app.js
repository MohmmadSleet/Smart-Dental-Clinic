/* Smart Dental Clinic: staff UI interactions only. All data, permissions,
   clinic changes, and form writes are server-owned. */
(() => {
 'use strict';
 const init=()=>{
  const top=document.querySelector('.ux-top');
  top?.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  const updateTop=()=>top?.classList.toggle('show',window.scrollY>500);
  window.addEventListener('scroll',updateTop,{passive:true});updateTop();
  // Select a different clinic using authenticated server workflow.
  const selector=document.querySelector('#activeClinicContext');
  selector?.addEventListener('change',()=>window.location.assign('/staff/choose-clinic'));

  // Local presentation-only pagination. Server still owns records and permissions.
  const table=document.querySelector('[data-staff-paginated]');
  const pager=document.querySelector('[data-staff-pagination]');
  if(table&&pager){
   const rows=Array.from(table.querySelectorAll('tbody tr[data-staff-record]'));
   const pageSize=Math.max(1,Number(table.dataset.staffPaginated)||10);
   const totalPages=Math.max(1,Math.ceil(rows.length/pageSize));
   let active=1;
   const button=(label,page,{selected=false,disabled=false}={})=>{
    const el=document.createElement('button');
    el.type='button';el.className='btn btn-sm';el.textContent=label;
    if(selected){el.setAttribute('aria-current','page');}
    el.disabled=disabled;
    if(!disabled)el.addEventListener('click',()=>{active=page;render();table.scrollIntoView({block:'start',behavior:'smooth'});});
    return el;
   };
   function render(){
    rows.forEach((row,i)=>{row.hidden=i<(active-1)*pageSize||i>=active*pageSize;});
    pager.replaceChildren();
    if(totalPages<2){pager.hidden=true;return;}
    pager.hidden=false;
    const status=document.createElement('small');status.className='text-secondary';
    status.textContent=`عرض ${(active-1)*pageSize+1}–${Math.min(active*pageSize,rows.length)} من ${rows.length} موعدًا`;
    const buttons=document.createElement('div');buttons.className='staff-pagination-buttons';
    buttons.append(button('السابق',active-1,{disabled:active===1}));
    for(let p=1;p<=totalPages;p++){
      if(totalPages>7&&p!==1&&p!==totalPages&&Math.abs(p-active)>1)continue;
      buttons.append(button(String(p),p,{selected:p===active}));
    }
    buttons.append(button('التالي',active+1,{disabled:active===totalPages}));
    pager.append(status,buttons);
   }
   render();
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();

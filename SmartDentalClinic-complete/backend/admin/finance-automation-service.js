'use strict';
// Finance policy is stored in PostgreSQL. Periods close in the clinic's local
// calendar (Asia/Hebron); the running Express server retries the latest closed
// period at startup and hourly. No background service runs while it is offline.
const commission=require('../clinic/commission-service');
const ID=/^[1-9]\d{0,17}$/;
const RATES=/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/;
const FREQUENCIES=new Set(['monthly','weekly']);
const DUE=new Set([7,14,30]);
function validateSettings(body){
 const rate=String(body?.rate??'').trim(),frequency=String(body?.frequency??'');
 const dueDays=Number(body?.due_days);
 if(!RATES.test(rate)||Number(rate)<=0||Number(rate)>100||!FREQUENCIES.has(frequency)||!DUE.has(dueDays)||
    !/^\d+$/.test(String(body?.due_days??'')))return null;
 return {rate,frequency,dueDays};
}
async function settings(pool){
 const r=await pool.query(`SELECT commission_rate::text rate,frequency,due_days due_days,
 to_char(effective_on,'YYYY-MM-DD') effective_on,to_char(updated_at,'YYYY-MM-DD HH24:MI') updated_at
 FROM sdc.platform_finance_settings WHERE settings_id=1`);
 if(!r.rowCount)throw Error('Finance migration 008 is missing configuration row');
 return r.rows[0];
}
async function save(pool,actor,body){
 const form=validateSettings(body);
 if(!form||!ID.test(String(actor||'')))return {status:'invalid'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('sdc.user_id',$1,true)",[String(actor)]);
  const auth=await client.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[String(actor)]);
  if(auth.rows[0]?.allowed!==true){await client.query('ROLLBACK');return {status:'forbidden'};}
  await client.query(`UPDATE sdc.platform_finance_settings
   SET commission_rate=$1::numeric,frequency=$2,due_days=$3::smallint,
       effective_on=(now() AT TIME ZONE 'Asia/Hebron')::date,updated_at=LOCALTIMESTAMP,updated_by=$4::bigint
   WHERE settings_id=1`,[form.rate,form.frequency,form.dueDays,String(actor)]);
  await client.query(`INSERT INTO sdc."AUDIT_LOG"
    ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
    VALUES(LOCALTIMESTAMP,'platform.finance.settings.updated','Platform','finance-settings',$1,$2::bigint)`,
    [`تعديل عمولة المنصة إلى ${form.rate}%، دورية ${form.frequency}، مهلة ${form.dueDays} يومًا`,String(actor)]);
  await client.query('COMMIT');return {status:'ok'};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
// Accept a deterministic date for tests. Monday is the first day of the week.
function lastClosedPeriod(localDate,frequency){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(localDate)||!FREQUENCIES.has(frequency))return null;
 const today=new Date(localDate+'T00:00:00Z');if(!Number.isFinite(today.getTime())||iso(today)!==localDate)return null;
 if(frequency==='monthly'){
  const first=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1));
  const end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),0));
  return {start:iso(first),end:iso(end)};
 }
 const weekday=(today.getUTCDay()+6)%7; // 0=Monday
 const end=new Date(today);end.setUTCDate(today.getUTCDate()-weekday-1);
 const start=new Date(end);start.setUTCDate(end.getUTCDate()-6);
 return {start:iso(start),end:iso(end)};
}
function localDateNow(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hebron',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${obj.year}-${obj.month}-${obj.day}`;
}
let running=false;
async function run(pool,{date=localDateNow()}={}){
 if(running)return {status:'busy'};
 running=true;
 try{
  const cfg=await settings(pool);
  const period=lastClosedPeriod(date,cfg.frequency);
  if(!period||period.end<cfg.effective_on)return {status:'not_due',period};
  const active=await pool.query(`SELECT c."Clinic_ID"::text id FROM sdc."CLINIC" c
    WHERE c."Approval_Status"='approved' AND c."Clinic_Status"='active' ORDER BY c."Clinic_ID"`);
  const admins=await pool.query(`SELECT u."User_ID"::text id FROM sdc."USER" u JOIN sdc."ROLE" r ON r."Role_ID"=u."Role_ID"
   WHERE r."Role_Scope"='System' AND r."Role_Name"='Super Admin' AND u."Account_Status"='active' AND u."Login_Enabled"=TRUE
   ORDER BY u."User_ID" LIMIT 1`);
  if(!admins.rows.length)return {status:'no_admin'};
  const actor=admins.rows[0].id;
  const outcomes={created:0,skipped:0,empty:0,errors:0,period};
  for(const clinic of active.rows){
   try{
    const result=await commission.createSettlement(pool,{
     actor,clinic:clinic.id,start:period.start,end:period.end,rate:cfg.rate,dueDays:cfg.due_days});
    if(result.status==='ok')outcomes.created++;
    else if(result.status==='overlap'||result.status==='no_clinic')outcomes.skipped++;
    else if(result.status==='empty')outcomes.empty++;
    else {outcomes.errors++;console.error('[AUTO_SETTLEMENT_CLINIC]',clinic.id,result.status);}
   }catch(e){outcomes.errors++;console.error('[AUTO_SETTLEMENT_CLINIC]',clinic.id,e.code||e.message);}
  }
  return {status:outcomes.errors?'partial':'ok',...outcomes};
 }finally{running=false;}
}
function start(pool,logger=console){
 const tick=()=>run(pool).then(r=>logger.info('[AUTO_SETTLEMENT]',r.status,r.created??0,r.period?.end||''))
  .catch(e=>logger.error('[AUTO_SETTLEMENT_FAILED]',e.code||e.message,'Apply db/migrations/008_platform_finance_automation.sql'));
 // Startup catch-up and hourly retries; absent SQL migration is logged clearly.
 void tick();const timer=setInterval(tick,60*60*1000);timer.unref?.();return timer;
}
module.exports={validateSettings,settings,save,lastClosedPeriod,localDateNow,run,start};

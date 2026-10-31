'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const ai=require('../backend/patient/workspace/ai-engine');
const triage=require('../backend/patient/workspace/triage');
const booking=require('../backend/appointments/service');
function addDays(date,d){return new Date(Date.parse(date+'T12:00:00Z')+d*86400000).toISOString().slice(0,10);}
const catalog=[
 {clinic_id:'1',clinic_name:'Nearby',doctor_id:'11',service_id:'101',service_name:'Dental exam',duration:30,price:'100'},
 {clinic_id:'2',clinic_name:'Farther',doctor_id:'22',service_id:'101',service_name:'Dental exam',duration:30,price:'100'}];
const meta={byDoctor:new Map([['11',new Set(['9'])],['22',new Set(['9'])]]),clinics:new Map([['1',{id:'1',lat:'32.2',lng:'35.2'}],['2',{id:'2',lat:'32.4',lng:'35.4'}]])};
async function testChoice(risk,slots){
 const oldTime=booking.localNow,oldAvailability=booking.availability;
 booking.localNow=()=>({date:'2026-11-01',time:'10:00'});
 booking.availability=async(_db,choice,date)=>({slots:slots(choice.clinic_id,date),reason:'available'});
 try{return await triage.suggest({},'8',catalog,{risk,scope:'dental',service_ids:['101'],specialty_ids:['9'],locale:'en'},meta,{lat:32.2,lng:35.2});}
 finally{booking.localNow=oldTime;booking.availability=oldAvailability;}
}
test('urgent must reject a 25-hour slot and prefer the earliest valid one even if farther',async()=>{
 const found=await testChoice('high',(clinic,date)=>clinic==='1'&&date==='2026-11-02'?['11:30']:clinic==='2'&&date==='2026-11-01'?['15:00']:[]);
 assert.equal(found.length,1);assert.equal(found[0].clinic_id,'2');assert.equal(found[0].time,'15:00');
 assert.match(found[0].reason,/24 hours/);
});
test('high urgency never silently falls back to a two-day wait',async()=>{
 const found=await testChoice('high',(_clinic,date)=>date==='2026-11-03'?['08:00']:[]);
 assert.equal(found.length,0);
});
test('medium prefers substantially earlier real slot to nearer clinic',async()=>{
 const found=await testChoice('medium',(clinic,date)=>clinic==='1'&&date==='2026-11-06'?['10:00']:clinic==='2'&&date==='2026-11-02'?['09:00']:[]);
 assert.equal(found[0].clinic_id,'2');
});
test('medium stays within 7 days, low allows a routine slot in 30 days',async()=>{
 assert.equal(triage.riskWindow('high'),1440);
 assert.equal(triage.isWithinRiskWindow('medium',{date:'2026-11-01',time:'10:00'},'2026-11-08','10:00'),true);
 assert.equal(triage.isWithinRiskWindow('medium',{date:'2026-11-01',time:'10:00'},'2026-11-08','10:30'),false);
 assert.equal(triage.isWithinRiskWindow('low',{date:'2026-11-01',time:'10:00'},'2026-11-29','10:00'),true);
});
test('emergency never suggests online booking and avulsed adult tooth requires immediate dental service',async()=>{
 const found=await testChoice('emergency',()=>['11:00']);assert.equal(found.length,0);
 const result=await ai.evaluate('انخلع سن دائم من فمي بالكامل',{services:[],specialties:[],locale:'ar'});
 assert.equal(result.risk,'high');assert.equal(result.timeCritical,true);
 assert.match(result.advice,/فور/);
});
test('booking acceptance rechecks urgency window inside the existing transaction',()=>{
 const fs=require('node:fs');const src=fs.readFileSync(require.resolve('../backend/appointments/service'),'utf8');
 assert.match(src,/isWithinRiskWindow\(risk,localNow\(\),date,time\)/);
 assert.match(src,/FOR UPDATE OF a/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ai=require('../backend/patient/workspace/ai-engine');
const triage=require('../backend/patient/workspace/triage');
const catalog=[
 {clinic_id:'1',clinic_name:'عيادة أ',doctor_id:'11',doctor_name:'طبيب أ',service_id:'101',service_name:'فحص الأسنان',price:'100',duration:30},
 {clinic_id:'2',clinic_name:'عيادة ب',doctor_id:'12',doctor_name:'طبيب ب',service_id:'101',service_name:'فحص الأسنان',price:'100',duration:30},
 {clinic_id:'3',clinic_name:'عيادة ج',doctor_id:'13',doctor_name:'طبيب ج',service_id:'102',service_name:'تنظيف الأسنان',price:'100',duration:30},
 ];
function poolStub(){
 const writes=[];let counter=100;
 function query(sql,args=[]){
  if(sql.includes('FROM sdc."PATIENT"'))return Promise.resolve({rowCount:1,rows:[{id:'9'}]});
  if(sql.includes('FROM sdc."PROVIDES"'))return Promise.resolve({rows:catalog});
  if(sql.includes('FROM sdc."SPECIALTY"'))return Promise.resolve({rows:[{id:'20',ar:'طب الأسنان العام',en:'General Dentistry'}]});
  if(sql.includes('FROM sdc."HAS_SPECIALTY"'))return Promise.resolve({rows:catalog.map(c=>({doctor_id:c.doctor_id,specialty_id:'20'}))});
  if(sql.includes('FROM sdc."CLINIC"')&&sql.includes('"Latitude"'))return Promise.resolve({rows:[{id:'1',lat:'32.200',lng:'35.200',city:'جنين'},{id:'2',lat:'32.250',lng:'35.250',city:'نابلس'},{id:'3',lat:'32.300',lng:'35.300',city:'رام الله'}]});
  if(sql.includes('FROM sdc."WORKS_AT"'))return Promise.resolve({rows:[{}],rowCount:1});
  if(sql.includes('FROM sdc."DOCTOR_WORKING_HOURS"'))return Promise.resolve({rows:[{start:'08:00',end:'18:00'}],rowCount:1});
  if(sql.includes('FROM sdc."CLINIC_WORKING_EXCEPTIONS"'))return Promise.resolve({rows:[],rowCount:0});
  if(sql.includes('FROM sdc."DOCTOR_ABSENCES"')||sql.includes('FROM sdc."BOOKING"'))return Promise.resolve({rows:[],rowCount:0});
  if(sql.includes('FROM sdc."CLINIC_WORKING_HOURS"'))return Promise.resolve({rows:[{start:'08:00',end:'18:00'}],rowCount:1});
  if(sql.includes('INSERT INTO')){writes.push({sql,args});if(sql.includes('"AI_ASSESSMENT"'))return Promise.resolve({rows:[{id:String(++counter)}],rowCount:1});return Promise.resolve({rows:[],rowCount:1});}
  return Promise.resolve({rows:[],rowCount:1});
 }
 return {query,connect:async()=>({query,release(){}}),writes};
}
function body(symptoms,extra={}){return {symptoms,ai_consent:'1',...extra};}
test('emergency breathing is immediate and never creates appointment recommendation',async()=>{
 process.env.SDC_AI_MODE='mock';const db=poolStub();
 const r=await triage.create(db,'1',body('عندي ألم في ضرسي وصعوبة في البلع'));
 assert.equal(r.status,'ok');const record=db.writes.find(w=>w.sql.includes('"AI_ASSESSMENT"'));
 assert.equal(record.args[2],'emergency');assert.equal(db.writes.filter(w=>w.sql.includes('"AI_RECOMMENDATION"')).length,0);
});
test('off-topic query stays dental-only and produces no clinic',async()=>{
 process.env.SDC_AI_MODE='mock';const db=poolStub();const r=await triage.create(db,'1',body('عندي ألم في المعدة منذ أمس'));
 assert.equal(r.status,'ok');assert.equal(db.writes.filter(w=>w.sql.includes('"AI_RECOMMENDATION"')).length,0);
 assert.match(db.writes.find(w=>w.sql.includes('"AI_ASSESSMENT"')).args[3],/الأسنان فقط/);
});
test('dental symptom follow-up persists patient and assistant messages',async()=>{
 process.env.SDC_AI_MODE='mock';const db=poolStub();
 const first=await triage.create(db,'1',body('أشعر بألم في ضرس منذ يومين'));
 assert.equal(first.status,'followup');assert.equal(db.writes.length,0);
 const second=await triage.create(db,'1',body(first.symptoms,{followup_question:first.question,followup_answer:'الألم بدأ قبل يومين ولا يوجد تورم',latitude:'32.200',longitude:'35.200'}));
 assert.equal(second.status,'ok');assert.equal(db.writes.filter(w=>w.sql.includes('"AI_ASSESSMENT_MESSAGES"')).length,4);
 assert.ok(db.writes.some(w=>w.sql.includes('"AI_RECOMMENDATION"')));
});
test('routine cleaning does not require follow-up',async()=>{
 process.env.SDC_AI_MODE='mock';const db=poolStub();const r=await triage.create(db,'1',body('أريد تنظيف الأسنان بشكل دوري'));
 assert.equal(r.status,'ok');assert.equal(db.writes.find(w=>w.sql.includes('"AI_ASSESSMENT"')).args[2],'low');
});
test('requires explicit symptom processing consent',async()=>{
 process.env.SDC_AI_MODE='mock';const db=poolStub();const r=await triage.create(db,'1',{symptoms:'أشعر بألم في الأسنان'});
 assert.equal(r.status,'invalid');assert.equal(db.writes.length,0);
});
test('emergency safeguard overrides model downgrade',()=>{
 const v=ai.normalize({scope:'dental',urgency:'low',summary:'مطمئن',advice:'',followup_question:'',service_ids:['101'],specialty_ids:[]},{services:[{id:'101',name:'فحص'}],specialties:[],answer:''},'نزيف من الفم شديد لا يتوقف');
 assert.equal(v.risk,'emergency');assert.equal(v.service_ids.length,0);
});
test('distance comparator is valid, does not require location for booking',()=>{
 assert.equal(triage.km({lat:32.2,lng:35.2},{lat:32.2,lng:35.2}),0);
 assert.equal(triage.coordinates({latitude:'32.2',longitude:'35.2'}).lat,32.2);
 assert.equal(triage.coordinates({latitude:'-100',longitude:'35.2'}),null);
});
test('fails closed rather than silently using mock mode without configuration',async()=>{
 delete process.env.SDC_AI_MODE;delete process.env.OPENAI_API_KEY;
 await assert.rejects(ai.evaluate('أشعر بألم في الأسنان',{services:[],specialties:[],answer:'',allowQuestion:true}),{code:'AI_NOT_CONFIGURED'});
});
test('real API integration uses structured output, excludes identity/location, and validates service IDs',async()=>{
 delete process.env.SDC_AI_MODE;process.env.OPENAI_API_KEY='test-placeholder-key';
 const original=global.fetch;let request;
 global.fetch=async(url,options)=>{
  request={url,options};return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({scope:'dental',urgency:'medium',summary:'Preliminary dental guidance',advice:'See a dentist',followup_question:'',service_ids:['101','999999'],specialty_ids:['20']})}]}]})};
 };
 try{
  const response=await ai.evaluate('I have tooth pain',{services:[{id:'101',name:'Exam'}],specialties:[{id:'20',name:'General Dentistry'}],answer:'started two days ago',locale:'en'});
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  const payload=JSON.parse(request.options.body);
  assert.equal(payload.store,false);assert.equal(payload.text.format.type,'json_schema');
  assert.deepEqual(response.service_ids,['101']);assert.deepEqual(response.specialty_ids,['20']);
  assert.equal(JSON.stringify(payload).includes('latitude'),false);assert.equal(JSON.stringify(payload).includes('fullName'),false);
 }finally{global.fetch=original;delete process.env.OPENAI_API_KEY;}
});
test('production never silently enables the mock even when configured',async()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';process.env.SDC_AI_MODE='mock';delete process.env.OPENAI_API_KEY;
 try{await assert.rejects(ai.evaluate('أشعر بألم في الأسنان',{services:[],specialties:[],answer:'',allowQuestion:true}),{code:'AI_NOT_CONFIGURED'});}
 finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;delete process.env.SDC_AI_MODE;}
});

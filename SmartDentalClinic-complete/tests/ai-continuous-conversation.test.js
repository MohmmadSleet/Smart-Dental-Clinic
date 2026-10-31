'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ai=require('../backend/patient/workspace/ai-engine');
const triage=require('../backend/patient/workspace/triage');
const router=fs.readFileSync(require.resolve('../backend/patient/workspace/router.js'),'utf8');
const view=fs.readFileSync(require('node:path').resolve(__dirname,'../views/patient/ai-diagnosis.ejs'),'utf8');
const app=fs.readFileSync(require('node:path').resolve(__dirname,'../public/patient/assets/app.js'),'utf8');
const book=fs.readFileSync(require('node:path').resolve(__dirname,'../backend/appointments/service.js'),'utf8');
function samplePool(){
 const state={messages:[{sender:'patient',text:'ألم في الضرس عند شرب البارد'}, {sender:'assistant',text:'تحتاج فحصًا'}],stale:false,writes:[],owner:'22',risk:'medium',result:'التقييم الأولي',advice:'تحتاج فحصًا',deleted:false};
 function query(sql,params=[]){
  const q=String(sql);
  if(q.includes('SELECT a."Assessment_ID"::text id'))return {rowCount:1,rows:[{id:'9',symptoms:'ألم في الضرس عند شرب البارد',result:state.result,risk:state.risk,advice:state.advice,date:'31/10/2026'}]};
  if(q.includes('"Sender_Type" sender'))return {rows:state.messages.slice()};
  if(q.includes('SELECT EXISTS(SELECT 1 FROM sdc."AUDIT_LOG"'))return {rows:[{stale:state.stale}]};
  if(q.includes('FROM sdc."PROVIDES"'))return {rows:[]};
  if(q.includes('FROM sdc."SPECIALTY"'))return {rows:[]};
  if(q.includes('FROM sdc."CLINIC"')&&q.includes('Latitude'))return {rows:[]};
  if(q.includes('FROM sdc."PATIENT"')&&!q.includes('AI_ASSESSMENT'))return {rowCount:1,rows:[{id:'55'}]};
  if(q.includes('FOR UPDATE OF a'))return {rowCount:params[1]===state.owner?1:0,rows:[{Risk_Level:state.risk,Preliminary_Result:state.result,Advice_Text:state.advice}]};
  if(q.includes('UPDATE sdc."AI_ASSESSMENT"')){state.risk=params[3];state.result=params[1];state.advice=params[2];state.writes.push(['update',params]);return {rowCount:1};}
  if(q.includes('DELETE FROM sdc."AI_RECOMMENDATION"')){state.deleted=true;state.writes.push(['delete',params]);return {rowCount:0};}
  if(q.includes('FROM sdc."BOOKING"'))return {rowCount:0,rows:[]};
  if(q.includes('MAX("Recommendation_Order"'))return {rows:[{n:0}]};
  if(q.includes('FROM sdc."AI_RECOMMENDATION"'))return {rows:[]};
  if(q.includes('MAX("Message_Order"'))return {rows:[{last:state.messages.length}]};
  if(q.includes('INSERT INTO sdc."AI_ASSESSMENT_MESSAGES"')){
   state.writes.push(['messages',params]);state.messages.push({sender:'patient',text:params[1]},{sender:'assistant',text:params[4]});return {rowCount:2};
  }
  if(q.includes('INSERT INTO sdc."AUDIT_LOG"')){state.writes.push(['audit',params]);return {rowCount:1};}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(q)||q.includes('set_config'))return {rows:[]};
  throw Error('unexpected query: '+q.slice(0,100));
 }
 return {state,query:async(...a)=>query(...a),connect:async()=>({query:async(...a)=>query(...a),release(){}})};
}
test('post-result composer is not replaced by done panel and keeps SSR POST fallback',()=>{
 assert.match(view,/id="aiContinuationForm"/);
 assert.match(view,/action="\/patient\/ai-diagnosis\/continue"/);
 assert.doesNotMatch(view,/ai-chat-done[^\n]*اكتمل هذا التقييم/);
 assert.match(app,/function attachContinuation\(nextForm\)/);
 assert.match(app,/attachContinuation\(composer\)/);
 assert.match(router,/router\.post\('\/ai-diagnosis\/continue'/);
 assert.match(router,/validateSessionCsrf\(req\)/);
});
test('continuation keeps same assessment and persists two messages without new consent or tables',async()=>{
 const oldMode=process.env.SDC_AI_MODE,oldEnv=process.env.NODE_ENV;
 process.env.SDC_AI_MODE='mock';process.env.NODE_ENV='development';
 try{
  const p=samplePool();const result=await triage.continueAssessment(p,'22','9','شو المقصود بالتقييم الأولي؟','ar');
  assert.equal(result.status,'ok');assert.equal(result.needsReassessment,false);
  assert.equal(p.state.messages.length,4);assert.equal(p.state.stale,false);
  assert.equal(p.state.writes.filter(x=>x[0]==='messages').length,1);
  assert.equal(p.state.writes.filter(x=>x[0]==='update').length,0);
  const saved=await triage.detail(p,'22','9');assert.equal(saved.messages.length,4);
  assert.equal(saved.needsReassessment,false);
 }finally{if(oldMode===undefined)delete process.env.SDC_AI_MODE;else process.env.SDC_AI_MODE=oldMode;if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;}
});
test('new emergency symptoms revise the SAME assessment ID; old unbooked offers are removed',async()=>{
 const oldMode=process.env.SDC_AI_MODE,oldEnv=process.env.NODE_ENV;
 process.env.SDC_AI_MODE='mock';process.env.NODE_ENV='development';
 try{
  const p=samplePool();const first=await triage.continueAssessment(p,'22','9','صار عندي صعوبة في التنفس','ar');
  assert.equal(first.status,'ok');assert.equal(first.updated,true);
  assert.equal(first.assessmentId,'9');assert.equal(first.needsReassessment,false);
  assert.match(first.reply,/للطوارئ/);
  assert.equal(p.state.risk,'emergency');assert.equal(p.state.deleted,true);
  assert.equal(p.state.writes.filter(x=>x[0]==='update').length,1);
  assert.equal(p.state.writes.filter(x=>x[0]==='audit').length,2);
  assert.equal(p.state.messages.length,4);
  assert.equal(p.state.writes.filter(x=>x[0]==='messages').length,1);
  const again=await triage.continueAssessment(p,'22','9','اشرح لي النتيجة','ar');
  assert.equal(again.updated,false);
  assert.equal(p.state.writes.filter(x=>x[0]==='update').length,1);
  assert.match(book,/ai.assessment.reassessment_completed/);
 }finally{if(oldMode===undefined)delete process.env.SDC_AI_MODE;else process.env.SDC_AI_MODE=oldMode;if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;}
});
test('provider unavailability pauses old offers on the SAME assessment instead of allowing stale booking',async()=>{
 const previous={mode:process.env.SDC_AI_MODE,key:process.env.OPENAI_API_KEY,env:process.env.NODE_ENV};
 process.env.SDC_AI_MODE='openai';delete process.env.OPENAI_API_KEY;process.env.NODE_ENV='development';
 try{
  const p=samplePool();const r=await triage.continueAssessment(p,'22','9','بدأ عندي ألم جديد وتورم','ar');
  assert.equal(r.status,'ok');assert.equal(r.needsReassessment,true);assert.equal(r.updated,false);
  assert.equal(p.state.messages.length,4);
  assert.equal(p.state.writes.some(x=>x[0]==='audit'&&x[1][0]==='9'),true);
  assert.equal(p.state.writes.filter(x=>x[0]==='update').length,0);
 }finally{
  if(previous.mode===undefined)delete process.env.SDC_AI_MODE;else process.env.SDC_AI_MODE=previous.mode;
  if(previous.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous.key;
  if(previous.env===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous.env;
 }
});
test('invalid assessment ID or message is rejected before database access',async()=>{
 const p=samplePool();assert.deepEqual(await triage.continueAssessment(p,'22','abc','شوي','ar'),{status:'invalid'});
 assert.deepEqual(await triage.continueAssessment(p,'22','9','x','ar'),{status:'invalid'});
 assert.deepEqual(await triage.continueAssessment(p,'22','9','a'.repeat(1001),'ar'),{status:'invalid'});
});
test('real continuation API sends only bounded clinical context and uses structured output',async()=>{
 const oldFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY,oldMode=process.env.SDC_AI_MODE,oldEnv=process.env.NODE_ENV;
 process.env.OPENAI_API_KEY='dummy-test-key';process.env.SDC_AI_MODE='openai';process.env.NODE_ENV='development';
 let sent;
 global.fetch=async(_url,req)=>{sent=JSON.parse(req.body);return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'You may continue to ask about dental care.',needs_reassessment:false})}]}]})};};
 try{
  const response=await ai.continueConversation('What does my assessment mean?',{locale:'en',symptoms:'Tooth sensitivity',summary:'Dental advice',advice:'Clinical examination',risk:'low',history:[{sender:'patient',text:'Tooth sensitivity'}]});
  assert.equal(response.needs_reassessment,false);
  assert.equal(response.reply,'You may continue to ask about dental care.');
  assert.equal(sent.store,false);assert.equal(sent.text.format.type,'json_schema');
  assert.doesNotMatch(JSON.stringify(sent),/latitude|longitude|firstName|phoneNumber/);
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldMode===undefined)delete process.env.SDC_AI_MODE;else process.env.SDC_AI_MODE=oldMode;if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;}
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const template=read('views/patient/ai-diagnosis.ejs');
const client=read('public/patient/assets/app.js');
const css=read('public/patient/assets/styles.css');
const router=read('backend/patient/workspace/router.js');
test('assistant interface uses one conversation and one composer, with no booking confirm popup',()=>{
 assert.match(template,/id="chatBody"/);
 assert.match(template,/id="aiSymptomsForm"/);
 assert.match(template,/id="aiFinalResponse"/);
 assert.match(template,/ai-chat-line--assistant/);
 assert.doesNotMatch(template,/onclick="return confirm/);
});
test('consent is visible only at beginning; follow-up uses previous consent',()=>{
 assert.match(template,/if\(!triageFollowup\)\{ %><label class="ai-chat-consent"/);
 assert.match(template,/if\(triageFollowup\)\{ %><input type="hidden" name="symptoms"/);
 assert.match(template,/type="hidden" name="ai_consent" value="1"/);
 assert.match(client,/check\.required=false;check\.disabled=true/);
});
test('asynchronous message flow preserves server-side fallback and CSRF',()=>{
 assert.match(router,/jsonReply\?res\.json\(\{status:'followup'/);
 assert.match(router,/jsonReply\?res\.json\(\{status:'ok',url\}/);
 assert.match(router,/validateSessionCsrf\(req\)/);
 assert.match(client,/credentials:'same-origin'/);
 assert.match(client,/method:'POST'/);
 assert.match(template,/method="post" action="\/patient\/ai-diagnosis"/);
});
test('mobile and reduced motion support apply only to the AI page',()=>{
 assert.match(css,/\.patient-page-ai-diagnosis \.ai-chat-thread/);
 assert.match(css,/@media\(max-width:767\.98px\)/);
 assert.match(css,/max-width:390px/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

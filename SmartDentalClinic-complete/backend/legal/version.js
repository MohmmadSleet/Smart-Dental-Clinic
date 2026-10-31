'use strict';
const policyVersion=()=>String(process.env.POLICY_VERSION||'غير مهيّأ').slice(0,150);
module.exports={policyVersion};

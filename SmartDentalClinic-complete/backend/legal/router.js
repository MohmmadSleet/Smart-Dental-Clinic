'use strict';
const express=require('express');
const router=express.Router();
const {policyVersion}=require('./version');
router.get('/terms',(_req,res)=>{res.set('Cache-Control','public, max-age=300');return res.render('auth/legal/terms',{policyVersion:policyVersion()});});
router.get('/privacy',(_req,res)=>{res.set('Cache-Control','public, max-age=300');return res.render('auth/legal/privacy',{policyVersion:policyVersion()});});
module.exports=router;

-- Smart Dental Clinic: clean testing database derived from uploaded 2026-10-30 PostgreSQL 18.6 SQL export.
-- Run ONLY in a newly created EMPTY database using pgAdmin Query Tool (connected as postgres).
-- Preserves the complete existing schema, including a leftover notification backup table.
-- No patient, doctor, clinic, session, invoice, or audit user data are copied.
-- Seeds roles, the original six specialties, and the existing platform finance policy (10%, weekly, due 7 days).
-- It does NOT create a Super Admin account: use the project's npm run db:seed:admin command afterward.
-- Does NOT drop or truncate anything.
BEGIN;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='sdc') THEN
    RAISE EXCEPTION 'Safety stop: schema sdc already exists. Use a new empty database; existing data was not modified.';
  END IF;
END $guard$;
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

-- Started on 2026-10-30 19:05:53

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 6 (class 2615 OID 32365)
-- Name: sdc; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA sdc;


ALTER SCHEMA sdc OWNER TO postgres;

--
-- TOC entry 6240 (class 0 OID 0)
-- Dependencies: 6
-- Name: SCHEMA sdc; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA sdc IS 'Smart Dental Clinic: 57 source-schema tables with database-enforced integrity. Use a trusted backend login; never expose SQL to clients.';


--
-- TOC entry 327 (class 1255 OID 33880)
-- Name: sdc_actor_id(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_actor_id() RETURNS bigint
    LANGUAGE plpgsql STABLE
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE a text; BEGIN a:=current_setting('sdc.user_id',true);
IF a IS NULL OR a='' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Set authenticated actor using SET LOCAL sdc.user_id'; END IF;
RETURN a::bigint; END $$;


ALTER FUNCTION sdc.sdc_actor_id() OWNER TO postgres;

--
-- TOC entry 351 (class 1255 OID 34206)
-- Name: sdc_approval_authorization(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_approval_authorization() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE a bigint; du bigint;
BEGIN
 IF TG_TABLE_NAME='VISIT' THEN
  IF NEW."Report_Approved_At" IS NOT NULL THEN
   IF TG_OP='INSERT' THEN a:=sdc_actor_id();
   ELSIF NEW."Report_Approved_At" IS NOT DISTINCT FROM OLD."Report_Approved_At" THEN RETURN NEW;
   ELSE a:=sdc_actor_id(); END IF;
   SELECT d."User_ID" INTO du FROM "BOOKING" b JOIN "DOCTOR" d USING("Doctor_ID") WHERE b."Booking_ID"=NEW."Booking_ID";
   IF NOT sdc_is_superadmin(a) AND a IS DISTINCT FROM du THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only treating doctor may approve report'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='CLINIC' THEN
  IF TG_OP='UPDATE' AND (NEW."Approval_Status",NEW."Reviewed_At",NEW."Reviewed_By_User_ID",NEW."Review_Notes") IS DISTINCT FROM (OLD."Approval_Status",OLD."Reviewed_At",OLD."Reviewed_By_User_ID",OLD."Review_Notes") THEN
   IF NOT sdc_is_superadmin(sdc_actor_id()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Super Admin may review clinic'; END IF;
  ELSIF TG_OP='INSERT' AND NEW."Approval_Status"<>'pending' THEN
   IF NOT sdc_is_superadmin(sdc_actor_id()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='New clinic starts pending'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='DOCTOR' THEN
  IF TG_OP='UPDATE' AND (NEW."License_Status",NEW."License_Reviewed_By_User_ID",NEW."License_Review_Notes") IS DISTINCT FROM (OLD."License_Status",OLD."License_Reviewed_By_User_ID",OLD."License_Review_Notes") THEN
   IF NOT sdc_is_superadmin(sdc_actor_id()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Super Admin may review license'; END IF;
  ELSIF TG_OP='INSERT' AND NEW."License_Status"<>'pending' THEN
   IF NOT sdc_is_superadmin(sdc_actor_id()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='New doctor license starts pending'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION sdc.sdc_approval_authorization() OWNER TO postgres;

--
-- TOC entry 331 (class 1255 OID 33884)
-- Name: sdc_block_truncate(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_block_truncate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TRUNCATE is disabled; use transactional DELETE respecting constraints'; END $$;


ALTER FUNCTION sdc.sdc_block_truncate() OWNER TO postgres;

--
-- TOC entry 354 (class 1255 OID 40598)
-- Name: sdc_booking_commission_rate_at_creation(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_booking_commission_rate_at_creation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE active_rate numeric(5,2);
BEGIN
 IF TG_OP='INSERT' THEN
  -- FOR SHARE serializes a concurrent policy change vs creation of a booking.
  SELECT commission_rate INTO active_rate
   FROM sdc.platform_finance_settings WHERE settings_id=1 FOR SHARE;
  IF active_rate IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Platform commission settings missing (run migration 008)';
  END IF;
  -- Never trust a client-supplied snapshot; the platform setting is canonical.
  NEW."Commission_Rate_Snapshot" := active_rate;
 ELSIF TG_OP='UPDATE' THEN
  IF OLD."Commission_Rate_Snapshot" IS NOT NULL AND
     OLD."Commission_Rate_Snapshot" IS DISTINCT FROM NEW."Commission_Rate_Snapshot" THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Booking commission rate is immutable once captured';
  END IF;
  -- Legacy unsettled bookings had NULL rates. At first settlement, the older
  -- service may assign a rate once, but it must never change it afterward.
  IF OLD."Commission_Rate_Snapshot" IS NULL
     AND NEW."Commission_Rate_Snapshot" IS NOT NULL
     AND NEW."Settlement_ID" IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Legacy commission rate can only be fixed at settlement';
  END IF;
 END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION sdc.sdc_booking_commission_rate_at_creation() OWNER TO postgres;

--
-- TOC entry 349 (class 1255 OID 33888)
-- Name: sdc_booking_guard(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_booking_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF (OLD."Service_Price_Snapshot",OLD."Duration_Minutes_Snapshot",OLD."Patient_ID",OLD."Clinic_ID",OLD."Doctor_ID",OLD."Service_ID",OLD."Recommendation_ID",OLD."Created_At",OLD."Created_By_User_ID") IS DISTINCT FROM
     (NEW."Service_Price_Snapshot",NEW."Duration_Minutes_Snapshot",NEW."Patient_ID",NEW."Clinic_ID",NEW."Doctor_ID",NEW."Service_ID",NEW."Recommendation_ID",NEW."Created_At",NEW."Created_By_User_ID") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Booking snapshots and participants are immutable; cancel and rebook'; END IF;
  IF OLD."Settlement_ID" IS NOT NULL AND (OLD."Settlement_ID",OLD."Commission_Rate_Snapshot") IS DISTINCT FROM (NEW."Settlement_ID",NEW."Commission_Rate_Snapshot") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Settled booking cannot be reassigned or repriced'; END IF;
  IF OLD."Request_Status"='pending' AND NEW."Request_Status" IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Resolve active request before clearing it'; END IF;
  IF OLD."Request_Status"='pending' AND NEW."Request_Status"='pending'  AND
   (OLD."Requested_Date",OLD."Requested_Start_Time",OLD."Change_Request_Reason",OLD."Request_Source",OLD."Requested_At") IS DISTINCT FROM
   (NEW."Requested_Date",NEW."Requested_Start_Time",NEW."Change_Request_Reason",NEW."Request_Source",NEW."Requested_At") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Resolve the active change request before replacing it'; END IF;
  IF OLD."Request_Status"='pending' AND NEW."Request_Status"='approved' AND (NEW."Appointment_Date",NEW."Start_Time") IS DISTINCT FROM (NEW."Requested_Date",NEW."Requested_Start_Time") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved reschedule must apply the requested date/time'; END IF;
 END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION sdc.sdc_booking_guard() OWNER TO postgres;

--
-- TOC entry 329 (class 1255 OID 33882)
-- Name: sdc_can(bigint, bigint, text); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_can(a bigint, c bigint, p text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
SELECT EXISTS(SELECT 1 FROM "USER" u WHERE u."User_ID"=a AND u."Account_Status"='active' AND u."Login_Enabled") AND
(sdc_is_superadmin(a) OR EXISTS(SELECT 1 FROM "CLINIC" x JOIN "DOCTOR" d ON d."Doctor_ID"=x."Manager_Doctor_ID" WHERE x."Clinic_ID"=c AND d."User_ID"=a)
OR EXISTS(SELECT 1 FROM "STAFF_AT" s JOIN "STAFF_PERMISSIONS" q USING("User_ID","Clinic_ID") WHERE s."User_ID"=a AND s."Clinic_ID"=c AND s."Membership_Status"='active' AND q."Permission_Code"=p)) $$;


ALTER FUNCTION sdc.sdc_can(a bigint, c bigint, p text) OWNER TO postgres;

--
-- TOC entry 334 (class 1255 OID 40595)
-- Name: sdc_finance_settings_superadmin_only(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_finance_settings_superadmin_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE actor bigint := sdc_actor_id();
BEGIN
 IF TG_OP='DELETE' OR NOT sdc_is_superadmin(actor) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Super Admin can update financial settings';
 END IF;
 IF NEW.updated_by IS DISTINCT FROM actor THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Financial settings actor mismatch';
 END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION sdc.sdc_finance_settings_superadmin_only() OWNER TO postgres;

--
-- TOC entry 328 (class 1255 OID 33881)
-- Name: sdc_is_superadmin(bigint); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_is_superadmin(a bigint) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
SELECT EXISTS(SELECT 1 FROM "USER" u JOIN "ROLE" r USING("Role_ID") WHERE u."User_ID"=a AND u."Account_Status"='active' AND u."Login_Enabled" AND r."Role_Scope"='System' AND r."Role_Name"='Super Admin') $$;


ALTER FUNCTION sdc.sdc_is_superadmin(a bigint) OWNER TO postgres;

--
-- TOC entry 339 (class 1255 OID 40601)
-- Name: sdc_job_admin_suspension_guard(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_job_admin_suspension_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE actor bigint;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF OLD."Admin_Suspended_At" IS NOT NULL OR NEW."Admin_Suspended_At" IS NOT NULL THEN
     actor := COALESCE(NULLIF(current_setting('sdc.user_id',true),''),'0')::bigint;
     IF NOT COALESCE(sdc.sdc_is_superadmin(actor),false) THEN
       RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Job advert is suspended by platform administration';
     END IF;
   END IF;
 ELSIF TG_OP='DELETE' THEN
   IF OLD."Admin_Suspended_At" IS NOT NULL THEN
     actor := COALESCE(NULLIF(current_setting('sdc.user_id',true),''),'0')::bigint;
     IF NOT COALESCE(sdc.sdc_is_superadmin(actor),false) THEN
       RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Suspended job advert cannot be deleted by clinic';
     END IF;
   END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;


ALTER FUNCTION sdc.sdc_job_admin_suspension_guard() OWNER TO postgres;

--
-- TOC entry 332 (class 1255 OID 33885)
-- Name: sdc_lab_admin(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_lab_admin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$ BEGIN
 IF NOT sdc_is_superadmin(sdc_actor_id()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Super Admin may manage laboratory master data'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


ALTER FUNCTION sdc.sdc_lab_admin() OWNER TO postgres;

--
-- TOC entry 333 (class 1255 OID 40565)
-- Name: sdc_lab_order_master_active(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_lab_order_master_active() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
BEGIN
  IF (TG_OP='INSERT') OR
     (TG_OP='UPDATE' AND (NEW."Laboratory_ID" IS DISTINCT FROM OLD."Laboratory_ID"
                         OR (NEW."Order_Status"='sent' AND OLD."Order_Status" IS DISTINCT FROM 'sent')))
  THEN
    IF NOT EXISTS (SELECT 1 FROM "LABORATORY" l
                   WHERE l."Laboratory_ID"=NEW."Laboratory_ID" AND l."Is_Active"=TRUE)
    THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Laboratory is disabled for new or sent orders';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION sdc.sdc_lab_order_master_active() OWNER TO postgres;

--
-- TOC entry 350 (class 1255 OID 34201)
-- Name: sdc_operation_authorization(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_operation_authorization() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE a bigint:=sdc_actor_id(); c bigint; docuser bigint; perm text;
BEGIN
 IF sdc_is_superadmin(a) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='INVOICE' THEN
  IF TG_OP='DELETE' THEN c:=OLD."Clinic_ID"; ELSE c:=NEW."Clinic_ID"; END IF; perm:='invoices.issue';
  IF TG_OP<>'DELETE' AND NEW."Issued_By_User_ID" IS NOT NULL AND NEW."Issued_By_User_ID"<>a THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invoice issuer must be authenticated actor'; END IF;
 ELSIF TG_TABLE_NAME='RECORDS_PAYMENT' THEN
  IF TG_OP='DELETE' THEN SELECT "Clinic_ID" INTO c FROM "INVOICE" WHERE "Invoice_ID"=OLD."Invoice_ID";
  ELSE SELECT "Clinic_ID" INTO c FROM "INVOICE" WHERE "Invoice_ID"=NEW."Invoice_ID";
   IF NEW."User_ID"<>a THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Payment recorder must be authenticated actor'; END IF;
  END IF; perm:='payments.record';
 ELSIF TG_TABLE_NAME='RECORDS_SETTLEMENT_PAYMENT' THEN
  IF TG_OP='DELETE' THEN SELECT "Clinic_ID" INTO c FROM "SETTLEMENT" WHERE "Settlement_ID"=OLD."Settlement_ID";
  ELSE SELECT "Clinic_ID" INTO c FROM "SETTLEMENT" WHERE "Settlement_ID"=NEW."Settlement_ID"; END IF; perm:='settlements.record';
 ELSIF TG_TABLE_NAME='STOCK_MOVEMENT' THEN
  IF TG_OP='DELETE' THEN SELECT "Clinic_ID" INTO c FROM "INVENTORY_ITEM" WHERE "Item_ID"=OLD."Item_ID";
  ELSE SELECT "Clinic_ID" INTO c FROM "INVENTORY_ITEM" WHERE "Item_ID"=NEW."Item_ID"; END IF; perm:='inventory.manage';
 END IF;
 IF NOT COALESCE(sdc_can(a,c,perm),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Actor lacks permission for this clinic'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='RECORDS_PAYMENT' THEN SELECT "Clinic_ID" INTO c FROM "INVOICE" WHERE "Invoice_ID"=OLD."Invoice_ID";
  ELSIF TG_TABLE_NAME='RECORDS_SETTLEMENT_PAYMENT' THEN SELECT "Clinic_ID" INTO c FROM "SETTLEMENT" WHERE "Settlement_ID"=OLD."Settlement_ID";
  ELSIF TG_TABLE_NAME='STOCK_MOVEMENT' THEN SELECT "Clinic_ID" INTO c FROM "INVENTORY_ITEM" WHERE "Item_ID"=OLD."Item_ID";
  ELSE c:=OLD."Clinic_ID"; END IF;
  IF NOT COALESCE(sdc_can(a,c,perm),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Actor lacks permission for source clinic'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


ALTER FUNCTION sdc.sdc_operation_authorization() OWNER TO postgres;

--
-- TOC entry 348 (class 1255 OID 33887)
-- Name: sdc_report_guard(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_report_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE vid bigint;
BEGIN
 IF TG_TABLE_NAME='VISIT' THEN
  IF TG_OP='DELETE' AND OLD."Report_Approved_At" IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved report cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND OLD."Report_Approved_At" IS NOT NULL AND
   (to_jsonb(OLD)-ARRAY['Follow_Up_Type','Suggested_Date','Follow_Up_Notes']) IS DISTINCT FROM
   (to_jsonb(NEW)-ARRAY['Follow_Up_Type','Suggested_Date','Follow_Up_Notes']) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved clinical report is immutable'; END IF;
 ELSE
  IF TG_OP IN ('UPDATE','DELETE') THEN
   vid:=OLD."Visit_ID";
   IF EXISTS(SELECT 1 FROM "VISIT" WHERE "Visit_ID"=vid AND "Report_Approved_At" IS NOT NULL) THEN
    IF TG_TABLE_NAME <> 'VISIT_VISIT_FILES' THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved report detail is immutable';
    ELSIF OLD."Included_In_Report" THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved report detail is immutable'; END IF;
   END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
   vid:=NEW."Visit_ID";
   IF EXISTS(SELECT 1 FROM "VISIT" WHERE "Visit_ID"=vid AND "Report_Approved_At" IS NOT NULL) THEN
    IF TG_TABLE_NAME <> 'VISIT_VISIT_FILES' THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cannot add clinical data to approved report';
    ELSIF NEW."Included_In_Report" THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cannot add clinical data to an approved report'; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


ALTER FUNCTION sdc.sdc_report_guard() OWNER TO postgres;

--
-- TOC entry 347 (class 1255 OID 34215)
-- Name: sdc_request_audit(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_request_audit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    SET "TimeZone" TO 'Asia/Hebron'
    AS $$
DECLARE a bigint; lid bigint; k text; ov jsonb:=to_jsonb(OLD); nv jsonb:=to_jsonb(NEW);
BEGIN
 IF (OLD."Request_Status",OLD."Requested_At",OLD."Appointment_Date",OLD."Start_Time") IS DISTINCT FROM (NEW."Request_Status",NEW."Requested_At",NEW."Appointment_Date",NEW."Start_Time") THEN
  a:=sdc_actor_id();
  INSERT INTO "AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
  VALUES(localtimestamp,'booking.reschedule','Booking',NEW."Booking_ID"::text,'تغيير موعد أو طلب تغيير موعد',COALESCE(NEW."Change_Request_Reason",OLD."Change_Request_Reason"),a) RETURNING "Log_ID" INTO lid;
  FOREACH k IN ARRAY ARRAY['Appointment_Date','Start_Time','Requested_Date','Requested_Start_Time','Request_Status','Request_Source','Requested_At','Resolved_At','Change_Request_Reason'] LOOP
   IF ov->k IS DISTINCT FROM nv->k THEN INSERT INTO "AUDIT_LOG_CHANGES"("Field_Name","Old_Value","New_Value","Log_ID") VALUES(k,ov->>k,nv->>k,lid); END IF;
  END LOOP;
 END IF; RETURN NEW;
END $$;


ALTER FUNCTION sdc.sdc_request_audit() OWNER TO postgres;

--
-- TOC entry 352 (class 1255 OID 34212)
-- Name: sdc_staff_management(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_staff_management() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
DECLARE a bigint:=sdc_actor_id(); c bigint; BEGIN
 IF sdc_is_superadmin(a) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN c:=OLD."Clinic_ID"; ELSE c:=NEW."Clinic_ID"; END IF;
 IF NOT EXISTS(SELECT 1 FROM "CLINIC" c1 JOIN "DOCTOR" d ON d."Doctor_ID"=c1."Manager_Doctor_ID" WHERE c1."Clinic_ID"=c AND d."User_ID"=a) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only clinic manager or Super Admin may manage staff membership/permissions'; END IF;
 IF TG_OP='UPDATE' AND OLD."Clinic_ID"<>NEW."Clinic_ID" THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Delete/recreate membership rather than moving it to another clinic'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


ALTER FUNCTION sdc.sdc_staff_management() OWNER TO postgres;

--
-- TOC entry 353 (class 1255 OID 33890)
-- Name: sdc_validate(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_validate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
BEGIN
 -- Validate captured insertion values even when FK targets were inserted later in this transaction.
 IF TG_TABLE_NAME='BOOKING' AND TG_OP='INSERT' THEN
  IF NEW."Recommendation_ID" IS NOT NULL AND EXISTS(SELECT 1 FROM "AI_RECOMMENDATION" r WHERE r."Recommendation_ID"=NEW."Recommendation_ID" AND (NEW."Appointment_Date",NEW."Start_Time") IS DISTINCT FROM (r."Suggested_Date",r."Suggested_Start_Time")) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Initial AI booking must use recommended slot'; END IF;
  IF NEW."Recommendation_ID" IS NULL AND EXISTS(SELECT 1 FROM "OFFERS" o WHERE o."Clinic_ID"=NEW."Clinic_ID" AND o."Service_ID"=NEW."Service_ID" AND (NEW."Service_Price_Snapshot",NEW."Duration_Minutes_Snapshot") IS DISTINCT FROM (o."Price",o."Duration_Minutes")) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Capture clinic service price/duration at booking'; END IF;
 END IF;
 -- Role scopes and profiles: one global role per account, one clinic role per membership.
 IF EXISTS(SELECT 1 FROM "USER" u JOIN "ROLE" r USING("Role_ID") WHERE r."Role_Scope"<>'System')
 OR EXISTS(SELECT 1 FROM "STAFF_AT" s JOIN "ROLE" r USING("Role_ID") JOIN "USER" u USING("User_ID") JOIN "ROLE" ur ON ur."Role_ID"=u."Role_ID" WHERE r."Role_Scope"<>'Clinic' OR ur."Role_Name"<>'Staff')
 OR EXISTS(SELECT 1 FROM "DOCTOR" d JOIN "USER" u USING("User_ID") JOIN "ROLE" r USING("Role_ID") WHERE r."Role_Name"<>'Doctor')
 OR EXISTS(SELECT 1 FROM "PATIENT" p JOIN "USER" u USING("User_ID") JOIN "ROLE" r USING("Role_ID") WHERE r."Role_Name"<>'Patient') THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Role scope/profile mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM "DOCTOR" WHERE "License_Reviewed_By_User_ID" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "USER" u JOIN "ROLE" r USING("Role_ID") WHERE u."User_ID"="DOCTOR"."License_Reviewed_By_User_ID" AND r."Role_Scope"='System' AND r."Role_Name"='Super Admin'))
 OR EXISTS(SELECT 1 FROM "CLINIC" WHERE "Reviewed_By_User_ID" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "USER" u JOIN "ROLE" r USING("Role_ID") WHERE u."User_ID"="CLINIC"."Reviewed_By_User_ID" AND r."Role_Scope"='System' AND r."Role_Name"='Super Admin')) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='License and clinic reviewers must be Super Admin'; END IF;
 -- Registered patient, treatment plan, follow-up and AI lineage.
 IF EXISTS(SELECT 1 FROM "BOOKING" b WHERE NOT EXISTS(SELECT 1 FROM "REGISTERED_AT" r WHERE r."Patient_ID"=b."Patient_ID" AND r."Clinic_ID"=b."Clinic_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Register patient with clinic before booking'; END IF;
 IF EXISTS(SELECT 1 FROM "BOOKING" b JOIN "TREATMENT_PLAN" p USING("Plan_ID") WHERE (b."Patient_ID",b."Clinic_ID",b."Doctor_ID") IS DISTINCT FROM (p."Patient_ID",p."Clinic_ID",p."Doctor_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Booking/treatment plan participants mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM "TREATMENT_PLAN" p WHERE NOT EXISTS(SELECT 1 FROM "WORKS_AT" w WHERE w."Clinic_ID"=p."Clinic_ID" AND w."Doctor_ID"=p."Doctor_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Plan doctor must belong to clinic'; END IF;
 IF EXISTS(SELECT 1 FROM "BOOKING" b JOIN "VISIT" v ON v."Visit_ID"=b."Follow_Up_Of_Visit_ID" JOIN "BOOKING" prior ON prior."Booking_ID"=v."Booking_ID"
 WHERE (b."Patient_ID",b."Clinic_ID",b."Doctor_ID") IS DISTINCT FROM (prior."Patient_ID",prior."Clinic_ID",prior."Doctor_ID") OR b."Appointment_Date"+b."Start_Time"<=prior."Appointment_Date"+prior."Start_Time" OR v."Suggested_Date" IS NULL) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Follow-up must refer to an earlier suggested visit of same patient/clinic/doctor'; END IF;
 IF EXISTS(SELECT 1 FROM "BOOKING" b JOIN "AI_RECOMMENDATION" r USING("Recommendation_ID") JOIN "AI_ASSESSMENT" a USING("Assessment_ID")
 WHERE b."Booking_Source"<>'ai' OR b."Patient_ID"<>a."Patient_ID" OR (b."Clinic_ID",b."Doctor_ID",b."Service_ID",b."Service_Price_Snapshot",b."Duration_Minutes_Snapshot") IS DISTINCT FROM
 (r."Clinic_ID",r."Doctor_ID",r."Service_ID",r."Price_Snapshot",r."Duration_Minutes_Snapshot"))
 OR EXISTS(SELECT 1 FROM "BOOKING" WHERE ("Booking_Source"='ai') <> ("Recommendation_ID" IS NOT NULL))
 OR EXISTS(SELECT r."Assessment_ID" FROM "BOOKING" b JOIN "AI_RECOMMENDATION" r USING("Recommendation_ID") GROUP BY r."Assessment_ID" HAVING count(*)>1) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='AI booking must match recommendation; one booking per assessment'; END IF;
 -- All non-cancelled appointment intervals: one doctor across all clinics, and one patient.
 IF EXISTS(SELECT 1 FROM "BOOKING" a JOIN "BOOKING" b ON a."Booking_ID"<b."Booking_ID"
 AND (a."Doctor_ID"=b."Doctor_ID" OR a."Patient_ID"=b."Patient_ID")
 WHERE a."Booking_Status" NOT IN ('cancelled','rejected','no_show') AND b."Booking_Status" NOT IN ('cancelled','rejected','no_show')
 AND tsrange(a."Appointment_Date"+a."Start_Time",a."Appointment_Date"+a."Start_Time"+make_interval(mins=>a."Duration_Minutes_Snapshot"),'[)') &&
 tsrange(b."Appointment_Date"+b."Start_Time",b."Appointment_Date"+b."Start_Time"+make_interval(mins=>b."Duration_Minutes_Snapshot"),'[)')) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Overlapping doctor or patient appointments'; END IF;
 -- Availability is enforced for pending/confirmed bookings, not historical completed work.
 IF EXISTS(SELECT 1 FROM "BOOKING" b JOIN "WORKS_AT" w USING("Clinic_ID","Doctor_ID") JOIN "OFFERS" o USING("Clinic_ID","Service_ID") JOIN "CLINIC" c USING("Clinic_ID") JOIN "DOCTOR" d USING("Doctor_ID")
 WHERE b."Booking_Status" IN ('pending','confirmed') AND (w."Membership_Status"<>'active' OR w."Start_Date">b."Appointment_Date" OR NOT o."Is_Available" OR c."Clinic_Status"<>'active' OR c."Approval_Status"<>'approved' OR d."License_Status"<>'verified'
 OR (b."Booking_Source"='ai' AND NOT c."Online_Booking_Enabled")
 OR EXISTS(SELECT 1 FROM "DOCTOR_ABSENCES" a WHERE a."Clinic_ID"=b."Clinic_ID" AND a."Doctor_ID"=b."Doctor_ID" AND b."Appointment_Date" BETWEEN a."From_Date" AND a."To_Date")
 OR NOT EXISTS(SELECT 1 FROM "DOCTOR_WORKING_HOURS" h WHERE h."Clinic_ID"=b."Clinic_ID" AND h."Doctor_ID"=b."Doctor_ID" AND h."Is_Active" AND h."Day_Of_Week"=extract(dow FROM b."Appointment_Date") AND b."Start_Time">=h."Start_Time" AND b."Start_Time"+make_interval(mins=>b."Duration_Minutes_Snapshot")<=h."End_Time")
 OR EXISTS(SELECT 1 FROM "CLINIC_WORKING_EXCEPTIONS" e WHERE e."Clinic_ID"=b."Clinic_ID" AND e."Exception_Date"=b."Appointment_Date" AND e."Exception_Type"='closed')
 OR (EXISTS(SELECT 1 FROM "CLINIC_WORKING_EXCEPTIONS" e WHERE e."Clinic_ID"=b."Clinic_ID" AND e."Exception_Date"=b."Appointment_Date") AND NOT EXISTS(SELECT 1 FROM "CLINIC_WORKING_EXCEPTIONS" e WHERE e."Clinic_ID"=b."Clinic_ID" AND e."Exception_Date"=b."Appointment_Date" AND e."Exception_Type"='custom_hours' AND b."Start_Time">=e."Start_Time" AND b."Start_Time"+make_interval(mins=>b."Duration_Minutes_Snapshot")<=e."End_Time"))
 OR (NOT EXISTS(SELECT 1 FROM "CLINIC_WORKING_EXCEPTIONS" e WHERE e."Clinic_ID"=b."Clinic_ID" AND e."Exception_Date"=b."Appointment_Date") AND NOT EXISTS(SELECT 1 FROM "CLINIC_WORKING_HOURS" h WHERE h."Clinic_ID"=b."Clinic_ID" AND h."Day_Of_Week"=extract(dow FROM b."Appointment_Date") AND b."Start_Time">=h."Start_Time" AND b."Start_Time"+make_interval(mins=>b."Duration_Minutes_Snapshot")<=h."End_Time")))) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Booking outside active doctor/service/clinic availability'; END IF;
 IF EXISTS(SELECT 1 FROM "DOCTOR_WORKING_HOURS" a JOIN "DOCTOR_WORKING_HOURS" b ON a."Doctor_ID"=b."Doctor_ID" AND a."Day_Of_Week"=b."Day_Of_Week" AND (a."Clinic_ID",a."Start_Time")<(b."Clinic_ID",b."Start_Time")
 WHERE a."Is_Active" AND b."Is_Active" AND a."Start_Time"<b."End_Time" AND b."Start_Time"<a."End_Time") THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Doctor weekly hours overlap across clinics'; END IF;
 IF EXISTS(SELECT 1 FROM "CLINIC_WORKING_HOURS" a JOIN "CLINIC_WORKING_HOURS" b ON a."Clinic_ID"=b."Clinic_ID" AND a."Day_Of_Week"=b."Day_Of_Week" AND a."Start_Time"<b."Start_Time" WHERE b."Start_Time"<a."End_Time") THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Overlapping clinic weekly hours'; END IF;
 -- Visit, procedure stage and invoice participant integrity.
 IF EXISTS(SELECT 1 FROM "VISIT" v JOIN "BOOKING" b USING("Booking_ID") WHERE b."Booking_Status" NOT IN ('in_progress','completed') OR (v."Visit_Status"='completed' AND b."Booking_Status"<>'completed') OR (v."Report_Approved_At" IS NOT NULL AND v."Report_Approved_At"<COALESCE(v."Actual_Completed_At",b."Appointment_Date"+b."Start_Time")) OR (v."Suggested_Date" IS NOT NULL AND v."Suggested_Date"<COALESCE(v."Actual_Completed_At"::date,b."Appointment_Date"))) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visit requires performed booking and valid report/follow-up dates'; END IF;
 IF EXISTS(SELECT 1 FROM "PROCEDURE" q JOIN "VISIT" v USING("Visit_ID") JOIN "BOOKING" b USING("Booking_ID") JOIN "TREATMENT_STAGE" s USING("Stage_ID") JOIN "TREATMENT_PLAN" p ON p."Plan_ID"=s."Plan_ID"
 WHERE b."Plan_ID" IS DISTINCT FROM p."Plan_ID" OR (b."Patient_ID",b."Clinic_ID",b."Doctor_ID") IS DISTINCT FROM (p."Patient_ID",p."Clinic_ID",p."Doctor_ID"))
 OR EXISTS(SELECT 1 FROM "PROCEDURE" q JOIN "VISIT" v USING("Visit_ID") JOIN "BOOKING" b USING("Booking_ID") WHERE NOT EXISTS(SELECT 1 FROM "PROVIDES" p WHERE (p."Clinic_ID",p."Doctor_ID",p."Service_ID")=(b."Clinic_ID",b."Doctor_ID",q."Service_ID"))) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Procedure/stage must belong to visit plan and provided clinic service'; END IF;
 IF EXISTS(SELECT 1 FROM "INVOICE" i JOIN "VISIT" v USING("Visit_ID") JOIN "BOOKING" b USING("Booking_ID") WHERE (i."Patient_ID",i."Clinic_ID") IS DISTINCT FROM (b."Patient_ID",b."Clinic_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice patient/clinic must match visit'; END IF;
 -- Minimum child counts are deferred until transaction end: insert parent and children together.
 IF EXISTS(SELECT 1 FROM "INVOICE" i WHERE NOT EXISTS(SELECT 1 FROM "INVOICE_INVOICE_ITEMS" x WHERE x."Invoice_ID"=i."Invoice_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Every invoice requires at least one item'; END IF;
 IF EXISTS(SELECT 1 FROM "PRESCRIPTION" p WHERE p."Prescription_Status"='issued' AND NOT EXISTS(SELECT 1 FROM "PRESCRIPTION_MEDICATIONS" x WHERE x."Prescription_ID"=p."Prescription_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Issued prescription requires at least one medication'; END IF;
 IF EXISTS(SELECT 1 FROM invoice_balances WHERE remaining_amount<0 OR (paid_amount>0 AND "Invoice_Status"<>'issued')) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Overpayment or payment against draft/void invoice'; END IF;
 IF EXISTS(SELECT 1 FROM "RECORDS_PAYMENT" p JOIN "INVOICE" i USING("Invoice_ID") WHERE p."Paid_At"<i."Issued_At") THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment cannot precede invoice issue'; END IF;
 -- Settlement membership can never make an ineligible appointment payable.
 IF EXISTS(SELECT 1 FROM "BOOKING" b JOIN booking_commissions c USING("Booking_ID") JOIN "SETTLEMENT" s ON s."Settlement_ID"=b."Settlement_ID"
 WHERE NOT c.eligible OR b."Clinic_ID"<>s."Clinic_ID" OR b."Appointment_Date" NOT BETWEEN s."Period_Start" AND s."Period_End") THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Settlement requires completed/issued/fully-paid booking of same clinic/period'; END IF;
 IF EXISTS(SELECT 1 FROM settlement_balances WHERE remaining_amount<0) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Settlement payment exceeds commission due'; END IF;
 -- Stock cannot go negative at any chronological point, not just in final balance.
 IF EXISTS(SELECT 1 FROM (SELECT sum("Quantity_Change") OVER(PARTITION BY "Item_ID" ORDER BY "Movement_At","Movement_ID") q FROM "STOCK_MOVEMENT") x WHERE q<0)
 OR EXISTS(SELECT 1 FROM "STOCK_MOVEMENT" a WHERE a."Movement_Type"='opening_balance' AND EXISTS(SELECT 1 FROM "STOCK_MOVEMENT" b WHERE b."Item_ID"=a."Item_ID" AND (b."Movement_At",b."Movement_ID")<(a."Movement_At",a."Movement_ID"))) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Stock would become negative or opening balance is not first'; END IF;
 -- Shared laboratory must be linked to clinic of originating visit.
 IF EXISTS(SELECT 1 FROM "LAB_ORDER" l JOIN "VISIT" v USING("Visit_ID") JOIN "BOOKING" b USING("Booking_ID") WHERE NOT EXISTS(SELECT 1 FROM "WORKS_WITH" w WHERE w."Clinic_ID"=b."Clinic_ID" AND w."Laboratory_ID"=l."Laboratory_ID")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Laboratory must be linked to visit clinic'; END IF;
 IF EXISTS(SELECT 1 FROM "LAB_ORDER_ITEMS" x JOIN "LAB_ORDER" l USING("Lab_Order_ID") WHERE x."Installed_At" IS NOT NULL AND (l."Order_Status"<>'received' OR l."Received_At" IS NULL OR x."Installed_At"<l."Received_At")) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Laboratory item cannot be installed before receipt'; END IF;
 RETURN NULL;
END $$;


ALTER FUNCTION sdc.sdc_validate() OWNER TO postgres;

--
-- TOC entry 330 (class 1255 OID 33883)
-- Name: sdc_write_gate(); Type: FUNCTION; Schema: sdc; Owner: postgres
--

CREATE FUNCTION sdc.sdc_write_gate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sdc', 'pg_catalog'
    AS $$
BEGIN
 IF current_setting('transaction_isolation')='repeatable read' THEN RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Use READ COMMITTED or SERIALIZABLE for SDC writes'; END IF;
 PERFORM pg_advisory_xact_lock(534443,570406);
 RETURN NULL;
END $$;


ALTER FUNCTION sdc.sdc_write_gate() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 231 (class 1259 OID 32532)
-- Name: AI_ASSESSMENT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."AI_ASSESSMENT" (
    "Assessment_ID" bigint NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Assessment_Status" character varying(150) NOT NULL,
    "Symptoms_Summary" text,
    "Preliminary_Result" character varying(150),
    "Risk_Level" character varying(150),
    "Advice_Text" text,
    "Latitude" numeric(10,7),
    "Longitude" numeric(10,7),
    "Patient_ID" bigint NOT NULL,
    "Specialty_ID" bigint,
    CONSTRAINT "AI_ASSESSMENT_Latitude_check" CHECK ((("Latitude" >= ('-90'::integer)::numeric) AND ("Latitude" <= (90)::numeric))),
    CONSTRAINT "AI_ASSESSMENT_Longitude_check" CHECK ((("Longitude" >= ('-180'::integer)::numeric) AND ("Longitude" <= (180)::numeric))),
    CONSTRAINT "AI_ASSESSMENT_check" CHECK ((("Latitude" IS NULL) = ("Longitude" IS NULL))),
    CONSTRAINT ck_text_05a20cd871bf583ba1eb CHECK ((("Assessment_Status" IS NULL) OR (btrim(("Assessment_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_6f25540ebb7e51cca3d7 CHECK ((("Symptoms_Summary" IS NULL) OR (btrim("Symptoms_Summary") <> ''::text))),
    CONSTRAINT ck_text_8e8bca8e698f5ca1a4bd CHECK ((("Preliminary_Result" IS NULL) OR (btrim(("Preliminary_Result")::text) <> ''::text))),
    CONSTRAINT ck_text_92f6db3dfa69558c87c2 CHECK ((("Risk_Level" IS NULL) OR (btrim(("Risk_Level")::text) <> ''::text))),
    CONSTRAINT ck_text_fe5b396dac815ca98c4d CHECK ((("Advice_Text" IS NULL) OR (btrim("Advice_Text") <> ''::text)))
);


ALTER TABLE sdc."AI_ASSESSMENT" OWNER TO postgres;

--
-- TOC entry 288 (class 1259 OID 33640)
-- Name: AI_ASSESSMENT_Assessment_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."AI_ASSESSMENT" ALTER COLUMN "Assessment_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."AI_ASSESSMENT_Assessment_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 264 (class 1259 OID 32959)
-- Name: AI_ASSESSMENT_MESSAGES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."AI_ASSESSMENT_MESSAGES" (
    "Message_ID" bigint NOT NULL,
    "Message_Order" integer NOT NULL,
    "Sender_Type" character varying(150) NOT NULL,
    "Message_Text" text NOT NULL,
    "Sent_At" timestamp without time zone NOT NULL,
    "Assessment_ID" bigint NOT NULL,
    CONSTRAINT "AI_ASSESSMENT_MESSAGES_Message_Order_check" CHECK (("Message_Order" > 0)),
    CONSTRAINT ck_text_63fbc4e38b50543fad03 CHECK ((("Message_Text" IS NULL) OR (btrim("Message_Text") <> ''::text))),
    CONSTRAINT ck_text_7791554705e8584593b4 CHECK ((("Sender_Type" IS NULL) OR (btrim(("Sender_Type")::text) <> ''::text)))
);


ALTER TABLE sdc."AI_ASSESSMENT_MESSAGES" OWNER TO postgres;

--
-- TOC entry 308 (class 1259 OID 33739)
-- Name: AI_ASSESSMENT_MESSAGES_Message_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."AI_ASSESSMENT_MESSAGES" ALTER COLUMN "Message_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."AI_ASSESSMENT_MESSAGES_Message_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 237 (class 1259 OID 32625)
-- Name: AI_RECOMMENDATION; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."AI_RECOMMENDATION" (
    "Recommendation_ID" bigint NOT NULL,
    "Recommendation_Order" integer NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Suggested_Date" date NOT NULL,
    "Suggested_Start_Time" time without time zone NOT NULL,
    "Price_Snapshot" numeric(12,2) NOT NULL,
    "Duration_Minutes_Snapshot" integer NOT NULL,
    "Distance_Km_Snapshot" numeric(10,3),
    "Recommendation_Reason" text NOT NULL,
    "Assessment_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Service_ID" bigint NOT NULL,
    CONSTRAINT "AI_RECOMMENDATION_Distance_Km_Snapshot_check" CHECK (("Distance_Km_Snapshot" >= (0)::numeric)),
    CONSTRAINT "AI_RECOMMENDATION_Duration_Minutes_Snapshot_check" CHECK (("Duration_Minutes_Snapshot" > 0)),
    CONSTRAINT "AI_RECOMMENDATION_Price_Snapshot_check" CHECK (("Price_Snapshot" >= (0)::numeric)),
    CONSTRAINT "AI_RECOMMENDATION_Recommendation_Order_check" CHECK (("Recommendation_Order" > 0)),
    CONSTRAINT ck_text_dc7a55728bb15263b2e0 CHECK ((("Recommendation_Reason" IS NULL) OR (btrim("Recommendation_Reason") <> ''::text)))
);


ALTER TABLE sdc."AI_RECOMMENDATION" OWNER TO postgres;

--
-- TOC entry 294 (class 1259 OID 33671)
-- Name: AI_RECOMMENDATION_Recommendation_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."AI_RECOMMENDATION" ALTER COLUMN "Recommendation_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."AI_RECOMMENDATION_Recommendation_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 248 (class 1259 OID 32763)
-- Name: APPLIES_FOR; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."APPLIES_FOR" (
    "Application_ID" bigint NOT NULL,
    "Application_Status" character varying(150) NOT NULL,
    "Applied_At" timestamp without time zone NOT NULL,
    "Expected_Salary" numeric(12,2),
    "Cover_Letter" text,
    "Internal_Notes" text,
    "Clinic_Feedback" text,
    "Sharing_Consent_At" timestamp without time zone NOT NULL,
    "Full_Name" character varying(150) NOT NULL,
    "Email" character varying(254) NOT NULL,
    "Phone" character varying(30) NOT NULL,
    "Residence_City" character varying(150) NOT NULL,
    "Specialty_Name" character varying(150) NOT NULL,
    "License_Number" character varying(150) NOT NULL,
    "License_Status" character varying(150) NOT NULL,
    "Years_Of_Experience" integer NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    "Job_ID" bigint NOT NULL,
    CONSTRAINT "APPLIES_FOR_Expected_Salary_check" CHECK (("Expected_Salary" >= (0)::numeric)),
    CONSTRAINT "APPLIES_FOR_Years_Of_Experience_check" CHECK (("Years_Of_Experience" >= 0)),
    CONSTRAINT ck_applies_for_application_status CHECK ((("Application_Status")::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'withdrawn'::character varying])::text[]))),
    CONSTRAINT ck_text_26753ae1cfe25995a1e0 CHECK ((("Email" IS NULL) OR (btrim(("Email")::text) <> ''::text))),
    CONSTRAINT ck_text_2f20fbc1ce6f5cac9eef CHECK ((("Clinic_Feedback" IS NULL) OR (btrim("Clinic_Feedback") <> ''::text))),
    CONSTRAINT ck_text_3ab063cca58b5abda667 CHECK ((("Residence_City" IS NULL) OR (btrim(("Residence_City")::text) <> ''::text))),
    CONSTRAINT ck_text_7417ab6b1fbc5bb6b9c6 CHECK ((("License_Number" IS NULL) OR (btrim(("License_Number")::text) <> ''::text))),
    CONSTRAINT ck_text_9a1e1d475fdb54e2986d CHECK ((("Internal_Notes" IS NULL) OR (btrim("Internal_Notes") <> ''::text))),
    CONSTRAINT ck_text_bf6292012a395dfa871c CHECK ((("Application_Status" IS NULL) OR (btrim(("Application_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_c66af5bc3f2a5a50ab92 CHECK ((("Full_Name" IS NULL) OR (btrim(("Full_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_d9531f7cee7352308282 CHECK ((("Specialty_Name" IS NULL) OR (btrim(("Specialty_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_dc251e9c3d295f53b39d CHECK ((("Phone" IS NULL) OR (btrim(("Phone")::text) <> ''::text))),
    CONSTRAINT ck_text_dd94a28a40ef5389ab93 CHECK ((("Cover_Letter" IS NULL) OR (btrim("Cover_Letter") <> ''::text))),
    CONSTRAINT ck_text_e849a844fbf45fea9c86 CHECK ((("License_Status" IS NULL) OR (btrim(("License_Status")::text) <> ''::text)))
);


ALTER TABLE sdc."APPLIES_FOR" OWNER TO postgres;

--
-- TOC entry 299 (class 1259 OID 33694)
-- Name: APPLIES_FOR_Application_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."APPLIES_FOR" ALTER COLUMN "Application_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."APPLIES_FOR_Application_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 235 (class 1259 OID 32600)
-- Name: AUDIT_LOG; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."AUDIT_LOG" (
    "Log_ID" bigint NOT NULL,
    "Occurred_At" timestamp without time zone NOT NULL,
    "Action_Type" character varying(150) NOT NULL,
    "Target_Type" character varying(150) NOT NULL,
    "Target_Reference" character varying(512),
    "Description" text NOT NULL,
    "Reason" text,
    "User_ID" bigint,
    CONSTRAINT ck_text_263a364c08355f78b973 CHECK ((("Target_Type" IS NULL) OR (btrim(("Target_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_750adf225bcb5ad7a999 CHECK ((("Action_Type" IS NULL) OR (btrim(("Action_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_9c5d3cd189e0544ea697 CHECK ((("Reason" IS NULL) OR (btrim("Reason") <> ''::text))),
    CONSTRAINT ck_text_f2296c41016d5cf79c67 CHECK ((("Description" IS NULL) OR (btrim("Description") <> ''::text))),
    CONSTRAINT ck_text_f9aa1ae109cb5f6bbc91 CHECK ((("Target_Reference" IS NULL) OR (btrim(("Target_Reference")::text) <> ''::text)))
);


ALTER TABLE sdc."AUDIT_LOG" OWNER TO postgres;

--
-- TOC entry 266 (class 1259 OID 32989)
-- Name: AUDIT_LOG_CHANGES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."AUDIT_LOG_CHANGES" (
    "Field_Name" character varying(150) NOT NULL,
    "Old_Value" text,
    "New_Value" text,
    "Log_ID" bigint NOT NULL,
    CONSTRAINT ck_text_4ea1587f3f4757aaa0a9 CHECK ((("Old_Value" IS NULL) OR (btrim("Old_Value") <> ''::text))),
    CONSTRAINT ck_text_a1bd56ce3378590a8a5e CHECK ((("Field_Name" IS NULL) OR (btrim(("Field_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_eccd8318625b5a79bc96 CHECK ((("New_Value" IS NULL) OR (btrim("New_Value") <> ''::text)))
);


ALTER TABLE sdc."AUDIT_LOG_CHANGES" OWNER TO postgres;

--
-- TOC entry 292 (class 1259 OID 33659)
-- Name: AUDIT_LOG_Log_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."AUDIT_LOG" ALTER COLUMN "Log_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."AUDIT_LOG_Log_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 233 (class 1259 OID 32557)
-- Name: BOOKING; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."BOOKING" (
    "Booking_ID" bigint NOT NULL,
    "Appointment_Date" date NOT NULL,
    "Start_Time" time without time zone NOT NULL,
    "Duration_Minutes_Snapshot" integer NOT NULL,
    "Service_Price_Snapshot" numeric(12,2) NOT NULL,
    "Booking_Status" character varying(150) NOT NULL,
    "Booking_Source" character varying(150) NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Patient_Notes" text,
    "Administrative_Notes" text,
    "Requested_Date" date,
    "Requested_Start_Time" time without time zone,
    "Change_Request_Reason" text,
    "Request_Source" character varying(150),
    "Requested_At" timestamp without time zone,
    "Request_Status" character varying(150),
    "Resolved_At" timestamp without time zone,
    "Doctor_Rating" smallint,
    "Clinic_Rating" smallint,
    "Review_Comment" character varying(150),
    "Reviewed_At" timestamp without time zone,
    "Patient_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    "Service_ID" bigint NOT NULL,
    "Plan_ID" bigint,
    "Settlement_ID" bigint,
    "Commission_Rate_Snapshot" numeric(5,2),
    "Created_By_User_ID" bigint NOT NULL,
    "Recommendation_ID" bigint,
    "Follow_Up_Of_Visit_ID" bigint,
    "Arrived_At" timestamp without time zone,
    CONSTRAINT "BOOKING_Clinic_Rating_check" CHECK ((("Clinic_Rating" >= 1) AND ("Clinic_Rating" <= 5))),
    CONSTRAINT "BOOKING_Commission_Rate_Snapshot_check" CHECK ((("Commission_Rate_Snapshot" >= (0)::numeric) AND ("Commission_Rate_Snapshot" <= (100)::numeric))),
    CONSTRAINT "BOOKING_Doctor_Rating_check" CHECK ((("Doctor_Rating" >= 1) AND ("Doctor_Rating" <= 5))),
    CONSTRAINT "BOOKING_Duration_Minutes_Snapshot_check" CHECK (("Duration_Minutes_Snapshot" > 0)),
    CONSTRAINT "BOOKING_Service_Price_Snapshot_check" CHECK (("Service_Price_Snapshot" >= (0)::numeric)),
    CONSTRAINT "BOOKING_check1" CHECK (((("Reviewed_At" IS NULL) AND ("Doctor_Rating" IS NULL) AND ("Clinic_Rating" IS NULL) AND ("Review_Comment" IS NULL)) OR (("Reviewed_At" IS NOT NULL) AND ("Doctor_Rating" IS NOT NULL) AND ("Clinic_Rating" IS NOT NULL)))),
    CONSTRAINT "BOOKING_check2" CHECK (((("Request_Status" IS NULL) AND ("Requested_Date" IS NULL) AND ("Requested_Start_Time" IS NULL) AND ("Change_Request_Reason" IS NULL) AND ("Request_Source" IS NULL) AND ("Requested_At" IS NULL) AND ("Resolved_At" IS NULL)) OR (("Request_Status" IS NOT NULL) AND ("Requested_Date" IS NOT NULL) AND ("Requested_Start_Time" IS NOT NULL) AND ("Change_Request_Reason" IS NOT NULL) AND ("Request_Source" IS NOT NULL) AND ("Requested_At" IS NOT NULL)))),
    CONSTRAINT ck_booking_booking_source CHECK ((("Booking_Source")::text = ANY ((ARRAY['manual'::character varying, 'ai'::character varying])::text[]))),
    CONSTRAINT ck_booking_booking_status CHECK ((("Booking_Status")::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'rejected'::character varying, 'no_show'::character varying])::text[]))),
    CONSTRAINT ck_booking_request_source CHECK ((("Request_Source")::text = ANY ((ARRAY['patient'::character varying, 'clinic'::character varying, 'doctor'::character varying])::text[]))),
    CONSTRAINT ck_booking_request_status CHECK ((("Request_Status")::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT ck_booking_same_day CHECK (((("Start_Time" + make_interval(mins => "Duration_Minutes_Snapshot")) > "Start_Time") AND ("Duration_Minutes_Snapshot" < 1440))),
    CONSTRAINT ck_request_resolution CHECK ((("Request_Status" IS NULL) OR ((("Request_Status")::text = 'pending'::text) AND ("Resolved_At" IS NULL)) OR ((("Request_Status")::text = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying])::text[])) AND ("Resolved_At" IS NOT NULL) AND ("Resolved_At" >= "Requested_At")))),
    CONSTRAINT ck_review_completed CHECK ((("Reviewed_At" IS NULL) OR ((("Booking_Status")::text = 'completed'::text) AND ("Reviewed_At" >= ("Appointment_Date" + "Start_Time"))))),
    CONSTRAINT ck_sdc_booking_settlement_rate CHECK ((("Settlement_ID" IS NULL) OR ("Commission_Rate_Snapshot" IS NOT NULL))),
    CONSTRAINT ck_text_445b63b0cfbe5db9b46f CHECK ((("Patient_Notes" IS NULL) OR (btrim("Patient_Notes") <> ''::text))),
    CONSTRAINT ck_text_5b1622ff72fd5edb9543 CHECK ((("Booking_Source" IS NULL) OR (btrim(("Booking_Source")::text) <> ''::text))),
    CONSTRAINT ck_text_5b5dc9ae516b5ce9ac57 CHECK ((("Request_Status" IS NULL) OR (btrim(("Request_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_5dada0ea745755278936 CHECK ((("Change_Request_Reason" IS NULL) OR (btrim("Change_Request_Reason") <> ''::text))),
    CONSTRAINT ck_text_6b0e5efa929d586d9d4d CHECK ((("Administrative_Notes" IS NULL) OR (btrim("Administrative_Notes") <> ''::text))),
    CONSTRAINT ck_text_aa01976c98bf5698b6d5 CHECK ((("Review_Comment" IS NULL) OR (btrim(("Review_Comment")::text) <> ''::text))),
    CONSTRAINT ck_text_ebff31504ef75c81be03 CHECK ((("Booking_Status" IS NULL) OR (btrim(("Booking_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_f96f818427575153bef4 CHECK ((("Request_Source" IS NULL) OR (btrim(("Request_Source")::text) <> ''::text)))
);


ALTER TABLE sdc."BOOKING" OWNER TO postgres;

--
-- TOC entry 290 (class 1259 OID 33647)
-- Name: BOOKING_Booking_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."BOOKING" ALTER COLUMN "Booking_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."BOOKING_Booking_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 224 (class 1259 OID 32429)
-- Name: CLINIC; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."CLINIC" (
    "Clinic_ID" bigint NOT NULL,
    "Clinic_Name" character varying(150) NOT NULL,
    "Clinic_Phone" character varying(30) NOT NULL,
    "Clinic_Email" character varying(254) NOT NULL,
    "Description" text,
    "Facility_License_Number" character varying(150) NOT NULL,
    "Clinic_Status" character varying(150) NOT NULL,
    "Online_Booking_Enabled" boolean NOT NULL,
    "Area" character varying(150) NOT NULL,
    "City" character varying(150) NOT NULL,
    "Address_Text" text NOT NULL,
    "Latitude" numeric(10,7) NOT NULL,
    "Longitude" numeric(10,7) NOT NULL,
    "Approval_Status" character varying(150) NOT NULL,
    "Application_Notes" text,
    "Review_Notes" text,
    "Submitted_At" timestamp without time zone NOT NULL,
    "Reviewed_At" timestamp without time zone,
    "Manager_Doctor_ID" bigint NOT NULL,
    "Reviewed_By_User_ID" bigint,
    CONSTRAINT "CLINIC_Latitude_check" CHECK ((("Latitude" >= ('-90'::integer)::numeric) AND ("Latitude" <= (90)::numeric))),
    CONSTRAINT "CLINIC_Longitude_check" CHECK ((("Longitude" >= ('-180'::integer)::numeric) AND ("Longitude" <= (180)::numeric))),
    CONSTRAINT "CLINIC_Online_Booking_Enabled_check" CHECK (("Online_Booking_Enabled" = ANY (ARRAY[true, false]))),
    CONSTRAINT ck_clinic_approval_status CHECK ((("Approval_Status")::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT ck_clinic_clinic_status CHECK ((("Clinic_Status")::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'inactive'::character varying])::text[]))),
    CONSTRAINT ck_text_2a3fd4fe8d7a58e0a125 CHECK ((("Clinic_Phone" IS NULL) OR (btrim(("Clinic_Phone")::text) <> ''::text))),
    CONSTRAINT ck_text_4856684ac33454a58bc2 CHECK ((("Application_Notes" IS NULL) OR (btrim("Application_Notes") <> ''::text))),
    CONSTRAINT ck_text_4e6167bacb3e5185b9b8 CHECK ((("Clinic_Name" IS NULL) OR (btrim(("Clinic_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_5409b216b4d955e9b8fc CHECK ((("Area" IS NULL) OR (btrim(("Area")::text) <> ''::text))),
    CONSTRAINT ck_text_5a3c4676842e51fa8473 CHECK ((("City" IS NULL) OR (btrim(("City")::text) <> ''::text))),
    CONSTRAINT ck_text_7d282dcb939a5e79a5c2 CHECK ((("Description" IS NULL) OR (btrim("Description") <> ''::text))),
    CONSTRAINT ck_text_93447f429ef55c50bbc5 CHECK ((("Review_Notes" IS NULL) OR (btrim("Review_Notes") <> ''::text))),
    CONSTRAINT ck_text_95874d8d2bbd521aa12b CHECK ((("Clinic_Email" IS NULL) OR (btrim(("Clinic_Email")::text) <> ''::text))),
    CONSTRAINT ck_text_95c98b58fb6858ffa4ee CHECK ((("Facility_License_Number" IS NULL) OR (btrim(("Facility_License_Number")::text) <> ''::text))),
    CONSTRAINT ck_text_9df1b86d4c6358308eac CHECK ((("Approval_Status" IS NULL) OR (btrim(("Approval_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_ad42e3e42bc05528a57f CHECK ((("Clinic_Status" IS NULL) OR (btrim(("Clinic_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_c5664c461ac65689933c CHECK ((("Address_Text" IS NULL) OR (btrim("Address_Text") <> ''::text)))
);


ALTER TABLE sdc."CLINIC" OWNER TO postgres;

--
-- TOC entry 281 (class 1259 OID 33600)
-- Name: CLINIC_Clinic_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."CLINIC" ALTER COLUMN "Clinic_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."CLINIC_Clinic_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 260 (class 1259 OID 32900)
-- Name: CLINIC_DOCUMENTS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."CLINIC_DOCUMENTS" (
    "Document_ID" bigint NOT NULL,
    "Document_Type" character varying(150) NOT NULL,
    "File_Reference" character varying(512) NOT NULL,
    "File_Name" character varying(512) NOT NULL,
    "Version_Number" integer NOT NULL,
    "Uploaded_At" timestamp without time zone NOT NULL,
    "Review_Status" character varying(150) NOT NULL,
    "Is_Current" boolean NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    CONSTRAINT "CLINIC_DOCUMENTS_Is_Current_check" CHECK (("Is_Current" = ANY (ARRAY[true, false]))),
    CONSTRAINT "CLINIC_DOCUMENTS_Version_Number_check" CHECK (("Version_Number" > 0)),
    CONSTRAINT ck_text_0bd90f4f49375f1b8e0f CHECK ((("File_Name" IS NULL) OR (btrim(("File_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_2df6eb0a4d665049aa97 CHECK ((("Review_Status" IS NULL) OR (btrim(("Review_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_5f5a54e3c50f5215b252 CHECK ((("File_Reference" IS NULL) OR (btrim(("File_Reference")::text) <> ''::text))),
    CONSTRAINT ck_text_f2f654a7e77352539a68 CHECK ((("Document_Type" IS NULL) OR (btrim(("Document_Type")::text) <> ''::text)))
);


ALTER TABLE sdc."CLINIC_DOCUMENTS" OWNER TO postgres;

--
-- TOC entry 305 (class 1259 OID 33729)
-- Name: CLINIC_DOCUMENTS_Document_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."CLINIC_DOCUMENTS" ALTER COLUMN "Document_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."CLINIC_DOCUMENTS_Document_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 262 (class 1259 OID 32930)
-- Name: CLINIC_WORKING_EXCEPTIONS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."CLINIC_WORKING_EXCEPTIONS" (
    "Exception_Date" date NOT NULL,
    "Exception_Type" character varying(150) NOT NULL,
    "Start_Time" time without time zone,
    "End_Time" time without time zone,
    "Reason" text NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Exception_ID" bigint NOT NULL,
    CONSTRAINT ck_clinic_working_exceptions_exception_type CHECK ((("Exception_Type")::text = ANY ((ARRAY['closed'::character varying, 'custom_hours'::character varying])::text[]))),
    CONSTRAINT ck_exception_hours CHECK ((((("Exception_Type")::text = 'closed'::text) AND ("Start_Time" IS NULL) AND ("End_Time" IS NULL)) OR ((("Exception_Type")::text = 'custom_hours'::text) AND ("Start_Time" IS NOT NULL) AND ("End_Time" IS NOT NULL) AND ("End_Time" > "Start_Time")))),
    CONSTRAINT ck_text_2038b316f6bd58f79fd2 CHECK ((("Exception_Type" IS NULL) OR (btrim(("Exception_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_2a769eb7f99a528a9e18 CHECK ((("Reason" IS NULL) OR (btrim("Reason") <> ''::text)))
);


ALTER TABLE sdc."CLINIC_WORKING_EXCEPTIONS" OWNER TO postgres;

--
-- TOC entry 306 (class 1259 OID 33734)
-- Name: CLINIC_WORKING_EXCEPTIONS_Exception_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."CLINIC_WORKING_EXCEPTIONS" ALTER COLUMN "Exception_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."CLINIC_WORKING_EXCEPTIONS_Exception_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 261 (class 1259 OID 32920)
-- Name: CLINIC_WORKING_HOURS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."CLINIC_WORKING_HOURS" (
    "Day_Of_Week" smallint NOT NULL,
    "Start_Time" time without time zone NOT NULL,
    "End_Time" time without time zone NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    CONSTRAINT "CLINIC_WORKING_HOURS_Day_Of_Week_check" CHECK ((("Day_Of_Week" >= 0) AND ("Day_Of_Week" <= 6))),
    CONSTRAINT ck_clinic_working_hours_range CHECK (("End_Time" > "Start_Time"))
);


ALTER TABLE sdc."CLINIC_WORKING_HOURS" OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 32405)
-- Name: DOCTOR; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."DOCTOR" (
    "Doctor_ID" bigint NOT NULL,
    "License_Number" character varying(150) NOT NULL,
    "License_Status" character varying(150) NOT NULL,
    "License_Review_Notes" text,
    "License_Submission_Note" text,
    "Years_Of_Experience" integer,
    "Bio" text,
    "User_ID" bigint NOT NULL,
    "License_Reviewed_By_User_ID" bigint,
    CONSTRAINT "DOCTOR_Years_Of_Experience_check" CHECK (("Years_Of_Experience" >= 0)),
    CONSTRAINT ck_doctor_license_status CHECK ((("License_Status")::text = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT ck_text_1aa1b2f150765bd08be7 CHECK ((("License_Number" IS NULL) OR (btrim(("License_Number")::text) <> ''::text))),
    CONSTRAINT ck_text_2dfc00c7358d54829eb8 CHECK ((("Bio" IS NULL) OR (btrim("Bio") <> ''::text))),
    CONSTRAINT ck_text_4ee6cbdacab255f0b57e CHECK ((("License_Status" IS NULL) OR (btrim(("License_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_9981eac30e945e979461 CHECK ((("License_Review_Notes" IS NULL) OR (btrim("License_Review_Notes") <> ''::text))),
    CONSTRAINT ck_text_f8aa6005ed43555d8e37 CHECK ((("License_Submission_Note" IS NULL) OR (btrim("License_Submission_Note") <> ''::text)))
);


ALTER TABLE sdc."DOCTOR" OWNER TO postgres;

--
-- TOC entry 273 (class 1259 OID 33065)
-- Name: DOCTOR_ABSENCES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."DOCTOR_ABSENCES" (
    "From_Date" date NOT NULL,
    "To_Date" date NOT NULL,
    "Reason" text NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    "Absence_ID" bigint NOT NULL,
    CONSTRAINT "DOCTOR_ABSENCES_check" CHECK (("To_Date" >= "From_Date")),
    CONSTRAINT ck_text_2eb4a73c58a252eabedb CHECK ((("Reason" IS NULL) OR (btrim("Reason") <> ''::text)))
);


ALTER TABLE sdc."DOCTOR_ABSENCES" OWNER TO postgres;

--
-- TOC entry 313 (class 1259 OID 33764)
-- Name: DOCTOR_ABSENCES_Absence_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."DOCTOR_ABSENCES" ALTER COLUMN "Absence_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."DOCTOR_ABSENCES_Absence_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 279 (class 1259 OID 33591)
-- Name: DOCTOR_Doctor_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."DOCTOR" ALTER COLUMN "Doctor_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."DOCTOR_Doctor_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 272 (class 1259 OID 33052)
-- Name: DOCTOR_WORKING_HOURS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."DOCTOR_WORKING_HOURS" (
    "Day_Of_Week" smallint NOT NULL,
    "Start_Time" time without time zone NOT NULL,
    "End_Time" time without time zone NOT NULL,
    "Is_Active" boolean NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    CONSTRAINT "DOCTOR_WORKING_HOURS_Day_Of_Week_check" CHECK ((("Day_Of_Week" >= 0) AND ("Day_Of_Week" <= 6))),
    CONSTRAINT "DOCTOR_WORKING_HOURS_Is_Active_check" CHECK (("Is_Active" = ANY (ARRAY[true, false]))),
    CONSTRAINT ck_doctor_working_hours_range CHECK (("End_Time" > "Start_Time"))
);


ALTER TABLE sdc."DOCTOR_WORKING_HOURS" OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 32705)
-- Name: HAS_SPECIALTY; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."HAS_SPECIALTY" (
    "Doctor_ID" bigint NOT NULL,
    "Specialty_ID" bigint NOT NULL
);


ALTER TABLE sdc."HAS_SPECIALTY" OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 32485)
-- Name: INVENTORY_ITEM; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."INVENTORY_ITEM" (
    "Item_ID" bigint NOT NULL,
    "Item_Name" character varying(150) NOT NULL,
    "Category" character varying(150) NOT NULL,
    "Unit" character varying(150) NOT NULL,
    "Minimum_Quantity" numeric(12,2) NOT NULL,
    "Expiry_Date" date,
    "Clinic_ID" bigint NOT NULL,
    CONSTRAINT "INVENTORY_ITEM_Minimum_Quantity_check" CHECK (("Minimum_Quantity" >= (0)::numeric)),
    CONSTRAINT ck_text_2999f6c734785a7fb708 CHECK ((("Unit" IS NULL) OR (btrim(("Unit")::text) <> ''::text))),
    CONSTRAINT ck_text_b66fbf0c81e65d1c9015 CHECK ((("Category" IS NULL) OR (btrim(("Category")::text) <> ''::text))),
    CONSTRAINT ck_text_ee586b39079b513591c0 CHECK ((("Item_Name" IS NULL) OR (btrim(("Item_Name")::text) <> ''::text)))
);


ALTER TABLE sdc."INVENTORY_ITEM" OWNER TO postgres;

--
-- TOC entry 285 (class 1259 OID 33624)
-- Name: INVENTORY_ITEM_Item_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."INVENTORY_ITEM" ALTER COLUMN "Item_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."INVENTORY_ITEM_Item_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 230 (class 1259 OID 32518)
-- Name: INVOICE; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."INVOICE" (
    "Invoice_ID" bigint NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Issued_At" timestamp without time zone,
    "Invoice_Status" character varying(150) NOT NULL,
    "Voided_At" timestamp without time zone,
    "Void_Reason" text,
    "Patient_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Issued_By_User_ID" bigint,
    "Visit_ID" bigint,
    CONSTRAINT ck_invoice_chronology CHECK (((("Issued_At" IS NULL) OR ("Issued_At" >= "Created_At")) AND (("Voided_At" IS NULL) OR ("Voided_At" >= COALESCE("Issued_At", "Created_At"))))),
    CONSTRAINT ck_invoice_invoice_status CHECK ((("Invoice_Status")::text = ANY ((ARRAY['draft'::character varying, 'issued'::character varying, 'void'::character varying])::text[]))),
    CONSTRAINT ck_invoice_issue CHECK ((((("Invoice_Status")::text = 'draft'::text) AND ("Issued_At" IS NULL) AND ("Voided_At" IS NULL) AND ("Void_Reason" IS NULL)) OR ((("Invoice_Status")::text = 'issued'::text) AND ("Issued_At" IS NOT NULL) AND ("Voided_At" IS NULL) AND ("Void_Reason" IS NULL)) OR ((("Invoice_Status")::text = 'void'::text) AND ("Voided_At" IS NOT NULL) AND ("Void_Reason" IS NOT NULL)))),
    CONSTRAINT ck_invoice_issuer CHECK (((("Invoice_Status")::text <> 'issued'::text) OR ("Issued_By_User_ID" IS NOT NULL))),
    CONSTRAINT ck_text_415cdc2cfed75513a544 CHECK ((("Invoice_Status" IS NULL) OR (btrim(("Invoice_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_b465ec89b7b855158931 CHECK ((("Void_Reason" IS NULL) OR (btrim("Void_Reason") <> ''::text)))
);


ALTER TABLE sdc."INVOICE" OWNER TO postgres;

--
-- TOC entry 263 (class 1259 OID 32942)
-- Name: INVOICE_INVOICE_ITEMS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."INVOICE_INVOICE_ITEMS" (
    "Item_ID" bigint NOT NULL,
    "Description" text NOT NULL,
    "Quantity" numeric(12,2) NOT NULL,
    "Unit_Price" numeric(12,2) NOT NULL,
    "Discount_Amount" numeric(12,2) NOT NULL,
    "Invoice_ID" bigint NOT NULL,
    CONSTRAINT "INVOICE_INVOICE_ITEMS_Discount_Amount_check" CHECK (("Discount_Amount" >= (0)::numeric)),
    CONSTRAINT "INVOICE_INVOICE_ITEMS_Quantity_check" CHECK (("Quantity" > (0)::numeric)),
    CONSTRAINT "INVOICE_INVOICE_ITEMS_Unit_Price_check" CHECK (("Unit_Price" >= (0)::numeric)),
    CONSTRAINT "INVOICE_INVOICE_ITEMS_check" CHECK ((("Discount_Amount" >= (0)::numeric) AND ("Discount_Amount" <= ("Quantity" * "Unit_Price")))),
    CONSTRAINT ck_text_f6e5827923e356c5bb9d CHECK ((("Description" IS NULL) OR (btrim("Description") <> ''::text)))
);


ALTER TABLE sdc."INVOICE_INVOICE_ITEMS" OWNER TO postgres;

--
-- TOC entry 307 (class 1259 OID 33737)
-- Name: INVOICE_INVOICE_ITEMS_Item_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."INVOICE_INVOICE_ITEMS" ALTER COLUMN "Item_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."INVOICE_INVOICE_ITEMS_Item_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 287 (class 1259 OID 33637)
-- Name: INVOICE_Invoice_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."INVOICE" ALTER COLUMN "Invoice_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."INVOICE_Invoice_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 229 (class 1259 OID 32497)
-- Name: JOB; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."JOB" (
    "Job_ID" bigint NOT NULL,
    "Job_Title" character varying(150) NOT NULL,
    "Employment_Type" character varying(150) NOT NULL,
    "Minimum_Experience_Years" integer NOT NULL,
    "Application_Deadline" date NOT NULL,
    "Work_Schedule_Description" text NOT NULL,
    "Salary_Description" text NOT NULL,
    "Summary" text NOT NULL,
    "Responsibilities" text NOT NULL,
    "Requirements" text NOT NULL,
    "Job_Status" character varying(150) NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Specialty_ID" bigint NOT NULL,
    "Admin_Suspended_At" timestamp without time zone,
    CONSTRAINT "JOB_Minimum_Experience_Years_check" CHECK (("Minimum_Experience_Years" >= 0)),
    CONSTRAINT ck_job_employment_type CHECK ((("Employment_Type")::text = ANY ((ARRAY['full_time'::character varying, 'part_time'::character varying, 'contract'::character varying])::text[]))),
    CONSTRAINT ck_job_job_status CHECK ((("Job_Status")::text = ANY ((ARRAY['draft'::character varying, 'open'::character varying, 'closed'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT ck_sdc_job_admin_suspension_closed CHECK ((("Admin_Suspended_At" IS NULL) OR (("Job_Status")::text = 'closed'::text))),
    CONSTRAINT ck_text_025887215ec6505bb4bf CHECK ((("Responsibilities" IS NULL) OR (btrim("Responsibilities") <> ''::text))),
    CONSTRAINT ck_text_2107f829c0595ae5a110 CHECK ((("Job_Title" IS NULL) OR (btrim(("Job_Title")::text) <> ''::text))),
    CONSTRAINT ck_text_2640bcf525ce520096be CHECK ((("Salary_Description" IS NULL) OR (btrim("Salary_Description") <> ''::text))),
    CONSTRAINT ck_text_50fbc441766b5173b8a8 CHECK ((("Summary" IS NULL) OR (btrim("Summary") <> ''::text))),
    CONSTRAINT ck_text_bc84f0c9c9ab51c3a2ca CHECK ((("Work_Schedule_Description" IS NULL) OR (btrim("Work_Schedule_Description") <> ''::text))),
    CONSTRAINT ck_text_d1467caf5b8451e39274 CHECK ((("Job_Status" IS NULL) OR (btrim(("Job_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_ef42f46506f95d8ab83b CHECK ((("Requirements" IS NULL) OR (btrim("Requirements") <> ''::text))),
    CONSTRAINT ck_text_f7ee3e559f8c569f9794 CHECK ((("Employment_Type" IS NULL) OR (btrim(("Employment_Type")::text) <> ''::text)))
);


ALTER TABLE sdc."JOB" OWNER TO postgres;

--
-- TOC entry 274 (class 1259 OID 33079)
-- Name: JOB_APPLICATION_ATTACHMENTS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."JOB_APPLICATION_ATTACHMENTS" (
    "Attachment_ID" bigint NOT NULL,
    "Attachment_Type" character varying(150) NOT NULL,
    "File_Name" character varying(512) NOT NULL,
    "File_Reference" character varying(512) NOT NULL,
    "Uploaded_At" timestamp without time zone NOT NULL,
    "Application_ID" bigint NOT NULL,
    CONSTRAINT ck_text_9c8fca8da2f1559589ed CHECK ((("File_Name" IS NULL) OR (btrim(("File_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_a9bd2c419b9650fc8bac CHECK ((("Attachment_Type" IS NULL) OR (btrim(("Attachment_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_c951f9c650c45a719153 CHECK ((("File_Reference" IS NULL) OR (btrim(("File_Reference")::text) <> ''::text)))
);


ALTER TABLE sdc."JOB_APPLICATION_ATTACHMENTS" OWNER TO postgres;

--
-- TOC entry 314 (class 1259 OID 33766)
-- Name: JOB_APPLICATION_ATTACHMENTS_Attachment_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."JOB_APPLICATION_ATTACHMENTS" ALTER COLUMN "Attachment_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."JOB_APPLICATION_ATTACHMENTS_Attachment_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 286 (class 1259 OID 33628)
-- Name: JOB_Job_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."JOB" ALTER COLUMN "Job_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."JOB_Job_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 227 (class 1259 OID 32476)
-- Name: LABORATORY; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."LABORATORY" (
    "Laboratory_ID" bigint NOT NULL,
    "Laboratory_Name" character varying(150) NOT NULL,
    "Phone" character varying(30) NOT NULL,
    "Address" character varying(150) NOT NULL,
    "Additional_Contact" character varying(150),
    "Is_Active" boolean DEFAULT true NOT NULL,
    CONSTRAINT ck_text_23eee570d8e15c2797ce CHECK ((("Phone" IS NULL) OR (btrim(("Phone")::text) <> ''::text))),
    CONSTRAINT ck_text_35bfc27e834c5effb08a CHECK ((("Additional_Contact" IS NULL) OR (btrim(("Additional_Contact")::text) <> ''::text))),
    CONSTRAINT ck_text_7cea50d5e71a5372a4a5 CHECK ((("Laboratory_Name" IS NULL) OR (btrim(("Laboratory_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_d847ca89b7395c929903 CHECK ((("Address" IS NULL) OR (btrim(("Address")::text) <> ''::text)))
);


ALTER TABLE sdc."LABORATORY" OWNER TO postgres;

--
-- TOC entry 284 (class 1259 OID 33619)
-- Name: LABORATORY_Laboratory_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."LABORATORY" ALTER COLUMN "Laboratory_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."LABORATORY_Laboratory_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 253 (class 1259 OID 32839)
-- Name: LAB_ORDER; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."LAB_ORDER" (
    "Lab_Order_ID" bigint NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Expected_Delivery_Date" date,
    "Order_Status" character varying(150) NOT NULL,
    "Sent_At" timestamp without time zone,
    "Received_At" timestamp without time zone,
    "Notes" text,
    "Attachment_Reference" character varying(512),
    "Laboratory_ID" bigint NOT NULL,
    "Visit_ID" bigint NOT NULL,
    CONSTRAINT ck_lab_dates CHECK (((("Sent_At" IS NULL) OR ("Sent_At" >= "Created_At")) AND (("Received_At" IS NULL) OR (("Sent_At" IS NOT NULL) AND ("Received_At" >= "Sent_At"))) AND ((("Order_Status")::text <> ALL ((ARRAY['sent'::character varying, 'received'::character varying])::text[])) OR ("Sent_At" IS NOT NULL)) AND ((("Order_Status")::text <> 'received'::text) OR ("Received_At" IS NOT NULL)))),
    CONSTRAINT ck_lab_order_order_status CHECK ((("Order_Status")::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'received'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT ck_text_4ec6d0afbd335d55a53e CHECK ((("Attachment_Reference" IS NULL) OR (btrim(("Attachment_Reference")::text) <> ''::text))),
    CONSTRAINT ck_text_7fd4772475a65cb790a4 CHECK ((("Notes" IS NULL) OR (btrim("Notes") <> ''::text))),
    CONSTRAINT ck_text_e360f3475e1a50de8d98 CHECK ((("Order_Status" IS NULL) OR (btrim(("Order_Status")::text) <> ''::text)))
);


ALTER TABLE sdc."LAB_ORDER" OWNER TO postgres;

--
-- TOC entry 276 (class 1259 OID 33100)
-- Name: LAB_ORDER_ITEMS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."LAB_ORDER_ITEMS" (
    "Lab_Item_ID" bigint NOT NULL,
    "Work_Type" character varying(150) NOT NULL,
    "Tooth_Number" smallint,
    "Region_Description" text,
    "Quantity" numeric(12,2) NOT NULL,
    "Material" character varying(150),
    "Shade" character varying(150),
    "Instructions" text,
    "Installed_At" timestamp without time zone,
    "Lab_Order_ID" bigint NOT NULL,
    CONSTRAINT "LAB_ORDER_ITEMS_Quantity_check" CHECK (("Quantity" > (0)::numeric)),
    CONSTRAINT ck_lab_order_items_tooth CHECK ((("Tooth_Number" IS NULL) OR (((("Tooth_Number" / 10) >= 1) AND (("Tooth_Number" / 10) <= 4)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 8))) OR (((("Tooth_Number" / 10) >= 5) AND (("Tooth_Number" / 10) <= 8)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 5))))),
    CONSTRAINT ck_text_1a9c763b5dfd5b2a8955 CHECK ((("Instructions" IS NULL) OR (btrim("Instructions") <> ''::text))),
    CONSTRAINT ck_text_a314a2ae1451544ebb6d CHECK ((("Material" IS NULL) OR (btrim(("Material")::text) <> ''::text))),
    CONSTRAINT ck_text_b7dd46a477df57908bba CHECK ((("Region_Description" IS NULL) OR (btrim("Region_Description") <> ''::text))),
    CONSTRAINT ck_text_b7e26821294d5e9fb451 CHECK ((("Shade" IS NULL) OR (btrim(("Shade")::text) <> ''::text))),
    CONSTRAINT ck_text_f8ab9ec5dac85bf2a9c0 CHECK ((("Work_Type" IS NULL) OR (btrim(("Work_Type")::text) <> ''::text)))
);


ALTER TABLE sdc."LAB_ORDER_ITEMS" OWNER TO postgres;

--
-- TOC entry 315 (class 1259 OID 33771)
-- Name: LAB_ORDER_ITEMS_Lab_Item_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."LAB_ORDER_ITEMS" ALTER COLUMN "Lab_Item_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."LAB_ORDER_ITEMS_Lab_Item_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 303 (class 1259 OID 33716)
-- Name: LAB_ORDER_Lab_Order_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."LAB_ORDER" ALTER COLUMN "Lab_Order_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."LAB_ORDER_Lab_Order_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 236 (class 1259 OID 32612)
-- Name: NOTIFICATION; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."NOTIFICATION" (
    "Notification_ID" bigint NOT NULL,
    "Title" character varying(150) NOT NULL,
    "Body" text NOT NULL,
    "Notification_Type" character varying(150) NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Read_At" timestamp without time zone,
    "Target_Type" character varying(150),
    "Target_Reference" character varying(512),
    "User_ID" bigint NOT NULL,
    "Dismissed_At" timestamp without time zone,
    CONSTRAINT ck_text_34b31f552c485094a86a CHECK ((("Title" IS NULL) OR (btrim(("Title")::text) <> ''::text))),
    CONSTRAINT ck_text_63c3c9d5d198507eb22d CHECK ((("Body" IS NULL) OR (btrim("Body") <> ''::text))),
    CONSTRAINT ck_text_9fd6d389231557519886 CHECK ((("Target_Type" IS NULL) OR (btrim(("Target_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_b574de0456015c30be80 CHECK ((("Notification_Type" IS NULL) OR (btrim(("Notification_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_b967d8be20ea5de1b7ed CHECK ((("Target_Reference" IS NULL) OR (btrim(("Target_Reference")::text) <> ''::text)))
);


ALTER TABLE sdc."NOTIFICATION" OWNER TO postgres;

--
-- TOC entry 326 (class 1259 OID 40611)
-- Name: NOTIFICATION_DUPLICATES_BACKUP_015_FIX; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."NOTIFICATION_DUPLICATES_BACKUP_015_FIX" (
    "Notification_ID" bigint,
    "Title" character varying(150),
    "Body" text,
    "Notification_Type" character varying(150),
    "Created_At" timestamp without time zone,
    "Read_At" timestamp without time zone,
    "Target_Type" character varying(150),
    "Target_Reference" character varying(512),
    "User_ID" bigint,
    "Dismissed_At" timestamp without time zone
);


ALTER TABLE sdc."NOTIFICATION_DUPLICATES_BACKUP_015_FIX" OWNER TO postgres;

--
-- TOC entry 293 (class 1259 OID 33665)
-- Name: NOTIFICATION_Notification_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."NOTIFICATION" ALTER COLUMN "Notification_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."NOTIFICATION_Notification_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 244 (class 1259 OID 32723)
-- Name: OFFERS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."OFFERS" (
    "Price" numeric(12,2) NOT NULL,
    "Duration_Minutes" integer NOT NULL,
    "Allows_Installments" boolean NOT NULL,
    "Is_Available" boolean NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Service_ID" bigint NOT NULL,
    CONSTRAINT "OFFERS_Allows_Installments_check" CHECK (("Allows_Installments" = ANY (ARRAY[true, false]))),
    CONSTRAINT "OFFERS_Duration_Minutes_check" CHECK (("Duration_Minutes" > 0)),
    CONSTRAINT "OFFERS_Is_Available_check" CHECK (("Is_Available" = ANY (ARRAY[true, false]))),
    CONSTRAINT "OFFERS_Price_check" CHECK (("Price" >= (0)::numeric))
);


ALTER TABLE sdc."OFFERS" OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 32390)
-- Name: PATIENT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PATIENT" (
    "Patient_ID" bigint NOT NULL,
    "Date_Of_Birth" date NOT NULL,
    "Gender" character varying(150) NOT NULL,
    "Blood_Type" character varying(10) NOT NULL,
    "Health_Notes" text NOT NULL,
    "User_ID" bigint NOT NULL,
    CONSTRAINT ck_birth CHECK (("Date_Of_Birth" <= CURRENT_DATE)),
    CONSTRAINT ck_blood CHECK ((("Blood_Type")::text = ANY ((ARRAY['A+'::character varying, 'A-'::character varying, 'B+'::character varying, 'B-'::character varying, 'AB+'::character varying, 'AB-'::character varying, 'O+'::character varying, 'O-'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_text_663f8a1ee22f59019d58 CHECK ((("Blood_Type" IS NULL) OR (btrim(("Blood_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_8cf527a349f25ba386df CHECK ((("Gender" IS NULL) OR (btrim(("Gender")::text) <> ''::text))),
    CONSTRAINT ck_text_fe9f82cc4c065cd484ca CHECK ((("Health_Notes" IS NULL) OR (btrim("Health_Notes") <> ''::text)))
);


ALTER TABLE sdc."PATIENT" OWNER TO postgres;

--
-- TOC entry 257 (class 1259 OID 32879)
-- Name: PATIENT_ALLERGIES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PATIENT_ALLERGIES" (
    "Allergies" character varying(150) NOT NULL,
    "Patient_ID" bigint NOT NULL,
    CONSTRAINT ck_text_d4b02b9c059e5e578f39 CHECK ((("Allergies" IS NULL) OR (btrim(("Allergies")::text) <> ''::text)))
);


ALTER TABLE sdc."PATIENT_ALLERGIES" OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 32886)
-- Name: PATIENT_CHRONIC_DISEASES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PATIENT_CHRONIC_DISEASES" (
    "Chronic_Diseases" character varying(150) NOT NULL,
    "Patient_ID" bigint NOT NULL,
    CONSTRAINT ck_text_a8b8d264a95a5c8cbb58 CHECK ((("Chronic_Diseases" IS NULL) OR (btrim(("Chronic_Diseases")::text) <> ''::text)))
);


ALTER TABLE sdc."PATIENT_CHRONIC_DISEASES" OWNER TO postgres;

--
-- TOC entry 259 (class 1259 OID 32893)
-- Name: PATIENT_CURRENT_MEDICATIONS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PATIENT_CURRENT_MEDICATIONS" (
    "Current_Medications" character varying(150) NOT NULL,
    "Patient_ID" bigint NOT NULL,
    CONSTRAINT ck_text_c14f5d935df055a593e9 CHECK ((("Current_Medications" IS NULL) OR (btrim(("Current_Medications")::text) <> ''::text)))
);


ALTER TABLE sdc."PATIENT_CURRENT_MEDICATIONS" OWNER TO postgres;

--
-- TOC entry 278 (class 1259 OID 33587)
-- Name: PATIENT_Patient_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."PATIENT" ALTER COLUMN "Patient_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."PATIENT_Patient_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 234 (class 1259 OID 32589)
-- Name: PRESCRIPTION; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PRESCRIPTION" (
    "Prescription_ID" bigint NOT NULL,
    "Prescription_Status" character varying(150) NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Issued_At" timestamp without time zone,
    "Voided_At" timestamp without time zone,
    "Void_Reason" text,
    "Visit_ID" bigint NOT NULL,
    CONSTRAINT ck_prescription_chronology CHECK (((("Issued_At" IS NULL) OR ("Issued_At" >= "Created_At")) AND (("Voided_At" IS NULL) OR ("Voided_At" >= COALESCE("Issued_At", "Created_At"))))),
    CONSTRAINT ck_prescription_issue CHECK ((((("Prescription_Status")::text = 'draft'::text) AND ("Issued_At" IS NULL) AND ("Voided_At" IS NULL) AND ("Void_Reason" IS NULL)) OR ((("Prescription_Status")::text = 'issued'::text) AND ("Issued_At" IS NOT NULL) AND ("Voided_At" IS NULL) AND ("Void_Reason" IS NULL)) OR ((("Prescription_Status")::text = 'void'::text) AND ("Voided_At" IS NOT NULL) AND ("Void_Reason" IS NOT NULL)))),
    CONSTRAINT ck_prescription_prescription_status CHECK ((("Prescription_Status")::text = ANY ((ARRAY['draft'::character varying, 'issued'::character varying, 'void'::character varying])::text[]))),
    CONSTRAINT ck_text_54efd094b9eb513e936a CHECK ((("Void_Reason" IS NULL) OR (btrim("Void_Reason") <> ''::text))),
    CONSTRAINT ck_text_595a778516b15e6bae1e CHECK ((("Prescription_Status" IS NULL) OR (btrim(("Prescription_Status")::text) <> ''::text)))
);


ALTER TABLE sdc."PRESCRIPTION" OWNER TO postgres;

--
-- TOC entry 265 (class 1259 OID 32975)
-- Name: PRESCRIPTION_MEDICATIONS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PRESCRIPTION_MEDICATIONS" (
    "Medication_Name" character varying(150) NOT NULL,
    "Dosage" character varying(150) NOT NULL,
    "Frequency" character varying(150) NOT NULL,
    "Duration" character varying(150) NOT NULL,
    "Route" character varying(150) NOT NULL,
    "Instructions" text,
    "Prescription_ID" bigint NOT NULL,
    "Medication_ID" bigint NOT NULL,
    CONSTRAINT ck_text_1d10e672f74e5c02a6c5 CHECK ((("Route" IS NULL) OR (btrim(("Route")::text) <> ''::text))),
    CONSTRAINT ck_text_482cc7d8943a53ebab1d CHECK ((("Duration" IS NULL) OR (btrim(("Duration")::text) <> ''::text))),
    CONSTRAINT ck_text_6d4e2b535f985d398c79 CHECK ((("Instructions" IS NULL) OR (btrim("Instructions") <> ''::text))),
    CONSTRAINT ck_text_880b65f1d0d75b47bdbd CHECK ((("Medication_Name" IS NULL) OR (btrim(("Medication_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_9785f5110ff258899f2c CHECK ((("Dosage" IS NULL) OR (btrim(("Dosage")::text) <> ''::text))),
    CONSTRAINT ck_text_c34dc15b06c85861b69d CHECK ((("Frequency" IS NULL) OR (btrim(("Frequency")::text) <> ''::text)))
);


ALTER TABLE sdc."PRESCRIPTION_MEDICATIONS" OWNER TO postgres;

--
-- TOC entry 309 (class 1259 OID 33742)
-- Name: PRESCRIPTION_MEDICATIONS_Medication_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."PRESCRIPTION_MEDICATIONS" ALTER COLUMN "Medication_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."PRESCRIPTION_MEDICATIONS_Medication_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 291 (class 1259 OID 33656)
-- Name: PRESCRIPTION_Prescription_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."PRESCRIPTION" ALTER COLUMN "Prescription_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."PRESCRIPTION_Prescription_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 239 (class 1259 OID 32664)
-- Name: PROCEDURE; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PROCEDURE" (
    "Procedure_ID" bigint NOT NULL,
    "Tooth_Number" smallint,
    "Quantity" numeric(12,2) NOT NULL,
    "Unit_Price_Snapshot" numeric(12,2) NOT NULL,
    "Procedure_Status" character varying(150) NOT NULL,
    "Notes" text,
    "Visit_ID" bigint NOT NULL,
    "Service_ID" bigint NOT NULL,
    "Stage_ID" bigint,
    CONSTRAINT "PROCEDURE_Quantity_check" CHECK (("Quantity" > (0)::numeric)),
    CONSTRAINT "PROCEDURE_Unit_Price_Snapshot_check" CHECK (("Unit_Price_Snapshot" >= (0)::numeric)),
    CONSTRAINT ck_procedure_procedure_status CHECK ((("Procedure_Status")::text = ANY ((ARRAY['planned'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT ck_procedure_tooth CHECK ((("Tooth_Number" IS NULL) OR (((("Tooth_Number" / 10) >= 1) AND (("Tooth_Number" / 10) <= 4)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 8))) OR (((("Tooth_Number" / 10) >= 5) AND (("Tooth_Number" / 10) <= 8)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 5))))),
    CONSTRAINT ck_text_8df33a58e83156a5bd2d CHECK ((("Procedure_Status" IS NULL) OR (btrim(("Procedure_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_e0da1a59fda55af7b5a0 CHECK ((("Notes" IS NULL) OR (btrim("Notes") <> ''::text)))
);


ALTER TABLE sdc."PROCEDURE" OWNER TO postgres;

--
-- TOC entry 296 (class 1259 OID 33681)
-- Name: PROCEDURE_Procedure_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."PROCEDURE" ALTER COLUMN "Procedure_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."PROCEDURE_Procedure_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 245 (class 1259 OID 32738)
-- Name: PROVIDES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."PROVIDES" (
    "Clinic_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    "Service_ID" bigint NOT NULL
);


ALTER TABLE sdc."PROVIDES" OWNER TO postgres;

--
-- TOC entry 251 (class 1259 OID 32811)
-- Name: RECORDS_PAYMENT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."RECORDS_PAYMENT" (
    "Payment_ID" bigint NOT NULL,
    "Amount" numeric(12,2) NOT NULL,
    "Payment_Method" character varying(150) NOT NULL,
    "Paid_At" timestamp without time zone NOT NULL,
    "Reference_Number" character varying(512),
    "Invoice_ID" bigint NOT NULL,
    "User_ID" bigint NOT NULL,
    CONSTRAINT "RECORDS_PAYMENT_Amount_check" CHECK (("Amount" >= (0)::numeric)),
    CONSTRAINT ck_records_payment_payment_method CHECK ((("Payment_Method")::text = ANY ((ARRAY['cash'::character varying, 'card'::character varying, 'bank_transfer'::character varying])::text[]))),
    CONSTRAINT ck_records_payment_positive CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT ck_text_108d7575838f53c1aebd CHECK ((("Reference_Number" IS NULL) OR (btrim(("Reference_Number")::text) <> ''::text))),
    CONSTRAINT ck_text_d6c55d1dfeea5d66ac8e CHECK ((("Payment_Method" IS NULL) OR (btrim(("Payment_Method")::text) <> ''::text)))
);


ALTER TABLE sdc."RECORDS_PAYMENT" OWNER TO postgres;

--
-- TOC entry 301 (class 1259 OID 33710)
-- Name: RECORDS_PAYMENT_Payment_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."RECORDS_PAYMENT" ALTER COLUMN "Payment_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."RECORDS_PAYMENT_Payment_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 252 (class 1259 OID 32825)
-- Name: RECORDS_SETTLEMENT_PAYMENT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."RECORDS_SETTLEMENT_PAYMENT" (
    "Settlement_Payment_ID" bigint NOT NULL,
    "Amount" numeric(12,2) NOT NULL,
    "Payment_Method" character varying(150) NOT NULL,
    "Paid_At" timestamp without time zone NOT NULL,
    "Reference_Number" character varying(512),
    "Settlement_ID" bigint NOT NULL,
    "User_ID" bigint NOT NULL,
    CONSTRAINT "RECORDS_SETTLEMENT_PAYMENT_Amount_check" CHECK (("Amount" >= (0)::numeric)),
    CONSTRAINT ck_records_settlement_payment_payment_method CHECK ((("Payment_Method")::text = ANY ((ARRAY['cash'::character varying, 'card'::character varying, 'bank_transfer'::character varying])::text[]))),
    CONSTRAINT ck_records_settlement_payment_positive CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT ck_text_70754920474a59279a6b CHECK ((("Reference_Number" IS NULL) OR (btrim(("Reference_Number")::text) <> ''::text))),
    CONSTRAINT ck_text_a53b3eb38a205f998759 CHECK ((("Payment_Method" IS NULL) OR (btrim(("Payment_Method")::text) <> ''::text)))
);


ALTER TABLE sdc."RECORDS_SETTLEMENT_PAYMENT" OWNER TO postgres;

--
-- TOC entry 302 (class 1259 OID 33713)
-- Name: RECORDS_SETTLEMENT_PAYMENT_Settlement_Payment_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."RECORDS_SETTLEMENT_PAYMENT" ALTER COLUMN "Settlement_Payment_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."RECORDS_SETTLEMENT_PAYMENT_Settlement_Payment_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 246 (class 1259 OID 32746)
-- Name: REGISTERED_AT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."REGISTERED_AT" (
    "Patient_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL
);


ALTER TABLE sdc."REGISTERED_AT" OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 32694)
-- Name: ROLE; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."ROLE" (
    "Role_ID" bigint NOT NULL,
    "Role_Name" character varying(150) NOT NULL,
    "Role_Scope" character varying(150) NOT NULL,
    CONSTRAINT "ROLE_Role_Scope_check" CHECK ((("Role_Scope")::text = ANY ((ARRAY['System'::character varying, 'Clinic'::character varying])::text[]))),
    CONSTRAINT ck_role_role_scope CHECK ((("Role_Scope")::text = ANY ((ARRAY['System'::character varying, 'Clinic'::character varying])::text[]))),
    CONSTRAINT ck_system_role_names CHECK (((("Role_Scope")::text <> 'System'::text) OR (("Role_Name")::text = ANY ((ARRAY['Super Admin'::character varying, 'Doctor'::character varying, 'Patient'::character varying, 'Staff'::character varying])::text[])))),
    CONSTRAINT ck_text_36a840f6dff95b88991e CHECK ((("Role_Scope" IS NULL) OR (btrim(("Role_Scope")::text) <> ''::text))),
    CONSTRAINT ck_text_7427fad376cb5029b685 CHECK ((("Role_Name" IS NULL) OR (btrim(("Role_Name")::text) <> ''::text)))
);


ALTER TABLE sdc."ROLE" OWNER TO postgres;

--
-- TOC entry 298 (class 1259 OID 33687)
-- Name: ROLE_Role_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."ROLE" ALTER COLUMN "Role_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."ROLE_Role_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 225 (class 1259 OID 32454)
-- Name: SERVICE; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."SERVICE" (
    "Service_ID" bigint NOT NULL,
    "Service_Name" character varying(150) NOT NULL,
    CONSTRAINT ck_text_de80b2fda4d151cea5cc CHECK ((("Service_Name" IS NULL) OR (btrim(("Service_Name")::text) <> ''::text)))
);


ALTER TABLE sdc."SERVICE" OWNER TO postgres;

--
-- TOC entry 282 (class 1259 OID 33613)
-- Name: SERVICE_Service_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."SERVICE" ALTER COLUMN "Service_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."SERVICE_Service_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 232 (class 1259 OID 32546)
-- Name: SETTLEMENT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."SETTLEMENT" (
    "Settlement_ID" bigint NOT NULL,
    "Period_Start" date NOT NULL,
    "Period_End" date NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Due_Date" date,
    CONSTRAINT "SETTLEMENT_check" CHECK (("Period_End" >= "Period_Start"))
);


ALTER TABLE sdc."SETTLEMENT" OWNER TO postgres;

--
-- TOC entry 289 (class 1259 OID 33646)
-- Name: SETTLEMENT_Settlement_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."SETTLEMENT" ALTER COLUMN "Settlement_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."SETTLEMENT_Settlement_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 223 (class 1259 OID 32419)
-- Name: SPECIALTY; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."SPECIALTY" (
    "Specialty_ID" bigint NOT NULL,
    "Name_AR" character varying(150) NOT NULL,
    "Name_EN" character varying(150) NOT NULL,
    "Is_Active" boolean NOT NULL,
    CONSTRAINT "SPECIALTY_Is_Active_check" CHECK (("Is_Active" = ANY (ARRAY[true, false]))),
    CONSTRAINT ck_text_0e755c351574579e9fa9 CHECK ((("Name_EN" IS NULL) OR (btrim(("Name_EN")::text) <> ''::text))),
    CONSTRAINT ck_text_84f8807c0d8254f9ae9c CHECK ((("Name_AR" IS NULL) OR (btrim(("Name_AR")::text) <> ''::text)))
);


ALTER TABLE sdc."SPECIALTY" OWNER TO postgres;

--
-- TOC entry 280 (class 1259 OID 33597)
-- Name: SPECIALTY_Specialty_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."SPECIALTY" ALTER COLUMN "Specialty_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."SPECIALTY_Specialty_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 249 (class 1259 OID 32788)
-- Name: STAFF_AT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."STAFF_AT" (
    "Membership_Status" character varying(150) NOT NULL,
    "User_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    "Role_ID" bigint NOT NULL,
    CONSTRAINT ck_staff_at_membership_status CHECK ((("Membership_Status")::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'inactive'::character varying])::text[]))),
    CONSTRAINT ck_text_8dbb4e680e8a57c7bc9b CHECK ((("Membership_Status" IS NULL) OR (btrim(("Membership_Status")::text) <> ''::text)))
);


ALTER TABLE sdc."STAFF_AT" OWNER TO postgres;

--
-- TOC entry 275 (class 1259 OID 33092)
-- Name: STAFF_PERMISSIONS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."STAFF_PERMISSIONS" (
    "Permission_Code" character varying(150) NOT NULL,
    "User_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    CONSTRAINT ck_text_5fe9755529275b45a181 CHECK ((("Permission_Code" IS NULL) OR (btrim(("Permission_Code")::text) <> ''::text)))
);


ALTER TABLE sdc."STAFF_PERMISSIONS" OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 32797)
-- Name: STOCK_MOVEMENT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."STOCK_MOVEMENT" (
    "Movement_ID" bigint NOT NULL,
    "Movement_Type" character varying(150) NOT NULL,
    "Quantity_Change" numeric(12,2) NOT NULL,
    "Movement_At" timestamp without time zone NOT NULL,
    "Reason" text,
    "Item_ID" bigint NOT NULL,
    "User_ID" bigint NOT NULL,
    CONSTRAINT "STOCK_MOVEMENT_Quantity_Change_check" CHECK (("Quantity_Change" <> (0)::numeric)),
    CONSTRAINT ck_stock_movement_movement_type CHECK ((("Movement_Type")::text = ANY ((ARRAY['opening_balance'::character varying, 'purchase'::character varying, 'usage'::character varying, 'adjustment'::character varying])::text[]))),
    CONSTRAINT ck_stock_sign CHECK ((((("Movement_Type")::text = ANY ((ARRAY['opening_balance'::character varying, 'purchase'::character varying])::text[])) AND ("Quantity_Change" > (0)::numeric)) OR ((("Movement_Type")::text = 'usage'::text) AND ("Quantity_Change" < (0)::numeric)) OR ((("Movement_Type")::text = 'adjustment'::text) AND ("Quantity_Change" <> (0)::numeric)))),
    CONSTRAINT ck_text_575e447345fb54e69b62 CHECK ((("Reason" IS NULL) OR (btrim("Reason") <> ''::text))),
    CONSTRAINT ck_text_99a81591f59056db8cd0 CHECK ((("Movement_Type" IS NULL) OR (btrim(("Movement_Type")::text) <> ''::text)))
);


ALTER TABLE sdc."STOCK_MOVEMENT" OWNER TO postgres;

--
-- TOC entry 300 (class 1259 OID 33707)
-- Name: STOCK_MOVEMENT_Movement_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."STOCK_MOVEMENT" ALTER COLUMN "Movement_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."STOCK_MOVEMENT_Movement_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 226 (class 1259 OID 32461)
-- Name: TREATMENT_PLAN; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."TREATMENT_PLAN" (
    "Plan_ID" bigint NOT NULL,
    "Plan_Name" character varying(150) NOT NULL,
    "Plan_Status" character varying(150) NOT NULL,
    "Start_Date" date NOT NULL,
    "Estimated_Cost" numeric(12,2),
    "Notes" text,
    "Patient_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    "Clinic_ID" bigint NOT NULL,
    CONSTRAINT "TREATMENT_PLAN_Estimated_Cost_check" CHECK (("Estimated_Cost" >= (0)::numeric)),
    CONSTRAINT ck_text_2d5e98e17f5e5cbb8a25 CHECK ((("Plan_Name" IS NULL) OR (btrim(("Plan_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_3583afffb8a052dca498 CHECK ((("Notes" IS NULL) OR (btrim("Notes") <> ''::text))),
    CONSTRAINT ck_text_379e63c292e854cabddc CHECK ((("Plan_Status" IS NULL) OR (btrim(("Plan_Status")::text) <> ''::text))),
    CONSTRAINT ck_treatment_plan_plan_status CHECK ((("Plan_Status")::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE sdc."TREATMENT_PLAN" OWNER TO postgres;

--
-- TOC entry 283 (class 1259 OID 33615)
-- Name: TREATMENT_PLAN_Plan_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."TREATMENT_PLAN" ALTER COLUMN "Plan_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."TREATMENT_PLAN_Plan_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 240 (class 1259 OID 32679)
-- Name: TREATMENT_STAGE; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."TREATMENT_STAGE" (
    "Stage_ID" bigint NOT NULL,
    "Stage_Order" integer NOT NULL,
    "Tooth_Number" smallint,
    "Description" text NOT NULL,
    "Stage_Status" character varying(150) NOT NULL,
    "Plan_ID" bigint NOT NULL,
    CONSTRAINT "TREATMENT_STAGE_Stage_Order_check" CHECK (("Stage_Order" > 0)),
    CONSTRAINT ck_text_2ecbd850749d5baa9bf7 CHECK ((("Stage_Status" IS NULL) OR (btrim(("Stage_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_b8cd0d7f27eb5a8d845f CHECK ((("Description" IS NULL) OR (btrim("Description") <> ''::text))),
    CONSTRAINT ck_treatment_stage_stage_status CHECK ((("Stage_Status")::text = ANY ((ARRAY['planned'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT ck_treatment_stage_tooth CHECK ((("Tooth_Number" IS NULL) OR (((("Tooth_Number" / 10) >= 1) AND (("Tooth_Number" / 10) <= 4)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 8))) OR (((("Tooth_Number" / 10) >= 5) AND (("Tooth_Number" / 10) <= 8)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 5)))))
);


ALTER TABLE sdc."TREATMENT_STAGE" OWNER TO postgres;

--
-- TOC entry 297 (class 1259 OID 33684)
-- Name: TREATMENT_STAGE_Stage_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."TREATMENT_STAGE" ALTER COLUMN "Stage_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."TREATMENT_STAGE_Stage_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 220 (class 1259 OID 32366)
-- Name: USER; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."USER" (
    "User_ID" bigint NOT NULL,
    "First_Name" character varying(150) NOT NULL,
    "Last_Name" character varying(150) NOT NULL,
    "Email" character varying(254),
    "Phone" character varying(30) NOT NULL,
    "Password_Hash" character varying(512),
    "Account_Status" character varying(150) NOT NULL,
    "Created_At" timestamp without time zone NOT NULL,
    "Last_Login_At" timestamp without time zone,
    "Preferred_Language" character varying(10) NOT NULL,
    "Two_Factor_Enabled" boolean NOT NULL,
    "Two_Factor_Secret_Encrypted" character varying(512),
    "Password_Reset_Token_Hash" character varying(512),
    "Password_Reset_Expires_At" timestamp without time zone,
    "Login_Enabled" boolean NOT NULL,
    "Role_ID" bigint NOT NULL,
    CONSTRAINT "USER_Login_Enabled_check" CHECK (("Login_Enabled" = ANY (ARRAY[true, false]))),
    CONSTRAINT "USER_Two_Factor_Enabled_check" CHECK (("Two_Factor_Enabled" = ANY (ARRAY[true, false]))),
    CONSTRAINT "USER_check" CHECK (((NOT "Login_Enabled") OR (("Email" IS NOT NULL) AND ("Password_Hash" IS NOT NULL)))),
    CONSTRAINT "USER_check1" CHECK ((("Password_Reset_Token_Hash" IS NULL) = ("Password_Reset_Expires_At" IS NULL))),
    CONSTRAINT "USER_check2" CHECK (((NOT "Two_Factor_Enabled") OR ("Two_Factor_Secret_Encrypted" IS NOT NULL))),
    CONSTRAINT ck_text_3a7868ac74e85667ba9d CHECK ((("Last_Name" IS NULL) OR (btrim(("Last_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_3e82759d63be5a5298a9 CHECK ((("Preferred_Language" IS NULL) OR (btrim(("Preferred_Language")::text) <> ''::text))),
    CONSTRAINT ck_text_407b7fb2d3085fb1900c CHECK ((("Password_Hash" IS NULL) OR (btrim(("Password_Hash")::text) <> ''::text))),
    CONSTRAINT ck_text_41bb6d56d415559db496 CHECK ((("First_Name" IS NULL) OR (btrim(("First_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_4b71b22ea76f5909a973 CHECK ((("Email" IS NULL) OR (btrim(("Email")::text) <> ''::text))),
    CONSTRAINT ck_text_4b8695197b6d5eed9043 CHECK ((("Phone" IS NULL) OR (btrim(("Phone")::text) <> ''::text))),
    CONSTRAINT ck_text_61cdcfc1f11a5ebca5f3 CHECK ((("Two_Factor_Secret_Encrypted" IS NULL) OR (btrim(("Two_Factor_Secret_Encrypted")::text) <> ''::text))),
    CONSTRAINT ck_text_b1367752b27653a29774 CHECK ((("Password_Reset_Token_Hash" IS NULL) OR (btrim(("Password_Reset_Token_Hash")::text) <> ''::text))),
    CONSTRAINT ck_text_e0b2613488605d0f895c CHECK ((("Account_Status" IS NULL) OR (btrim(("Account_Status")::text) <> ''::text))),
    CONSTRAINT ck_user_account_status CHECK ((("Account_Status")::text = ANY ((ARRAY['active'::character varying, 'pending'::character varying, 'suspended'::character varying, 'disabled'::character varying])::text[]))),
    CONSTRAINT ck_user_preferred_language CHECK ((("Preferred_Language")::text = ANY ((ARRAY['ar'::character varying, 'en'::character varying])::text[])))
);


ALTER TABLE sdc."USER" OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 32870)
-- Name: USER_POLICY_CONSENTS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."USER_POLICY_CONSENTS" (
    "Policy_Type" character varying(150) NOT NULL,
    "Policy_Version" character varying(150) NOT NULL,
    "Accepted_At" timestamp without time zone NOT NULL,
    "User_ID" bigint NOT NULL,
    CONSTRAINT ck_text_d9548945a7505167a523 CHECK ((("Policy_Type" IS NULL) OR (btrim(("Policy_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_f42a12846ce954b8b8a8 CHECK ((("Policy_Version" IS NULL) OR (btrim(("Policy_Version")::text) <> ''::text)))
);


ALTER TABLE sdc."USER_POLICY_CONSENTS" OWNER TO postgres;

--
-- TOC entry 255 (class 1259 OID 32861)
-- Name: USER_RECOVERY_CODES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."USER_RECOVERY_CODES" (
    "Code_Hash" character varying(512) NOT NULL,
    "Used_At" timestamp without time zone,
    "User_ID" bigint NOT NULL,
    CONSTRAINT ck_text_07f2ae8440f058d49c54 CHECK ((("Code_Hash" IS NULL) OR (btrim(("Code_Hash")::text) <> ''::text)))
);


ALTER TABLE sdc."USER_RECOVERY_CODES" OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 32851)
-- Name: USER_SESSIONS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."USER_SESSIONS" (
    "Session_ID" bigint NOT NULL,
    "Device_Info" character varying(150),
    "Browser" character varying(150),
    "Started_At" timestamp without time zone NOT NULL,
    "Expires_At" timestamp without time zone NOT NULL,
    "Revoked_At" timestamp without time zone,
    "User_ID" bigint NOT NULL,
    "Session_Token_Hash" character varying(64),
    "Last_Seen_At" timestamp without time zone,
    "Active_Clinic_ID" bigint,
    CONSTRAINT "USER_SESSIONS_check" CHECK (("Expires_At" > "Started_At")),
    CONSTRAINT ck_session_revoke CHECK ((("Revoked_At" IS NULL) OR ("Revoked_At" >= "Started_At"))),
    CONSTRAINT ck_text_59e068180fcc552986e3 CHECK ((("Device_Info" IS NULL) OR (btrim(("Device_Info")::text) <> ''::text))),
    CONSTRAINT ck_text_87fed474c51e5c029bf0 CHECK ((("Browser" IS NULL) OR (btrim(("Browser")::text) <> ''::text)))
);


ALTER TABLE sdc."USER_SESSIONS" OWNER TO postgres;

--
-- TOC entry 304 (class 1259 OID 33720)
-- Name: USER_SESSIONS_Session_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."USER_SESSIONS" ALTER COLUMN "Session_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."USER_SESSIONS_Session_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 277 (class 1259 OID 33577)
-- Name: USER_User_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."USER" ALTER COLUMN "User_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."USER_User_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 238 (class 1259 OID 32650)
-- Name: VISIT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."VISIT" (
    "Visit_ID" bigint NOT NULL,
    "Chief_Complaint" character varying(150) NOT NULL,
    "Examination_Notes" text,
    "Visit_Status" character varying(150) NOT NULL,
    "Follow_Up_Type" character varying(150),
    "Suggested_Date" date,
    "Follow_Up_Notes" text,
    "Report_Approved_At" timestamp without time zone,
    "Recommendations" text,
    "Approved_Report_File_Reference" character varying(512),
    "Booking_ID" bigint NOT NULL,
    "Actual_Started_At" timestamp without time zone,
    "Actual_Completed_At" timestamp without time zone,
    CONSTRAINT "VISIT_check" CHECK ((("Report_Approved_At" IS NULL) = ("Approved_Report_File_Reference" IS NULL))),
    CONSTRAINT ck_followup_pair CHECK (((("Follow_Up_Type" IS NULL) AND ("Suggested_Date" IS NULL) AND ("Follow_Up_Notes" IS NULL)) OR (("Follow_Up_Type" IS NOT NULL) AND ("Suggested_Date" IS NOT NULL)))),
    CONSTRAINT ck_report_completed CHECK ((("Report_Approved_At" IS NULL) OR (("Visit_Status")::text = 'completed'::text))),
    CONSTRAINT ck_report_pair CHECK ((("Report_Approved_At" IS NULL) = ("Approved_Report_File_Reference" IS NULL))),
    CONSTRAINT ck_text_00f50ad2dcb25189904c CHECK ((("Follow_Up_Type" IS NULL) OR (btrim(("Follow_Up_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_049d2ba2ac185b138c21 CHECK ((("Recommendations" IS NULL) OR (btrim("Recommendations") <> ''::text))),
    CONSTRAINT ck_text_5a9282b1706b56dcb406 CHECK ((("Examination_Notes" IS NULL) OR (btrim("Examination_Notes") <> ''::text))),
    CONSTRAINT ck_text_76fbc1eda3565753a4a4 CHECK ((("Approved_Report_File_Reference" IS NULL) OR (btrim(("Approved_Report_File_Reference")::text) <> ''::text))),
    CONSTRAINT ck_text_bc753aa1d6a6556c9c79 CHECK ((("Chief_Complaint" IS NULL) OR (btrim(("Chief_Complaint")::text) <> ''::text))),
    CONSTRAINT ck_text_d905f3c33f1b5b978600 CHECK ((("Visit_Status" IS NULL) OR (btrim(("Visit_Status")::text) <> ''::text))),
    CONSTRAINT ck_text_e83856cdf01d5deba5eb CHECK ((("Follow_Up_Notes" IS NULL) OR (btrim("Follow_Up_Notes") <> ''::text))),
    CONSTRAINT ck_visit_actual_times CHECK (((("Actual_Completed_At" IS NULL) OR (("Actual_Started_At" IS NOT NULL) AND ("Actual_Completed_At" >= "Actual_Started_At"))) AND (("Report_Approved_At" IS NULL) OR ("Actual_Completed_At" IS NULL) OR ("Report_Approved_At" >= "Actual_Completed_At")))),
    CONSTRAINT ck_visit_visit_status CHECK ((("Visit_Status")::text = ANY ((ARRAY['draft'::character varying, 'in_progress'::character varying, 'completed'::character varying])::text[])))
);


ALTER TABLE sdc."VISIT" OWNER TO postgres;

--
-- TOC entry 267 (class 1259 OID 32998)
-- Name: VISIT_CLINICAL_FINDINGS; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."VISIT_CLINICAL_FINDINGS" (
    "Clinical_Findings" text NOT NULL,
    "Visit_ID" bigint NOT NULL,
    CONSTRAINT ck_text_954b1de0cc5d5bad8c31 CHECK ((("Clinical_Findings" IS NULL) OR (btrim("Clinical_Findings") <> ''::text)))
);


ALTER TABLE sdc."VISIT_CLINICAL_FINDINGS" OWNER TO postgres;

--
-- TOC entry 270 (class 1259 OID 33026)
-- Name: VISIT_DIAGNOSES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."VISIT_DIAGNOSES" (
    "Tooth_Number" smallint NOT NULL,
    "Diagnosis_Text" text NOT NULL,
    "Visit_ID" bigint NOT NULL,
    "Diagnosis_ID" bigint NOT NULL,
    CONSTRAINT ck_text_81455e00c2c958d3a5ff CHECK ((("Diagnosis_Text" IS NULL) OR (btrim("Diagnosis_Text") <> ''::text))),
    CONSTRAINT ck_visit_diagnoses_tooth CHECK ((("Tooth_Number" IS NULL) OR (((("Tooth_Number" / 10) >= 1) AND (("Tooth_Number" / 10) <= 4)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 8))) OR (((("Tooth_Number" / 10) >= 5) AND (("Tooth_Number" / 10) <= 8)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 5)))))
);


ALTER TABLE sdc."VISIT_DIAGNOSES" OWNER TO postgres;

--
-- TOC entry 311 (class 1259 OID 33757)
-- Name: VISIT_DIAGNOSES_Diagnosis_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."VISIT_DIAGNOSES" ALTER COLUMN "Diagnosis_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."VISIT_DIAGNOSES_Diagnosis_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 268 (class 1259 OID 33007)
-- Name: VISIT_ODONTOGRAM; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."VISIT_ODONTOGRAM" (
    "Tooth_Number" smallint NOT NULL,
    "Tooth_Status" character varying(150) NOT NULL,
    "Visit_ID" bigint NOT NULL,
    CONSTRAINT ck_text_dedd9bff148b5a25ba37 CHECK ((("Tooth_Status" IS NULL) OR (btrim(("Tooth_Status")::text) <> ''::text))),
    CONSTRAINT ck_visit_odontogram_tooth CHECK ((("Tooth_Number" IS NULL) OR (((("Tooth_Number" / 10) >= 1) AND (("Tooth_Number" / 10) <= 4)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 8))) OR (((("Tooth_Number" / 10) >= 5) AND (("Tooth_Number" / 10) <= 8)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 5)))))
);


ALTER TABLE sdc."VISIT_ODONTOGRAM" OWNER TO postgres;

--
-- TOC entry 269 (class 1259 OID 33015)
-- Name: VISIT_TOOTH_SURFACE_NOTES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."VISIT_TOOTH_SURFACE_NOTES" (
    "Tooth_Number" smallint,
    "Surface" character varying(150) NOT NULL,
    "Note" text NOT NULL,
    "Visit_ID" bigint NOT NULL,
    "Note_ID" bigint NOT NULL,
    CONSTRAINT ck_text_80a8726f46195f9dba1f CHECK ((("Surface" IS NULL) OR (btrim(("Surface")::text) <> ''::text))),
    CONSTRAINT ck_text_faec567fd720538c843f CHECK ((("Note" IS NULL) OR (btrim("Note") <> ''::text))),
    CONSTRAINT ck_visit_tooth_surface_notes_tooth CHECK ((("Tooth_Number" IS NULL) OR (((("Tooth_Number" / 10) >= 1) AND (("Tooth_Number" / 10) <= 4)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 8))) OR (((("Tooth_Number" / 10) >= 5) AND (("Tooth_Number" / 10) <= 8)) AND (((("Tooth_Number")::integer % 10) >= 1) AND ((("Tooth_Number")::integer % 10) <= 5)))))
);


ALTER TABLE sdc."VISIT_TOOTH_SURFACE_NOTES" OWNER TO postgres;

--
-- TOC entry 310 (class 1259 OID 33754)
-- Name: VISIT_TOOTH_SURFACE_NOTES_Note_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."VISIT_TOOTH_SURFACE_NOTES" ALTER COLUMN "Note_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."VISIT_TOOTH_SURFACE_NOTES_Note_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 271 (class 1259 OID 33037)
-- Name: VISIT_VISIT_FILES; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."VISIT_VISIT_FILES" (
    "File_ID" bigint NOT NULL,
    "File_Name" character varying(512) NOT NULL,
    "File_Reference" character varying(512) NOT NULL,
    "Description" text,
    "Uploaded_At" timestamp without time zone NOT NULL,
    "Included_In_Report" boolean NOT NULL,
    "File_Type" character varying(150) NOT NULL,
    "Visit_ID" bigint NOT NULL,
    CONSTRAINT "VISIT_VISIT_FILES_Included_In_Report_check" CHECK (("Included_In_Report" = ANY (ARRAY[true, false]))),
    CONSTRAINT ck_text_2e27c02ab2865313b7c2 CHECK ((("Description" IS NULL) OR (btrim("Description") <> ''::text))),
    CONSTRAINT ck_text_3c9ad78f5baf5a1b9768 CHECK ((("File_Type" IS NULL) OR (btrim(("File_Type")::text) <> ''::text))),
    CONSTRAINT ck_text_92be42f46ced5910b9ee CHECK ((("File_Name" IS NULL) OR (btrim(("File_Name")::text) <> ''::text))),
    CONSTRAINT ck_text_c254fa1f904258489f09 CHECK ((("File_Reference" IS NULL) OR (btrim(("File_Reference")::text) <> ''::text)))
);


ALTER TABLE sdc."VISIT_VISIT_FILES" OWNER TO postgres;

--
-- TOC entry 312 (class 1259 OID 33759)
-- Name: VISIT_VISIT_FILES_File_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."VISIT_VISIT_FILES" ALTER COLUMN "File_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."VISIT_VISIT_FILES_File_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 295 (class 1259 OID 33673)
-- Name: VISIT_Visit_ID_seq; Type: SEQUENCE; Schema: sdc; Owner: postgres
--

ALTER TABLE sdc."VISIT" ALTER COLUMN "Visit_ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME sdc."VISIT_Visit_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 243 (class 1259 OID 32712)
-- Name: WORKS_AT; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."WORKS_AT" (
    "Start_Date" date NOT NULL,
    "Membership_Status" character varying(150) NOT NULL,
    "Admin_Notes" text,
    "Clinic_ID" bigint NOT NULL,
    "Doctor_ID" bigint NOT NULL,
    CONSTRAINT ck_text_4aa89ee6876c5276a923 CHECK ((("Admin_Notes" IS NULL) OR (btrim("Admin_Notes") <> ''::text))),
    CONSTRAINT ck_text_9d5fdd639aed54d7ae03 CHECK ((("Membership_Status" IS NULL) OR (btrim(("Membership_Status")::text) <> ''::text))),
    CONSTRAINT ck_works_at_membership_status CHECK ((("Membership_Status")::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'suspended'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE sdc."WORKS_AT" OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 32753)
-- Name: WORKS_WITH; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc."WORKS_WITH" (
    "Relationship_Status" character varying(150) NOT NULL,
    "Internal_Notes" text,
    "Clinic_ID" bigint NOT NULL,
    "Laboratory_ID" bigint NOT NULL,
    CONSTRAINT ck_text_38dd0a7b0a365f8e9bfe CHECK ((("Internal_Notes" IS NULL) OR (btrim("Internal_Notes") <> ''::text))),
    CONSTRAINT ck_text_f5abf104486758799ed3 CHECK ((("Relationship_Status" IS NULL) OR (btrim(("Relationship_Status")::text) <> ''::text))),
    CONSTRAINT ck_works_with_relationship_status CHECK ((("Relationship_Status")::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE sdc."WORKS_WITH" OWNER TO postgres;

--
-- TOC entry 316 (class 1259 OID 33836)
-- Name: invoice_balances; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.invoice_balances AS
 SELECT i."Invoice_ID",
    i."Created_At",
    i."Issued_At",
    i."Invoice_Status",
    i."Voided_At",
    i."Void_Reason",
    i."Patient_ID",
    i."Clinic_ID",
    i."Issued_By_User_ID",
    i."Visit_ID",
    (COALESCE(x.total, (0)::numeric))::numeric(16,2) AS total_amount,
    (COALESCE(p.paid, (0)::numeric))::numeric(16,2) AS paid_amount,
    ((COALESCE(x.total, (0)::numeric) - COALESCE(p.paid, (0)::numeric)))::numeric(16,2) AS remaining_amount,
        CASE
            WHEN ((i."Invoice_Status")::text = 'void'::text) THEN 'void'::text
            WHEN ((COALESCE(p.paid, (0)::numeric) = (0)::numeric) AND (COALESCE(x.total, (0)::numeric) > (0)::numeric)) THEN 'unpaid'::text
            WHEN (COALESCE(p.paid, (0)::numeric) >= COALESCE(x.total, (0)::numeric)) THEN 'paid'::text
            ELSE 'partial'::text
        END AS payment_status
   FROM ((sdc."INVOICE" i
     LEFT JOIN ( SELECT "INVOICE_INVOICE_ITEMS"."Invoice_ID",
            sum((("INVOICE_INVOICE_ITEMS"."Quantity" * "INVOICE_INVOICE_ITEMS"."Unit_Price") - "INVOICE_INVOICE_ITEMS"."Discount_Amount")) AS total
           FROM sdc."INVOICE_INVOICE_ITEMS"
          GROUP BY "INVOICE_INVOICE_ITEMS"."Invoice_ID") x USING ("Invoice_ID"))
     LEFT JOIN ( SELECT "RECORDS_PAYMENT"."Invoice_ID",
            sum("RECORDS_PAYMENT"."Amount") AS paid
           FROM sdc."RECORDS_PAYMENT"
          GROUP BY "RECORDS_PAYMENT"."Invoice_ID") p USING ("Invoice_ID"));


ALTER VIEW sdc.invoice_balances OWNER TO postgres;

--
-- TOC entry 318 (class 1259 OID 33846)
-- Name: booking_commissions; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.booking_commissions AS
 SELECT b."Booking_ID",
    b."Clinic_ID",
    b."Settlement_ID",
    b."Service_Price_Snapshot",
    b."Commission_Rate_Snapshot",
    ((((b."Booking_Status")::text = 'completed'::text) AND ((i."Invoice_Status")::text = 'issued'::text) AND (i.remaining_amount = (0)::numeric)) IS TRUE) AS eligible,
    round(((b."Service_Price_Snapshot" * COALESCE(b."Commission_Rate_Snapshot", (0)::numeric)) / (100)::numeric), 2) AS commission_amount
   FROM ((sdc."BOOKING" b
     LEFT JOIN sdc."VISIT" v USING ("Booking_ID"))
     LEFT JOIN sdc.invoice_balances i USING ("Visit_ID"));


ALTER VIEW sdc.booking_commissions OWNER TO postgres;

--
-- TOC entry 321 (class 1259 OID 33861)
-- Name: clinic_ratings; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.clinic_ratings AS
 SELECT c."Clinic_ID",
    (COALESCE(avg(b."Clinic_Rating"), (0)::numeric))::numeric(3,2) AS average_rating,
    count(b."Reviewed_At") AS reviews_count
   FROM (sdc."CLINIC" c
     LEFT JOIN sdc."BOOKING" b USING ("Clinic_ID"))
  GROUP BY c."Clinic_ID";


ALTER VIEW sdc.clinic_ratings OWNER TO postgres;

--
-- TOC entry 320 (class 1259 OID 33856)
-- Name: doctor_ratings; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.doctor_ratings AS
 SELECT d."Doctor_ID",
    (COALESCE(avg(b."Doctor_Rating"), (0)::numeric))::numeric(3,2) AS average_rating,
    count(b."Reviewed_At") AS reviews_count
   FROM (sdc."DOCTOR" d
     LEFT JOIN sdc."BOOKING" b USING ("Doctor_ID"))
  GROUP BY d."Doctor_ID";


ALTER VIEW sdc.doctor_ratings OWNER TO postgres;

--
-- TOC entry 324 (class 1259 OID 33875)
-- Name: followup_status; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.followup_status AS
 SELECT v."Visit_ID",
    v."Suggested_Date",
    b."Booking_ID",
        CASE
            WHEN ((b."Booking_ID" IS NOT NULL) AND ((b."Booking_Status")::text <> ALL ((ARRAY['cancelled'::character varying, 'rejected'::character varying])::text[]))) THEN 'booked'::text
            WHEN (v."Suggested_Date" < CURRENT_DATE) THEN 'late'::text
            ELSE 'waiting'::text
        END AS status
   FROM (sdc."VISIT" v
     LEFT JOIN sdc."BOOKING" b ON ((b."Follow_Up_Of_Visit_ID" = v."Visit_ID")))
  WHERE (v."Suggested_Date" IS NOT NULL);


ALTER VIEW sdc.followup_status OWNER TO postgres;

--
-- TOC entry 317 (class 1259 OID 33841)
-- Name: inventory_balances; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.inventory_balances AS
 SELECT i."Item_ID",
    i."Item_Name",
    i."Category",
    i."Unit",
    i."Minimum_Quantity",
    i."Expiry_Date",
    i."Clinic_ID",
    (COALESCE(m.quantity, (0)::numeric))::numeric(16,2) AS current_quantity
   FROM (sdc."INVENTORY_ITEM" i
     LEFT JOIN ( SELECT "STOCK_MOVEMENT"."Item_ID",
            sum("STOCK_MOVEMENT"."Quantity_Change") AS quantity
           FROM sdc."STOCK_MOVEMENT"
          GROUP BY "STOCK_MOVEMENT"."Item_ID") m USING ("Item_ID"));


ALTER VIEW sdc.inventory_balances OWNER TO postgres;

--
-- TOC entry 322 (class 1259 OID 33866)
-- Name: patient_ages; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.patient_ages AS
 SELECT "Patient_ID",
    (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, ("Date_Of_Birth")::timestamp with time zone)))::integer AS age_years
   FROM sdc."PATIENT";


ALTER VIEW sdc.patient_ages OWNER TO postgres;

--
-- TOC entry 325 (class 1259 OID 40568)
-- Name: platform_finance_settings; Type: TABLE; Schema: sdc; Owner: postgres
--

CREATE TABLE sdc.platform_finance_settings (
    settings_id smallint DEFAULT 1 NOT NULL,
    commission_rate numeric(5,2) DEFAULT 5.00 NOT NULL,
    frequency character varying(10) DEFAULT 'monthly'::character varying NOT NULL,
    due_days smallint DEFAULT 7 NOT NULL,
    effective_on date DEFAULT ((now() AT TIME ZONE 'Asia/Hebron'::text))::date NOT NULL,
    updated_at timestamp without time zone DEFAULT LOCALTIMESTAMP NOT NULL,
    updated_by bigint,
    CONSTRAINT platform_finance_settings_commission_rate_check CHECK (((commission_rate > (0)::numeric) AND (commission_rate <= (100)::numeric))),
    CONSTRAINT platform_finance_settings_due_days_check CHECK ((due_days = ANY (ARRAY[7, 14, 30]))),
    CONSTRAINT platform_finance_settings_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['weekly'::character varying, 'monthly'::character varying])::text[]))),
    CONSTRAINT platform_finance_settings_settings_id_check CHECK ((settings_id = 1))
);


ALTER TABLE sdc.platform_finance_settings OWNER TO postgres;

--
-- TOC entry 319 (class 1259 OID 33851)
-- Name: settlement_balances; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.settlement_balances AS
 SELECT s."Settlement_ID",
    s."Period_Start",
    s."Period_End",
    s."Created_At",
    s."Clinic_ID",
    (COALESCE(c.total, (0)::numeric))::numeric(16,2) AS total_commission,
    (COALESCE(p.paid, (0)::numeric))::numeric(16,2) AS paid_amount,
    ((COALESCE(c.total, (0)::numeric) - COALESCE(p.paid, (0)::numeric)))::numeric(16,2) AS remaining_amount
   FROM ((sdc."SETTLEMENT" s
     LEFT JOIN ( SELECT booking_commissions."Settlement_ID",
            sum(booking_commissions.commission_amount) AS total
           FROM sdc.booking_commissions
          WHERE (booking_commissions."Settlement_ID" IS NOT NULL)
          GROUP BY booking_commissions."Settlement_ID") c USING ("Settlement_ID"))
     LEFT JOIN ( SELECT "RECORDS_SETTLEMENT_PAYMENT"."Settlement_ID",
            sum("RECORDS_SETTLEMENT_PAYMENT"."Amount") AS paid
           FROM sdc."RECORDS_SETTLEMENT_PAYMENT"
          GROUP BY "RECORDS_SETTLEMENT_PAYMENT"."Settlement_ID") p USING ("Settlement_ID"));


ALTER VIEW sdc.settlement_balances OWNER TO postgres;

--
-- TOC entry 323 (class 1259 OID 33870)
-- Name: treatment_progress; Type: VIEW; Schema: sdc; Owner: postgres
--

CREATE VIEW sdc.treatment_progress AS
 SELECT p."Plan_ID",
    count(s."Stage_ID") AS total_stages,
    count(s."Stage_ID") FILTER (WHERE ((s."Stage_Status")::text = 'completed'::text)) AS completed_stages,
    COALESCE(round(((100.0 * (count(s."Stage_ID") FILTER (WHERE ((s."Stage_Status")::text = 'completed'::text)))::numeric) / (NULLIF(count(s."Stage_ID"), 0))::numeric), 2), (0)::numeric) AS progress_percent
   FROM (sdc."TREATMENT_PLAN" p
     LEFT JOIN sdc."TREATMENT_STAGE" s USING ("Plan_ID"))
  GROUP BY p."Plan_ID";


ALTER VIEW sdc.treatment_progress OWNER TO postgres;

--
-- TOC entry 6148 (class 0 OID 32532)
-- Dependencies: 231
-- Data for Name: AI_ASSESSMENT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: AI_ASSESSMENT (6 original rows)


--
-- TOC entry 6181 (class 0 OID 32959)
-- Dependencies: 264
-- Data for Name: AI_ASSESSMENT_MESSAGES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: AI_ASSESSMENT_MESSAGES (12 original rows)


--
-- TOC entry 6154 (class 0 OID 32625)
-- Dependencies: 237
-- Data for Name: AI_RECOMMENDATION; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: AI_RECOMMENDATION (0 original rows)


--
-- TOC entry 6165 (class 0 OID 32763)
-- Dependencies: 248
-- Data for Name: APPLIES_FOR; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: APPLIES_FOR (2 original rows)


--
-- TOC entry 6152 (class 0 OID 32600)
-- Dependencies: 235
-- Data for Name: AUDIT_LOG; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: AUDIT_LOG (421 original rows)


--
-- TOC entry 6183 (class 0 OID 32989)
-- Dependencies: 266
-- Data for Name: AUDIT_LOG_CHANGES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: AUDIT_LOG_CHANGES (17 original rows)


--
-- TOC entry 6150 (class 0 OID 32557)
-- Dependencies: 233
-- Data for Name: BOOKING; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: BOOKING (29 original rows)


--
-- TOC entry 6141 (class 0 OID 32429)
-- Dependencies: 224
-- Data for Name: CLINIC; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: CLINIC (3 original rows)


--
-- TOC entry 6177 (class 0 OID 32900)
-- Dependencies: 260
-- Data for Name: CLINIC_DOCUMENTS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: CLINIC_DOCUMENTS (10 original rows)


--
-- TOC entry 6179 (class 0 OID 32930)
-- Dependencies: 262
-- Data for Name: CLINIC_WORKING_EXCEPTIONS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: CLINIC_WORKING_EXCEPTIONS (1 original rows)


--
-- TOC entry 6178 (class 0 OID 32920)
-- Dependencies: 261
-- Data for Name: CLINIC_WORKING_HOURS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: CLINIC_WORKING_HOURS (6 original rows)


--
-- TOC entry 6139 (class 0 OID 32405)
-- Dependencies: 222
-- Data for Name: DOCTOR; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: DOCTOR (6 original rows)


--
-- TOC entry 6190 (class 0 OID 33065)
-- Dependencies: 273
-- Data for Name: DOCTOR_ABSENCES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: DOCTOR_ABSENCES (0 original rows)


--
-- TOC entry 6189 (class 0 OID 33052)
-- Dependencies: 272
-- Data for Name: DOCTOR_WORKING_HOURS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: DOCTOR_WORKING_HOURS (9 original rows)


--
-- TOC entry 6159 (class 0 OID 32705)
-- Dependencies: 242
-- Data for Name: HAS_SPECIALTY; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: HAS_SPECIALTY (12 original rows)


--
-- TOC entry 6145 (class 0 OID 32485)
-- Dependencies: 228
-- Data for Name: INVENTORY_ITEM; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: INVENTORY_ITEM (3 original rows)


--
-- TOC entry 6147 (class 0 OID 32518)
-- Dependencies: 230
-- Data for Name: INVOICE; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: INVOICE (7 original rows)


--
-- TOC entry 6180 (class 0 OID 32942)
-- Dependencies: 263
-- Data for Name: INVOICE_INVOICE_ITEMS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: INVOICE_INVOICE_ITEMS (9 original rows)


--
-- TOC entry 6146 (class 0 OID 32497)
-- Dependencies: 229
-- Data for Name: JOB; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: JOB (2 original rows)


--
-- TOC entry 6191 (class 0 OID 33079)
-- Dependencies: 274
-- Data for Name: JOB_APPLICATION_ATTACHMENTS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: JOB_APPLICATION_ATTACHMENTS (4 original rows)


--
-- TOC entry 6144 (class 0 OID 32476)
-- Dependencies: 227
-- Data for Name: LABORATORY; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: LABORATORY (2 original rows)


--
-- TOC entry 6170 (class 0 OID 32839)
-- Dependencies: 253
-- Data for Name: LAB_ORDER; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: LAB_ORDER (2 original rows)


--
-- TOC entry 6193 (class 0 OID 33100)
-- Dependencies: 276
-- Data for Name: LAB_ORDER_ITEMS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: LAB_ORDER_ITEMS (2 original rows)


--
-- TOC entry 6153 (class 0 OID 32612)
-- Dependencies: 236
-- Data for Name: NOTIFICATION; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: NOTIFICATION (59 original rows)


--
-- TOC entry 6234 (class 0 OID 40611)
-- Dependencies: 326
-- Data for Name: NOTIFICATION_DUPLICATES_BACKUP_015_FIX; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: NOTIFICATION_DUPLICATES_BACKUP_015_FIX (124 original rows)


--
-- TOC entry 6161 (class 0 OID 32723)
-- Dependencies: 244
-- Data for Name: OFFERS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: OFFERS (8 original rows)


--
-- TOC entry 6138 (class 0 OID 32390)
-- Dependencies: 221
-- Data for Name: PATIENT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PATIENT (4 original rows)


--
-- TOC entry 6174 (class 0 OID 32879)
-- Dependencies: 257
-- Data for Name: PATIENT_ALLERGIES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PATIENT_ALLERGIES (3 original rows)


--
-- TOC entry 6175 (class 0 OID 32886)
-- Dependencies: 258
-- Data for Name: PATIENT_CHRONIC_DISEASES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PATIENT_CHRONIC_DISEASES (3 original rows)


--
-- TOC entry 6176 (class 0 OID 32893)
-- Dependencies: 259
-- Data for Name: PATIENT_CURRENT_MEDICATIONS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PATIENT_CURRENT_MEDICATIONS (3 original rows)


--
-- TOC entry 6151 (class 0 OID 32589)
-- Dependencies: 234
-- Data for Name: PRESCRIPTION; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PRESCRIPTION (3 original rows)


--
-- TOC entry 6182 (class 0 OID 32975)
-- Dependencies: 265
-- Data for Name: PRESCRIPTION_MEDICATIONS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PRESCRIPTION_MEDICATIONS (3 original rows)


--
-- TOC entry 6156 (class 0 OID 32664)
-- Dependencies: 239
-- Data for Name: PROCEDURE; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PROCEDURE (9 original rows)


--
-- TOC entry 6162 (class 0 OID 32738)
-- Dependencies: 245
-- Data for Name: PROVIDES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: PROVIDES (14 original rows)


--
-- TOC entry 6168 (class 0 OID 32811)
-- Dependencies: 251
-- Data for Name: RECORDS_PAYMENT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: RECORDS_PAYMENT (11 original rows)


--
-- TOC entry 6169 (class 0 OID 32825)
-- Dependencies: 252
-- Data for Name: RECORDS_SETTLEMENT_PAYMENT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: RECORDS_SETTLEMENT_PAYMENT (2 original rows)


--
-- TOC entry 6163 (class 0 OID 32746)
-- Dependencies: 246
-- Data for Name: REGISTERED_AT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: REGISTERED_AT (3 original rows)


--
-- TOC entry 6158 (class 0 OID 32694)
-- Dependencies: 241
-- Data for Name: ROLE; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

INSERT INTO sdc."ROLE" ("Role_ID","Role_Name","Role_Scope") VALUES
    (1,'Patient','System'),
    (2,'Doctor','System'),
    (3,'Super Admin','System'),
    (4,'Staff','System'),
    (5,'Receptionist','Clinic');


--
-- TOC entry 6142 (class 0 OID 32454)
-- Dependencies: 225
-- Data for Name: SERVICE; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: SERVICE (7 original rows)


--
-- TOC entry 6149 (class 0 OID 32546)
-- Dependencies: 232
-- Data for Name: SETTLEMENT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: SETTLEMENT (1 original rows)


--
-- TOC entry 6140 (class 0 OID 32419)
-- Dependencies: 223
-- Data for Name: SPECIALTY; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

INSERT INTO sdc."SPECIALTY" ("Specialty_ID","Name_AR","Name_EN","Is_Active") VALUES
    (1,'طب أسنان عام','General Dentistry',TRUE),
    (2,'علاج جذور','Endodontics',TRUE),
    (3,'تقويم الأسنان','Orthodontics',TRUE),
    (4,'جراحة الفم','Oral Surgery',TRUE),
    (5,'التركيبات السنية','Prosthodontics',TRUE),
    (6,'أسنان أطفال-1','Pediatric Dentistry',TRUE);


--
-- TOC entry 6166 (class 0 OID 32788)
-- Dependencies: 249
-- Data for Name: STAFF_AT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: STAFF_AT (1 original rows)


--
-- TOC entry 6192 (class 0 OID 33092)
-- Dependencies: 275
-- Data for Name: STAFF_PERMISSIONS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: STAFF_PERMISSIONS (10 original rows)


--
-- TOC entry 6167 (class 0 OID 32797)
-- Dependencies: 250
-- Data for Name: STOCK_MOVEMENT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: STOCK_MOVEMENT (48 original rows)


--
-- TOC entry 6143 (class 0 OID 32461)
-- Dependencies: 226
-- Data for Name: TREATMENT_PLAN; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: TREATMENT_PLAN (4 original rows)


--
-- TOC entry 6157 (class 0 OID 32679)
-- Dependencies: 240
-- Data for Name: TREATMENT_STAGE; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: TREATMENT_STAGE (7 original rows)


--
-- TOC entry 6137 (class 0 OID 32366)
-- Dependencies: 220
-- Data for Name: USER; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: USER (12 original rows)


--
-- TOC entry 6173 (class 0 OID 32870)
-- Dependencies: 256
-- Data for Name: USER_POLICY_CONSENTS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: USER_POLICY_CONSENTS (18 original rows)


--
-- TOC entry 6172 (class 0 OID 32861)
-- Dependencies: 255
-- Data for Name: USER_RECOVERY_CODES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: USER_RECOVERY_CODES (8 original rows)


--
-- TOC entry 6171 (class 0 OID 32851)
-- Dependencies: 254
-- Data for Name: USER_SESSIONS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: USER_SESSIONS (86 original rows)


--
-- TOC entry 6155 (class 0 OID 32650)
-- Dependencies: 238
-- Data for Name: VISIT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: VISIT (7 original rows)


--
-- TOC entry 6184 (class 0 OID 32998)
-- Dependencies: 267
-- Data for Name: VISIT_CLINICAL_FINDINGS; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: VISIT_CLINICAL_FINDINGS (15 original rows)


--
-- TOC entry 6187 (class 0 OID 33026)
-- Dependencies: 270
-- Data for Name: VISIT_DIAGNOSES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: VISIT_DIAGNOSES (0 original rows)


--
-- TOC entry 6185 (class 0 OID 33007)
-- Dependencies: 268
-- Data for Name: VISIT_ODONTOGRAM; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: VISIT_ODONTOGRAM (24 original rows)


--
-- TOC entry 6186 (class 0 OID 33015)
-- Dependencies: 269
-- Data for Name: VISIT_TOOTH_SURFACE_NOTES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: VISIT_TOOTH_SURFACE_NOTES (1 original rows)


--
-- TOC entry 6188 (class 0 OID 33037)
-- Dependencies: 271
-- Data for Name: VISIT_VISIT_FILES; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: VISIT_VISIT_FILES (3 original rows)


--
-- TOC entry 6160 (class 0 OID 32712)
-- Dependencies: 243
-- Data for Name: WORKS_AT; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: WORKS_AT (5 original rows)


--
-- TOC entry 6164 (class 0 OID 32753)
-- Dependencies: 247
-- Data for Name: WORKS_WITH; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

-- Data excluded from clean testing database: WORKS_WITH (3 original rows)


--
-- TOC entry 6233 (class 0 OID 40568)
-- Dependencies: 325
-- Data for Name: platform_finance_settings; Type: TABLE DATA; Schema: sdc; Owner: postgres
--

INSERT INTO sdc.platform_finance_settings (settings_id, commission_rate, frequency, due_days, effective_on, updated_at, updated_by)
VALUES (1, 10.00, 'weekly', 7, (now() AT TIME ZONE 'Asia/Hebron')::date, LOCALTIMESTAMP, NULL);


--
-- TOC entry 6254 (class 0 OID 0)
-- Dependencies: 288
-- Name: AI_ASSESSMENT_Assessment_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6255 (class 0 OID 0)
-- Dependencies: 308
-- Name: AI_ASSESSMENT_MESSAGES_Message_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6256 (class 0 OID 0)
-- Dependencies: 294
-- Name: AI_RECOMMENDATION_Recommendation_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6257 (class 0 OID 0)
-- Dependencies: 299
-- Name: APPLIES_FOR_Application_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6258 (class 0 OID 0)
-- Dependencies: 292
-- Name: AUDIT_LOG_Log_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6259 (class 0 OID 0)
-- Dependencies: 290
-- Name: BOOKING_Booking_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6260 (class 0 OID 0)
-- Dependencies: 281
-- Name: CLINIC_Clinic_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6261 (class 0 OID 0)
-- Dependencies: 305
-- Name: CLINIC_DOCUMENTS_Document_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6262 (class 0 OID 0)
-- Dependencies: 306
-- Name: CLINIC_WORKING_EXCEPTIONS_Exception_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6263 (class 0 OID 0)
-- Dependencies: 313
-- Name: DOCTOR_ABSENCES_Absence_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6264 (class 0 OID 0)
-- Dependencies: 279
-- Name: DOCTOR_Doctor_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6265 (class 0 OID 0)
-- Dependencies: 285
-- Name: INVENTORY_ITEM_Item_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6266 (class 0 OID 0)
-- Dependencies: 307
-- Name: INVOICE_INVOICE_ITEMS_Item_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6267 (class 0 OID 0)
-- Dependencies: 287
-- Name: INVOICE_Invoice_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6268 (class 0 OID 0)
-- Dependencies: 314
-- Name: JOB_APPLICATION_ATTACHMENTS_Attachment_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6269 (class 0 OID 0)
-- Dependencies: 286
-- Name: JOB_Job_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6270 (class 0 OID 0)
-- Dependencies: 284
-- Name: LABORATORY_Laboratory_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6271 (class 0 OID 0)
-- Dependencies: 315
-- Name: LAB_ORDER_ITEMS_Lab_Item_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6272 (class 0 OID 0)
-- Dependencies: 303
-- Name: LAB_ORDER_Lab_Order_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6273 (class 0 OID 0)
-- Dependencies: 293
-- Name: NOTIFICATION_Notification_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6274 (class 0 OID 0)
-- Dependencies: 278
-- Name: PATIENT_Patient_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6275 (class 0 OID 0)
-- Dependencies: 309
-- Name: PRESCRIPTION_MEDICATIONS_Medication_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6276 (class 0 OID 0)
-- Dependencies: 291
-- Name: PRESCRIPTION_Prescription_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6277 (class 0 OID 0)
-- Dependencies: 296
-- Name: PROCEDURE_Procedure_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6278 (class 0 OID 0)
-- Dependencies: 301
-- Name: RECORDS_PAYMENT_Payment_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6279 (class 0 OID 0)
-- Dependencies: 302
-- Name: RECORDS_SETTLEMENT_PAYMENT_Settlement_Payment_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6280 (class 0 OID 0)
-- Dependencies: 298
-- Name: ROLE_Role_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6281 (class 0 OID 0)
-- Dependencies: 282
-- Name: SERVICE_Service_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6282 (class 0 OID 0)
-- Dependencies: 289
-- Name: SETTLEMENT_Settlement_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6283 (class 0 OID 0)
-- Dependencies: 280
-- Name: SPECIALTY_Specialty_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6284 (class 0 OID 0)
-- Dependencies: 300
-- Name: STOCK_MOVEMENT_Movement_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6285 (class 0 OID 0)
-- Dependencies: 283
-- Name: TREATMENT_PLAN_Plan_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6286 (class 0 OID 0)
-- Dependencies: 297
-- Name: TREATMENT_STAGE_Stage_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6287 (class 0 OID 0)
-- Dependencies: 304
-- Name: USER_SESSIONS_Session_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6288 (class 0 OID 0)
-- Dependencies: 277
-- Name: USER_User_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6289 (class 0 OID 0)
-- Dependencies: 311
-- Name: VISIT_DIAGNOSES_Diagnosis_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6290 (class 0 OID 0)
-- Dependencies: 310
-- Name: VISIT_TOOTH_SURFACE_NOTES_Note_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6291 (class 0 OID 0)
-- Dependencies: 312
-- Name: VISIT_VISIT_FILES_File_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 6292 (class 0 OID 0)
-- Dependencies: 295
-- Name: VISIT_Visit_ID_seq; Type: SEQUENCE SET; Schema: sdc; Owner: postgres
--



--
-- TOC entry 5652 (class 2606 OID 32974)
-- Name: AI_ASSESSMENT_MESSAGES AI_ASSESSMENT_MESSAGES_Assessment_ID_Message_Order_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_ASSESSMENT_MESSAGES"
    ADD CONSTRAINT "AI_ASSESSMENT_MESSAGES_Assessment_ID_Message_Order_key" UNIQUE ("Assessment_ID", "Message_Order");


--
-- TOC entry 5654 (class 2606 OID 32972)
-- Name: AI_ASSESSMENT_MESSAGES AI_ASSESSMENT_MESSAGES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_ASSESSMENT_MESSAGES"
    ADD CONSTRAINT "AI_ASSESSMENT_MESSAGES_pkey" PRIMARY KEY ("Message_ID");


--
-- TOC entry 5514 (class 2606 OID 32545)
-- Name: AI_ASSESSMENT AI_ASSESSMENT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_ASSESSMENT"
    ADD CONSTRAINT "AI_ASSESSMENT_pkey" PRIMARY KEY ("Assessment_ID");


--
-- TOC entry 5548 (class 2606 OID 32649)
-- Name: AI_RECOMMENDATION AI_RECOMMENDATION_Assessment_ID_Recommendation_Order_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT "AI_RECOMMENDATION_Assessment_ID_Recommendation_Order_key" UNIQUE ("Assessment_ID", "Recommendation_Order");


--
-- TOC entry 5550 (class 2606 OID 32647)
-- Name: AI_RECOMMENDATION AI_RECOMMENDATION_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT "AI_RECOMMENDATION_pkey" PRIMARY KEY ("Recommendation_ID");


--
-- TOC entry 5593 (class 2606 OID 32787)
-- Name: APPLIES_FOR APPLIES_FOR_Doctor_ID_Job_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."APPLIES_FOR"
    ADD CONSTRAINT "APPLIES_FOR_Doctor_ID_Job_ID_key" UNIQUE ("Doctor_ID", "Job_ID");


--
-- TOC entry 5595 (class 2606 OID 32785)
-- Name: APPLIES_FOR APPLIES_FOR_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."APPLIES_FOR"
    ADD CONSTRAINT "APPLIES_FOR_pkey" PRIMARY KEY ("Application_ID");


--
-- TOC entry 5659 (class 2606 OID 32997)
-- Name: AUDIT_LOG_CHANGES AUDIT_LOG_CHANGES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AUDIT_LOG_CHANGES"
    ADD CONSTRAINT "AUDIT_LOG_CHANGES_pkey" PRIMARY KEY ("Field_Name", "Log_ID");


--
-- TOC entry 5540 (class 2606 OID 32611)
-- Name: AUDIT_LOG AUDIT_LOG_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AUDIT_LOG"
    ADD CONSTRAINT "AUDIT_LOG_pkey" PRIMARY KEY ("Log_ID");


--
-- TOC entry 5522 (class 2606 OID 32588)
-- Name: BOOKING BOOKING_Follow_Up_Of_Visit_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT "BOOKING_Follow_Up_Of_Visit_ID_key" UNIQUE ("Follow_Up_Of_Visit_ID");


--
-- TOC entry 5524 (class 2606 OID 32586)
-- Name: BOOKING BOOKING_Recommendation_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT "BOOKING_Recommendation_ID_key" UNIQUE ("Recommendation_ID");


--
-- TOC entry 5526 (class 2606 OID 32584)
-- Name: BOOKING BOOKING_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT "BOOKING_pkey" PRIMARY KEY ("Booking_ID");


--
-- TOC entry 5638 (class 2606 OID 32919)
-- Name: CLINIC_DOCUMENTS CLINIC_DOCUMENTS_Clinic_ID_Document_Type_Version_Number_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_DOCUMENTS"
    ADD CONSTRAINT "CLINIC_DOCUMENTS_Clinic_ID_Document_Type_Version_Number_key" UNIQUE ("Clinic_ID", "Document_Type", "Version_Number");


--
-- TOC entry 5640 (class 2606 OID 32917)
-- Name: CLINIC_DOCUMENTS CLINIC_DOCUMENTS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_DOCUMENTS"
    ADD CONSTRAINT "CLINIC_DOCUMENTS_pkey" PRIMARY KEY ("Document_ID");


--
-- TOC entry 5646 (class 2606 OID 32941)
-- Name: CLINIC_WORKING_EXCEPTIONS CLINIC_WORKING_EXCEPTIONS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_WORKING_EXCEPTIONS"
    ADD CONSTRAINT "CLINIC_WORKING_EXCEPTIONS_pkey" PRIMARY KEY ("Exception_ID");


--
-- TOC entry 5643 (class 2606 OID 32929)
-- Name: CLINIC_WORKING_HOURS CLINIC_WORKING_HOURS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_WORKING_HOURS"
    ADD CONSTRAINT "CLINIC_WORKING_HOURS_pkey" PRIMARY KEY ("Day_Of_Week", "Start_Time", "Clinic_ID");


--
-- TOC entry 5486 (class 2606 OID 32453)
-- Name: CLINIC CLINIC_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC"
    ADD CONSTRAINT "CLINIC_pkey" PRIMARY KEY ("Clinic_ID");


--
-- TOC entry 5680 (class 2606 OID 33078)
-- Name: DOCTOR_ABSENCES DOCTOR_ABSENCES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR_ABSENCES"
    ADD CONSTRAINT "DOCTOR_ABSENCES_pkey" PRIMARY KEY ("Absence_ID");


--
-- TOC entry 5478 (class 2606 OID 32418)
-- Name: DOCTOR DOCTOR_User_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR"
    ADD CONSTRAINT "DOCTOR_User_ID_key" UNIQUE ("User_ID");


--
-- TOC entry 5677 (class 2606 OID 33064)
-- Name: DOCTOR_WORKING_HOURS DOCTOR_WORKING_HOURS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR_WORKING_HOURS"
    ADD CONSTRAINT "DOCTOR_WORKING_HOURS_pkey" PRIMARY KEY ("Day_Of_Week", "Start_Time", "Clinic_ID", "Doctor_ID");


--
-- TOC entry 5480 (class 2606 OID 32416)
-- Name: DOCTOR DOCTOR_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR"
    ADD CONSTRAINT "DOCTOR_pkey" PRIMARY KEY ("Doctor_ID");


--
-- TOC entry 5573 (class 2606 OID 32711)
-- Name: HAS_SPECIALTY HAS_SPECIALTY_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."HAS_SPECIALTY"
    ADD CONSTRAINT "HAS_SPECIALTY_pkey" PRIMARY KEY ("Doctor_ID", "Specialty_ID");


--
-- TOC entry 5500 (class 2606 OID 32496)
-- Name: INVENTORY_ITEM INVENTORY_ITEM_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVENTORY_ITEM"
    ADD CONSTRAINT "INVENTORY_ITEM_pkey" PRIMARY KEY ("Item_ID");


--
-- TOC entry 5649 (class 2606 OID 32958)
-- Name: INVOICE_INVOICE_ITEMS INVOICE_INVOICE_ITEMS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE_INVOICE_ITEMS"
    ADD CONSTRAINT "INVOICE_INVOICE_ITEMS_pkey" PRIMARY KEY ("Item_ID");


--
-- TOC entry 5507 (class 2606 OID 32531)
-- Name: INVOICE INVOICE_Visit_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE"
    ADD CONSTRAINT "INVOICE_Visit_ID_key" UNIQUE ("Visit_ID");


--
-- TOC entry 5509 (class 2606 OID 32529)
-- Name: INVOICE INVOICE_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE"
    ADD CONSTRAINT "INVOICE_pkey" PRIMARY KEY ("Invoice_ID");


--
-- TOC entry 5683 (class 2606 OID 33091)
-- Name: JOB_APPLICATION_ATTACHMENTS JOB_APPLICATION_ATTACHMENTS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."JOB_APPLICATION_ATTACHMENTS"
    ADD CONSTRAINT "JOB_APPLICATION_ATTACHMENTS_pkey" PRIMARY KEY ("Attachment_ID");


--
-- TOC entry 5503 (class 2606 OID 32517)
-- Name: JOB JOB_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."JOB"
    ADD CONSTRAINT "JOB_pkey" PRIMARY KEY ("Job_ID");


--
-- TOC entry 5498 (class 2606 OID 32484)
-- Name: LABORATORY LABORATORY_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."LABORATORY"
    ADD CONSTRAINT "LABORATORY_pkey" PRIMARY KEY ("Laboratory_ID");


--
-- TOC entry 5689 (class 2606 OID 33111)
-- Name: LAB_ORDER_ITEMS LAB_ORDER_ITEMS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."LAB_ORDER_ITEMS"
    ADD CONSTRAINT "LAB_ORDER_ITEMS_pkey" PRIMARY KEY ("Lab_Item_ID");


--
-- TOC entry 5615 (class 2606 OID 32850)
-- Name: LAB_ORDER LAB_ORDER_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."LAB_ORDER"
    ADD CONSTRAINT "LAB_ORDER_pkey" PRIMARY KEY ("Lab_Order_ID");


--
-- TOC entry 5543 (class 2606 OID 32624)
-- Name: NOTIFICATION NOTIFICATION_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."NOTIFICATION"
    ADD CONSTRAINT "NOTIFICATION_pkey" PRIMARY KEY ("Notification_ID");


--
-- TOC entry 5579 (class 2606 OID 32737)
-- Name: OFFERS OFFERS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."OFFERS"
    ADD CONSTRAINT "OFFERS_pkey" PRIMARY KEY ("Clinic_ID", "Service_ID");


--
-- TOC entry 5629 (class 2606 OID 32885)
-- Name: PATIENT_ALLERGIES PATIENT_ALLERGIES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT_ALLERGIES"
    ADD CONSTRAINT "PATIENT_ALLERGIES_pkey" PRIMARY KEY ("Allergies", "Patient_ID");


--
-- TOC entry 5632 (class 2606 OID 32892)
-- Name: PATIENT_CHRONIC_DISEASES PATIENT_CHRONIC_DISEASES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT_CHRONIC_DISEASES"
    ADD CONSTRAINT "PATIENT_CHRONIC_DISEASES_pkey" PRIMARY KEY ("Chronic_Diseases", "Patient_ID");


--
-- TOC entry 5635 (class 2606 OID 32899)
-- Name: PATIENT_CURRENT_MEDICATIONS PATIENT_CURRENT_MEDICATIONS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT_CURRENT_MEDICATIONS"
    ADD CONSTRAINT "PATIENT_CURRENT_MEDICATIONS_pkey" PRIMARY KEY ("Current_Medications", "Patient_ID");


--
-- TOC entry 5474 (class 2606 OID 32404)
-- Name: PATIENT PATIENT_User_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT"
    ADD CONSTRAINT "PATIENT_User_ID_key" UNIQUE ("User_ID");


--
-- TOC entry 5476 (class 2606 OID 32402)
-- Name: PATIENT PATIENT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT"
    ADD CONSTRAINT "PATIENT_pkey" PRIMARY KEY ("Patient_ID");


--
-- TOC entry 5656 (class 2606 OID 32988)
-- Name: PRESCRIPTION_MEDICATIONS PRESCRIPTION_MEDICATIONS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PRESCRIPTION_MEDICATIONS"
    ADD CONSTRAINT "PRESCRIPTION_MEDICATIONS_pkey" PRIMARY KEY ("Medication_ID");


--
-- TOC entry 5537 (class 2606 OID 32599)
-- Name: PRESCRIPTION PRESCRIPTION_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PRESCRIPTION"
    ADD CONSTRAINT "PRESCRIPTION_pkey" PRIMARY KEY ("Prescription_ID");


--
-- TOC entry 5560 (class 2606 OID 32678)
-- Name: PROCEDURE PROCEDURE_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROCEDURE"
    ADD CONSTRAINT "PROCEDURE_pkey" PRIMARY KEY ("Procedure_ID");


--
-- TOC entry 5582 (class 2606 OID 32745)
-- Name: PROVIDES PROVIDES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROVIDES"
    ADD CONSTRAINT "PROVIDES_pkey" PRIMARY KEY ("Clinic_ID", "Doctor_ID", "Service_ID");


--
-- TOC entry 5607 (class 2606 OID 32824)
-- Name: RECORDS_PAYMENT RECORDS_PAYMENT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."RECORDS_PAYMENT"
    ADD CONSTRAINT "RECORDS_PAYMENT_pkey" PRIMARY KEY ("Payment_ID");


--
-- TOC entry 5611 (class 2606 OID 32838)
-- Name: RECORDS_SETTLEMENT_PAYMENT RECORDS_SETTLEMENT_PAYMENT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."RECORDS_SETTLEMENT_PAYMENT"
    ADD CONSTRAINT "RECORDS_SETTLEMENT_PAYMENT_pkey" PRIMARY KEY ("Settlement_Payment_ID");


--
-- TOC entry 5587 (class 2606 OID 32752)
-- Name: REGISTERED_AT REGISTERED_AT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."REGISTERED_AT"
    ADD CONSTRAINT "REGISTERED_AT_pkey" PRIMARY KEY ("Patient_ID", "Clinic_ID");


--
-- TOC entry 5569 (class 2606 OID 32704)
-- Name: ROLE ROLE_Role_Name_Role_Scope_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."ROLE"
    ADD CONSTRAINT "ROLE_Role_Name_Role_Scope_key" UNIQUE ("Role_Name", "Role_Scope");


--
-- TOC entry 5571 (class 2606 OID 32702)
-- Name: ROLE ROLE_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."ROLE"
    ADD CONSTRAINT "ROLE_pkey" PRIMARY KEY ("Role_ID");


--
-- TOC entry 5491 (class 2606 OID 32460)
-- Name: SERVICE SERVICE_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."SERVICE"
    ADD CONSTRAINT "SERVICE_pkey" PRIMARY KEY ("Service_ID");


--
-- TOC entry 5518 (class 2606 OID 32556)
-- Name: SETTLEMENT SETTLEMENT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."SETTLEMENT"
    ADD CONSTRAINT "SETTLEMENT_pkey" PRIMARY KEY ("Settlement_ID");


--
-- TOC entry 5484 (class 2606 OID 32428)
-- Name: SPECIALTY SPECIALTY_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."SPECIALTY"
    ADD CONSTRAINT "SPECIALTY_pkey" PRIMARY KEY ("Specialty_ID");


--
-- TOC entry 5598 (class 2606 OID 32796)
-- Name: STAFF_AT STAFF_AT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STAFF_AT"
    ADD CONSTRAINT "STAFF_AT_pkey" PRIMARY KEY ("User_ID", "Clinic_ID");


--
-- TOC entry 5686 (class 2606 OID 33099)
-- Name: STAFF_PERMISSIONS STAFF_PERMISSIONS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STAFF_PERMISSIONS"
    ADD CONSTRAINT "STAFF_PERMISSIONS_pkey" PRIMARY KEY ("Permission_Code", "User_ID", "Clinic_ID");


--
-- TOC entry 5602 (class 2606 OID 32810)
-- Name: STOCK_MOVEMENT STOCK_MOVEMENT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STOCK_MOVEMENT"
    ADD CONSTRAINT "STOCK_MOVEMENT_pkey" PRIMARY KEY ("Movement_ID");


--
-- TOC entry 5493 (class 2606 OID 32475)
-- Name: TREATMENT_PLAN TREATMENT_PLAN_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_PLAN"
    ADD CONSTRAINT "TREATMENT_PLAN_pkey" PRIMARY KEY ("Plan_ID");


--
-- TOC entry 5565 (class 2606 OID 32693)
-- Name: TREATMENT_STAGE TREATMENT_STAGE_Plan_ID_Stage_Order_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_STAGE"
    ADD CONSTRAINT "TREATMENT_STAGE_Plan_ID_Stage_Order_key" UNIQUE ("Plan_ID", "Stage_Order");


--
-- TOC entry 5567 (class 2606 OID 32691)
-- Name: TREATMENT_STAGE TREATMENT_STAGE_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_STAGE"
    ADD CONSTRAINT "TREATMENT_STAGE_pkey" PRIMARY KEY ("Stage_ID");


--
-- TOC entry 5467 (class 2606 OID 32389)
-- Name: USER USER_Email_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER"
    ADD CONSTRAINT "USER_Email_key" UNIQUE ("Email");


--
-- TOC entry 5626 (class 2606 OID 32878)
-- Name: USER_POLICY_CONSENTS USER_POLICY_CONSENTS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER_POLICY_CONSENTS"
    ADD CONSTRAINT "USER_POLICY_CONSENTS_pkey" PRIMARY KEY ("Policy_Type", "Policy_Version", "User_ID");


--
-- TOC entry 5623 (class 2606 OID 32869)
-- Name: USER_RECOVERY_CODES USER_RECOVERY_CODES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER_RECOVERY_CODES"
    ADD CONSTRAINT "USER_RECOVERY_CODES_pkey" PRIMARY KEY ("Code_Hash");


--
-- TOC entry 5619 (class 2606 OID 32860)
-- Name: USER_SESSIONS USER_SESSIONS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER_SESSIONS"
    ADD CONSTRAINT "USER_SESSIONS_pkey" PRIMARY KEY ("Session_ID");


--
-- TOC entry 5469 (class 2606 OID 32387)
-- Name: USER USER_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER"
    ADD CONSTRAINT "USER_pkey" PRIMARY KEY ("User_ID");


--
-- TOC entry 5556 (class 2606 OID 32663)
-- Name: VISIT VISIT_Booking_ID_key; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT"
    ADD CONSTRAINT "VISIT_Booking_ID_key" UNIQUE ("Booking_ID");


--
-- TOC entry 5662 (class 2606 OID 33006)
-- Name: VISIT_CLINICAL_FINDINGS VISIT_CLINICAL_FINDINGS_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_CLINICAL_FINDINGS"
    ADD CONSTRAINT "VISIT_CLINICAL_FINDINGS_pkey" PRIMARY KEY ("Clinical_Findings", "Visit_ID");


--
-- TOC entry 5671 (class 2606 OID 33036)
-- Name: VISIT_DIAGNOSES VISIT_DIAGNOSES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_DIAGNOSES"
    ADD CONSTRAINT "VISIT_DIAGNOSES_pkey" PRIMARY KEY ("Diagnosis_ID");


--
-- TOC entry 5665 (class 2606 OID 33014)
-- Name: VISIT_ODONTOGRAM VISIT_ODONTOGRAM_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_ODONTOGRAM"
    ADD CONSTRAINT "VISIT_ODONTOGRAM_pkey" PRIMARY KEY ("Tooth_Number", "Visit_ID");


--
-- TOC entry 5668 (class 2606 OID 33025)
-- Name: VISIT_TOOTH_SURFACE_NOTES VISIT_TOOTH_SURFACE_NOTES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_TOOTH_SURFACE_NOTES"
    ADD CONSTRAINT "VISIT_TOOTH_SURFACE_NOTES_pkey" PRIMARY KEY ("Note_ID");


--
-- TOC entry 5674 (class 2606 OID 33051)
-- Name: VISIT_VISIT_FILES VISIT_VISIT_FILES_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_VISIT_FILES"
    ADD CONSTRAINT "VISIT_VISIT_FILES_pkey" PRIMARY KEY ("File_ID");


--
-- TOC entry 5558 (class 2606 OID 32661)
-- Name: VISIT VISIT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT"
    ADD CONSTRAINT "VISIT_pkey" PRIMARY KEY ("Visit_ID");


--
-- TOC entry 5576 (class 2606 OID 32722)
-- Name: WORKS_AT WORKS_AT_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."WORKS_AT"
    ADD CONSTRAINT "WORKS_AT_pkey" PRIMARY KEY ("Clinic_ID", "Doctor_ID");


--
-- TOC entry 5590 (class 2606 OID 32762)
-- Name: WORKS_WITH WORKS_WITH_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."WORKS_WITH"
    ADD CONSTRAINT "WORKS_WITH_pkey" PRIMARY KEY ("Clinic_ID", "Laboratory_ID");


--
-- TOC entry 5692 (class 2606 OID 40588)
-- Name: platform_finance_settings platform_finance_settings_pkey; Type: CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc.platform_finance_settings
    ADD CONSTRAINT platform_finance_settings_pkey PRIMARY KEY (settings_id);


--
-- TOC entry 5527 (class 1259 OID 40555)
-- Name: idx_sdc_booking_clinic_day_arrived; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX idx_sdc_booking_clinic_day_arrived ON sdc."BOOKING" USING btree ("Clinic_ID", "Appointment_Date", "Arrived_At");


--
-- TOC entry 5470 (class 1259 OID 33892)
-- Name: ix_fk_33112; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33112 ON sdc."USER" USING btree ("Role_ID");


--
-- TOC entry 5481 (class 1259 OID 33893)
-- Name: ix_fk_33127; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33127 ON sdc."DOCTOR" USING btree ("License_Reviewed_By_User_ID");


--
-- TOC entry 5487 (class 1259 OID 33894)
-- Name: ix_fk_33132; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33132 ON sdc."CLINIC" USING btree ("Manager_Doctor_ID");


--
-- TOC entry 5488 (class 1259 OID 33895)
-- Name: ix_fk_33137; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33137 ON sdc."CLINIC" USING btree ("Reviewed_By_User_ID");


--
-- TOC entry 5494 (class 1259 OID 33896)
-- Name: ix_fk_33142; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33142 ON sdc."TREATMENT_PLAN" USING btree ("Patient_ID");


--
-- TOC entry 5495 (class 1259 OID 33897)
-- Name: ix_fk_33147; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33147 ON sdc."TREATMENT_PLAN" USING btree ("Doctor_ID");


--
-- TOC entry 5496 (class 1259 OID 33898)
-- Name: ix_fk_33152; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33152 ON sdc."TREATMENT_PLAN" USING btree ("Clinic_ID");


--
-- TOC entry 5501 (class 1259 OID 33899)
-- Name: ix_fk_33157; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33157 ON sdc."INVENTORY_ITEM" USING btree ("Clinic_ID");


--
-- TOC entry 5504 (class 1259 OID 33900)
-- Name: ix_fk_33162; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33162 ON sdc."JOB" USING btree ("Clinic_ID");


--
-- TOC entry 5505 (class 1259 OID 33901)
-- Name: ix_fk_33167; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33167 ON sdc."JOB" USING btree ("Specialty_ID");


--
-- TOC entry 5510 (class 1259 OID 33902)
-- Name: ix_fk_33172; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33172 ON sdc."INVOICE" USING btree ("Patient_ID");


--
-- TOC entry 5511 (class 1259 OID 33903)
-- Name: ix_fk_33177; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33177 ON sdc."INVOICE" USING btree ("Clinic_ID");


--
-- TOC entry 5512 (class 1259 OID 33904)
-- Name: ix_fk_33182; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33182 ON sdc."INVOICE" USING btree ("Issued_By_User_ID");


--
-- TOC entry 5515 (class 1259 OID 33905)
-- Name: ix_fk_33192; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33192 ON sdc."AI_ASSESSMENT" USING btree ("Patient_ID");


--
-- TOC entry 5516 (class 1259 OID 33906)
-- Name: ix_fk_33197; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33197 ON sdc."AI_ASSESSMENT" USING btree ("Specialty_ID");


--
-- TOC entry 5519 (class 1259 OID 33907)
-- Name: ix_fk_33202; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33202 ON sdc."SETTLEMENT" USING btree ("Clinic_ID");


--
-- TOC entry 5528 (class 1259 OID 33908)
-- Name: ix_fk_33207; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33207 ON sdc."BOOKING" USING btree ("Patient_ID");


--
-- TOC entry 5529 (class 1259 OID 33909)
-- Name: ix_fk_33212; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33212 ON sdc."BOOKING" USING btree ("Clinic_ID");


--
-- TOC entry 5530 (class 1259 OID 33910)
-- Name: ix_fk_33217; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33217 ON sdc."BOOKING" USING btree ("Doctor_ID");


--
-- TOC entry 5531 (class 1259 OID 33911)
-- Name: ix_fk_33222; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33222 ON sdc."BOOKING" USING btree ("Service_ID");


--
-- TOC entry 5532 (class 1259 OID 33912)
-- Name: ix_fk_33227; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33227 ON sdc."BOOKING" USING btree ("Plan_ID");


--
-- TOC entry 5533 (class 1259 OID 33913)
-- Name: ix_fk_33232; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33232 ON sdc."BOOKING" USING btree ("Settlement_ID");


--
-- TOC entry 5534 (class 1259 OID 33914)
-- Name: ix_fk_33237; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33237 ON sdc."BOOKING" USING btree ("Created_By_User_ID");


--
-- TOC entry 5538 (class 1259 OID 33915)
-- Name: ix_fk_33252; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33252 ON sdc."PRESCRIPTION" USING btree ("Visit_ID");


--
-- TOC entry 5541 (class 1259 OID 33916)
-- Name: ix_fk_33257; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33257 ON sdc."AUDIT_LOG" USING btree ("User_ID");


--
-- TOC entry 5544 (class 1259 OID 33917)
-- Name: ix_fk_33262; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33262 ON sdc."NOTIFICATION" USING btree ("User_ID");


--
-- TOC entry 5551 (class 1259 OID 33918)
-- Name: ix_fk_33272; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33272 ON sdc."AI_RECOMMENDATION" USING btree ("Doctor_ID");


--
-- TOC entry 5552 (class 1259 OID 33919)
-- Name: ix_fk_33277; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33277 ON sdc."AI_RECOMMENDATION" USING btree ("Clinic_ID");


--
-- TOC entry 5553 (class 1259 OID 33920)
-- Name: ix_fk_33282; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33282 ON sdc."AI_RECOMMENDATION" USING btree ("Service_ID");


--
-- TOC entry 5561 (class 1259 OID 33921)
-- Name: ix_fk_33292; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33292 ON sdc."PROCEDURE" USING btree ("Visit_ID");


--
-- TOC entry 5562 (class 1259 OID 33922)
-- Name: ix_fk_33297; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33297 ON sdc."PROCEDURE" USING btree ("Service_ID");


--
-- TOC entry 5563 (class 1259 OID 33923)
-- Name: ix_fk_33302; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33302 ON sdc."PROCEDURE" USING btree ("Stage_ID");


--
-- TOC entry 5574 (class 1259 OID 33924)
-- Name: ix_fk_33317; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33317 ON sdc."HAS_SPECIALTY" USING btree ("Specialty_ID");


--
-- TOC entry 5577 (class 1259 OID 33925)
-- Name: ix_fk_33327; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33327 ON sdc."WORKS_AT" USING btree ("Doctor_ID");


--
-- TOC entry 5580 (class 1259 OID 33926)
-- Name: ix_fk_33337; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33337 ON sdc."OFFERS" USING btree ("Service_ID");


--
-- TOC entry 5583 (class 1259 OID 33927)
-- Name: ix_fk_33347; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33347 ON sdc."PROVIDES" USING btree ("Doctor_ID");


--
-- TOC entry 5584 (class 1259 OID 33928)
-- Name: ix_fk_33352; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33352 ON sdc."PROVIDES" USING btree ("Service_ID");


--
-- TOC entry 5588 (class 1259 OID 33929)
-- Name: ix_fk_33362; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33362 ON sdc."REGISTERED_AT" USING btree ("Clinic_ID");


--
-- TOC entry 5591 (class 1259 OID 33930)
-- Name: ix_fk_33372; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33372 ON sdc."WORKS_WITH" USING btree ("Laboratory_ID");


--
-- TOC entry 5596 (class 1259 OID 33931)
-- Name: ix_fk_33382; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33382 ON sdc."APPLIES_FOR" USING btree ("Job_ID");


--
-- TOC entry 5599 (class 1259 OID 33932)
-- Name: ix_fk_33392; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33392 ON sdc."STAFF_AT" USING btree ("Clinic_ID");


--
-- TOC entry 5600 (class 1259 OID 33933)
-- Name: ix_fk_33397; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33397 ON sdc."STAFF_AT" USING btree ("Role_ID");


--
-- TOC entry 5603 (class 1259 OID 33934)
-- Name: ix_fk_33402; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33402 ON sdc."STOCK_MOVEMENT" USING btree ("Item_ID");


--
-- TOC entry 5604 (class 1259 OID 33935)
-- Name: ix_fk_33407; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33407 ON sdc."STOCK_MOVEMENT" USING btree ("User_ID");


--
-- TOC entry 5608 (class 1259 OID 33936)
-- Name: ix_fk_33412; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33412 ON sdc."RECORDS_PAYMENT" USING btree ("Invoice_ID");


--
-- TOC entry 5609 (class 1259 OID 33937)
-- Name: ix_fk_33417; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33417 ON sdc."RECORDS_PAYMENT" USING btree ("User_ID");


--
-- TOC entry 5612 (class 1259 OID 33938)
-- Name: ix_fk_33422; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33422 ON sdc."RECORDS_SETTLEMENT_PAYMENT" USING btree ("Settlement_ID");


--
-- TOC entry 5613 (class 1259 OID 33939)
-- Name: ix_fk_33427; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33427 ON sdc."RECORDS_SETTLEMENT_PAYMENT" USING btree ("User_ID");


--
-- TOC entry 5616 (class 1259 OID 33940)
-- Name: ix_fk_33432; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33432 ON sdc."LAB_ORDER" USING btree ("Laboratory_ID");


--
-- TOC entry 5617 (class 1259 OID 33941)
-- Name: ix_fk_33437; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33437 ON sdc."LAB_ORDER" USING btree ("Visit_ID");


--
-- TOC entry 5620 (class 1259 OID 33942)
-- Name: ix_fk_33442; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33442 ON sdc."USER_SESSIONS" USING btree ("User_ID");


--
-- TOC entry 5624 (class 1259 OID 33943)
-- Name: ix_fk_33447; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33447 ON sdc."USER_RECOVERY_CODES" USING btree ("User_ID");


--
-- TOC entry 5627 (class 1259 OID 33944)
-- Name: ix_fk_33452; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33452 ON sdc."USER_POLICY_CONSENTS" USING btree ("User_ID");


--
-- TOC entry 5630 (class 1259 OID 33945)
-- Name: ix_fk_33457; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33457 ON sdc."PATIENT_ALLERGIES" USING btree ("Patient_ID");


--
-- TOC entry 5633 (class 1259 OID 33946)
-- Name: ix_fk_33462; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33462 ON sdc."PATIENT_CHRONIC_DISEASES" USING btree ("Patient_ID");


--
-- TOC entry 5636 (class 1259 OID 33947)
-- Name: ix_fk_33467; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33467 ON sdc."PATIENT_CURRENT_MEDICATIONS" USING btree ("Patient_ID");


--
-- TOC entry 5644 (class 1259 OID 33948)
-- Name: ix_fk_33477; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33477 ON sdc."CLINIC_WORKING_HOURS" USING btree ("Clinic_ID");


--
-- TOC entry 5647 (class 1259 OID 33949)
-- Name: ix_fk_33482; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33482 ON sdc."CLINIC_WORKING_EXCEPTIONS" USING btree ("Clinic_ID");


--
-- TOC entry 5650 (class 1259 OID 33950)
-- Name: ix_fk_33487; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33487 ON sdc."INVOICE_INVOICE_ITEMS" USING btree ("Invoice_ID");


--
-- TOC entry 5657 (class 1259 OID 33951)
-- Name: ix_fk_33497; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33497 ON sdc."PRESCRIPTION_MEDICATIONS" USING btree ("Prescription_ID");


--
-- TOC entry 5660 (class 1259 OID 33952)
-- Name: ix_fk_33502; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33502 ON sdc."AUDIT_LOG_CHANGES" USING btree ("Log_ID");


--
-- TOC entry 5663 (class 1259 OID 33953)
-- Name: ix_fk_33507; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33507 ON sdc."VISIT_CLINICAL_FINDINGS" USING btree ("Visit_ID");


--
-- TOC entry 5666 (class 1259 OID 33954)
-- Name: ix_fk_33512; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33512 ON sdc."VISIT_ODONTOGRAM" USING btree ("Visit_ID");


--
-- TOC entry 5669 (class 1259 OID 33955)
-- Name: ix_fk_33517; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33517 ON sdc."VISIT_TOOTH_SURFACE_NOTES" USING btree ("Visit_ID");


--
-- TOC entry 5672 (class 1259 OID 33956)
-- Name: ix_fk_33522; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33522 ON sdc."VISIT_DIAGNOSES" USING btree ("Visit_ID");


--
-- TOC entry 5675 (class 1259 OID 33957)
-- Name: ix_fk_33527; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33527 ON sdc."VISIT_VISIT_FILES" USING btree ("Visit_ID");


--
-- TOC entry 5678 (class 1259 OID 33958)
-- Name: ix_fk_33532; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33532 ON sdc."DOCTOR_WORKING_HOURS" USING btree ("Clinic_ID", "Doctor_ID");


--
-- TOC entry 5681 (class 1259 OID 33959)
-- Name: ix_fk_33537; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33537 ON sdc."DOCTOR_ABSENCES" USING btree ("Clinic_ID", "Doctor_ID");


--
-- TOC entry 5684 (class 1259 OID 33960)
-- Name: ix_fk_33542; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33542 ON sdc."JOB_APPLICATION_ATTACHMENTS" USING btree ("Application_ID");


--
-- TOC entry 5687 (class 1259 OID 33961)
-- Name: ix_fk_33547; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33547 ON sdc."STAFF_PERMISSIONS" USING btree ("User_ID", "Clinic_ID");


--
-- TOC entry 5690 (class 1259 OID 33962)
-- Name: ix_fk_33552; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33552 ON sdc."LAB_ORDER_ITEMS" USING btree ("Lab_Order_ID");


--
-- TOC entry 5585 (class 1259 OID 33963)
-- Name: ix_fk_33562; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33562 ON sdc."PROVIDES" USING btree ("Clinic_ID", "Service_ID");


--
-- TOC entry 5535 (class 1259 OID 33964)
-- Name: ix_fk_33567; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33567 ON sdc."BOOKING" USING btree ("Clinic_ID", "Doctor_ID", "Service_ID");


--
-- TOC entry 5554 (class 1259 OID 33965)
-- Name: ix_fk_33572; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_fk_33572 ON sdc."AI_RECOMMENDATION" USING btree ("Clinic_ID", "Doctor_ID", "Service_ID");


--
-- TOC entry 5545 (class 1259 OID 40617)
-- Name: ix_sdc_admin_notice_unread; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE INDEX ix_sdc_admin_notice_unread ON sdc."NOTIFICATION" USING btree ("User_ID", "Created_At" DESC) WHERE ((("Notification_Type")::text ~~ 'admin.%'::text) AND ("Read_At" IS NULL) AND ("Dismissed_At" IS NULL));


--
-- TOC entry 5641 (class 1259 OID 33810)
-- Name: uq_current_document; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_current_document ON sdc."CLINIC_DOCUMENTS" USING btree ("Clinic_ID", "Document_Type") WHERE "Is_Current";


--
-- TOC entry 5482 (class 1259 OID 33808)
-- Name: uq_doctor_license; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_doctor_license ON sdc."DOCTOR" USING btree (lower(btrim(("License_Number")::text)));


--
-- TOC entry 5489 (class 1259 OID 33809)
-- Name: uq_facility_license; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_facility_license ON sdc."CLINIC" USING btree (lower(btrim(("Facility_License_Number")::text)));


--
-- TOC entry 5605 (class 1259 OID 33811)
-- Name: uq_opening_stock; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_opening_stock ON sdc."STOCK_MOVEMENT" USING btree ("Item_ID") WHERE (("Movement_Type")::text = 'opening_balance'::text);


--
-- TOC entry 5471 (class 1259 OID 34211)
-- Name: uq_reset_hash; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_reset_hash ON sdc."USER" USING btree ("Password_Reset_Token_Hash") WHERE ("Password_Reset_Token_Hash" IS NOT NULL);


--
-- TOC entry 5520 (class 1259 OID 40594)
-- Name: uq_sdc_settlement_exact_period; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_sdc_settlement_exact_period ON sdc."SETTLEMENT" USING btree ("Clinic_ID", "Period_Start", "Period_End");


--
-- TOC entry 5472 (class 1259 OID 33807)
-- Name: uq_user_email_ci; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX uq_user_email_ci ON sdc."USER" USING btree (lower(btrim(("Email")::text))) WHERE ("Email" IS NOT NULL);


--
-- TOC entry 5546 (class 1259 OID 40616)
-- Name: ux_sdc_admin_notice_event; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX ux_sdc_admin_notice_event ON sdc."NOTIFICATION" USING btree ("User_ID", "Notification_Type", "Target_Type", "Target_Reference") WHERE (("Notification_Type")::text ~~ 'admin.%'::text);


--
-- TOC entry 5621 (class 1259 OID 34221)
-- Name: ux_sdc_user_sessions_token_hash; Type: INDEX; Schema: sdc; Owner: postgres
--

CREATE UNIQUE INDEX ux_sdc_user_sessions_token_hash ON sdc."USER_SESSIONS" USING btree ("Session_Token_Hash") WHERE ("Session_Token_Hash" IS NOT NULL);


--
-- TOC entry 5825 (class 2620 OID 34003)
-- Name: AI_ASSESSMENT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."AI_ASSESSMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5935 (class 2620 OID 34051)
-- Name: AI_ASSESSMENT_MESSAGES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."AI_ASSESSMENT_MESSAGES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5846 (class 2620 OID 34015)
-- Name: AI_RECOMMENDATION a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."AI_RECOMMENDATION" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5882 (class 2620 OID 34115)
-- Name: APPLIES_FOR a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."APPLIES_FOR" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5840 (class 2620 OID 34007)
-- Name: AUDIT_LOG a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."AUDIT_LOG" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5941 (class 2620 OID 34059)
-- Name: AUDIT_LOG_CHANGES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."AUDIT_LOG_CHANGES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5831 (class 2620 OID 34139)
-- Name: BOOKING a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."BOOKING" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5800 (class 2620 OID 34091)
-- Name: CLINIC a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."CLINIC" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5923 (class 2620 OID 34043)
-- Name: CLINIC_DOCUMENTS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."CLINIC_DOCUMENTS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5929 (class 2620 OID 34135)
-- Name: CLINIC_WORKING_EXCEPTIONS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."CLINIC_WORKING_EXCEPTIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5926 (class 2620 OID 34127)
-- Name: CLINIC_WORKING_HOURS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."CLINIC_WORKING_HOURS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5793 (class 2620 OID 34087)
-- Name: DOCTOR a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."DOCTOR" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5967 (class 2620 OID 34071)
-- Name: DOCTOR_ABSENCES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."DOCTOR_ABSENCES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5964 (class 2620 OID 34131)
-- Name: DOCTOR_WORKING_HOURS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."DOCTOR_WORKING_HOURS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5864 (class 2620 OID 33971)
-- Name: HAS_SPECIALTY a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."HAS_SPECIALTY" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5814 (class 2620 OID 33999)
-- Name: INVENTORY_ITEM a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."INVENTORY_ITEM" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5821 (class 2620 OID 34151)
-- Name: INVOICE a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."INVOICE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5932 (class 2620 OID 34047)
-- Name: INVOICE_INVOICE_ITEMS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."INVOICE_INVOICE_ITEMS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5817 (class 2620 OID 34111)
-- Name: JOB a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."JOB" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5970 (class 2620 OID 34075)
-- Name: JOB_APPLICATION_ATTACHMENTS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."JOB_APPLICATION_ATTACHMENTS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5810 (class 2620 OID 33995)
-- Name: LABORATORY a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."LABORATORY" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5901 (class 2620 OID 34191)
-- Name: LAB_ORDER a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."LAB_ORDER" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5977 (class 2620 OID 34187)
-- Name: LAB_ORDER_ITEMS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."LAB_ORDER_ITEMS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5843 (class 2620 OID 34011)
-- Name: NOTIFICATION a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."NOTIFICATION" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5870 (class 2620 OID 33975)
-- Name: OFFERS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."OFFERS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5790 (class 2620 OID 34123)
-- Name: PATIENT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PATIENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5914 (class 2620 OID 34031)
-- Name: PATIENT_ALLERGIES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PATIENT_ALLERGIES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5917 (class 2620 OID 34035)
-- Name: PATIENT_CHRONIC_DISEASES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PATIENT_CHRONIC_DISEASES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5920 (class 2620 OID 34039)
-- Name: PATIENT_CURRENT_MEDICATIONS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PATIENT_CURRENT_MEDICATIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5837 (class 2620 OID 34147)
-- Name: PRESCRIPTION a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PRESCRIPTION" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5938 (class 2620 OID 34055)
-- Name: PRESCRIPTION_MEDICATIONS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PRESCRIPTION_MEDICATIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5854 (class 2620 OID 34179)
-- Name: PROCEDURE a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PROCEDURE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5873 (class 2620 OID 33979)
-- Name: PROVIDES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."PROVIDES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5893 (class 2620 OID 34155)
-- Name: RECORDS_PAYMENT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."RECORDS_PAYMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5897 (class 2620 OID 34159)
-- Name: RECORDS_SETTLEMENT_PAYMENT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."RECORDS_SETTLEMENT_PAYMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5876 (class 2620 OID 33983)
-- Name: REGISTERED_AT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."REGISTERED_AT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5861 (class 2620 OID 34119)
-- Name: ROLE a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."ROLE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5804 (class 2620 OID 33991)
-- Name: SERVICE a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."SERVICE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5828 (class 2620 OID 33967)
-- Name: SETTLEMENT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."SETTLEMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5797 (class 2620 OID 33987)
-- Name: SPECIALTY a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."SPECIALTY" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5885 (class 2620 OID 34099)
-- Name: STAFF_AT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."STAFF_AT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5973 (class 2620 OID 34079)
-- Name: STAFF_PERMISSIONS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."STAFF_PERMISSIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5889 (class 2620 OID 34163)
-- Name: STOCK_MOVEMENT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."STOCK_MOVEMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5807 (class 2620 OID 34107)
-- Name: TREATMENT_PLAN a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."TREATMENT_PLAN" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5858 (class 2620 OID 34183)
-- Name: TREATMENT_STAGE a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."TREATMENT_STAGE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5787 (class 2620 OID 34083)
-- Name: USER a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."USER" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5911 (class 2620 OID 34027)
-- Name: USER_POLICY_CONSENTS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."USER_POLICY_CONSENTS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5908 (class 2620 OID 34023)
-- Name: USER_RECOVERY_CODES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."USER_RECOVERY_CODES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5905 (class 2620 OID 34019)
-- Name: USER_SESSIONS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."USER_SESSIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5849 (class 2620 OID 34143)
-- Name: VISIT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."VISIT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5944 (class 2620 OID 34063)
-- Name: VISIT_CLINICAL_FINDINGS a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."VISIT_CLINICAL_FINDINGS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5956 (class 2620 OID 34171)
-- Name: VISIT_DIAGNOSES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."VISIT_DIAGNOSES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5948 (class 2620 OID 34167)
-- Name: VISIT_ODONTOGRAM a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."VISIT_ODONTOGRAM" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5952 (class 2620 OID 34175)
-- Name: VISIT_TOOTH_SURFACE_NOTES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."VISIT_TOOTH_SURFACE_NOTES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5960 (class 2620 OID 34067)
-- Name: VISIT_VISIT_FILES a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."VISIT_VISIT_FILES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5867 (class 2620 OID 34095)
-- Name: WORKS_AT a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."WORKS_AT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5879 (class 2620 OID 34103)
-- Name: WORKS_WITH a_no_truncate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON sdc."WORKS_WITH" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_block_truncate();


--
-- TOC entry 5826 (class 2620 OID 34002)
-- Name: AI_ASSESSMENT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."AI_ASSESSMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5936 (class 2620 OID 34050)
-- Name: AI_ASSESSMENT_MESSAGES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."AI_ASSESSMENT_MESSAGES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5847 (class 2620 OID 34014)
-- Name: AI_RECOMMENDATION a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."AI_RECOMMENDATION" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5883 (class 2620 OID 34114)
-- Name: APPLIES_FOR a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."APPLIES_FOR" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5841 (class 2620 OID 34006)
-- Name: AUDIT_LOG a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."AUDIT_LOG" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5942 (class 2620 OID 34058)
-- Name: AUDIT_LOG_CHANGES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."AUDIT_LOG_CHANGES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5832 (class 2620 OID 34138)
-- Name: BOOKING a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."BOOKING" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5801 (class 2620 OID 34090)
-- Name: CLINIC a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."CLINIC" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5924 (class 2620 OID 34042)
-- Name: CLINIC_DOCUMENTS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."CLINIC_DOCUMENTS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5930 (class 2620 OID 34134)
-- Name: CLINIC_WORKING_EXCEPTIONS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."CLINIC_WORKING_EXCEPTIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5927 (class 2620 OID 34126)
-- Name: CLINIC_WORKING_HOURS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."CLINIC_WORKING_HOURS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5794 (class 2620 OID 34086)
-- Name: DOCTOR a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."DOCTOR" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5968 (class 2620 OID 34070)
-- Name: DOCTOR_ABSENCES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."DOCTOR_ABSENCES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5965 (class 2620 OID 34130)
-- Name: DOCTOR_WORKING_HOURS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."DOCTOR_WORKING_HOURS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5865 (class 2620 OID 33970)
-- Name: HAS_SPECIALTY a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."HAS_SPECIALTY" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5815 (class 2620 OID 33998)
-- Name: INVENTORY_ITEM a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."INVENTORY_ITEM" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5822 (class 2620 OID 34150)
-- Name: INVOICE a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."INVOICE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5933 (class 2620 OID 34046)
-- Name: INVOICE_INVOICE_ITEMS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."INVOICE_INVOICE_ITEMS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5818 (class 2620 OID 34110)
-- Name: JOB a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."JOB" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5971 (class 2620 OID 34074)
-- Name: JOB_APPLICATION_ATTACHMENTS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."JOB_APPLICATION_ATTACHMENTS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5811 (class 2620 OID 33994)
-- Name: LABORATORY a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."LABORATORY" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5902 (class 2620 OID 34190)
-- Name: LAB_ORDER a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."LAB_ORDER" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5978 (class 2620 OID 34186)
-- Name: LAB_ORDER_ITEMS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."LAB_ORDER_ITEMS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5844 (class 2620 OID 34010)
-- Name: NOTIFICATION a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."NOTIFICATION" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5871 (class 2620 OID 33974)
-- Name: OFFERS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."OFFERS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5791 (class 2620 OID 34122)
-- Name: PATIENT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PATIENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5915 (class 2620 OID 34030)
-- Name: PATIENT_ALLERGIES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PATIENT_ALLERGIES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5918 (class 2620 OID 34034)
-- Name: PATIENT_CHRONIC_DISEASES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PATIENT_CHRONIC_DISEASES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5921 (class 2620 OID 34038)
-- Name: PATIENT_CURRENT_MEDICATIONS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PATIENT_CURRENT_MEDICATIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5838 (class 2620 OID 34146)
-- Name: PRESCRIPTION a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PRESCRIPTION" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5939 (class 2620 OID 34054)
-- Name: PRESCRIPTION_MEDICATIONS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PRESCRIPTION_MEDICATIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5855 (class 2620 OID 34178)
-- Name: PROCEDURE a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PROCEDURE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5874 (class 2620 OID 33978)
-- Name: PROVIDES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."PROVIDES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5894 (class 2620 OID 34154)
-- Name: RECORDS_PAYMENT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."RECORDS_PAYMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5898 (class 2620 OID 34158)
-- Name: RECORDS_SETTLEMENT_PAYMENT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."RECORDS_SETTLEMENT_PAYMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5877 (class 2620 OID 33982)
-- Name: REGISTERED_AT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."REGISTERED_AT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5862 (class 2620 OID 34118)
-- Name: ROLE a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."ROLE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5805 (class 2620 OID 33990)
-- Name: SERVICE a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."SERVICE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5829 (class 2620 OID 33966)
-- Name: SETTLEMENT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."SETTLEMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5798 (class 2620 OID 33986)
-- Name: SPECIALTY a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."SPECIALTY" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5886 (class 2620 OID 34098)
-- Name: STAFF_AT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."STAFF_AT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5974 (class 2620 OID 34078)
-- Name: STAFF_PERMISSIONS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."STAFF_PERMISSIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5890 (class 2620 OID 34162)
-- Name: STOCK_MOVEMENT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."STOCK_MOVEMENT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5808 (class 2620 OID 34106)
-- Name: TREATMENT_PLAN a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."TREATMENT_PLAN" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5859 (class 2620 OID 34182)
-- Name: TREATMENT_STAGE a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."TREATMENT_STAGE" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5788 (class 2620 OID 34082)
-- Name: USER a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."USER" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5912 (class 2620 OID 34026)
-- Name: USER_POLICY_CONSENTS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."USER_POLICY_CONSENTS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5909 (class 2620 OID 34022)
-- Name: USER_RECOVERY_CODES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."USER_RECOVERY_CODES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5906 (class 2620 OID 34018)
-- Name: USER_SESSIONS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."USER_SESSIONS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5850 (class 2620 OID 34142)
-- Name: VISIT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5945 (class 2620 OID 34062)
-- Name: VISIT_CLINICAL_FINDINGS a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_CLINICAL_FINDINGS" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5957 (class 2620 OID 34170)
-- Name: VISIT_DIAGNOSES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_DIAGNOSES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5949 (class 2620 OID 34166)
-- Name: VISIT_ODONTOGRAM a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_ODONTOGRAM" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5953 (class 2620 OID 34174)
-- Name: VISIT_TOOTH_SURFACE_NOTES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_TOOTH_SURFACE_NOTES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5961 (class 2620 OID 34066)
-- Name: VISIT_VISIT_FILES a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_VISIT_FILES" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5868 (class 2620 OID 34094)
-- Name: WORKS_AT a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."WORKS_AT" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5880 (class 2620 OID 34102)
-- Name: WORKS_WITH a_write_gate; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER a_write_gate BEFORE INSERT OR DELETE OR UPDATE ON sdc."WORKS_WITH" FOR EACH STATEMENT EXECUTE FUNCTION sdc.sdc_write_gate();


--
-- TOC entry 5802 (class 2620 OID 34208)
-- Name: CLINIC approval_actor; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER approval_actor BEFORE INSERT OR UPDATE ON sdc."CLINIC" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_approval_authorization();


--
-- TOC entry 5795 (class 2620 OID 34209)
-- Name: DOCTOR approval_actor; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER approval_actor BEFORE INSERT OR UPDATE ON sdc."DOCTOR" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_approval_authorization();


--
-- TOC entry 5851 (class 2620 OID 34207)
-- Name: VISIT approval_actor; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER approval_actor BEFORE INSERT OR UPDATE ON sdc."VISIT" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_approval_authorization();


--
-- TOC entry 5833 (class 2620 OID 40599)
-- Name: BOOKING booking_commission_rate_at_creation; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER booking_commission_rate_at_creation BEFORE INSERT OR UPDATE ON sdc."BOOKING" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_booking_commission_rate_at_creation();


--
-- TOC entry 5834 (class 2620 OID 33889)
-- Name: BOOKING booking_guard; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER booking_guard BEFORE UPDATE ON sdc."BOOKING" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_booking_guard();


--
-- TOC entry 5827 (class 2620 OID 34004)
-- Name: AI_ASSESSMENT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."AI_ASSESSMENT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5937 (class 2620 OID 34052)
-- Name: AI_ASSESSMENT_MESSAGES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."AI_ASSESSMENT_MESSAGES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5848 (class 2620 OID 34016)
-- Name: AI_RECOMMENDATION business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."AI_RECOMMENDATION" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5884 (class 2620 OID 34116)
-- Name: APPLIES_FOR business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."APPLIES_FOR" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5842 (class 2620 OID 34008)
-- Name: AUDIT_LOG business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."AUDIT_LOG" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5943 (class 2620 OID 34060)
-- Name: AUDIT_LOG_CHANGES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."AUDIT_LOG_CHANGES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5835 (class 2620 OID 34140)
-- Name: BOOKING business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."BOOKING" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5803 (class 2620 OID 34092)
-- Name: CLINIC business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."CLINIC" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5925 (class 2620 OID 34044)
-- Name: CLINIC_DOCUMENTS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."CLINIC_DOCUMENTS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5931 (class 2620 OID 34136)
-- Name: CLINIC_WORKING_EXCEPTIONS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."CLINIC_WORKING_EXCEPTIONS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5928 (class 2620 OID 34128)
-- Name: CLINIC_WORKING_HOURS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."CLINIC_WORKING_HOURS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5796 (class 2620 OID 34088)
-- Name: DOCTOR business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."DOCTOR" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5969 (class 2620 OID 34072)
-- Name: DOCTOR_ABSENCES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."DOCTOR_ABSENCES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5966 (class 2620 OID 34132)
-- Name: DOCTOR_WORKING_HOURS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."DOCTOR_WORKING_HOURS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5866 (class 2620 OID 33972)
-- Name: HAS_SPECIALTY business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."HAS_SPECIALTY" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5816 (class 2620 OID 34000)
-- Name: INVENTORY_ITEM business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."INVENTORY_ITEM" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5823 (class 2620 OID 34152)
-- Name: INVOICE business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."INVOICE" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5934 (class 2620 OID 34048)
-- Name: INVOICE_INVOICE_ITEMS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."INVOICE_INVOICE_ITEMS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5819 (class 2620 OID 34112)
-- Name: JOB business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."JOB" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5972 (class 2620 OID 34076)
-- Name: JOB_APPLICATION_ATTACHMENTS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."JOB_APPLICATION_ATTACHMENTS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5812 (class 2620 OID 33996)
-- Name: LABORATORY business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."LABORATORY" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5903 (class 2620 OID 34192)
-- Name: LAB_ORDER business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."LAB_ORDER" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5979 (class 2620 OID 34188)
-- Name: LAB_ORDER_ITEMS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."LAB_ORDER_ITEMS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5845 (class 2620 OID 34012)
-- Name: NOTIFICATION business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."NOTIFICATION" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5872 (class 2620 OID 33976)
-- Name: OFFERS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."OFFERS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5792 (class 2620 OID 34124)
-- Name: PATIENT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PATIENT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5916 (class 2620 OID 34032)
-- Name: PATIENT_ALLERGIES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PATIENT_ALLERGIES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5919 (class 2620 OID 34036)
-- Name: PATIENT_CHRONIC_DISEASES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PATIENT_CHRONIC_DISEASES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5922 (class 2620 OID 34040)
-- Name: PATIENT_CURRENT_MEDICATIONS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PATIENT_CURRENT_MEDICATIONS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5839 (class 2620 OID 34148)
-- Name: PRESCRIPTION business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PRESCRIPTION" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5940 (class 2620 OID 34056)
-- Name: PRESCRIPTION_MEDICATIONS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PRESCRIPTION_MEDICATIONS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5856 (class 2620 OID 34180)
-- Name: PROCEDURE business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PROCEDURE" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5875 (class 2620 OID 33980)
-- Name: PROVIDES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."PROVIDES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5895 (class 2620 OID 34156)
-- Name: RECORDS_PAYMENT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."RECORDS_PAYMENT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5899 (class 2620 OID 34160)
-- Name: RECORDS_SETTLEMENT_PAYMENT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."RECORDS_SETTLEMENT_PAYMENT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5878 (class 2620 OID 33984)
-- Name: REGISTERED_AT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."REGISTERED_AT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5863 (class 2620 OID 34120)
-- Name: ROLE business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."ROLE" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5806 (class 2620 OID 33992)
-- Name: SERVICE business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."SERVICE" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5830 (class 2620 OID 33968)
-- Name: SETTLEMENT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."SETTLEMENT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5799 (class 2620 OID 33988)
-- Name: SPECIALTY business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."SPECIALTY" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5887 (class 2620 OID 34100)
-- Name: STAFF_AT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."STAFF_AT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5975 (class 2620 OID 34080)
-- Name: STAFF_PERMISSIONS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."STAFF_PERMISSIONS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5891 (class 2620 OID 34164)
-- Name: STOCK_MOVEMENT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."STOCK_MOVEMENT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5809 (class 2620 OID 34108)
-- Name: TREATMENT_PLAN business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."TREATMENT_PLAN" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5860 (class 2620 OID 34184)
-- Name: TREATMENT_STAGE business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."TREATMENT_STAGE" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5789 (class 2620 OID 34084)
-- Name: USER business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."USER" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5913 (class 2620 OID 34028)
-- Name: USER_POLICY_CONSENTS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."USER_POLICY_CONSENTS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5910 (class 2620 OID 34024)
-- Name: USER_RECOVERY_CODES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."USER_RECOVERY_CODES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5907 (class 2620 OID 34020)
-- Name: USER_SESSIONS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."USER_SESSIONS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5852 (class 2620 OID 34144)
-- Name: VISIT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."VISIT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5946 (class 2620 OID 34064)
-- Name: VISIT_CLINICAL_FINDINGS business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."VISIT_CLINICAL_FINDINGS" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5958 (class 2620 OID 34172)
-- Name: VISIT_DIAGNOSES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."VISIT_DIAGNOSES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5950 (class 2620 OID 34168)
-- Name: VISIT_ODONTOGRAM business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."VISIT_ODONTOGRAM" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5954 (class 2620 OID 34176)
-- Name: VISIT_TOOTH_SURFACE_NOTES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."VISIT_TOOTH_SURFACE_NOTES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5962 (class 2620 OID 34068)
-- Name: VISIT_VISIT_FILES business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."VISIT_VISIT_FILES" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5869 (class 2620 OID 34096)
-- Name: WORKS_AT business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."WORKS_AT" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5881 (class 2620 OID 34104)
-- Name: WORKS_WITH business_integrity; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE CONSTRAINT TRIGGER business_integrity AFTER INSERT OR DELETE OR UPDATE ON sdc."WORKS_WITH" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sdc.sdc_validate();


--
-- TOC entry 5980 (class 2620 OID 40596)
-- Name: platform_finance_settings finance_settings_superadmin_only; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER finance_settings_superadmin_only BEFORE INSERT OR DELETE OR UPDATE ON sdc.platform_finance_settings FOR EACH ROW EXECUTE FUNCTION sdc.sdc_finance_settings_superadmin_only();


--
-- TOC entry 5813 (class 2620 OID 33886)
-- Name: LABORATORY lab_master_admin; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER lab_master_admin BEFORE INSERT OR DELETE OR UPDATE ON sdc."LABORATORY" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_lab_admin();


--
-- TOC entry 5904 (class 2620 OID 40566)
-- Name: LAB_ORDER lab_order_master_active; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER lab_order_master_active BEFORE INSERT OR UPDATE ON sdc."LAB_ORDER" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_lab_order_master_active();


--
-- TOC entry 5824 (class 2620 OID 34202)
-- Name: INVOICE operation_permission; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER operation_permission BEFORE INSERT OR DELETE OR UPDATE ON sdc."INVOICE" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_operation_authorization();


--
-- TOC entry 5896 (class 2620 OID 34203)
-- Name: RECORDS_PAYMENT operation_permission; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER operation_permission BEFORE INSERT OR DELETE OR UPDATE ON sdc."RECORDS_PAYMENT" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_operation_authorization();


--
-- TOC entry 5900 (class 2620 OID 34204)
-- Name: RECORDS_SETTLEMENT_PAYMENT operation_permission; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER operation_permission BEFORE INSERT OR DELETE OR UPDATE ON sdc."RECORDS_SETTLEMENT_PAYMENT" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_operation_authorization();


--
-- TOC entry 5892 (class 2620 OID 34205)
-- Name: STOCK_MOVEMENT operation_permission; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER operation_permission BEFORE INSERT OR DELETE OR UPDATE ON sdc."STOCK_MOVEMENT" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_operation_authorization();


--
-- TOC entry 5857 (class 2620 OID 34200)
-- Name: PROCEDURE report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."PROCEDURE" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5853 (class 2620 OID 34194)
-- Name: VISIT report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5947 (class 2620 OID 34195)
-- Name: VISIT_CLINICAL_FINDINGS report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_CLINICAL_FINDINGS" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5959 (class 2620 OID 34198)
-- Name: VISIT_DIAGNOSES report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_DIAGNOSES" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5951 (class 2620 OID 34196)
-- Name: VISIT_ODONTOGRAM report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_ODONTOGRAM" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5955 (class 2620 OID 34197)
-- Name: VISIT_TOOTH_SURFACE_NOTES report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_TOOTH_SURFACE_NOTES" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5963 (class 2620 OID 34199)
-- Name: VISIT_VISIT_FILES report_immutable; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER report_immutable BEFORE INSERT OR DELETE OR UPDATE ON sdc."VISIT_VISIT_FILES" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_report_guard();


--
-- TOC entry 5836 (class 2620 OID 34216)
-- Name: BOOKING request_audit; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER request_audit AFTER UPDATE ON sdc."BOOKING" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_request_audit();


--
-- TOC entry 5820 (class 2620 OID 40602)
-- Name: JOB sdc_job_admin_suspension_guard; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER sdc_job_admin_suspension_guard BEFORE DELETE OR UPDATE ON sdc."JOB" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_job_admin_suspension_guard();


--
-- TOC entry 5888 (class 2620 OID 34213)
-- Name: STAFF_AT staff_management; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER staff_management BEFORE INSERT OR DELETE OR UPDATE ON sdc."STAFF_AT" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_staff_management();


--
-- TOC entry 5976 (class 2620 OID 34214)
-- Name: STAFF_PERMISSIONS staff_management; Type: TRIGGER; Schema: sdc; Owner: postgres
--

CREATE TRIGGER staff_management BEFORE INSERT OR DELETE OR UPDATE ON sdc."STAFF_PERMISSIONS" FOR EACH ROW EXECUTE FUNCTION sdc.sdc_staff_management();


--
-- TOC entry 5693 (class 2606 OID 33112)
-- Name: USER fk_001; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER"
    ADD CONSTRAINT fk_001 FOREIGN KEY ("Role_ID") REFERENCES sdc."ROLE"("Role_ID") DEFERRABLE;


--
-- TOC entry 5694 (class 2606 OID 33117)
-- Name: PATIENT fk_002; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT"
    ADD CONSTRAINT fk_002 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5695 (class 2606 OID 33122)
-- Name: DOCTOR fk_003; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR"
    ADD CONSTRAINT fk_003 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5696 (class 2606 OID 33127)
-- Name: DOCTOR fk_004; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR"
    ADD CONSTRAINT fk_004 FOREIGN KEY ("License_Reviewed_By_User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5697 (class 2606 OID 33132)
-- Name: CLINIC fk_005; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC"
    ADD CONSTRAINT fk_005 FOREIGN KEY ("Manager_Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5698 (class 2606 OID 33137)
-- Name: CLINIC fk_006; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC"
    ADD CONSTRAINT fk_006 FOREIGN KEY ("Reviewed_By_User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5699 (class 2606 OID 33142)
-- Name: TREATMENT_PLAN fk_007; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_PLAN"
    ADD CONSTRAINT fk_007 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5700 (class 2606 OID 33147)
-- Name: TREATMENT_PLAN fk_008; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_PLAN"
    ADD CONSTRAINT fk_008 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5701 (class 2606 OID 33152)
-- Name: TREATMENT_PLAN fk_009; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_PLAN"
    ADD CONSTRAINT fk_009 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5702 (class 2606 OID 33157)
-- Name: INVENTORY_ITEM fk_010; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVENTORY_ITEM"
    ADD CONSTRAINT fk_010 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5703 (class 2606 OID 33162)
-- Name: JOB fk_011; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."JOB"
    ADD CONSTRAINT fk_011 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5704 (class 2606 OID 33167)
-- Name: JOB fk_012; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."JOB"
    ADD CONSTRAINT fk_012 FOREIGN KEY ("Specialty_ID") REFERENCES sdc."SPECIALTY"("Specialty_ID") DEFERRABLE;


--
-- TOC entry 5705 (class 2606 OID 33172)
-- Name: INVOICE fk_013; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE"
    ADD CONSTRAINT fk_013 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5706 (class 2606 OID 33177)
-- Name: INVOICE fk_014; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE"
    ADD CONSTRAINT fk_014 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5707 (class 2606 OID 33182)
-- Name: INVOICE fk_015; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE"
    ADD CONSTRAINT fk_015 FOREIGN KEY ("Issued_By_User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5708 (class 2606 OID 33187)
-- Name: INVOICE fk_016; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE"
    ADD CONSTRAINT fk_016 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5709 (class 2606 OID 33192)
-- Name: AI_ASSESSMENT fk_017; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_ASSESSMENT"
    ADD CONSTRAINT fk_017 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5710 (class 2606 OID 33197)
-- Name: AI_ASSESSMENT fk_018; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_ASSESSMENT"
    ADD CONSTRAINT fk_018 FOREIGN KEY ("Specialty_ID") REFERENCES sdc."SPECIALTY"("Specialty_ID") DEFERRABLE;


--
-- TOC entry 5711 (class 2606 OID 33202)
-- Name: SETTLEMENT fk_019; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."SETTLEMENT"
    ADD CONSTRAINT fk_019 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5712 (class 2606 OID 33207)
-- Name: BOOKING fk_020; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_020 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5713 (class 2606 OID 33212)
-- Name: BOOKING fk_021; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_021 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5714 (class 2606 OID 33217)
-- Name: BOOKING fk_022; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_022 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5715 (class 2606 OID 33222)
-- Name: BOOKING fk_023; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_023 FOREIGN KEY ("Service_ID") REFERENCES sdc."SERVICE"("Service_ID") DEFERRABLE;


--
-- TOC entry 5716 (class 2606 OID 33227)
-- Name: BOOKING fk_024; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_024 FOREIGN KEY ("Plan_ID") REFERENCES sdc."TREATMENT_PLAN"("Plan_ID") DEFERRABLE;


--
-- TOC entry 5717 (class 2606 OID 33232)
-- Name: BOOKING fk_025; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_025 FOREIGN KEY ("Settlement_ID") REFERENCES sdc."SETTLEMENT"("Settlement_ID") DEFERRABLE;


--
-- TOC entry 5718 (class 2606 OID 33237)
-- Name: BOOKING fk_026; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_026 FOREIGN KEY ("Created_By_User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5719 (class 2606 OID 33242)
-- Name: BOOKING fk_027; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_027 FOREIGN KEY ("Recommendation_ID") REFERENCES sdc."AI_RECOMMENDATION"("Recommendation_ID") DEFERRABLE;


--
-- TOC entry 5720 (class 2606 OID 33247)
-- Name: BOOKING fk_028; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_028 FOREIGN KEY ("Follow_Up_Of_Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5722 (class 2606 OID 33252)
-- Name: PRESCRIPTION fk_029; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PRESCRIPTION"
    ADD CONSTRAINT fk_029 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5723 (class 2606 OID 33257)
-- Name: AUDIT_LOG fk_030; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AUDIT_LOG"
    ADD CONSTRAINT fk_030 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5724 (class 2606 OID 33262)
-- Name: NOTIFICATION fk_031; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."NOTIFICATION"
    ADD CONSTRAINT fk_031 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5725 (class 2606 OID 33267)
-- Name: AI_RECOMMENDATION fk_032; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT fk_032 FOREIGN KEY ("Assessment_ID") REFERENCES sdc."AI_ASSESSMENT"("Assessment_ID") DEFERRABLE;


--
-- TOC entry 5726 (class 2606 OID 33272)
-- Name: AI_RECOMMENDATION fk_033; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT fk_033 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5727 (class 2606 OID 33277)
-- Name: AI_RECOMMENDATION fk_034; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT fk_034 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5728 (class 2606 OID 33282)
-- Name: AI_RECOMMENDATION fk_035; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT fk_035 FOREIGN KEY ("Service_ID") REFERENCES sdc."SERVICE"("Service_ID") DEFERRABLE;


--
-- TOC entry 5730 (class 2606 OID 33287)
-- Name: VISIT fk_036; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT"
    ADD CONSTRAINT fk_036 FOREIGN KEY ("Booking_ID") REFERENCES sdc."BOOKING"("Booking_ID") DEFERRABLE;


--
-- TOC entry 5731 (class 2606 OID 33292)
-- Name: PROCEDURE fk_037; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROCEDURE"
    ADD CONSTRAINT fk_037 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5732 (class 2606 OID 33297)
-- Name: PROCEDURE fk_038; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROCEDURE"
    ADD CONSTRAINT fk_038 FOREIGN KEY ("Service_ID") REFERENCES sdc."SERVICE"("Service_ID") DEFERRABLE;


--
-- TOC entry 5733 (class 2606 OID 33302)
-- Name: PROCEDURE fk_039; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROCEDURE"
    ADD CONSTRAINT fk_039 FOREIGN KEY ("Stage_ID") REFERENCES sdc."TREATMENT_STAGE"("Stage_ID") DEFERRABLE;


--
-- TOC entry 5734 (class 2606 OID 33307)
-- Name: TREATMENT_STAGE fk_040; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."TREATMENT_STAGE"
    ADD CONSTRAINT fk_040 FOREIGN KEY ("Plan_ID") REFERENCES sdc."TREATMENT_PLAN"("Plan_ID") DEFERRABLE;


--
-- TOC entry 5735 (class 2606 OID 33312)
-- Name: HAS_SPECIALTY fk_041; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."HAS_SPECIALTY"
    ADD CONSTRAINT fk_041 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5736 (class 2606 OID 33317)
-- Name: HAS_SPECIALTY fk_042; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."HAS_SPECIALTY"
    ADD CONSTRAINT fk_042 FOREIGN KEY ("Specialty_ID") REFERENCES sdc."SPECIALTY"("Specialty_ID") DEFERRABLE;


--
-- TOC entry 5737 (class 2606 OID 33322)
-- Name: WORKS_AT fk_043; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."WORKS_AT"
    ADD CONSTRAINT fk_043 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5738 (class 2606 OID 33327)
-- Name: WORKS_AT fk_044; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."WORKS_AT"
    ADD CONSTRAINT fk_044 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5739 (class 2606 OID 33332)
-- Name: OFFERS fk_045; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."OFFERS"
    ADD CONSTRAINT fk_045 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5740 (class 2606 OID 33337)
-- Name: OFFERS fk_046; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."OFFERS"
    ADD CONSTRAINT fk_046 FOREIGN KEY ("Service_ID") REFERENCES sdc."SERVICE"("Service_ID") DEFERRABLE;


--
-- TOC entry 5741 (class 2606 OID 33342)
-- Name: PROVIDES fk_047; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROVIDES"
    ADD CONSTRAINT fk_047 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5742 (class 2606 OID 33347)
-- Name: PROVIDES fk_048; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROVIDES"
    ADD CONSTRAINT fk_048 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5743 (class 2606 OID 33352)
-- Name: PROVIDES fk_049; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROVIDES"
    ADD CONSTRAINT fk_049 FOREIGN KEY ("Service_ID") REFERENCES sdc."SERVICE"("Service_ID") DEFERRABLE;


--
-- TOC entry 5746 (class 2606 OID 33357)
-- Name: REGISTERED_AT fk_050; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."REGISTERED_AT"
    ADD CONSTRAINT fk_050 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5747 (class 2606 OID 33362)
-- Name: REGISTERED_AT fk_051; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."REGISTERED_AT"
    ADD CONSTRAINT fk_051 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5748 (class 2606 OID 33367)
-- Name: WORKS_WITH fk_052; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."WORKS_WITH"
    ADD CONSTRAINT fk_052 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5749 (class 2606 OID 33372)
-- Name: WORKS_WITH fk_053; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."WORKS_WITH"
    ADD CONSTRAINT fk_053 FOREIGN KEY ("Laboratory_ID") REFERENCES sdc."LABORATORY"("Laboratory_ID") DEFERRABLE;


--
-- TOC entry 5750 (class 2606 OID 33377)
-- Name: APPLIES_FOR fk_054; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."APPLIES_FOR"
    ADD CONSTRAINT fk_054 FOREIGN KEY ("Doctor_ID") REFERENCES sdc."DOCTOR"("Doctor_ID") DEFERRABLE;


--
-- TOC entry 5751 (class 2606 OID 33382)
-- Name: APPLIES_FOR fk_055; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."APPLIES_FOR"
    ADD CONSTRAINT fk_055 FOREIGN KEY ("Job_ID") REFERENCES sdc."JOB"("Job_ID") DEFERRABLE;


--
-- TOC entry 5752 (class 2606 OID 33387)
-- Name: STAFF_AT fk_056; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STAFF_AT"
    ADD CONSTRAINT fk_056 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5753 (class 2606 OID 33392)
-- Name: STAFF_AT fk_057; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STAFF_AT"
    ADD CONSTRAINT fk_057 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5754 (class 2606 OID 33397)
-- Name: STAFF_AT fk_058; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STAFF_AT"
    ADD CONSTRAINT fk_058 FOREIGN KEY ("Role_ID") REFERENCES sdc."ROLE"("Role_ID") DEFERRABLE;


--
-- TOC entry 5755 (class 2606 OID 33402)
-- Name: STOCK_MOVEMENT fk_059; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STOCK_MOVEMENT"
    ADD CONSTRAINT fk_059 FOREIGN KEY ("Item_ID") REFERENCES sdc."INVENTORY_ITEM"("Item_ID") DEFERRABLE;


--
-- TOC entry 5756 (class 2606 OID 33407)
-- Name: STOCK_MOVEMENT fk_060; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STOCK_MOVEMENT"
    ADD CONSTRAINT fk_060 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5757 (class 2606 OID 33412)
-- Name: RECORDS_PAYMENT fk_061; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."RECORDS_PAYMENT"
    ADD CONSTRAINT fk_061 FOREIGN KEY ("Invoice_ID") REFERENCES sdc."INVOICE"("Invoice_ID") DEFERRABLE;


--
-- TOC entry 5758 (class 2606 OID 33417)
-- Name: RECORDS_PAYMENT fk_062; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."RECORDS_PAYMENT"
    ADD CONSTRAINT fk_062 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5759 (class 2606 OID 33422)
-- Name: RECORDS_SETTLEMENT_PAYMENT fk_063; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."RECORDS_SETTLEMENT_PAYMENT"
    ADD CONSTRAINT fk_063 FOREIGN KEY ("Settlement_ID") REFERENCES sdc."SETTLEMENT"("Settlement_ID") DEFERRABLE;


--
-- TOC entry 5760 (class 2606 OID 33427)
-- Name: RECORDS_SETTLEMENT_PAYMENT fk_064; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."RECORDS_SETTLEMENT_PAYMENT"
    ADD CONSTRAINT fk_064 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5761 (class 2606 OID 33432)
-- Name: LAB_ORDER fk_065; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."LAB_ORDER"
    ADD CONSTRAINT fk_065 FOREIGN KEY ("Laboratory_ID") REFERENCES sdc."LABORATORY"("Laboratory_ID") DEFERRABLE;


--
-- TOC entry 5762 (class 2606 OID 33437)
-- Name: LAB_ORDER fk_066; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."LAB_ORDER"
    ADD CONSTRAINT fk_066 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5763 (class 2606 OID 33442)
-- Name: USER_SESSIONS fk_067; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER_SESSIONS"
    ADD CONSTRAINT fk_067 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5764 (class 2606 OID 33447)
-- Name: USER_RECOVERY_CODES fk_068; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER_RECOVERY_CODES"
    ADD CONSTRAINT fk_068 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5765 (class 2606 OID 33452)
-- Name: USER_POLICY_CONSENTS fk_069; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."USER_POLICY_CONSENTS"
    ADD CONSTRAINT fk_069 FOREIGN KEY ("User_ID") REFERENCES sdc."USER"("User_ID") DEFERRABLE;


--
-- TOC entry 5766 (class 2606 OID 33457)
-- Name: PATIENT_ALLERGIES fk_070; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT_ALLERGIES"
    ADD CONSTRAINT fk_070 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5767 (class 2606 OID 33462)
-- Name: PATIENT_CHRONIC_DISEASES fk_071; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT_CHRONIC_DISEASES"
    ADD CONSTRAINT fk_071 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5768 (class 2606 OID 33467)
-- Name: PATIENT_CURRENT_MEDICATIONS fk_072; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PATIENT_CURRENT_MEDICATIONS"
    ADD CONSTRAINT fk_072 FOREIGN KEY ("Patient_ID") REFERENCES sdc."PATIENT"("Patient_ID") DEFERRABLE;


--
-- TOC entry 5769 (class 2606 OID 33472)
-- Name: CLINIC_DOCUMENTS fk_073; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_DOCUMENTS"
    ADD CONSTRAINT fk_073 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5770 (class 2606 OID 33477)
-- Name: CLINIC_WORKING_HOURS fk_074; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_WORKING_HOURS"
    ADD CONSTRAINT fk_074 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5771 (class 2606 OID 33482)
-- Name: CLINIC_WORKING_EXCEPTIONS fk_075; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."CLINIC_WORKING_EXCEPTIONS"
    ADD CONSTRAINT fk_075 FOREIGN KEY ("Clinic_ID") REFERENCES sdc."CLINIC"("Clinic_ID") DEFERRABLE;


--
-- TOC entry 5772 (class 2606 OID 33487)
-- Name: INVOICE_INVOICE_ITEMS fk_076; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."INVOICE_INVOICE_ITEMS"
    ADD CONSTRAINT fk_076 FOREIGN KEY ("Invoice_ID") REFERENCES sdc."INVOICE"("Invoice_ID") DEFERRABLE;


--
-- TOC entry 5773 (class 2606 OID 33492)
-- Name: AI_ASSESSMENT_MESSAGES fk_077; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_ASSESSMENT_MESSAGES"
    ADD CONSTRAINT fk_077 FOREIGN KEY ("Assessment_ID") REFERENCES sdc."AI_ASSESSMENT"("Assessment_ID") DEFERRABLE;


--
-- TOC entry 5774 (class 2606 OID 33497)
-- Name: PRESCRIPTION_MEDICATIONS fk_078; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PRESCRIPTION_MEDICATIONS"
    ADD CONSTRAINT fk_078 FOREIGN KEY ("Prescription_ID") REFERENCES sdc."PRESCRIPTION"("Prescription_ID") DEFERRABLE;


--
-- TOC entry 5775 (class 2606 OID 33502)
-- Name: AUDIT_LOG_CHANGES fk_079; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AUDIT_LOG_CHANGES"
    ADD CONSTRAINT fk_079 FOREIGN KEY ("Log_ID") REFERENCES sdc."AUDIT_LOG"("Log_ID") DEFERRABLE;


--
-- TOC entry 5776 (class 2606 OID 33507)
-- Name: VISIT_CLINICAL_FINDINGS fk_080; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_CLINICAL_FINDINGS"
    ADD CONSTRAINT fk_080 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5777 (class 2606 OID 33512)
-- Name: VISIT_ODONTOGRAM fk_081; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_ODONTOGRAM"
    ADD CONSTRAINT fk_081 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5778 (class 2606 OID 33517)
-- Name: VISIT_TOOTH_SURFACE_NOTES fk_082; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_TOOTH_SURFACE_NOTES"
    ADD CONSTRAINT fk_082 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5779 (class 2606 OID 33522)
-- Name: VISIT_DIAGNOSES fk_083; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_DIAGNOSES"
    ADD CONSTRAINT fk_083 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5780 (class 2606 OID 33527)
-- Name: VISIT_VISIT_FILES fk_084; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."VISIT_VISIT_FILES"
    ADD CONSTRAINT fk_084 FOREIGN KEY ("Visit_ID") REFERENCES sdc."VISIT"("Visit_ID") DEFERRABLE;


--
-- TOC entry 5781 (class 2606 OID 33532)
-- Name: DOCTOR_WORKING_HOURS fk_085; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR_WORKING_HOURS"
    ADD CONSTRAINT fk_085 FOREIGN KEY ("Clinic_ID", "Doctor_ID") REFERENCES sdc."WORKS_AT"("Clinic_ID", "Doctor_ID") DEFERRABLE;


--
-- TOC entry 5782 (class 2606 OID 33537)
-- Name: DOCTOR_ABSENCES fk_086; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."DOCTOR_ABSENCES"
    ADD CONSTRAINT fk_086 FOREIGN KEY ("Clinic_ID", "Doctor_ID") REFERENCES sdc."WORKS_AT"("Clinic_ID", "Doctor_ID") DEFERRABLE;


--
-- TOC entry 5783 (class 2606 OID 33542)
-- Name: JOB_APPLICATION_ATTACHMENTS fk_087; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."JOB_APPLICATION_ATTACHMENTS"
    ADD CONSTRAINT fk_087 FOREIGN KEY ("Application_ID") REFERENCES sdc."APPLIES_FOR"("Application_ID") DEFERRABLE;


--
-- TOC entry 5784 (class 2606 OID 33547)
-- Name: STAFF_PERMISSIONS fk_088; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."STAFF_PERMISSIONS"
    ADD CONSTRAINT fk_088 FOREIGN KEY ("User_ID", "Clinic_ID") REFERENCES sdc."STAFF_AT"("User_ID", "Clinic_ID") DEFERRABLE;


--
-- TOC entry 5785 (class 2606 OID 33552)
-- Name: LAB_ORDER_ITEMS fk_089; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."LAB_ORDER_ITEMS"
    ADD CONSTRAINT fk_089 FOREIGN KEY ("Lab_Order_ID") REFERENCES sdc."LAB_ORDER"("Lab_Order_ID") DEFERRABLE;


--
-- TOC entry 5744 (class 2606 OID 33557)
-- Name: PROVIDES fk_090; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROVIDES"
    ADD CONSTRAINT fk_090 FOREIGN KEY ("Clinic_ID", "Doctor_ID") REFERENCES sdc."WORKS_AT"("Clinic_ID", "Doctor_ID") DEFERRABLE;


--
-- TOC entry 5745 (class 2606 OID 33562)
-- Name: PROVIDES fk_091; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."PROVIDES"
    ADD CONSTRAINT fk_091 FOREIGN KEY ("Clinic_ID", "Service_ID") REFERENCES sdc."OFFERS"("Clinic_ID", "Service_ID") DEFERRABLE;


--
-- TOC entry 5721 (class 2606 OID 33567)
-- Name: BOOKING fk_092; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."BOOKING"
    ADD CONSTRAINT fk_092 FOREIGN KEY ("Clinic_ID", "Doctor_ID", "Service_ID") REFERENCES sdc."PROVIDES"("Clinic_ID", "Doctor_ID", "Service_ID") DEFERRABLE;


--
-- TOC entry 5729 (class 2606 OID 33572)
-- Name: AI_RECOMMENDATION fk_093; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc."AI_RECOMMENDATION"
    ADD CONSTRAINT fk_093 FOREIGN KEY ("Clinic_ID", "Doctor_ID", "Service_ID") REFERENCES sdc."PROVIDES"("Clinic_ID", "Doctor_ID", "Service_ID") DEFERRABLE;


--
-- TOC entry 5786 (class 2606 OID 40589)
-- Name: platform_finance_settings platform_finance_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: sdc; Owner: postgres
--

ALTER TABLE ONLY sdc.platform_finance_settings
    ADD CONSTRAINT platform_finance_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES sdc."USER"("User_ID");


--
-- TOC entry 6241 (class 0 OID 0)
-- Dependencies: 327
-- Name: FUNCTION sdc_actor_id(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_actor_id() FROM PUBLIC;


--
-- TOC entry 6242 (class 0 OID 0)
-- Dependencies: 351
-- Name: FUNCTION sdc_approval_authorization(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_approval_authorization() FROM PUBLIC;


--
-- TOC entry 6243 (class 0 OID 0)
-- Dependencies: 331
-- Name: FUNCTION sdc_block_truncate(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_block_truncate() FROM PUBLIC;


--
-- TOC entry 6244 (class 0 OID 0)
-- Dependencies: 349
-- Name: FUNCTION sdc_booking_guard(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_booking_guard() FROM PUBLIC;


--
-- TOC entry 6245 (class 0 OID 0)
-- Dependencies: 329
-- Name: FUNCTION sdc_can(a bigint, c bigint, p text); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_can(a bigint, c bigint, p text) FROM PUBLIC;


--
-- TOC entry 6246 (class 0 OID 0)
-- Dependencies: 328
-- Name: FUNCTION sdc_is_superadmin(a bigint); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_is_superadmin(a bigint) FROM PUBLIC;


--
-- TOC entry 6247 (class 0 OID 0)
-- Dependencies: 332
-- Name: FUNCTION sdc_lab_admin(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_lab_admin() FROM PUBLIC;


--
-- TOC entry 6248 (class 0 OID 0)
-- Dependencies: 350
-- Name: FUNCTION sdc_operation_authorization(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_operation_authorization() FROM PUBLIC;


--
-- TOC entry 6249 (class 0 OID 0)
-- Dependencies: 348
-- Name: FUNCTION sdc_report_guard(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_report_guard() FROM PUBLIC;


--
-- TOC entry 6250 (class 0 OID 0)
-- Dependencies: 347
-- Name: FUNCTION sdc_request_audit(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_request_audit() FROM PUBLIC;


--
-- TOC entry 6251 (class 0 OID 0)
-- Dependencies: 352
-- Name: FUNCTION sdc_staff_management(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_staff_management() FROM PUBLIC;


--
-- TOC entry 6252 (class 0 OID 0)
-- Dependencies: 353
-- Name: FUNCTION sdc_validate(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_validate() FROM PUBLIC;


--
-- TOC entry 6253 (class 0 OID 0)
-- Dependencies: 330
-- Name: FUNCTION sdc_write_gate(); Type: ACL; Schema: sdc; Owner: postgres
--

REVOKE ALL ON FUNCTION sdc.sdc_write_gate() FROM PUBLIC;


-- Completed on 2026-10-30 19:05:53

--
-- PostgreSQL database dump complete
--



-- Keep identity values beyond the preserved reference rows.
SELECT pg_catalog.setval('sdc."ROLE_Role_ID_seq"', (SELECT MAX("Role_ID") FROM sdc."ROLE"), true);
SELECT pg_catalog.setval('sdc."SPECIALTY_Specialty_ID_seq"', (SELECT MAX("Specialty_ID") FROM sdc."SPECIALTY"), true);

COMMIT;

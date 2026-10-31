'use strict';
// Registration choices come from the same live catalog used by Super Admin.
// IDs are immutable even when an administrator renames a specialty.
const MAX_SELECTED_SPECIALTIES = 20;
const validSpecialtyId = value => typeof value === 'string' && /^[1-9]\d{0,17}$/.test(value);

async function listActiveSpecialties(pool) {
  const result = await pool.query(`SELECT "Specialty_ID"::text AS id, "Name_AR" AS name
    FROM sdc."SPECIALTY" WHERE "Is_Active"=true
    ORDER BY "Name_AR", "Specialty_ID"`);
  return result.rows;
}

module.exports = {MAX_SELECTED_SPECIALTIES, validSpecialtyId, listActiveSpecialties};

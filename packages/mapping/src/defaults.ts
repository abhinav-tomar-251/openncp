import type { MappingDefinition } from "./index.js";

/**
 * Starter NPSP -> NPC mapping definitions (v1 DRAFTS).
 *
 * These are field-level defaults intended to be reviewed and refined against the
 * live target-org schema (a future mapping-editor milestone). NPC standard-object
 * API/field names evolve and orgs customize, so treat every target name here as a
 * default to confirm. Complex model transforms (multi-member household merge,
 * Opportunity+Payment consolidation, soft credits) are deliberately out of the v1
 * drafts. See docs/05-data-model-mapping.md.
 */
export const DEFAULT_MAPPINGS: Record<string, MappingDefinition> = {
  // Contact -> Person Account (one Person Account per Contact).
  // NOTE: creating a Person Account also requires the person-account RecordTypeId,
  // which is target-org specific and cannot be a static constant here — it's
  // resolved live and injected as a transform `overrides` value (see
  // apps/worker/src/jobs/transform.ts and findPersonAccountRecordTypeId).
  Contact: {
    source: "Contact",
    target: "Account",
    fieldMap: {
      FirstName: "FirstName",
      LastName: "LastName",
      Salutation: "Salutation",
      // Title intentionally omitted: confirmed live via the Analyze stage that
      // Person Accounts don't expose a Title field the way standard Contacts do.
      Phone: "Phone",
      MobilePhone: "PersonMobilePhone",
      Email: "PersonEmail",
      Birthdate: "PersonBirthdate",
      MailingStreet: "PersonMailingStreet",
      MailingCity: "PersonMailingCity",
      MailingState: "PersonMailingState",
      MailingPostalCode: "PersonMailingPostalCode",
      MailingCountry: "PersonMailingCountry",
      Description: "Description",
    },
  },

  // Opportunity (Donation) -> GiftTransaction.
  Opportunity: {
    source: "Opportunity",
    target: "GiftTransaction",
    fieldMap: {
      Amount: "OriginalAmount",
      CloseDate: "TransactionDate",
      StageName: "Status",
      Description: "Description",
    },
    valueMap: {
      StageName: {
        "Closed Won": "Paid",
        Pledged: "Outstanding",
        Posted: "Paid",
        "Closed Lost": "Cancelled",
      },
    },
    lookups: {
      CampaignId: { relationship: "Campaign", targetObject: "Campaign" },
    },
    reconcile: { amountField: "OriginalAmount" },
  },

  // Campaign -> Campaign (standard both sides — near pass-through).
  Campaign: {
    source: "Campaign",
    target: "Campaign",
    fieldMap: {
      Name: "Name",
      Type: "Type",
      Status: "Status",
      IsActive: "IsActive",
      StartDate: "StartDate",
      EndDate: "EndDate",
      Description: "Description",
      ExpectedRevenue: "ExpectedRevenue",
      BudgetedCost: "BudgetedCost",
    },
    lookups: {
      ParentId: { relationship: "Parent", targetObject: "Campaign" },
    },
  },

  // General Accounting Unit -> Designation.
  npsp__General_Accounting_Unit__c: {
    source: "npsp__General_Accounting_Unit__c",
    target: "Designation",
    fieldMap: {
      Name: "Name",
      npsp__Description__c: "Description",
      npsp__Active__c: "IsActive",
    },
  },

  // Task -> Task (standard both sides — near pass-through).
  // KNOWN LIMITATION (v1): WhoId/WhatId are polymorphic lookups (Contact/Lead,
  // Account/Opportunity/Campaign/…). Bulk API 2.0's external-id relationship
  // syntax for polymorphic fields is not implemented here — it needs live-org
  // verification we can't do without a real target org. Tasks migrate with their
  // own field data but are NOT re-linked to their donor/campaign in v1.
  Task: {
    source: "Task",
    target: "Task",
    fieldMap: {
      Subject: "Subject",
      ActivityDate: "ActivityDate",
      Status: "Status",
      Priority: "Priority",
      Description: "Description",
    },
  },

  // Event -> Event (standard both sides). Same WhoId/WhatId limitation as Task.
  Event: {
    source: "Event",
    target: "Event",
    fieldMap: {
      Subject: "Subject",
      StartDateTime: "StartDateTime",
      EndDateTime: "EndDateTime",
      Location: "Location",
      Description: "Description",
    },
  },
};

/** Distinct target objects across all default mappings (for target-schema prep). */
export function targetObjectsFromMappings(
  mappings: Record<string, MappingDefinition> = DEFAULT_MAPPINGS,
): string[] {
  return Array.from(new Set(Object.values(mappings).map((m) => m.target)));
}

/**
 * Target field names our mappings actually reference for a given target object —
 * used by the Analyze stage's target-schema check to diagnose *why* a target
 * object/field might be missing, before prepare-target/transform hit it blindly.
 * Best-effort, not authoritative: lookup fields are inferred as `${relationship}Id`
 * (the standard Salesforce convention), which may not hold for custom relationships.
 * `Legacy_NPSP_Id__c` is intentionally excluded — prepare-target creates it, so its
 * absence beforehand is expected, not a finding.
 */
export function targetFieldsForObject(
  targetObject: string,
  mappings: Record<string, MappingDefinition> = DEFAULT_MAPPINGS,
): string[] {
  const fields = new Set<string>(["OwnerId"]); // injected as an override on every mapped object
  if (targetObject === "Account") fields.add("RecordTypeId"); // Contact -> Person Account override

  for (const def of Object.values(mappings)) {
    if (def.target !== targetObject) continue;
    for (const tgtField of Object.values(def.fieldMap)) fields.add(tgtField);
    for (const lookup of Object.values(def.lookups ?? {})) fields.add(`${lookup.relationship}Id`);
    for (const constField of Object.keys(def.constants ?? {})) fields.add(constField);
  }
  return Array.from(fields);
}

/**
 * Dependency order for loading target objects: parents before children so
 * relationship-by-external-id lookups resolve at upsert time. Objects not listed
 * are loaded last. See docs/05-data-model-mapping.md §7.
 */
export const TARGET_LOAD_ORDER: readonly string[] = [
  "Designation",
  "Account", // Person/Business Accounts (donors)
  "Campaign",
  "GiftCommitment",
  "GiftTransaction", // references Campaign (and donor Account)
  "GiftTransactionDesignation",
  "GiftSoftCredit",
  "Task",
  "Event",
];

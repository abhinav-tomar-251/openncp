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
  //
  // DONOR LINKAGE: `npsp__Primary_Contact__c` is the donor Contact, and the
  // Contact->Account mapping above turns that Contact into a Person Account
  // stamped with `Legacy_NPSP_Id__c = <Contact Id>`. So resolving the gift's
  // `Donor` relationship by that same external id lands it on the right Person
  // Account. Without this every migrated gift is orphaned (no DonorId) — the
  // single highest-impact correctness fix from the real-org analysis.
  //
  // We deliberately use `npsp__Primary_Contact__c` rather than `AccountId`:
  // in NPSP's Household model `AccountId` is the *Household* Account, which is
  // not a constituent in NPC's Person Account model.
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
      // Verified against the real org's StageName picklist:
      // Prospecting; Pledged; Closed Lost; Closed Won; Cultivating.
      // Target GiftTransaction.Status: Canceled, Failed, Fully Refunded, Paid,
      // Pending, Unpaid, Written-Off.
      StageName: {
        "Closed Won": "Paid",
        Pledged: "Unpaid",
        "Closed Lost": "Canceled",
        Prospecting: "Pending",
        Cultivating: "Pending",
      },
    },
    lookups: {
      CampaignId: { relationship: "Campaign", targetObject: "Campaign" },
      npsp__Primary_Contact__c: { relationship: "Donor", targetObject: "Account" },
      npe03__Recurring_Donation__c: { relationship: "GiftCommitment", targetObject: "GiftCommitment" },
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

  // General Accounting Unit -> GiftDesignation.
  //
  // The NPC object is `GiftDesignation`, NOT `Designation` — verified against a
  // real NPC org's inventory (`Designation` does not exist). The old name meant
  // this curated seed silently fell through to `unmapped` on every real org.
  npsp__General_Accounting_Unit__c: {
    source: "npsp__General_Accounting_Unit__c",
    target: "GiftDesignation",
    fieldMap: {
      Name: "Name",
      npsp__Description__c: "Description",
      npsp__Active__c: "IsActive",
    },
  },

  // GAU Allocation -> GiftTransactionDesignation (the gift<->fund junction).
  // Both sides are 1:1, so this is expressible with today's engine. NPSP keeps
  // amount AND percent; NPC's junction has the same two fields.
  npsp__Allocation__c: {
    source: "npsp__Allocation__c",
    target: "GiftTransactionDesignation",
    fieldMap: {
      npsp__Amount__c: "Amount",
      npsp__Percent__c: "Percent",
    },
    lookups: {
      npsp__Opportunity__c: { relationship: "GiftTransaction", targetObject: "GiftTransaction" },
      npsp__General_Accounting_Unit__c: { relationship: "GiftDesignation", targetObject: "GiftDesignation" },
    },
  },

  // Partial Soft Credit -> GiftSoftCredit.
  // NPC's Role picklist is Honoree | Household Member | Influencer | Matched Donor |
  // Other | Soft Credit | Solicitor | Third Party Donor. NPSP's free-text
  // `npsp__Role_Name__c` is carried through a value map for the common cases.
  npsp__Partial_Soft_Credit__c: {
    source: "npsp__Partial_Soft_Credit__c",
    target: "GiftSoftCredit",
    fieldMap: {
      npsp__Amount__c: "PartialAmount",
      npsp__Role_Name__c: "Role",
    },
    valueMap: {
      npsp__Role_Name__c: {
        "Soft Credit": "Soft Credit",
        Solicitor: "Solicitor",
        Honoree: "Honoree",
        "Household Member": "Household Member",
        "Matched Donor": "Matched Donor",
      },
    },
    constants: { Role: "Soft Credit" },
    lookups: {
      npsp__Opportunity__c: { relationship: "GiftTransaction", targetObject: "GiftTransaction" },
      npsp__Contact__c: { relationship: "Recipient", targetObject: "Account" },
    },
  },

  // Recurring Donation -> GiftCommitment.
  //
  // The commitment itself is 1:1 and expressible today. Its SCHEDULE is a separate
  // child record (`GiftCommitmentSchedule`, master-detail to the commitment) which
  // needs multi-record emit — see docs/planning_for_migration/02-engine-architecture.md.
  // Until then the commitment migrates without its installment schedule.
  npe03__Recurring_Donation__c: {
    source: "npe03__Recurring_Donation__c",
    target: "GiftCommitment",
    fieldMap: {
      npe03__Amount__c: "ExpectedTotalCmtAmount",
      npe03__Open_Ended_Status__c: "Status",
    },
    valueMap: {
      // Verified picklist: Open; Closed; None -> NPC Status:
      // Draft, Active, Paused, Failing, Lapsed, Closed.
      npe03__Open_Ended_Status__c: {
        Open: "Active",
        Closed: "Closed",
        None: "Draft",
      },
    },
    lookups: {
      npe03__Contact__c: { relationship: "Donor", targetObject: "Account" },
      npe03__Recurring_Donation_Campaign__c: { relationship: "Campaign", targetObject: "Campaign" },
    },
  },

  // Affiliation (person <-> organization) -> AccountContactRelation.
  // NPC replaces NPSP Affiliations with "Contacts to Multiple Accounts".
  npe5__Affiliation__c: {
    source: "npe5__Affiliation__c",
    target: "AccountContactRelation",
    fieldMap: {
      npe5__Role__c: "Roles",
      npe5__Primary__c: "IsDirect",
      npe5__StartDate__c: "StartDate",
      npe5__EndDate__c: "EndDate",
    },
    lookups: {
      npe5__Organization__c: { relationship: "Account", targetObject: "Account" },
      npe5__Contact__c: { relationship: "Contact", targetObject: "Account" },
    },
  },

  // Relationship (person <-> person) -> ContactContactRelation.
  // KNOWN LIMITATION: NPSP auto-creates a reciprocal row for every relationship
  // (`npe4__ReciprocalRelationship__c`). Deduplicating those pairs needs a
  // persistable record filter, which the mapping layer can't serialize yet — so
  // both directions migrate today. See docs/planning_for_migration/02.
  npe4__Relationship__c: {
    source: "npe4__Relationship__c",
    target: "ContactContactRelation",
    fieldMap: {
      npe4__Type__c: "Roles",
      npe4__Description__c: "Description",
    },
    lookups: {
      npe4__Contact__c: { relationship: "Contact", targetObject: "Account" },
      npe4__RelatedContact__c: { relationship: "RelatedContact", targetObject: "Account" },
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
 *
 * `OwnerId` is only expected when the target object ACTUALLY has it. Many standard
 * objects (CampaignMember, OpportunityContactRole, PricebookEntry, RecordType, User,
 * OpportunityLineItem, …) have no OwnerId at all, and blindly expecting it produced
 * a wall of false-positive "missing fields: OwnerId" warnings on a real org — every
 * readiness WARN in the Caritas analysis was this bug. Callers pass the target's real
 * field names (already captured at Analyze) via `targetFieldNames`; when omitted we
 * fall back to the old behaviour so existing callers/tests keep working.
 */
export function targetFieldsForObject(
  targetObject: string,
  mappings: Record<string, MappingDefinition> = DEFAULT_MAPPINGS,
  targetFieldNames?: ReadonlySet<string>,
): string[] {
  const fields = new Set<string>();
  // OwnerId is injected as a transform override, but only where the object has it.
  if (!targetFieldNames || targetFieldNames.has("OwnerId")) fields.add("OwnerId");
  // Contact -> Person Account needs a record type; same existence guard.
  if (targetObject === "Account" && (!targetFieldNames || targetFieldNames.has("RecordTypeId"))) {
    fields.add("RecordTypeId");
  }

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
  "GiftDesignation", // funds; referenced by GiftTransactionDesignation
  "Account", // Person/Business Accounts (donors) — referenced by nearly everything
  "Campaign",
  "GiftCommitment", // references donor Account + Campaign
  "GiftTransaction", // references donor Account, Campaign, GiftCommitment
  "GiftTransactionDesignation", // references GiftTransaction + GiftDesignation
  "GiftSoftCredit", // references GiftTransaction + recipient Account
  "AccountContactRelation", // person <-> org; both sides are Accounts
  "ContactContactRelation", // person <-> person
  "Task",
  "Event",
];

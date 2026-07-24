/**
 * The NPSP source objects the Extract stage pulls in v1. The Extract planner
 * intersects this list with the objects actually present in the source org, so
 * absent objects (e.g. PMM, unused Products) are simply skipped.
 * See docs/05-data-model-mapping.md.
 *
 * Not every extracted object has a DEFAULT_MAPPINGS entry (a target-side mapping).
 * Some are extracted for completeness/audit only — either because they're used to
 * *resolve* other records (User, RecordType) rather than being migrated themselves,
 * or because a confident 1:1 NPC target can't be determined without live-schema
 * verification (Engagement Plans, Products/Pricebooks, Deliverables). See the
 * per-group comments below.
 *
 * Deliberately excluded: NPSP's Data Import / Data Import Batch objects
 * (npsp__DataImport__c / npsp__DataImportBatch__c) — these are transient staging
 * scaffolding NPSP itself uses to *load* data in, not part of the org's living
 * donor/constituent data, so migrating them serves no purpose here.
 */
export const DEFAULT_SOURCE_OBJECTS: readonly string[] = [
  // Directory data — not migrated as records themselves, but needed to correctly
  // remap OwnerId (User) and RecordTypeId (RecordType) on migrated records.
  "User",
  "RecordType",
  // Core fundraising
  "Account",
  "Contact",
  "Lead",
  "Opportunity",
  "OpportunityContactRole",
  "npe01__OppPayment__c",
  "npe03__Recurring_Donation__c",
  "npsp__General_Accounting_Unit__c",
  "npsp__Allocation__c",
  "npsp__Partial_Soft_Credit__c",
  "npsp__Address__c",
  "npsp__Level__c",
  "npsp__Deliverable__c",
  // Relationships & affiliations
  "npe4__Relationship__c",
  "npe5__Affiliation__c",
  "AccountContactRelation",
  "ContactPointEmail",
  "ContactPointPhone",
  // Campaigns & engagement
  "Campaign",
  "CampaignMember",
  "Task",
  "Event",
  "Case",
  // Extracted for completeness/audit; not auto-mapped in v1 (see docs/05 §3.5 —
  // NPC has no single confirmed 1:1 target for the stewardship-plan construct).
  "npsp__Engagement_Plan__c",
  "npsp__Engagement_Plan_Task__c",
  // Products/pricing — only relevant to orgs that sell products on Opportunities
  // (uncommon for pure donation orgs). Extracted for completeness; not auto-mapped
  // in v1 pending live NPC schema verification of an equivalent construct.
  "Pricebook2",
  "Product2",
  "PricebookEntry",
  "OpportunityLineItem",
];

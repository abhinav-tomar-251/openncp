/**
 * The NPSP source objects the Extract stage pulls in v1. The Extract planner
 * intersects this list with the objects actually present in the source org, so
 * absent objects (e.g. PMM) are simply skipped. See docs/05-data-model-mapping.md.
 */
export const DEFAULT_SOURCE_OBJECTS: readonly string[] = [
  // Core fundraising
  "Account",
  "Contact",
  "Opportunity",
  "OpportunityContactRole",
  "npe01__OppPayment__c",
  "npe03__Recurring_Donation__c",
  "npsp__General_Accounting_Unit__c",
  "npsp__Allocation__c",
  "npsp__Partial_Soft_Credit__c",
  "npsp__Address__c",
  "npsp__Level__c",
  // Relationships & affiliations
  "npe4__Relationship__c",
  "npe5__Affiliation__c",
  // Campaigns
  "Campaign",
  "CampaignMember",
];

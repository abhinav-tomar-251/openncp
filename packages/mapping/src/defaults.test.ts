import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAPPINGS, TARGET_LOAD_ORDER, targetFieldsForObject, targetObjectsFromMappings } from "./defaults.js";
import type { MappingDefinition } from "./index.js";

const mappings: Record<string, MappingDefinition> = {
  Contact: {
    source: "Contact",
    target: "Account",
    fieldMap: { FirstName: "FirstName", LastName: "LastName" },
  },
  Opportunity: {
    source: "Opportunity",
    target: "GiftTransaction",
    fieldMap: { Amount: "OriginalAmount" },
    lookups: { CampaignId: { relationship: "Campaign", targetObject: "Campaign" } },
    constants: { RecordTypeId: "012XYZ" },
  },
};

test("targetFieldsForObject unions fieldMap, lookup-derived, and constant fields", () => {
  const fields = targetFieldsForObject("GiftTransaction", mappings);
  assert.ok(fields.includes("OriginalAmount"));
  assert.ok(fields.includes("CampaignId")); // relationship "Campaign" -> "CampaignId"
  assert.ok(fields.includes("RecordTypeId")); // from constants
  assert.ok(fields.includes("OwnerId")); // always included (injected as an override)
});

test("targetFieldsForObject always includes RecordTypeId for Account (Person Account override)", () => {
  const fields = targetFieldsForObject("Account", mappings);
  assert.ok(fields.includes("RecordTypeId"));
  assert.ok(fields.includes("FirstName"));
});

test("targetFieldsForObject returns just the base overrides for an unmapped target", () => {
  const fields = targetFieldsForObject("SomethingElse", mappings);
  assert.deepEqual(fields, ["OwnerId"]);
});

test("targetObjectsFromMappings still dedupes as before", () => {
  const objects = targetObjectsFromMappings(mappings);
  assert.deepEqual([...objects].sort(), ["Account", "GiftTransaction"]);
});

// =====================================================================
// Correctness locks from analyzing a REAL NPSP org against a REAL NPC org.
// Every target object name below was verified to exist in the NPC inventory.
// =====================================================================

/** Objects confirmed ABSENT from a real NPC org — mapping to them silently breaks. */
const NON_EXISTENT_NPC_OBJECTS = ["Designation", "GivingTier", "PartyRelationshipGroupMember"];

test("no curated mapping targets an object that doesn't exist in NPC", () => {
  for (const [source, def] of Object.entries(DEFAULT_MAPPINGS)) {
    assert.ok(
      !NON_EXISTENT_NPC_OBJECTS.includes(def.target),
      `${source} targets "${def.target}", which does not exist in a real NPC org`,
    );
  }
});

test("GAU maps to GiftDesignation (not the non-existent Designation)", () => {
  assert.equal(DEFAULT_MAPPINGS.npsp__General_Accounting_Unit__c?.target, "GiftDesignation");
});

test("Opportunity carries a donor lookup so migrated gifts are not orphaned", () => {
  const donor = DEFAULT_MAPPINGS.Opportunity!.lookups?.npsp__Primary_Contact__c;
  assert.ok(donor, "Opportunity must map the NPSP primary contact to the gift's donor");
  assert.equal(donor!.relationship, "Donor");
  assert.equal(donor!.targetObject, "Account"); // the Person Account made from that Contact
});

test("Opportunity donor uses the primary CONTACT, not the household AccountId", () => {
  // In NPSP's Household model AccountId is the Household Account, which is not a
  // constituent in NPC's Person Account model — mapping it would mis-attribute gifts.
  assert.ok(!("AccountId" in (DEFAULT_MAPPINGS.Opportunity!.lookups ?? {})));
});

test("StageName value map only emits legal GiftTransaction.Status values", () => {
  const legal = new Set(["Canceled", "Failed", "Fully Refunded", "Paid", "Pending", "Unpaid", "Written-Off"]);
  for (const v of Object.values(DEFAULT_MAPPINGS.Opportunity!.valueMap!.StageName!)) {
    assert.ok(legal.has(v), `"${v}" is not a legal GiftTransaction.Status value`);
  }
});

test("RD status value map only emits legal GiftCommitment.Status values", () => {
  const legal = new Set(["Draft", "Active", "Paused", "Failing", "Lapsed", "Closed"]);
  const vm = DEFAULT_MAPPINGS.npe03__Recurring_Donation__c!.valueMap!.npe03__Open_Ended_Status__c!;
  for (const v of Object.values(vm)) {
    assert.ok(legal.has(v), `"${v}" is not a legal GiftCommitment.Status value`);
  }
});

test("soft-credit role map only emits legal GiftSoftCredit.Role values", () => {
  const legal = new Set([
    "Honoree", "Household Member", "Influencer", "Matched Donor",
    "Other", "Soft Credit", "Solicitor", "Third Party Donor",
  ]);
  const vm = DEFAULT_MAPPINGS.npsp__Partial_Soft_Credit__c!.valueMap!.npsp__Role_Name__c!;
  for (const v of Object.values(vm)) {
    assert.ok(legal.has(v), `"${v}" is not a legal GiftSoftCredit.Role value`);
  }
});

test("the NPSP transactional graph all has curated mappings", () => {
  for (const source of [
    "Contact",
    "Opportunity",
    "npsp__General_Accounting_Unit__c",
    "npsp__Allocation__c",
    "npsp__Partial_Soft_Credit__c",
    "npe03__Recurring_Donation__c",
    "npe5__Affiliation__c",
    "npe4__Relationship__c",
  ]) {
    assert.ok(DEFAULT_MAPPINGS[source], `missing curated mapping for ${source}`);
  }
});

test("every curated mapping's target appears in TARGET_LOAD_ORDER", () => {
  // Unlisted targets collapse to the same sort index and load in arbitrary order,
  // which breaks external-id relationship resolution for their children.
  for (const target of targetObjectsFromMappings()) {
    assert.ok(TARGET_LOAD_ORDER.includes(target), `${target} is missing from TARGET_LOAD_ORDER`);
  }
});

test("load order puts parents before children", () => {
  const idx = (o: string) => TARGET_LOAD_ORDER.indexOf(o);
  assert.ok(idx("GiftDesignation") < idx("GiftTransactionDesignation"));
  assert.ok(idx("Account") < idx("GiftTransaction"));
  assert.ok(idx("GiftCommitment") < idx("GiftTransaction"), "commitments before the gifts referencing them");
  assert.ok(idx("GiftTransaction") < idx("GiftTransactionDesignation"));
  assert.ok(idx("GiftTransaction") < idx("GiftSoftCredit"));
});

// --- targetFieldsForObject: the OwnerId false-positive fix ---

test("targetFieldsForObject omits OwnerId when the target object doesn't have it", () => {
  // Real defect: every readiness WARN in the Caritas analysis was a bogus
  // "missing fields: OwnerId" on an object with no OwnerId at all.
  const fields = targetFieldsForObject("GiftTransaction", mappings, new Set(["OriginalAmount", "CampaignId"]));
  assert.ok(!fields.includes("OwnerId"));
});

test("targetFieldsForObject keeps OwnerId when the object really has it", () => {
  const fields = targetFieldsForObject("GiftTransaction", mappings, new Set(["OriginalAmount", "OwnerId"]));
  assert.ok(fields.includes("OwnerId"));
});

test("targetFieldsForObject omits RecordTypeId on Account when absent", () => {
  const fields = targetFieldsForObject("Account", mappings, new Set(["FirstName", "LastName"]));
  assert.ok(!fields.includes("RecordTypeId"));
  assert.ok(!fields.includes("OwnerId"));
});

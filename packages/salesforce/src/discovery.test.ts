import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findSimilarObjectNames,
  summarizeFields,
  checkTargetSchema,
  isMappableRequiredField,
  isMeaningfulPolymorphicLookup,
  isNpspNamespacedObject,
  type FieldMeta,
} from "./discovery.js";

/** Minimal FieldMeta factory — only `name` matters to checkTargetSchema. */
function fm(name: string, over: Partial<FieldMeta> = {}): FieldMeta {
  return {
    name,
    label: name,
    type: "string",
    custom: false,
    required: false,
    createable: true,
    autoNumber: false,
    unique: false,
    externalId: false,
    calculated: false,
    ...over,
  };
}

const candidates = [
  { name: "GiftDesignation", label: "Gift Designation" },
  { name: "npsp__Designation__c", label: "Designation" },
  { name: "Account", label: "Account" },
  { name: "Campaign", label: "Campaign" },
];

test("matches by case-insensitive substring on name or label", () => {
  const matches = findSimilarObjectNames("Designation", candidates);
  assert.deepEqual(matches.sort(), ["GiftDesignation", "npsp__Designation__c"]);
});

test("returns empty when nothing looks related", () => {
  assert.deepEqual(findSimilarObjectNames("Deliverable", candidates), []);
});

test("caps results at the given limit", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `Designation${i}`, label: `D${i}` }));
  assert.equal(findSimilarObjectNames("Designation", many, 3).length, 3);
});

test("excludes Salesforce's auto-generated Feed/History/Share companion objects", () => {
  const withCompanions = [
    { name: "GiftDesignation", label: "Gift Designation" },
    { name: "GiftDesignationFeed", label: "Gift Designation Feed" },
    { name: "GiftDesignationHistory", label: "Gift Designation History" },
    { name: "GiftDesignationShare", label: "Gift Designation Share" },
  ];
  assert.deepEqual(findSimilarObjectNames("Designation", withCompanions), ["GiftDesignation"]);
});

test("also matches when the candidate name is a short prefix of the target", () => {
  // e.g. searching for "GAU_Allocation" should still surface a plain "Allocation" object
  const matches = findSimilarObjectNames("GAU_Allocation", [{ name: "Allocation", label: "Allocation" }]);
  assert.deepEqual(matches, ["Allocation"]);
});

test("summarizeFields drops housekeeping fields and puts custom fields first", () => {
  const fields = [
    { name: "Id", custom: false },
    { name: "Name", custom: false },
    { name: "OwnerId", custom: false },
    { name: "CreatedDate", custom: false },
    { name: "General_Ledger_Code__c", custom: true },
    { name: "Active__c", custom: true },
  ];
  assert.deepEqual(summarizeFields(fields), ["Active__c", "General_Ledger_Code__c", "Name"]);
});

test("summarizeFields sorts within each group", () => {
  const fields = [
    { name: "Zebra__c", custom: true },
    { name: "Apple__c", custom: true },
    { name: "Zulu", custom: false },
    { name: "Alpha", custom: false },
  ];
  assert.deepEqual(summarizeFields(fields), ["Apple__c", "Zebra__c", "Alpha", "Zulu"]);
});

// --- checkTargetSchema: pure, in-memory equivalent of discoverTargetSchema ---

const inventory = [
  { name: "Account", label: "Account", fields: [fm("Name"), fm("BillingCity")] },
  { name: "GiftTransaction", label: "Gift Transaction", fields: [fm("OriginalAmount"), fm("Status")] },
  { name: "GiftDesignation", label: "Gift Designation", fields: [fm("Name")] },
];

test("checkTargetSchema: PASS when the target exists with every expected field", () => {
  const [check] = checkTargetSchema(inventory, ["Account"], () => ["Name"]);
  assert.deepEqual(check, { name: "Account", exists: true, missingFields: [], suggestions: [], suggestionDetails: [] });
});

test("checkTargetSchema: WARN-shape (exists but missing expected fields)", () => {
  const [check] = checkTargetSchema(inventory, ["GiftTransaction"], () => ["OriginalAmount", "CampaignId"]);
  assert.equal(check!.exists, true);
  assert.deepEqual(check!.missingFields, ["CampaignId"]);
});

test("checkTargetSchema: MISSING when the target isn't in the inventory, with name-matched suggestions", () => {
  const [check] = checkTargetSchema(inventory, ["Designation"], () => []);
  assert.equal(check!.exists, false);
  assert.deepEqual(check!.suggestions, ["GiftDesignation"]);
  assert.deepEqual(check!.suggestionDetails, [{ name: "GiftDesignation", fields: ["Name"] }]);
});

test("checkTargetSchema: never calls fieldsForObject for a missing target (no expected-field diff possible)", () => {
  let called = false;
  checkTargetSchema(inventory, ["NoSuchObject"], () => {
    called = true;
    return [];
  });
  assert.equal(called, false);
});

test("checkTargetSchema: is pure — same inventory, independent results per target object", () => {
  const checks = checkTargetSchema(inventory, ["Account", "NoSuchObject", "GiftTransaction"], (obj) =>
    obj === "Account" ? ["Name", "BillingCity"] : ["OriginalAmount"],
  );
  assert.deepEqual(
    checks.map((c) => [c.name, c.exists]),
    [
      ["Account", true],
      ["NoSuchObject", false],
      ["GiftTransaction", true],
    ],
  );
});

// --- Required-field / polymorphic / namespace predicates (real-org defect fixes) ---

test("isMappableRequiredField: a plain required writable field is mappable", () => {
  assert.equal(isMappableRequiredField(fm("LastName", { required: true })), true);
});

test("isMappableRequiredField: read-only rollups are NOT mappable (Campaign.NumberOfContacts)", () => {
  // Salesforce reports these as non-nillable, but createable=false — asking the
  // operator to map them guarantees a Load failure. Real defect from the Caritas org.
  for (const name of ["NumberOfContacts", "AmountWonOpportunities", "NumberOfLeads"]) {
    assert.equal(
      isMappableRequiredField(fm(name, { required: true, createable: false })),
      false,
      `${name} must not be reported as a required field to map`,
    );
  }
});

test("isMappableRequiredField: auto-number and formula fields are NOT mappable", () => {
  assert.equal(isMappableRequiredField(fm("Name", { required: true, autoNumber: true })), false);
  assert.equal(isMappableRequiredField(fm("Total__c", { required: true, calculated: true })), false);
});

test("isMeaningfulPolymorphicLookup: OwnerId / SetupOwnerId are excluded", () => {
  assert.equal(isMeaningfulPolymorphicLookup({ name: "OwnerId", referenceTo: ["User", "Group"] }), false);
  assert.equal(isMeaningfulPolymorphicLookup({ name: "SetupOwnerId", referenceTo: ["Organization", "Profile", "User"] }), false);
});

test("isMeaningfulPolymorphicLookup: any User|Group pair is ownership, not a relationship", () => {
  assert.equal(isMeaningfulPolymorphicLookup({ name: "DelegatedApproverId", referenceTo: ["User", "Group"] }), false);
});

test("isMeaningfulPolymorphicLookup: real donor/campaign polymorphs are kept", () => {
  assert.equal(isMeaningfulPolymorphicLookup({ name: "WhoId", referenceTo: ["Contact", "Lead"] }), true);
  assert.equal(isMeaningfulPolymorphicLookup({ name: "WhatId", referenceTo: ["Account", "Opportunity", "Campaign"] }), true);
});

test("isMeaningfulPolymorphicLookup: a single-target lookup is not polymorphic at all", () => {
  assert.equal(isMeaningfulPolymorphicLookup({ name: "AccountId", referenceTo: ["Account"] }), false);
  assert.equal(isMeaningfulPolymorphicLookup({ name: "Plain__c" }), false);
});

test("isNpspNamespacedObject: recognizes every NPSP namespace", () => {
  for (const n of [
    "npsp__Allocation__c",
    "npe01__OppPayment__c",
    "npe03__Recurring_Donation__c",
    "npe4__Relationship__c",
    "npe5__Affiliation__c",
    "npo02__Household__c",
    "pmdm__Program__c",
  ]) {
    assert.equal(isNpspNamespacedObject(n), true, n);
  }
});

test("isNpspNamespacedObject: ignores standard and third-party objects", () => {
  for (const n of ["Account", "Opportunity", "ChargentOrders__Transaction__c", "dlrs__LookupRollupSummary__c"]) {
    assert.equal(isNpspNamespacedObject(n), false, n);
  }
});

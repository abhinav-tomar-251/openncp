import { test } from "node:test";
import assert from "node:assert/strict";
import { findSimilarObjectNames, summarizeFields } from "./discovery.js";

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

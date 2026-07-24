import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectSoql, buildAggregateSoql } from "./schema.js";

test("buildSelectSoql always includes Id and de-duplicates", () => {
  assert.equal(
    buildSelectSoql("Contact", ["FirstName", "LastName"]),
    "SELECT Id, FirstName, LastName FROM Contact",
  );
  // Id passed explicitly is not duplicated
  assert.equal(buildSelectSoql("Account", ["Id", "Name"]), "SELECT Id, Name FROM Account");
});

test("buildSelectSoql defaults to Id when no fields given", () => {
  assert.equal(buildSelectSoql("Opportunity", []), "SELECT Id FROM Opportunity");
});

test("buildSelectSoql appends a WHERE clause", () => {
  assert.equal(
    buildSelectSoql("Opportunity", ["Amount"], "IsWon = true"),
    "SELECT Id, Amount FROM Opportunity WHERE IsWon = true",
  );
});

test("buildAggregateSoql counts only, scoped to migrated records", () => {
  assert.equal(
    buildAggregateSoql("Designation", "Legacy_NPSP_Id__c"),
    "SELECT COUNT(Id) cnt FROM Designation WHERE Legacy_NPSP_Id__c != null",
  );
});

test("buildAggregateSoql adds a SUM when an amount field is given", () => {
  assert.equal(
    buildAggregateSoql("GiftTransaction", "Legacy_NPSP_Id__c", "OriginalAmount"),
    "SELECT COUNT(Id) cnt, SUM(OriginalAmount) amt FROM GiftTransaction WHERE Legacy_NPSP_Id__c != null",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMapping } from "./engine.js";
import type { MappingDefinition } from "./index.js";

const oppDef: MappingDefinition = {
  source: "Opportunity",
  target: "GiftTransaction",
  fieldMap: { Amount: "OriginalAmount", CloseDate: "TransactionDate", StageName: "Status" },
  valueMap: { StageName: { "Closed Won": "Paid" } },
  lookups: { CampaignId: { relationship: "Campaign", targetObject: "Campaign" } },
};

test("maps fields, translates picklists, and sets the external id", () => {
  const res = applyMapping(
    { Id: "006A", Amount: "100", CloseDate: "2024-01-01", StageName: "Closed Won" },
    oppDef,
  );
  assert.ok(res);
  assert.equal(res.targetObject, "GiftTransaction");
  assert.equal(res.sourceId, "006A");
  assert.equal(res.record.OriginalAmount, "100");
  assert.equal(res.record.TransactionDate, "2024-01-01");
  assert.equal(res.record.Status, "Paid"); // value-mapped
  assert.equal(res.record.Legacy_NPSP_Id__c, "006A");
});

test("emits lookups as relationship-by-external-id", () => {
  const res = applyMapping({ Id: "006A", CampaignId: "701X" }, oppDef);
  assert.equal(res?.record["Campaign.Legacy_NPSP_Id__c"], "701X");
});

test("skips empty/null lookup and field values", () => {
  const res = applyMapping({ Id: "006A", CampaignId: "", Amount: null }, oppDef);
  assert.ok(res);
  assert.equal("Campaign.Legacy_NPSP_Id__c" in res.record, false);
  assert.equal("OriginalAmount" in res.record, false);
});

test("constants apply and filter can exclude a record", () => {
  const def: MappingDefinition = {
    source: "Account",
    target: "Account",
    filter: (raw) => raw.Type === "Organization",
    fieldMap: { Name: "Name" },
    constants: { RecordTypeName: "Business" },
  };
  assert.equal(applyMapping({ Id: "001", Name: "Acme", Type: "Household" }, def), null);
  const res = applyMapping({ Id: "001", Name: "Acme", Type: "Organization" }, def);
  assert.equal(res?.record.Name, "Acme");
  assert.equal(res?.record.RecordTypeName, "Business");
});

test("overrides win over fieldMap/constants and are skipped when null/undefined", () => {
  const def: MappingDefinition = {
    source: "Contact",
    target: "Account",
    fieldMap: { FirstName: "FirstName" },
    constants: { RecordTypeId: "012_DEFAULT" },
  };
  const withOverride = applyMapping(
    { Id: "003A", FirstName: "Jane" },
    def,
    { RecordTypeId: "012_PERSON_ACCOUNT", OwnerId: "005TARGET" },
  );
  assert.equal(withOverride?.record.RecordTypeId, "012_PERSON_ACCOUNT");
  assert.equal(withOverride?.record.OwnerId, "005TARGET");

  const withoutMatch = applyMapping({ Id: "003A", FirstName: "Jane" }, def, { OwnerId: undefined });
  assert.equal(withoutMatch?.record.RecordTypeId, "012_DEFAULT"); // falls back to constants
  assert.equal("OwnerId" in (withoutMatch?.record ?? {}), false); // undefined override is skipped
});

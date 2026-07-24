import { test } from "node:test";
import assert from "node:assert/strict";
import { targetFieldsForObject, targetObjectsFromMappings } from "./defaults.js";
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

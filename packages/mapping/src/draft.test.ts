import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTokens,
  tokenOverlap,
  draftFieldMap,
  scoreObjectMatch,
  draftMapping,
  type DraftObject,
  type DraftFieldMeta,
} from "./draft.js";
import type { MappingDefinition } from "./index.js";

const f = (name: string, type = "string", label = name): DraftFieldMeta => ({ name, label, type });

test("normalizeTokens strips namespace prefixes + __c and splits camelCase", () => {
  assert.deepEqual(normalizeTokens("npsp__General_Accounting_Unit__c"), [
    "general",
    "accounting",
    "unit",
  ]);
  assert.deepEqual(normalizeTokens("GiftTransaction"), ["gift", "transaction"]);
  assert.deepEqual(normalizeTokens("npe03__Recurring_Donation__c"), ["recurring", "donation"]);
});

test("tokenOverlap: identical=1, disjoint=0, partial in between", () => {
  assert.equal(tokenOverlap("Campaign", "Campaign"), 1);
  assert.equal(tokenOverlap("Account", "Widget"), 0);
  const partial = tokenOverlap("Gift Designation", "GiftDefaultDesignation");
  assert.ok(partial > 0 && partial < 1);
});

test("draftFieldMap: exact > case-insensitive > label, gated by type family", () => {
  const source = [f("FirstName"), f("email", "email"), f("Amount", "currency")];
  const target = [f("FirstName"), f("Email", "email"), f("Amount", "currency")];
  const map = draftFieldMap(source, target);
  assert.equal(map.FirstName, "FirstName"); // exact
  assert.equal(map.email, "Email"); // case-insensitive
  assert.equal(map.Amount, "Amount"); // exact, numeric family
});

test("draftFieldMap does NOT map across incompatible type families", () => {
  const source = [f("CloseDate", "date")];
  const target = [f("CloseDate", "string")]; // same name, wrong family
  assert.deepEqual(draftFieldMap(source, target), {});
});

test("draftFieldMap skips system + reference fields on both sides", () => {
  const source = [f("Id", "id"), f("OwnerId", "reference"), f("AccountId", "reference"), f("Name")];
  const target = [f("Id", "id"), f("OwnerId", "reference"), f("AccountId", "reference"), f("Name")];
  assert.deepEqual(draftFieldMap(source, target), { Name: "Name" });
});

test("scoreObjectMatch is high for same-named objects with overlapping fields", () => {
  const src: DraftObject = { name: "Campaign", label: "Campaign", fields: [f("Name"), f("Status")] };
  const tgt: DraftObject = { name: "Campaign", label: "Campaign", fields: [f("Name"), f("Status")] };
  assert.ok(scoreObjectMatch(src, tgt) > 0.8);
});

const curated: Record<string, MappingDefinition> = {
  Contact: { source: "Contact", target: "Account", fieldMap: { FirstName: "FirstName" } },
};

test("draftMapping: curated template wins when its target exists in the org", () => {
  const src: DraftObject = { name: "Contact", label: "Contact", fields: [f("FirstName")] };
  const inventory: DraftObject[] = [{ name: "Account", label: "Account", fields: [f("FirstName")] }];
  const d = draftMapping(src, inventory, curated);
  assert.equal(d.target, "Account");
  assert.equal(d.confidence, "curated");
  assert.equal(d.enabledByDefault, true);
});

test("draftMapping: curated target absent in org falls back (does not force a missing object)", () => {
  const src: DraftObject = { name: "Contact", label: "Contact", fields: [f("FirstName")] };
  const inventory: DraftObject[] = [{ name: "Widget", label: "Widget", fields: [f("Sprocket")] }];
  const d = draftMapping(src, inventory, curated);
  assert.notEqual(d.confidence, "curated");
  assert.equal(d.enabledByDefault, false); // never auto-enable a non-curated draft
});

test("draftMapping: heuristic picks the best-scoring target and drafts a field map", () => {
  const src: DraftObject = {
    name: "Widget__c",
    label: "Widget",
    fields: [f("Name"), f("Color__c")],
  };
  const inventory: DraftObject[] = [
    { name: "Unrelated", label: "Unrelated", fields: [f("Foo")] },
    { name: "Widget", label: "Widget", fields: [f("Name"), f("Color__c")] },
  ];
  const d = draftMapping(src, inventory, {});
  assert.equal(d.target, "Widget");
  assert.equal(d.confidence, "heuristic");
  assert.equal(d.enabledByDefault, false);
  assert.equal(d.fieldMap.Name, "Name");
});

test("draftMapping: nothing above threshold -> unmapped/null", () => {
  const src: DraftObject = { name: "Zzz__c", label: "Zzz", fields: [f("Qqq__c")] };
  const inventory: DraftObject[] = [{ name: "Account", label: "Account", fields: [f("Name")] }];
  const d = draftMapping(src, inventory, {});
  assert.equal(d.target, null);
  assert.equal(d.confidence, "unmapped");
  assert.equal(d.enabledByDefault, false);
});

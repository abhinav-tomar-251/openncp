import { test } from "node:test";
import assert from "node:assert/strict";
import { apexTriggerEvents, stripAttributes, normalizeTdtmObjectName, summarizeNpspConfig } from "./orgAudit.js";

test("apexTriggerEvents derives the human event list from Usage* flags", () => {
  const rec = {
    UsageBeforeInsert: true,
    UsageAfterInsert: true,
    UsageBeforeUpdate: false,
    UsageAfterUpdate: true,
    UsageBeforeDelete: false,
    UsageAfterDelete: false,
    UsageAfterUndelete: false,
  };
  assert.deepEqual(apexTriggerEvents(rec), ["before insert", "after insert", "after update"]);
});

test("apexTriggerEvents returns empty when no usage flags are set", () => {
  assert.deepEqual(apexTriggerEvents({ Name: "T", UsageBeforeInsert: false }), []);
});

test("apexTriggerEvents treats missing/non-true flags as off", () => {
  // A flag that is undefined or a non-boolean must not count as enabled.
  assert.deepEqual(apexTriggerEvents({ UsageAfterUndelete: "true" as unknown }), []);
});

test("stripAttributes removes the jsforce envelope but keeps data fields", () => {
  const rec = { attributes: { type: "npe03__Recurring_Donations_Settings__c" }, npe03__Open_Opportunity_Behavior__c: "Mark_Closed_Lost" };
  assert.deepEqual(stripAttributes(rec), { npe03__Open_Opportunity_Behavior__c: "Mark_Closed_Lost" });
});

// --- NPSP config summarization + TDTM namespace normalization ---

test("normalizeTdtmObjectName re-qualifies NPSP package objects", () => {
  // NPSP's Trigger_Handler rows drop the npsp__ prefix for its OWN objects, which
  // silently broke joins against the object inventory in a real org's report.
  assert.equal(normalizeTdtmObjectName("Allocation__c"), "npsp__Allocation__c");
  assert.equal(normalizeTdtmObjectName("Partial_Soft_Credit__c"), "npsp__Partial_Soft_Credit__c");
  assert.equal(normalizeTdtmObjectName("General_Accounting_Unit__c"), "npsp__General_Accounting_Unit__c");
});

test("normalizeTdtmObjectName leaves already-qualified and standard objects alone", () => {
  for (const n of ["npe03__Recurring_Donation__c", "npe01__OppPayment__c", "Account", "Contact", "Opportunity"]) {
    assert.equal(normalizeTdtmObjectName(n), n);
  }
});

test("summarizeNpspConfig extracts the decisive account model", () => {
  const cfg = summarizeNpspConfig({
    npe01__Contacts_And_Orgs_Settings__c: [
      { npe01__Account_Processor__c: "Household Account", npe01__Payments_Enabled__c: true },
    ],
  });
  assert.equal(cfg.accountModel, "Household Account");
  assert.equal(cfg.paymentsEnabled, true);
});

test("summarizeNpspConfig detects Enhanced RD from live RD2 handlers", () => {
  const withRd2 = summarizeNpspConfig({}, [
    { className: "RD2_RecurringDonations_TDTM", object: "npe03__Recurring_Donation__c", trigger: "BeforeInsert", active: true, loadOrder: 1 },
  ]);
  assert.equal(withRd2.enhancedRecurringDonations, true);

  const legacyOnly = summarizeNpspConfig({}, [
    { className: "RD_RecurringDonations_TDTM", object: "npe03__Recurring_Donation__c", trigger: "BeforeInsert", active: true, loadOrder: 1 },
  ]);
  assert.equal(legacyOnly.enhancedRecurringDonations, false);
});

test("summarizeNpspConfig ignores INACTIVE RD2 handlers", () => {
  const cfg = summarizeNpspConfig({}, [
    { className: "RD2_RecurringDonations_TDTM", object: "npe03__Recurring_Donation__c", trigger: "BeforeInsert", active: false, loadOrder: 1 },
  ]);
  assert.equal(cfg.enhancedRecurringDonations, false);
});

test("summarizeNpspConfig degrades to nulls when nothing was captured", () => {
  const cfg = summarizeNpspConfig({});
  assert.deepEqual(cfg, {
    accountModel: null,
    enhancedRecurringDonations: false,
    paymentsEnabled: null,
    defaultGau: null,
    householdRules: null,
  });
});

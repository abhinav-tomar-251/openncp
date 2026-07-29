import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalysisReport,
  renderAnalysisMarkdown,
  type StageRunLike,
  type MappingRowLike,
  type ConnectionLike,
} from "./analysisReport.js";

/** Minimal FieldMeta factory (only the props the report reads matter).
 * `createable: true` is the default because that's what a normal writable
 * Salesforce field looks like; read-only rollups override it to false. */
function fm(name: string, over: Record<string, unknown> = {}) {
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

function fixtureStageRun(): StageRunLike {
  return {
    finishedAt: new Date("2026-07-27T00:00:00Z"),
    audit: { source: { validationRules: [], flows: [], apexTriggers: [], tdtmHandlers: [], workflowRules: [], duplicateRules: [], npspSettings: {}, captured: ["flows"], skipped: [{ kind: "workflowRules", reason: "not exposed" }] } },
    objectRuns: [
      // Source inventory
      { objectApiName: "Account", role: "source", processedCount: 100, checkpoint: { label: "Account", custom: false, fields: [fm("Name", { required: true })], recordTypes: [], childRelationships: [] } },
      { objectApiName: "npe03__Recurring_Donation__c", role: "source", processedCount: 5, checkpoint: { label: "Recurring Donation", custom: true, fields: [fm("Name")], recordTypes: [] } },
      { objectApiName: "Designation__c", role: "source", processedCount: 3, checkpoint: { label: "Designation", custom: true, fields: [fm("Name")] } },
      // Target inventory (for required-field checks)
      { objectApiName: "target:Account", role: "target", processedCount: 0, checkpoint: { label: "Account", fields: [fm("Name", { required: true }), fm("Legacy_NPSP_Id__c", { required: false })] } },
      // Target readiness (schema checks) — mappedBy mirrors what the worker persists.
      {
        objectApiName: "Account",
        role: "target",
        processedCount: 0,
        checkpoint: { exists: true, missingFields: [], suggestions: [], outcome: "PASS", mappedBy: [{ source: "Account", enabled: true, confidence: "curated" }] },
      },
      {
        objectApiName: "Designation",
        role: "target",
        processedCount: 0,
        checkpoint: { exists: false, missingFields: [], suggestions: ["GiftDesignation"], outcome: "MISSING", mappedBy: [{ source: "Designation__c", enabled: true, confidence: "heuristic" }] },
      },
    ],
  };
}

const mappings: MappingRowLike[] = [
  { object: "Account", target: "Account", fieldMap: {}, enabled: true, confidence: "curated" }, // required Name unmapped
  { object: "Designation__c", target: "Designation", fieldMap: { Name: "Name" }, enabled: true, confidence: "heuristic" }, // target missing
  // npe03__Recurring_Donation__c intentionally has NO mapping row -> unmapped-with-data
];

const connections: ConnectionLike[] = [
  { role: "source", orgId: "00Dxx", instanceUrl: "https://src.my.salesforce.com", apiVersion: "62.0", tokenMeta: { capability: { orgId: "00Dxx", npspInstalled: true, enhancedRecurringDonations: false, personAccountsEnabled: true } } },
];

test("buildAnalysisReport summarizes the source inventory", () => {
  const r = buildAnalysisReport("Demo", fixtureStageRun(), mappings, connections);
  assert.equal(r.source.objectCount, 3);
  assert.equal(r.source.objectsWithData, 3);
  assert.equal(r.source.totalRecords, 108);
  assert.equal(r.mappings.drafted, 2);
  assert.equal(r.mappings.enabled, 2);
  assert.equal(r.meta.capability?.npspInstalled, true);
});

test("buildAnalysisReport derives the key warnings", () => {
  const r = buildAnalysisReport("Demo", fixtureStageRun(), mappings, connections);
  const kinds = r.warnings.map((w) => w.kind);
  assert.ok(kinds.includes("unmapped-object-with-data"), "recurring donation has data but no mapping");
  assert.ok(kinds.includes("target-object-missing"), "Designation target is MISSING");
  assert.ok(kinds.includes("unmapped-required-target-field"), "Account.Name required but unmapped");
  assert.ok(kinds.includes("audit-kind-skipped"), "workflowRules audit was skipped");
  // The fixture's target inventory only has "target:Account" — no Gift*/Designation — so
  // the fundraising-not-enabled blocker should also fire.
  assert.ok(kinds.includes("fundraising-not-enabled"), "target inventory has no Gift*/Designation objects");
  // Blockers sort first.
  assert.equal(r.warnings[0]!.severity, "blocker");
  // Enriched warnings carry why/action, not just a bare message.
  const unmapped = r.warnings.find((w) => w.kind === "unmapped-object-with-data")!;
  assert.ok(unmapped.why && unmapped.why.length > 0);
  assert.ok(unmapped.action && unmapped.action.length > 0);
});

test("fundraising-not-enabled does NOT fire when Gift*/Designation objects are present in the target", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push({
    objectApiName: "target:GiftTransaction",
    role: "target",
    processedCount: 0,
    checkpoint: { label: "Gift Transaction", fields: [fm("OriginalAmount")] },
  });
  const r = buildAnalysisReport("Demo", stageRun, mappings, connections);
  assert.ok(!r.warnings.some((w) => w.kind === "fundraising-not-enabled"));
});

test("fundraising-not-enabled does NOT fire when the target isn't connected (no target inventory at all)", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns = stageRun.objectRuns.filter((o) => o.role !== "target");
  const r = buildAnalysisReport("Demo", stageRun, mappings, connections);
  assert.ok(!r.warnings.some((w) => w.kind === "fundraising-not-enabled"));
});

test("renderAnalysisMarkdown produces a document with the expected sections", () => {
  const md = renderAnalysisMarkdown(buildAnalysisReport("Demo", fixtureStageRun(), mappings, connections));
  for (const heading of [
    "# NPSP Org Analysis — Demo",
    "## Overview",
    "## Warnings",
    "## Source Object Inventory",
    "## Field Dictionary",
    "## Validation Rules & Automations",
    "## Target Readiness (NPC)",
    "## Mapping Summary",
  ]) {
    assert.ok(md.includes(heading), `missing section: ${heading}`);
  }
});

test("targetReadiness includes UNMAPPED rows and targetSummary splits issues by enabled vs unreviewed", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push(
    // In inventory, nothing maps here -> UNMAPPED.
    { objectApiName: "target:Campaign", role: "target", processedCount: 12, checkpoint: { label: "Campaign", fields: [fm("Name")] } },
    // Referenced only by a DISABLED heuristic draft -> MISSING but unreviewed (info), not a blocker.
    {
      objectApiName: "GiftCommitment",
      role: "target",
      processedCount: 0,
      checkpoint: {
        exists: false,
        missingFields: [],
        suggestions: [],
        outcome: "MISSING",
        mappedBy: [{ source: "npe03__Recurring_Donation__c", enabled: false, confidence: "heuristic" }],
      },
    },
  );
  const localMappings: MappingRowLike[] = [
    ...mappings,
    { object: "npe03__Recurring_Donation__c", target: "GiftCommitment", fieldMap: {}, enabled: false, confidence: "heuristic" },
  ];
  const r = buildAnalysisReport("Demo", stageRun, localMappings, connections);

  const campaign = r.targetReadiness.find((t) => t.object === "Campaign")!;
  assert.equal(campaign.outcome, "UNMAPPED");
  assert.equal(campaign.count, 12);
  assert.deepEqual(campaign.mappedBy, []);

  const giftCommitment = r.targetReadiness.find((t) => t.object === "GiftCommitment")!;
  assert.equal(giftCommitment.outcome, "MISSING");
  assert.deepEqual(giftCommitment.mappedBy, [{ source: "npe03__Recurring_Donation__c", enabled: false, confidence: "heuristic" }]);

  assert.equal(r.targetSummary.total, r.targetReadiness.length);
  assert.equal(r.targetSummary.unmapped, 1); // Campaign only
  assert.ok(r.targetSummary.issuesEnabled >= 1); // Designation: enabled + MISSING
  assert.ok(r.targetSummary.issuesUnreviewed >= 1); // GiftCommitment: disabled + MISSING

  // Enabled-issue rows sort before unreviewed-issue rows, which sort before UNMAPPED.
  const designationIdx = r.targetReadiness.findIndex((t) => t.object === "Designation");
  const giftCommitmentIdx = r.targetReadiness.findIndex((t) => t.object === "GiftCommitment");
  const campaignIdx = r.targetReadiness.findIndex((t) => t.object === "Campaign");
  assert.ok(designationIdx < campaignIdx, "enabled-issue row should sort before an UNMAPPED row");
  assert.ok(giftCommitmentIdx < campaignIdx, "unreviewed-issue row should sort before an UNMAPPED row");
});

test("deriveWarnings emits an info-level unreviewed-target-missing for disabled drafts, not a blocker", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push({
    objectApiName: "GiftCommitment",
    role: "target",
    processedCount: 0,
    checkpoint: {
      exists: false,
      missingFields: [],
      suggestions: [],
      outcome: "MISSING",
      mappedBy: [{ source: "npe03__Recurring_Donation__c", enabled: false, confidence: "heuristic" }],
    },
  });
  const localMappings: MappingRowLike[] = [
    ...mappings,
    { object: "npe03__Recurring_Donation__c", target: "GiftCommitment", fieldMap: {}, enabled: false, confidence: "heuristic" },
  ];
  const r = buildAnalysisReport("Demo", stageRun, localMappings, connections);
  const w = r.warnings.find((w) => w.object === "npe03__Recurring_Donation__c" && w.kind === "unreviewed-target-missing");
  assert.ok(w, "expected an info-level unreviewed-target-missing warning");
  assert.equal(w!.severity, "info");
  assert.ok(!r.warnings.some((x) => x.kind === "target-object-missing" && x.object === "npe03__Recurring_Donation__c"));
});

test("unmapped-required-target-field only fires for ENABLED mappings, not disabled drafts", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push(
    { objectApiName: "SomeObj__c", role: "source", processedCount: 1, checkpoint: { label: "Some Obj", custom: true, fields: [fm("Name")] } },
    { objectApiName: "target:Campaign", role: "target", processedCount: 0, checkpoint: { label: "Campaign", fields: [fm("StartDate", { required: true })] } },
    {
      objectApiName: "Campaign",
      role: "target",
      processedCount: 0,
      checkpoint: {
        exists: true,
        missingFields: ["StartDate"],
        suggestions: [],
        outcome: "WARN",
        mappedBy: [{ source: "SomeObj__c", enabled: false, confidence: "heuristic" }],
      },
    },
  );
  const localMappings: MappingRowLike[] = [
    ...mappings,
    { object: "SomeObj__c", target: "Campaign", fieldMap: {}, enabled: false, confidence: "heuristic" },
  ];
  const r = buildAnalysisReport("Demo", stageRun, localMappings, connections);
  assert.ok(!r.warnings.some((w) => w.kind === "unmapped-required-target-field" && w.object === "SomeObj__c"));
});

test("buildAnalysisReport returns empty inventory gracefully when no source runs", () => {
  const empty: StageRunLike = { finishedAt: null, audit: null, objectRuns: [] };
  const r = buildAnalysisReport("Empty", empty, [], []);
  assert.equal(r.source.objectCount, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.meta.capability, null);
});

// =====================================================================
// Noise-reduction + correctness fixes found by analyzing a REAL NPSP org.
// =====================================================================

test("read-only rollup fields are NOT reported as required-to-map", () => {
  // Real defect: the report told the operator to map Campaign.NumberOfContacts and
  // AmountWonOpportunities, which are createable=false — doing so fails every Load.
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push(
    { objectApiName: "Widget__c", role: "source", processedCount: 4, checkpoint: { label: "Widget", custom: true, fields: [fm("Name")] } },
    {
      objectApiName: "target:Campaign",
      role: "target",
      processedCount: 0,
      checkpoint: {
        label: "Campaign",
        fields: [
          fm("NumberOfContacts", { required: true, createable: false }),
          fm("AmountWonOpportunities", { required: true, createable: false }),
          fm("CampaignName", { required: true, autoNumber: true }),
        ],
      },
    },
  );
  const localMappings: MappingRowLike[] = [
    ...mappings,
    { object: "Widget__c", target: "Campaign", fieldMap: {}, enabled: true, confidence: "curated" },
  ];
  const r = buildAnalysisReport("Demo", stageRun, localMappings, connections);
  const w = r.warnings.find((w) => w.kind === "unmapped-required-target-field" && w.object === "Widget__c");
  assert.equal(w, undefined, "read-only rollups/autonumbers must not be demanded of the operator");
});

test("polymorphic warning ignores OwnerId / SetupOwnerId noise", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push({
    objectApiName: "Noisy__c",
    role: "source",
    processedCount: 1,
    checkpoint: {
      label: "Noisy",
      custom: true,
      fields: [
        fm("OwnerId", { type: "reference", referenceTo: ["User", "Group"] }),
        fm("SetupOwnerId", { type: "reference", referenceTo: ["Organization", "Profile", "User"] }),
      ],
    },
  });
  const r = buildAnalysisReport("Demo", stageRun, mappings, connections);
  assert.ok(!r.warnings.some((w) => w.kind === "polymorphic-lookup-present" && w.object === "Noisy__c"));
});

test("polymorphic warning still fires for real donor/campaign relationships", () => {
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push({
    objectApiName: "Task",
    role: "source",
    processedCount: 3,
    checkpoint: {
      label: "Task",
      custom: false,
      fields: [
        fm("WhoId", { type: "reference", referenceTo: ["Contact", "Lead"] }),
        fm("OwnerId", { type: "reference", referenceTo: ["User", "Group"] }),
      ],
    },
  });
  const r = buildAnalysisReport("Demo", stageRun, mappings, connections);
  const w = r.warnings.find((w) => w.kind === "polymorphic-lookup-present" && w.object === "Task");
  assert.ok(w, "WhoId is a genuine polymorphic relationship and must still be reported");
  assert.ok(w!.message.includes("WhoId"));
  assert.ok(!w!.message.includes("OwnerId"), "OwnerId must not be listed among the polymorphic fields");
});

test("Custom Settings never produce unmapped-object-with-data warnings", () => {
  // 40 of 57 such warnings on a real org were hierarchy custom settings holding a
  // single org-default row — configuration, not migratable data.
  const stageRun = fixtureStageRun();
  stageRun.objectRuns.push({
    objectApiName: "npsp__Error_Settings__c",
    role: "source",
    processedCount: 1,
    checkpoint: { label: "Error Settings", custom: true, customSetting: true, fields: [fm("Name")] },
  });
  const r = buildAnalysisReport("Demo", stageRun, mappings, connections);
  assert.ok(!r.warnings.some((w) => w.object === "npsp__Error_Settings__c"));
});

test("multi-source-same-target collision is reported", () => {
  // Real org: Contact -> Account (Person Account) and Account -> Account both existed.
  const localMappings: MappingRowLike[] = [
    ...mappings,
    { object: "Account", target: "Account", fieldMap: {}, enabled: false, confidence: "heuristic" },
  ];
  const r = buildAnalysisReport("Demo", fixtureStageRun(), localMappings, connections);
  const w = r.warnings.find((w) => w.kind === "multi-source-same-target");
  assert.ok(w, "expected a collision warning when two sources target one object");
  assert.ok(w!.message.includes("Account"));
});

test("markdown export collapses UNMAPPED rows instead of listing all of them", () => {
  const stageRun = fixtureStageRun();
  for (let i = 0; i < 30; i++) {
    stageRun.objectRuns.push({
      objectApiName: `target:Filler${i}`,
      role: "target",
      processedCount: 0,
      checkpoint: { label: `Filler${i}`, fields: [] },
    });
  }
  const md = renderAnalysisMarkdown(buildAnalysisReport("Demo", stageRun, mappings, connections));
  assert.ok(md.includes("further target objects exist but nothing maps to them"));
  // The collapsed block names them, but not as 30 separate table rows.
  assert.ok(!md.includes("| Filler7 | — | UNMAPPED | — |"));
});

test("markdown cells escape pipes and newlines so tables can't break", () => {
  const stageRun = fixtureStageRun();
  stageRun.audit = {
    source: {
      validationRules: [
        { object: "Contact", name: "Multi_Line", active: true, errorMessage: "Line one\n- bullet | with pipe" },
      ],
      flows: [], apexTriggers: [], tdtmHandlers: [], workflowRules: [], duplicateRules: [],
      npspSettings: {}, npspConfig: null, captured: [], skipped: [],
    },
  };
  const md = renderAnalysisMarkdown(buildAnalysisReport("Demo", stageRun, mappings, connections));
  const row = md.split("\n").find((l) => l.includes("Multi_Line"))!;
  assert.ok(!row.includes("\n"));
  assert.ok(row.includes("\|"), "raw pipes inside a cell must be escaped");
});

test("NPSP Configuration renders the decisive settings values, not just row counts", () => {
  const stageRun = fixtureStageRun();
  stageRun.audit = {
    source: {
      validationRules: [], flows: [], apexTriggers: [], tdtmHandlers: [],
      workflowRules: [{ object: "Contact", name: "WF_One" }],
      duplicateRules: [{ object: "Account", name: "Dup_One", active: true }],
      npspSettings: { npe01__Contacts_And_Orgs_Settings__c: [{ npe01__Account_Processor__c: "Household Account" }] },
      npspConfig: { accountModel: "Household Account", enhancedRecurringDonations: false, paymentsEnabled: true, defaultGau: null, householdRules: null },
      captured: [], skipped: [],
    },
  };
  const md = renderAnalysisMarkdown(buildAnalysisReport("Demo", stageRun, mappings, connections));
  assert.ok(md.includes("Household Account"), "the account model decides the constituent transform");
  assert.ok(md.includes("classic RD1"));
  assert.ok(md.includes("WF_One"), "workflow rules must be listed, not just counted");
  assert.ok(md.includes("Dup_One"), "duplicate rules block Load and must be listed");
});

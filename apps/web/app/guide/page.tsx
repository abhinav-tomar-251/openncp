"use client";

import Link from "next/link";
import { AppHeader } from "../components/AppHeader";
import { TranslationDiagram } from "../components/TranslationDiagram";
import { AnalyzeIcon, ExtractIcon, TransformIcon, LoadIcon, ValidateIcon } from "../components/icons";
import { useSession } from "../lib/useSession";

const TOC = [
  { id: "how-it-works", label: "How this works" },
  { id: "npsp-vs-npc", label: "NPSP vs NPC" },
  { id: "prepare-npc-org", label: "1 · Prepare NPC org" },
  { id: "connect", label: "2 · Connect orgs" },
  { id: "analyze", label: "3 · Analyze" },
  { id: "mapping", label: "4 · Mapping" },
  { id: "extract", label: "5 · Extract" },
  { id: "transform", label: "6 · Transform" },
  { id: "load", label: "7 · Load" },
  { id: "validate", label: "8 · Validate" },
  { id: "glossary", label: "Glossary" },
  { id: "faq", label: "Troubleshooting" },
];

export default function GuidePage() {
  const { user, loading, logout } = useSession();

  if (loading) return <main className="container"><p className="muted">Loading…</p></main>;
  if (!user) return null;

  return (
    <>
      <AppHeader user={user} onLogout={() => void logout()} />
      <main className="container fade-in">
        <h1 style={{ margin: "10px 0 4px" }}>Migration Guide</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          A plain-language, step-by-step walkthrough of migrating an existing NPSP org into a fresh
          Nonprofit Cloud (NPC) org using this app — written for someone with only minor NPSP or NPC
          experience.
        </p>

        <nav className="guide-toc">
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`}>
              {t.label}
            </a>
          ))}
        </nav>

        <GuideSection id="how-it-works" title="How this works">
          <p>
            This app connects to your existing NPSP org (the <strong>source</strong>, read-only) and a
            fresh NPC org (the <strong>target</strong>), then walks the data through five stages:{" "}
            <strong>Analyze → Extract → Transform → Load → Validate</strong>. Each stage saves its
            progress, can be re-run on its own without redoing earlier stages, and pauses for you to
            review and approve before the next stage can start — nothing moves data into NPC without
            you seeing it first.
          </p>
          <p className="muted">
            You don&apos;t need to know Salesforce administration deeply to follow this guide, but you
            do need <strong>System Administrator</strong> access (or equivalent) on both orgs to connect
            them and to turn on NPC features.
          </p>
        </GuideSection>

        <GuideSection id="npsp-vs-npc" title="NPSP vs NPC, in plain language">
          <p>
            NPSP (Nonprofit Success Pack) and NPC (Nonprofit Cloud) are <strong>two different products</strong>{" "}
            with different underlying data models — migrating between them isn&apos;t a simple copy. NPSP
            is a managed package built on custom objects (names with <code>npsp__</code>, <code>npe01__</code>,{" "}
            <code>npe03__</code> prefixes) using a <strong>Household Account model</strong> — every person
            (Contact) belongs to a household (Account). NPC is built on <strong>standard objects</strong>{" "}
            using a <strong>Person Account</strong> model — a person and their account are merged into one
            record.
          </p>
          <p>
            Here&apos;s the translation table this app uses when drafting a mapping for you. Some of these
            are near-automatic; others need your review because there&apos;s no single correct automatic
            translation:
          </p>
          <TranslationDiagram />
        </GuideSection>

        <GuideSection id="prepare-npc-org" step={1} title="Prepare the blank NPC org">
          <p>
            If your NPC org is brand new, <strong>do this before connecting it</strong>. A fresh NPC org
            does not have <code>GiftTransaction</code>, <code>GiftCommitment</code>, or{" "}
            <code>GiftDesignation</code> until an administrator turns on two things in Setup:
          </p>
          <ol>
            <li><strong>Person Accounts</strong> — required for the Person Account model NPC uses.</li>
            <li>
              <strong>Nonprofit Cloud for Fundraising</strong> — the feature that creates the Gift*
              objects this app maps donation data into.
            </li>
          </ol>
          <div className="callout">
            If you skip this step, Analyze will still run — but the Analysis Report will show a single
            clear warning ("target org doesn&apos;t appear to have Fundraising enabled") instead of a
            wall of confusing "object missing" rows. That warning links back to this section.
          </div>
          <p className="muted">
            For the exact click-path (it changes as Salesforce updates NPC), follow Salesforce&apos;s own
            setup documentation:
          </p>
          <ul className="muted">
            <li>
              <a href="https://help.salesforce.com/s/articleView?id=sfdo.npc_set_up_nonprofit_cloud_parent.htm&type=5" target="_blank" rel="noopener noreferrer">
                Set Up Nonprofit Cloud — Salesforce Help
              </a>
            </li>
            <li>
              <a href="https://help.salesforce.com/s/articleView?id=sfdo.nonprofit_success_pack.htm&type=5" target="_blank" rel="noopener noreferrer">
                Nonprofit Success Pack — Salesforce Help (for reference on what your source org has)
              </a>
            </li>
          </ul>
        </GuideSection>

        <GuideSection id="connect" step={2} title="Connect both orgs">
          <p>
            On a project page, connect the <strong>Source</strong> (your existing NPSP org — this app
            never writes to it) and the <strong>Target</strong> (your prepared NPC org). Each connection
            uses Salesforce&apos;s standard login + consent screen — you&apos;re not sharing a password
            with this app, you&apos;re authorizing it the same way you&apos;d authorize any connected app.
          </p>
          <p>
            After connecting, each org runs a quick <strong>capability check</strong> — it confirms
            things like whether NPSP is actually installed on the source, and whether Person Accounts /
            Fundraising are enabled on the target. Green checks are good; anything flagged is worth
            reading before you continue.
          </p>
        </GuideSection>

        <GuideSection id="analyze" step={3} title="Analyze & read the report">
          <p>
            Analyze is read-only on both orgs. It discovers every object your source org actually has
            (not a fixed list), captures full field detail (types, required/unique flags, picklist
            values, record types, relationships), inspects validation rules and automations, checks
            whether your target org can receive the data, and drafts a first-pass mapping. On a large org
            this can take a few minutes.
          </p>
          <p>Once it finishes, open the <strong>Analysis Report</strong> from the project page. It has 8 sections:</p>
          <dl className="guide-dl">
            <dt>Overview</dt>
            <dd>Record counts, mapping counts, and a few org capability flags at a glance.</dd>
            <dt>Warnings</dt>
            <dd>
              The most important section — every issue found, with a plain-language <em>why</em> and a
              concrete <em>what to do</em>. Blockers (red) should be resolved before you continue; info
              items (blue) are just things worth knowing.
            </dd>
            <dt>Source Object Inventory</dt>
            <dd>Every object found in the NPSP org, with record counts — expand any row for its full field dictionary.</dd>
            <dt>Field Dictionary</dt>
            <dd>Per-object field detail: type, required, unique, formula, and picklist values.</dd>
            <dt>Validation Rules &amp; Automations</dt>
            <dd>What business logic exists in the source org today (validation rules, flows, Apex triggers, NPSP&apos;s own trigger framework) — this app doesn&apos;t migrate automations, but you should know what exists so you can decide whether to recreate any of it in NPC.</dd>
            <dt>NPSP Configuration</dt>
            <dd>Key NPSP settings (recurring donation behavior, allocation defaults, etc.) captured for reference.</dd>
            <dt>Target Org Readiness</dt>
            <dd>
              Every object in the target NPC org — not just the ones you&apos;ve enabled. Objects a
              mapping targets show PASS/WARN/MISSING; everything else shows UNMAPPED (it exists, nothing
              currently targets it). Issues are split into two counts: <strong>in enabled mappings</strong>{" "}
              (blocks migration right now — fix these first) and <strong>in unreviewed drafts</strong>{" "}
              (worth knowing, not urgent until you enable that mapping).
            </dd>
            <dt>Mapping Summary</dt>
            <dd>Every drafted mapping with its confidence level — the next step covers what to do with these.</dd>
          </dl>
        </GuideSection>

        <GuideSection id="mapping" step={4} title="Review the Mapping">
          <p>Every drafted mapping has a confidence level:</p>
          <ul>
            <li><strong>curated</strong> — a hand-built translation this app trusts; enabled by default.</li>
            <li><strong>heuristic</strong> — a best guess based on matching names/fields; <strong>starts disabled</strong> until you review it.</li>
            <li><strong>unmapped</strong> — no good target match was found; needs a target object picked manually.</li>
          </ul>
          <p>
            Open the <strong>Mapping Editor</strong> from the project page to review drafts, pick target
            objects, map individual fields, and enable/disable objects. Only <em>enabled</em> mappings
            run in Transform and Load — this is what makes review-before-migrate safe.
          </p>
          <p>
            <strong>How to triage efficiently:</strong> use the editor&apos;s{" "}
            <strong>needs attention only</strong> filter to jump straight to mappings whose target is
            WARN or MISSING. Fix mappings you&apos;ve already <strong>enabled</strong> first — those
            actually block migration. Then work through unreviewed heuristic drafts flagged WARN/MISSING
            before enabling them; a bad guess is fine to leave disabled.
          </p>
          <p>
            Some objects need extra attention because — per the translation table in{" "}
            <a href="#npsp-vs-npc">NPSP vs NPC</a> — they don&apos;t translate 1:1 and the app
            can&apos;t yet do the whole job:
          </p>
          <ul>
            <li><strong>Payments</strong> should fold into their Opportunity&apos;s Gift Transaction. Not automated yet — leave them unmapped and reconcile installments manually.</li>
            <li><strong>Recurring Donations</strong> migrate as Gift Commitments, but their <em>schedule</em> doesn&apos;t yet — recreate schedules in NPC after Load.</li>
            <li><strong>Multi-member households</strong>: each Contact becomes its own Person Account; the household grouping isn&apos;t rebuilt yet.</li>
            <li><strong>Relationships</strong>: NPSP&apos;s reciprocal pairs both migrate, so expect duplicates to tidy up.</li>
            <li><strong>Organization Accounts</strong> need a manual filter so Household Accounts aren&apos;t copied too.</li>
          </ul>
          <p>
            Re-run Analyze anytime — your manual edits are preserved; only untouched auto-drafts get
            refreshed.
          </p>
        </GuideSection>

        <GuideSection id="extract" step={5} title="Extract">
          <StageBlurb Icon={ExtractIcon}>
            Pulls every in-scope source object out of NPSP and into this app&apos;s own staging database,
            using Salesforce&apos;s Bulk API — large objects are automatically split into chunks. This
            step only <strong>reads</strong> from NPSP.
          </StageBlurb>
        </GuideSection>

        <GuideSection id="transform" step={6} title="Transform + Prepare Target">
          <StageBlurb Icon={TransformIcon}>
            Applies your reviewed mapping to convert staged NPSP-shaped data into NPC-shaped data, and
            builds a cross-reference table linking every old NPSP Id to where it will land in NPC (this
            is how relationships stay intact even though every record gets a brand-new Id). <strong>Prepare
            Target</strong>, run from this stage, creates one small tracking field on each target object
            in NPC — this is what makes Load safe to re-run without creating duplicates.
          </StageBlurb>
        </GuideSection>

        <GuideSection id="load" step={7} title="Load">
          <StageBlurb Icon={LoadIcon}>
            Writes the transformed data into NPC, in dependency order (funds before gifts, accounts
            before contacts, etc.) so relationships resolve correctly. Loading is <strong>idempotent</strong> —
            re-running it after fixing an error updates existing records instead of creating duplicates,
            because of the tracking field from Prepare Target.
          </StageBlurb>
        </GuideSection>

        <GuideSection id="validate" step={8} title="Validate">
          <StageBlurb Icon={ValidateIcon}>
            Reconciles what actually landed in NPC against what was staged — record counts and, where
            configured, financial totals — and produces a downloadable report you can use to confirm the
            migration with stakeholders.
          </StageBlurb>
        </GuideSection>

        <GuideSection id="glossary" title="Glossary">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>NPSP term</th><th>NPC term</th><th>What it is</th></tr>
              </thead>
              <tbody>
                <tr><td><code>Account</code> (Household) + <code>Contact</code></td><td>Person Account</td><td>An individual constituent</td></tr>
                <tr><td><code>Account</code> (Organization)</td><td>Business Account</td><td>A company/org constituent</td></tr>
                <tr><td><code>Opportunity</code></td><td>GiftTransaction</td><td>A completed donation</td></tr>
                <tr><td><code>npe01__OppPayment__c</code></td><td>(folded into GiftTransaction)</td><td>An installment payment on a donation</td></tr>
                <tr><td><code>npe03__Recurring_Donation__c</code></td><td>GiftCommitment + GiftCommitmentSchedule</td><td>An ongoing pledge</td></tr>
                <tr><td><code>npsp__General_Accounting_Unit__c</code></td><td>GiftDesignation</td><td>A fund/purpose</td></tr>
                <tr><td><code>npsp__Allocation__c</code></td><td>GiftTransactionDesignation</td><td>A gift-to-fund link</td></tr>
                <tr><td><code>npsp__Partial_Soft_Credit__c</code></td><td>GiftSoftCredit</td><td>Credit to a non-primary donor</td></tr>
                <tr><td><code>npe4__Relationship__c</code></td><td>Contact Contact Relationship</td><td>Person-to-person link</td></tr>
                <tr><td><code>npe5__Affiliation__c</code></td><td>Contacts to Multiple Accounts</td><td>Person-to-organization link</td></tr>
                <tr><td><code>Campaign</code> / <code>CampaignMember</code></td><td>Campaign / CampaignMember</td><td>Same object in both — pass-through</td></tr>
              </tbody>
            </table>
          </div>
        </GuideSection>

        <GuideSection id="faq" title="Troubleshooting & FAQ">
          <dl className="guide-dl">
            <dt>Why does the Target Org Readiness table show (almost) everything as MISSING?</dt>
            <dd>
              This almost always means Nonprofit Cloud for Fundraising isn&apos;t enabled on the target
              org yet — see <a href="#prepare-npc-org">Prepare the blank NPC org</a> above. The Analysis
              Report&apos;s Warnings section will call this out directly as a single blocker.
            </dd>
            <dt>Why does the readiness table have so many rows, and what does UNMAPPED mean?</dt>
            <dd>
              It covers the whole target org on purpose — every standard and custom object, not just the
              ones you&apos;ve mapped. <strong>UNMAPPED</strong> just means the object is real and exists
              in NPC, but nothing currently targets it — that&apos;s normal for most of a large org (things
              like report/dashboard-support objects) and isn&apos;t something to fix. Use the{" "}
              <strong>needs attention only</strong> filter (Mapping Editor) or filter box (Analysis
              Report) to skip past it straight to WARN/MISSING rows.
            </dd>
            <dt>Will re-running Analyze lose my mapping edits?</dt>
            <dd>No — mappings you&apos;ve edited or approved are preserved. Only untouched auto-drafts get refreshed against the latest schema.</dd>
            <dt>A stage failed partway through — do I have to start over?</dt>
            <dd>No. Every object within a stage tracks its own status; retry just the failed object from the stage&apos;s panel instead of re-running the whole stage.</dd>
            <dt>Is it safe to re-run Load after fixing an error?</dt>
            <dd>Yes — Load is idempotent (see <a href="#load">Load</a>). Re-running it never creates duplicate records.</dd>
          </dl>
        </GuideSection>

        <p className="muted" style={{ marginTop: 24 }}>
          Prefer to go back to your projects? <Link href="/">Return to Projects →</Link>
        </p>
      </main>
    </>
  );
}

function GuideSection({
  id,
  step,
  title,
  children,
}: {
  id: string;
  step?: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card" style={{ scrollMarginTop: 120 }}>
      <div className="card-hd" style={{ marginBottom: 10, justifyContent: "flex-start" }}>
        {step !== undefined && <span className="guide-step-num">{step}</span>}
        <h2 style={{ margin: 0 }}>{title}</h2>
      </div>
      <div className="stack" style={{ gap: 10, fontSize: 13.5, lineHeight: 1.65 }}>
        {children}
      </div>
    </section>
  );
}

function StageBlurb({ Icon, children }: { Icon: (p: { size?: number }) => React.ReactElement; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span className="stepper-dot stepper-dot-pending" style={{ flex: "0 0 auto" }}>
        <Icon size={16} />
      </span>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}

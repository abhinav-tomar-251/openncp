import { PersonIcon, BuildingIcon, GiftIcon, TagIcon, RepeatIcon, LinkIcon, ArrowRightIcon } from "./icons";

/**
 * The NPSP <-> NPC "rosetta stone" — the same translation content as
 * docs/05-data-model-mapping.md §3, condensed to plain language for an operator
 * with minor NPSP/NPC knowledge. Used full-size in the Guide (§2) and as compact
 * inline hints next to relevant Analysis Report warnings.
 */
export interface Translation {
  npspLabel: string;
  npcLabel: string;
  note: string;
  Icon: (props: { size?: number; className?: string }) => React.ReactElement;
  /** Source NPSP object API names this translation applies to. */
  matches: string[];
  /**
   * Honest delivery status so the diagram never over-claims:
   *  full    — migrates automatically today
   *  partial — migrates, but part of the translation still needs manual work
   *  planned — not automated yet
   *  none    — no NPC equivalent exists
   */
  status: "full" | "partial" | "planned" | "none";
}

/** All NPC object names below were verified against a real NPC org's inventory. */
export const TRANSLATIONS: Translation[] = [
  {
    npspLabel: "Household Account + Contact",
    npcLabel: "Person Account",
    note: "NPSP splits a person into two records — a Household Account and a Contact. NPC merges them into one Person Account. Each Contact migrates today; rebuilding multi-member households as a relationship group is still planned.",
    Icon: PersonIcon,
    matches: ["Contact"],
    status: "partial",
  },
  {
    npspLabel: "Opportunity",
    npcLabel: "Gift Transaction",
    note: "The donation itself, including its donor, campaign and stage→status translation.",
    Icon: GiftIcon,
    matches: ["Opportunity"],
    status: "full",
  },
  {
    npspLabel: "Payment",
    npcLabel: "folded into Gift Transaction",
    note: "An NPSP Payment is an installment of a gift, so several payments should collapse into their parent Gift Transaction. That many-into-one transform isn't built yet — payments stay unmapped for now.",
    Icon: GiftIcon,
    matches: ["npe01__OppPayment__c"],
    status: "planned",
  },
  {
    npspLabel: "Recurring Donation",
    npcLabel: "Gift Commitment (+ Schedule)",
    note: "The ongoing pledge becomes a GiftCommitment — that part works today. Its installment pattern should also become a GiftCommitmentSchedule, which is still planned; recreate schedules in NPC after Load.",
    Icon: RepeatIcon,
    matches: ["npe03__Recurring_Donation__c"],
    status: "partial",
  },
  {
    npspLabel: "General Accounting Unit + Allocation",
    npcLabel: "Gift Designation + Gift Transaction Designation",
    note: "A GAU is the fund; an Allocation is the gift-to-fund link. NPC keeps the same two-piece shape — note the NPC object is GiftDesignation, not Designation.",
    Icon: TagIcon,
    matches: ["npsp__General_Accounting_Unit__c", "npsp__Allocation__c"],
    status: "full",
  },
  {
    npspLabel: "Partial Soft Credit",
    npcLabel: "Gift Soft Credit",
    note: "Crediting someone other than the primary donor for a gift — same idea, a different object on the NPC side, with a Role picklist that also covers tributes (Honoree).",
    Icon: PersonIcon,
    matches: ["npsp__Partial_Soft_Credit__c"],
    status: "full",
  },
  {
    npspLabel: "Affiliation (person ↔ org)",
    npcLabel: "Account Contact Relation",
    note: "NPC replaces NPSP Affiliations with \"Contacts to Multiple Accounts\" rather than a Party object.",
    Icon: LinkIcon,
    matches: ["npe5__Affiliation__c"],
    status: "full",
  },
  {
    npspLabel: "Relationship (person ↔ person)",
    npcLabel: "Contact Contact Relation",
    note: "Migrates today, but NPSP auto-creates a reciprocal row for every relationship and those pairs aren't de-duplicated yet — expect duplicates to tidy up.",
    Icon: LinkIcon,
    matches: ["npe4__Relationship__c"],
    status: "partial",
  },
  {
    npspLabel: "Organization Account",
    npcLabel: "Business Account",
    note: "Mostly a direct field-level translation, but it needs a filter to avoid also copying Household Accounts — not automated yet.",
    Icon: BuildingIcon,
    matches: ["Account"],
    status: "planned",
  },
  {
    npspLabel: "Level",
    npcLabel: "— no NPC equivalent",
    note: "NPC has no GivingTier or equivalent object. Decide per project: recreate as a custom field on the Person Account, or skip.",
    Icon: TagIcon,
    matches: ["npsp__Level__c"],
    status: "none",
  },
];

const STATUS_PILL: Record<Translation["status"], { cls: string; label: string }> = {
  full: { cls: "pill-success", label: "automatic" },
  partial: { cls: "pill-warn", label: "partial" },
  planned: { cls: "pill-info", label: "planned" },
  none: { cls: "pill-neutral", label: "no equivalent" },
};

/** Find the translation entry relevant to a source object api name, if any. */
export function findTranslation(objectApiName: string): Translation | undefined {
  return TRANSLATIONS.find((t) => t.matches.includes(objectApiName));
}

export function TranslationDiagram({ items = TRANSLATIONS }: { items?: Translation[] }) {
  return (
    <div className="diagram">
      {items.map((t) => (
        <div className="diagram-row" key={t.npspLabel}>
          <div className="diagram-side">
            <t.Icon size={20} />
            <span>{t.npspLabel}</span>
          </div>
          <ArrowRightIcon size={16} className="diagram-arrow" />
          <div className="diagram-side diagram-side-npc">
            <t.Icon size={20} />
            <span>{t.npcLabel}</span>
            <span className={`pill ${STATUS_PILL[t.status].cls}`}>{STATUS_PILL[t.status].label}</span>
          </div>
          <p className="diagram-note">{t.note}</p>
        </div>
      ))}
    </div>
  );
}

/** Compact single-line version for inline hints next to a warning. */
export function TranslationHint({ item }: { item: Translation }) {
  return (
    <span className="diagram-hint">
      <item.Icon size={13} /> {item.npspLabel} <ArrowRightIcon size={11} /> {item.npcLabel}
    </span>
  );
}

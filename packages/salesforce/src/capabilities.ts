import type { Connection } from "jsforce";
import { parseIdentityUrl } from "./auth.js";

export interface CapabilityReport {
  orgId: string | null;
  userId: string | null;
  username?: string;
  organizationName?: string;
  apiVersion: string;
  /** Person Accounts enabled (required in the target org for NPC constituents). */
  personAccountsEnabled: boolean;
  /** NPSP managed package detected (source org). */
  npspInstalled: boolean;
  /** NPSP Enhanced Recurring Donations enabled. */
  enhancedRecurringDonations: boolean;
  /** NPSP Program Management Module (pmdm__) detected. */
  pmmInstalled: boolean;
  /** NPC Fundraising standard objects present (target org). */
  npcFundraisingPresent: boolean;
  dailyApiRequests?: { max: number; remaining: number };
  /** Hard blockers that prevent migration for this role. */
  blockers: string[];
  /** Non-blocking advisories. */
  warnings: string[];
}

async function sobjectExists(conn: Connection, name: string): Promise<boolean> {
  try {
    const g = await conn.describeGlobal();
    return g.sobjects.some((s) => s.name === name);
  } catch {
    return false;
  }
}

async function hasField(conn: Connection, object: string, field: string): Promise<boolean> {
  try {
    const d = await conn.describe(object);
    return d.fields.some((f) => f.name === field);
  } catch {
    return false;
  }
}

async function getDailyApiRequests(
  conn: Connection,
): Promise<{ max: number; remaining: number } | undefined> {
  try {
    const res = await conn.request<{ DailyApiRequests?: { Max: number; Remaining: number } }>(
      `/services/data/v${conn.version}/limits`,
    );
    const d = res.DailyApiRequests;
    return d ? { max: d.Max, remaining: d.Remaining } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe an org's capabilities to drive the Stage 1 readiness report.
 * Read-only. `identityUrl` (from the token response) yields orgId/userId without an extra call.
 */
export async function probeOrg(
  conn: Connection,
  role: "source" | "target",
  identityUrl?: string,
): Promise<CapabilityReport> {
  const ident = identityUrl ? parseIdentityUrl(identityUrl) : null;

  // Identity (name/username) is best-effort; orgId comes from the identity URL.
  let username: string | undefined;
  let organizationName: string | undefined;
  try {
    const info = (await conn.identity()) as {
      username?: string;
      display_name?: string;
      organization_id?: string;
    };
    username = info.username;
    organizationName = info.display_name;
  } catch {
    /* ignore — orgId still available from identity URL */
  }

  const [personAccountsEnabled, npspInstalled, pmmInstalled, npcFundraisingPresent] =
    await Promise.all([
      hasField(conn, "Account", "IsPersonAccount"),
      sobjectExists(conn, "npe03__Recurring_Donation__c"),
      sobjectExists(conn, "pmdm__Program__c"),
      sobjectExists(conn, "GiftTransaction"),
    ]);

  const enhancedRecurringDonations = npspInstalled
    ? await hasField(conn, "npe03__Recurring_Donation__c", "npsp__InstallmentFrequency__c")
    : false;

  const dailyApiRequests = await getDailyApiRequests(conn);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (role === "source" && !npspInstalled) {
    blockers.push("NPSP not detected in the source org (npe03__Recurring_Donation__c missing).");
  }
  if (role === "target") {
    if (!personAccountsEnabled) {
      blockers.push(
        "Person Accounts are not enabled in the target org (required for NPC constituents).",
      );
    }
    if (!npcFundraisingPresent) {
      blockers.push("NPC Fundraising objects (e.g. GiftTransaction) not found in the target org.");
    }
  }
  if (dailyApiRequests && dailyApiRequests.remaining < 10000) {
    warnings.push(
      `Low remaining daily API requests (${dailyApiRequests.remaining}/${dailyApiRequests.max}).`,
    );
  }

  return {
    orgId: ident?.orgId ?? null,
    userId: ident?.userId ?? null,
    username,
    organizationName,
    apiVersion: conn.version,
    personAccountsEnabled,
    npspInstalled,
    enhancedRecurringDonations,
    pmmInstalled,
    npcFundraisingPresent,
    dailyApiRequests,
    blockers,
    warnings,
  };
}

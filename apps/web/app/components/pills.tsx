import { CheckIcon, WarningIcon, XCircleIcon, InfoIcon, CircleIcon } from "./icons";

/**
 * Consolidated pill components — previously duplicated 3x across page.tsx,
 * mappings/page.tsx, and analysis/page.tsx. Each pairs an icon with the `.pill-*`
 * classes from globals.css so status/outcome/confidence/severity read consistently
 * everywhere in the app.
 */

function Pill({ cls, icon, children }: { cls: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={`pill ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

/** ObjectRun / StageRun status: COMPLETED, RUNNING, QUEUED, PENDING, PARTIAL, AWAITING_REVIEW, APPROVED, DONE, FAILED. */
export function StatusPill({ status }: { status: string }) {
  if (status === "COMPLETED" || status === "APPROVED" || status === "DONE") {
    return <Pill cls="pill-success" icon={<CheckIcon />}>{status}</Pill>;
  }
  if (status === "RUNNING" || status === "QUEUED") {
    return <Pill cls="pill-info" icon={<CircleIcon />}>{status}</Pill>;
  }
  if (status === "PARTIAL" || status === "AWAITING_REVIEW") {
    return <Pill cls="pill-warn" icon={<WarningIcon />}>{status}</Pill>;
  }
  if (status === "FAILED") {
    return <Pill cls="pill-danger" icon={<XCircleIcon />}>{status}</Pill>;
  }
  return <Pill cls="pill-neutral" icon={<CircleIcon />}>{status}</Pill>;
}

/** Reconcile / target-schema-check outcome: PASS, PARTIAL, WARN, MISSING, FAIL. */
export function OutcomePill({ outcome }: { outcome: string }) {
  if (outcome === "PASS") return <Pill cls="pill-success" icon={<CheckIcon />}>{outcome}</Pill>;
  if (outcome === "PARTIAL" || outcome === "WARN") return <Pill cls="pill-warn" icon={<WarningIcon />}>{outcome}</Pill>;
  if (outcome === "MISSING" || outcome === "FAIL") return <Pill cls="pill-danger" icon={<XCircleIcon />}>{outcome}</Pill>;
  return <Pill cls="pill-neutral" icon={<CircleIcon />}>{outcome}</Pill>;
}

/** Mapping confidence: curated, heuristic, unmapped, or manual (edited by a human). */
export function ConfidencePill({ confidence }: { confidence: string | null }) {
  const c = confidence ?? "manual";
  if (c === "curated") return <Pill cls="pill-success" icon={<CheckIcon />}>{c}</Pill>;
  if (c === "heuristic") return <Pill cls="pill-info" icon={<InfoIcon />}>{c}</Pill>;
  if (c === "unmapped") return <Pill cls="pill-danger" icon={<XCircleIcon />}>{c}</Pill>;
  return <Pill cls="pill-neutral" icon={<CircleIcon />}>{c}</Pill>;
}

/** Analysis Report warning severity: info, warn, blocker. */
export function SeverityPill({ severity }: { severity: "info" | "warn" | "blocker" }) {
  if (severity === "blocker") return <Pill cls="pill-danger" icon={<XCircleIcon />}>{severity}</Pill>;
  if (severity === "warn") return <Pill cls="pill-warn" icon={<WarningIcon />}>{severity}</Pill>;
  return <Pill cls="pill-info" icon={<InfoIcon />}>{severity}</Pill>;
}

/** Capability probe boolean flag (e.g. "NPSP installed: yes"). */
export function CapFlag({ on, label }: { on: unknown; label: string }) {
  const cls = on === true ? "pill-success" : on === false ? "pill-neutral" : "pill-warn";
  const icon = on === true ? <CheckIcon /> : on === false ? <CircleIcon /> : <InfoIcon />;
  return (
    <Pill cls={cls} icon={icon}>
      {label}: {on === true ? "yes" : on === false ? "no" : "?"}
    </Pill>
  );
}

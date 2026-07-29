"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { AnalyzeIcon, ExtractIcon, TransformIcon, LoadIcon, ValidateIcon } from "./icons";

const STAGES = [
  { key: "analyze", label: "Analyze", Icon: AnalyzeIcon },
  { key: "extract", label: "Extract", Icon: ExtractIcon },
  { key: "transform", label: "Transform", Icon: TransformIcon },
  { key: "load", label: "Load", Icon: LoadIcon },
  { key: "validate", label: "Validate", Icon: ValidateIcon },
] as const;

type StageStatus = "NOT_STARTED" | "QUEUED" | "RUNNING" | "AWAITING_REVIEW" | "APPROVED" | "DONE" | "FAILED";

function dotClass(status: StageStatus | undefined): string {
  switch (status) {
    case "DONE":
    case "APPROVED":
      return "stepper-dot-done";
    case "RUNNING":
    case "QUEUED":
      return "stepper-dot-active";
    case "AWAITING_REVIEW":
      return "stepper-dot-review";
    case "FAILED":
      return "stepper-dot-failed";
    default:
      return "stepper-dot-pending";
  }
}

/**
 * At-a-glance 5-stage progress visualization for the project page. Fetches each
 * stage's status independently (mirroring the existing per-StagePanel fetch
 * pattern in projects/[id]/page.tsx) and polls lightly so it stays live while a
 * stage is running elsewhere on the page.
 */
export function Stepper({ projectId }: { projectId: string }) {
  const [statuses, setStatuses] = useState<Partial<Record<string, StageStatus>>>({});

  async function refresh() {
    const results = await Promise.all(
      STAGES.map((s) =>
        apiGet<{ status: StageStatus }>(`/projects/${projectId}/stages/${s.key}`)
          .then((r) => [s.key, r.status] as const)
          .catch(() => [s.key, "NOT_STARTED"] as const),
      ),
    );
    setStatuses(Object.fromEntries(results));
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="stepper">
      {STAGES.map((s, i) => {
        const status = statuses[s.key];
        const Icon = s.Icon;
        return (
          <div className="stepper-step" key={s.key}>
            {i > 0 && <div className="stepper-line" />}
            <div className={`stepper-dot ${dotClass(status)}`}>
              <Icon size={15} />
            </div>
            <div className="stepper-label">{s.label}</div>
            <div className="stepper-status">{(status ?? "…").replace(/_/g, " ").toLowerCase()}</div>
          </div>
        );
      })}
    </div>
  );
}

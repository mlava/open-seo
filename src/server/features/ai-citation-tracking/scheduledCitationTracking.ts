import { AiCitationTrackingService } from "./AiCitationTrackingService";
import type { AiCitationTrackingWorkflowParams } from "@/server/workflows/AiCitationTrackingWorkflow";

type TrackingWorkflowBinding = {
  create(options: {
    params: AiCitationTrackingWorkflowParams;
  }): Promise<unknown>;
};

/** Dispatch due weekly batches only. Provider work stays inside the Workflow. */
export async function runScheduledCitationTracking(
  workflow: TrackingWorkflowBinding,
) {
  const dueConfigs = await AiCitationTrackingService.listDueConfigs(
    new Date().toISOString(),
  );
  for (const config of dueConfigs) {
    try {
      // Advance before dispatch so a failed Workflow cannot become a 15-minute
      // retry loop that repeatedly spends the API budget.
      await AiCitationTrackingService.advanceSchedule(config.id);
      const runId = await AiCitationTrackingService.createRun(
        config.projectId,
        "scheduled",
      );
      await workflow.create({ params: { runId } });
    } catch (error) {
      console.error(
        `[citation-tracking] failed to start scheduled run for ${config.projectId}:`,
        error,
      );
    }
  }
}

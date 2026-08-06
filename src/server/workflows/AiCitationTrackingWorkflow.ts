import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { withPgClient } from "@/db";
import { AiCitationTrackingService } from "@/server/features/ai-citation-tracking/AiCitationTrackingService";
import { pgStep } from "@/server/workflows/pgStep";

export interface AiCitationTrackingWorkflowParams {
  runId: string;
}

/** A batch is durable: a Worker restart resumes its stored run rather than
 * issuing an untracked second set of provider requests. */
export class AiCitationTrackingWorkflow extends WorkflowEntrypoint<
  Env,
  AiCitationTrackingWorkflowParams
> {
  async run(
    event: WorkflowEvent<AiCitationTrackingWorkflowParams>,
    step: WorkflowStep,
  ) {
    return withPgClient(() =>
      pgStep(
        step,
        `collect-${event.payload.runId}`,
        { retries: { limit: 1, delay: "10 seconds" }, timeout: "15 minutes" },
        () => AiCitationTrackingService.runById(event.payload.runId),
      ),
    );
  }
}

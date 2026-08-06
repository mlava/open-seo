import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { AiCitationTrackingService } from "@/server/features/ai-citation-tracking/AiCitationTrackingService";
import { pgStep } from "@/server/workflows/pgStep";

export interface AiCitationTrackingWorkflowParams {
  runId: string;
}

/**
 * One durable step per tracked prompt rather than one step for the whole batch.
 * A batch can be 50 prompts across 5 providers; as a single step it would blow
 * any sane step timeout, and a retry would re-ask every provider from the top.
 * Per-prompt steps keep each unit small, and the engine's memoised results mean
 * a Worker restart resumes at the first prompt that had not finished.
 */
export class AiCitationTrackingWorkflow extends WorkflowEntrypoint<
  Env,
  AiCitationTrackingWorkflowParams
> {
  async run(
    event: WorkflowEvent<AiCitationTrackingWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { runId } = event.payload;

    const plan = await pgStep(
      step,
      `plan-${runId}`,
      { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" },
      () => AiCitationTrackingService.planRun(runId),
    );

    for (const promptId of plan.promptIds) {
      // A prompt that keeps failing records per-provider errors and moves on,
      // so one bad prompt cannot strand the rest of the batch.
      await pgStep(
        step,
        `prompt-${promptId}`,
        { retries: { limit: 1, delay: "20 seconds" }, timeout: "5 minutes" },
        () => AiCitationTrackingService.runPromptTask(runId, promptId),
      );
    }

    return pgStep(
      step,
      `finalize-${runId}`,
      { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" },
      () => AiCitationTrackingService.finalizeRun(runId),
    );
  }
}

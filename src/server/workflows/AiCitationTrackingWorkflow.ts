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
 *
 * SUBREQUESTS ARE BUDGETED PER INSTANCE, NOT PER STEP. Every provider call,
 * redirect hop and D1 query in the whole run shares one allowance, and one
 * prompt costs roughly a dozen. `step.sleep` does NOT refill it — a sleeping
 * instance only stops counting against concurrency — so an earlier attempt to
 * yield every few prompts changed nothing: a 33-prompt sweep still died after
 * exactly six, twice. This needs headroom in the budget itself (Workers Paid
 * defaults to 10,000, against 50 on Free), not a smarter loop. If a run ever
 * outgrows that, raise `limits.subrequests` in wrangler.jsonc.
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
      try {
        await pgStep(
          step,
          `prompt-${promptId}`,
          { retries: { limit: 1, delay: "20 seconds" }, timeout: "5 minutes" },
          () => AiCitationTrackingService.runPromptTask(runId, promptId),
        );
      } catch (error) {
        // Per-provider failures are already recorded as rows; this catches a
        // step-level failure (timeout, or a write that failed twice). Swallow
        // it so one bad prompt cannot strand the other 32 and skip finalize —
        // a run of 33 prompts died here after two when this rethrew.
        console.error(
          `[citation-tracking] prompt ${promptId} step failed, continuing:`,
          error,
        );
      }
    }

    return pgStep(
      step,
      `finalize-${runId}`,
      { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" },
      () => AiCitationTrackingService.finalizeRun(runId),
    );
  }
}

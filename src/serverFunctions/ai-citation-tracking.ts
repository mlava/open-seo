import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { env } from "cloudflare:workers";
import { AiCitationTrackingService } from "@/server/features/ai-citation-tracking/AiCitationTrackingService";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectSchema = z.object({ projectId: z.string().min(1) });
const settingsSchema = projectSchema.extend({
  aliases: z.array(z.string().max(160)).max(20),
  scheduleEnabled: z.boolean(),
});
const addPromptSchema = projectSchema.extend({
  label: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4_000),
});
const promptSchema = projectSchema.extend({ promptId: z.string().uuid() });

export const getAiCitationTrackingOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(({ context }) =>
    AiCitationTrackingService.getOverview(context.projectId),
  );
export const saveAiCitationTrackingSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(settingsSchema)
  .handler(async ({ data, context }) => {
    await AiCitationTrackingService.saveConfig({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      aliases: data.aliases,
      scheduleEnabled: data.scheduleEnabled,
    });
    return { saved: true as const };
  });
export const addAiCitationTrackingPrompt = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addPromptSchema)
  .handler(async ({ data, context }) => {
    await AiCitationTrackingService.addPrompt({
      projectId: context.projectId,
      label: data.label,
      prompt: data.prompt,
    });
    return { added: true as const };
  });
export const removeAiCitationTrackingPrompt = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(promptSchema)
  .handler(async ({ data, context }) => {
    await AiCitationTrackingService.removePrompt(
      context.projectId,
      data.promptId,
    );
    return { removed: true as const };
  });
export const startAiCitationTrackingRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => {
    const runId = await AiCitationTrackingService.createRun(
      context.projectId,
      "manual",
    );
    await env.AI_CITATION_TRACKING_WORKFLOW.create({ params: { runId } });
    return { runId };
  });

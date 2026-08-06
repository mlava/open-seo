import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { env } from "cloudflare:workers";
import { AiCitationTrackingService } from "@/server/features/ai-citation-tracking/AiCitationTrackingService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { CITATION_PROVIDERS } from "@/shared/ai-citation-providers";

const providerSchema = z.enum(CITATION_PROVIDERS);
const providerListSchema = z
  .array(providerSchema)
  .max(CITATION_PROVIDERS.length);
const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(20);

const projectSchema = z.object({ projectId: z.string().min(1) });
const overviewSchema = projectSchema.extend({
  runId: z.string().uuid().optional(),
});
const settingsSchema = projectSchema.extend({
  aliases: z.array(z.string().max(160)).max(20),
  providers: providerListSchema,
  scheduleEnabled: z.boolean(),
});
const addPromptSchema = projectSchema.extend({
  label: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4_000),
  // null means "inherit the project default".
  providers: providerListSchema.nullable().default(null),
  tags: tagsSchema.default([]),
});
const updatePromptSchema = projectSchema.extend({
  promptId: z.string().uuid(),
  enabled: z.boolean().optional(),
  providers: providerListSchema.nullable().optional(),
  tags: tagsSchema.optional(),
});
const promptSchema = projectSchema.extend({ promptId: z.string().uuid() });
const responseSchema = projectSchema.extend({
  responseId: z.string().uuid(),
});

export const getAiCitationTrackingOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(overviewSchema)
  .handler(({ data, context }) =>
    AiCitationTrackingService.getOverview(context.projectId, data.runId),
  );

export const getAiCitationTrackingResponse = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(responseSchema)
  .handler(({ data, context }) =>
    AiCitationTrackingService.getResponseDetail(
      context.projectId,
      data.responseId,
    ),
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
      providers: data.providers,
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
      providers: data.providers,
      tags: data.tags,
    });
    return { added: true as const };
  });

export const updateAiCitationTrackingPrompt = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updatePromptSchema)
  .handler(async ({ data, context }) => {
    await AiCitationTrackingService.updatePrompt({
      projectId: context.projectId,
      promptId: data.promptId,
      enabled: data.enabled,
      providers: data.providers,
      tags: data.tags,
    });
    return { updated: true as const };
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

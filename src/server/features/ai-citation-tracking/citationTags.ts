import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCitationTrackingPromptTags,
  aiCitationTrackingTags,
} from "@/db/schema";
import { normalizeSavedKeywordTags } from "@/shared/saved-keyword-tags";

/**
 * Free-text tags on tracked prompts. Mirrors the saved-keyword tag model (tag
 * table plus an assignment join) so both features behave the same way and can
 * share the client-side chip and colour helpers.
 */
export type PromptTag = { id: string; name: string; color: string | null };

export async function listPromptTags(
  projectId: string,
): Promise<Map<string, PromptTag[]>> {
  const rows = await db
    .select({
      promptId: aiCitationTrackingPromptTags.promptId,
      id: aiCitationTrackingTags.id,
      name: aiCitationTrackingTags.name,
      color: aiCitationTrackingTags.color,
    })
    .from(aiCitationTrackingPromptTags)
    .innerJoin(
      aiCitationTrackingTags,
      eq(aiCitationTrackingTags.id, aiCitationTrackingPromptTags.tagId),
    )
    .where(eq(aiCitationTrackingTags.projectId, projectId));
  const byPrompt = new Map<string, PromptTag[]>();
  for (const row of rows) {
    const list = byPrompt.get(row.promptId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    byPrompt.set(row.promptId, list);
  }
  return byPrompt;
}

/** Resolve tag names to ids for this project, creating any that are new. */
async function resolveTagIds(
  projectId: string,
  names: readonly string[],
): Promise<string[]> {
  const normalized = normalizeSavedKeywordTags(names);
  if (normalized.length === 0) return [];
  const existing = await db
    .select()
    .from(aiCitationTrackingTags)
    .where(eq(aiCitationTrackingTags.projectId, projectId));
  const byNormalized = new Map(
    existing.map((tag) => [tag.normalizedName, tag.id]),
  );
  const created: {
    id: string;
    projectId: string;
    name: string;
    normalizedName: string;
  }[] = [];
  const ids: string[] = [];
  for (const tag of normalized) {
    const found = byNormalized.get(tag.normalizedName);
    if (found) {
      ids.push(found);
      continue;
    }
    const id = crypto.randomUUID();
    created.push({
      id,
      projectId,
      name: tag.name,
      normalizedName: tag.normalizedName,
    });
    byNormalized.set(tag.normalizedName, id);
    ids.push(id);
  }
  if (created.length) await db.insert(aiCitationTrackingTags).values(created);
  return ids;
}

/** Replace a prompt's tag set wholesale — the UI always submits the full list. */
export async function setPromptTags(
  projectId: string,
  promptId: string,
  names: readonly string[],
) {
  const tagIds = await resolveTagIds(projectId, names);
  await db
    .delete(aiCitationTrackingPromptTags)
    .where(eq(aiCitationTrackingPromptTags.promptId, promptId));
  if (tagIds.length)
    await db
      .insert(aiCitationTrackingPromptTags)
      .values(tagIds.map((tagId) => ({ promptId, tagId })));
}

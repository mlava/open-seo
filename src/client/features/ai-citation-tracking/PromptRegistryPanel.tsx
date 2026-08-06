import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { TagChip } from "@/client/features/saved-keywords/TagChip";
import {
  addAiCitationTrackingPrompt,
  removeAiCitationTrackingPrompt,
  updateAiCitationTrackingPrompt,
} from "@/serverFunctions/ai-citation-tracking";
import {
  CITATION_PROVIDER_LABELS,
  type CitationProvider,
} from "@/shared/ai-citation-providers";
import { parseSavedKeywordTagInput } from "@/shared/saved-keyword-tags";
import { ProviderBadge } from "./citationParts";

export type RegistryPrompt = {
  id: string;
  label: string;
  prompt: string;
  enabled: boolean;
  providers: CitationProvider[] | null;
  tags: { id: string; name: string; color: string | null }[];
};

export function PromptRegistryPanel({
  projectId,
  prompts,
  configuredProviders,
  defaultProviders,
  onChanged,
}: {
  projectId: string;
  prompts: RegistryPrompt[];
  configuredProviders: CitationProvider[];
  defaultProviders: CitationProvider[];
  onChanged: () => void;
}) {
  const [label, setLabel] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [tagInput, setTagInput] = React.useState("");

  const addPrompt = useMutation({
    mutationFn: () =>
      addAiCitationTrackingPrompt({
        data: {
          projectId,
          label,
          prompt,
          providers: null,
          tags: parseSavedKeywordTagInput(tagInput),
        },
      }),
    onSuccess: () => {
      setLabel("");
      setPrompt("");
      setTagInput("");
      toast.success("Prompt added");
      onChanged();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const updatePrompt = useMutation({
    mutationFn: (input: {
      promptId: string;
      enabled?: boolean;
      providers?: CitationProvider[] | null;
      tags?: string[];
    }) => updateAiCitationTrackingPrompt({ data: { projectId, ...input } }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const removePrompt = useMutation({
    mutationFn: (promptId: string) =>
      removeAiCitationTrackingPrompt({ data: { projectId, promptId } }),
    onSuccess: () => {
      toast.success("Prompt removed");
      onChanged();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <h2 className="font-semibold">Prompt registry</h2>
      <p className="mt-1 text-sm text-base-content/65">
        Keep prompts stable to make week-over-week evidence comparable. Tag them
        to group related questions; leave providers unset to use the project
        default.
      </p>

      <form
        className="mt-4 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addPrompt.mutate();
        }}
      >
        <input
          className="input input-bordered"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Prompt label"
          maxLength={120}
        />
        <textarea
          className="textarea textarea-bordered min-h-24"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What are the best scholarly identifier lookup tools?"
          maxLength={4000}
        />
        <input
          className="input input-bordered"
          value={tagInput}
          onChange={(event) => setTagInput(event.target.value)}
          placeholder="Tags, comma separated (e.g. competitors, pricing)"
        />
        <div>
          <button
            className="btn btn-sm"
            disabled={!label.trim() || !prompt.trim() || addPrompt.isPending}
          >
            {addPrompt.isPending ? "Adding…" : "Add prompt"}
          </button>
        </div>
      </form>

      <div className="mt-4 space-y-2">
        {prompts.map((item) => (
          <PromptRow
            key={item.id}
            prompt={item}
            configuredProviders={configuredProviders}
            defaultProviders={defaultProviders}
            busy={updatePrompt.isPending || removePrompt.isPending}
            onUpdate={(input) =>
              updatePrompt.mutate({ promptId: item.id, ...input })
            }
            onRemove={() => removePrompt.mutate(item.id)}
          />
        ))}
        {prompts.length === 0 ? (
          <p className="text-sm text-base-content/60">No prompts yet.</p>
        ) : null}
      </div>
    </section>
  );
}

function PromptRow({
  prompt,
  configuredProviders,
  defaultProviders,
  busy,
  onUpdate,
  onRemove,
}: {
  prompt: RegistryPrompt;
  configuredProviders: CitationProvider[];
  defaultProviders: CitationProvider[];
  busy: boolean;
  onUpdate: (input: {
    enabled?: boolean;
    providers?: CitationProvider[] | null;
    tags?: string[];
  }) => void;
  onRemove: () => void;
}) {
  const [editingTags, setEditingTags] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");
  const effective = prompt.providers ?? defaultProviders;

  const toggleProvider = (provider: CitationProvider) => {
    const current = prompt.providers ?? defaultProviders;
    const next = current.includes(provider)
      ? current.filter((entry) => entry !== provider)
      : [...current, provider];
    // Back to null (inherit) once the selection matches the project default.
    const matchesDefault =
      next.length === defaultProviders.length &&
      next.every((entry) => defaultProviders.includes(entry));
    onUpdate({ providers: matchesDefault ? null : next });
  };

  return (
    <div className="rounded-lg bg-base-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{prompt.label}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-base-content/70">
            {prompt.prompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={prompt.enabled}
              disabled={busy}
              onChange={(event) => onUpdate({ enabled: event.target.checked })}
            />
            <span className="text-base-content/60">
              {prompt.enabled ? "On" : "Off"}
            </span>
          </label>
          <button
            className="btn btn-ghost btn-xs text-error"
            onClick={onRemove}
            disabled={busy}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {prompt.tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} size="xs" />
        ))}
        {editingTags ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              onUpdate({ tags: parseSavedKeywordTagInput(tagDraft) });
              setEditingTags(false);
            }}
          >
            <input
              autoFocus
              className="input input-bordered input-xs w-56"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="competitors, pricing"
            />
            <button className="btn btn-xs">Save</button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setEditingTags(false)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-xs text-base-content/60"
            onClick={() => {
              setTagDraft(prompt.tags.map((tag) => tag.name).join(", "));
              setEditingTags(true);
            }}
          >
            {prompt.tags.length ? "Edit tags" : "+ Tags"}
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs text-base-content/50">
          {prompt.providers ? "Custom providers" : "Project default"}
        </span>
        {configuredProviders.map((provider) => (
          <label
            key={provider}
            className="flex cursor-pointer items-center gap-1.5 text-xs"
            title={CITATION_PROVIDER_LABELS[provider]}
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={effective.includes(provider)}
              disabled={busy}
              onChange={() => toggleProvider(provider)}
            />
            <ProviderBadge provider={provider} />
          </label>
        ))}
      </div>
    </div>
  );
}

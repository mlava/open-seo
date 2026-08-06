import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { saveAiCitationTrackingSettings } from "@/serverFunctions/ai-citation-tracking";
import type { CitationProvider } from "@/shared/ai-citation-providers";
import { ProviderBadge } from "./citationParts";

export function TrackerSettingsPanel({
  projectId,
  configuredProviders,
  initialAliases,
  initialProviders,
  initialScheduleEnabled,
  onSaved,
}: {
  projectId: string;
  configuredProviders: CitationProvider[];
  initialAliases: string[];
  initialProviders: CitationProvider[];
  initialScheduleEnabled: boolean;
  onSaved: () => void;
}) {
  const [aliases, setAliases] = React.useState(initialAliases.join(", "));
  const [providers, setProviders] =
    React.useState<CitationProvider[]>(initialProviders);
  const [scheduleEnabled, setScheduleEnabled] = React.useState(
    initialScheduleEnabled,
  );

  const save = useMutation({
    mutationFn: () =>
      saveAiCitationTrackingSettings({
        data: {
          projectId,
          aliases: aliases
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          providers,
          scheduleEnabled,
        },
      }),
    onSuccess: () => {
      toast.success("Tracker settings saved");
      onSaved();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const toggleProvider = (provider: CitationProvider) =>
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider],
    );

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <h2 className="font-semibold">Tracker settings</h2>
      <p className="mt-1 text-sm text-base-content/65">
        Enter the domains you want to count as your own, without paths — for
        example <code>example.com</code>. A prompt counts as a mention when your
        brand name appears in the answer prose.
      </p>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="block">
          <span className="label-text text-sm">Tracked domains</span>
          <input
            className="input input-bordered mt-1 w-full"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            placeholder="example.com, docs.example.com"
          />
        </label>

        <div>
          <span className="label-text text-sm">
            Providers to ask by default
          </span>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {configuredProviders.map((provider) => (
              <label
                key={provider}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={providers.includes(provider)}
                  onChange={() => toggleProvider(provider)}
                />
                <ProviderBadge provider={provider} />
              </label>
            ))}
            {configuredProviders.length === 0 ? (
              <p className="text-sm text-base-content/60">
                No provider keys configured yet.
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-base-content/50">
            Each run asks every enabled prompt against every provider selected
            here, so cost scales with prompts × providers.
          </p>
        </div>

        <label className="label w-fit cursor-pointer gap-3">
          <span className="label-text">Run weekly</span>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={scheduleEnabled}
            onChange={(event) => setScheduleEnabled(event.target.checked)}
          />
        </label>

        <button className="btn btn-sm" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </section>
  );
}

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  listBingSitesForApiKey,
  setBingSiteWithApiKey,
} from "@/serverFunctions/bing";

type SiteOption = {
  siteUrl: string;
  isVerified: boolean;
  selectable: boolean;
};

/**
 * Connect Bing with the account-wide API key from Bing Webmaster Tools →
 * Settings → API Access, as an alternative to OAuth.
 *
 * Two steps on purpose: the key is used to list sites first, so a wrong key
 * fails before anything is stored, and the user picks the site the same way
 * the OAuth picker works. The key is only persisted by the second step, and is
 * encrypted server-side before it reaches the database.
 */
export function BingApiKeyPanel({
  projectId,
  onConnected,
  onCancel,
}: {
  projectId: string;
  onConnected: () => void;
  onCancel: () => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [sites, setSites] = React.useState<SiteOption[] | null>(null);
  const [siteUrl, setSiteUrl] = React.useState("");

  const listMutation = useMutation({
    mutationFn: (key: string) =>
      listBingSitesForApiKey({ data: { projectId, apiKey: key } }),
    onSuccess: (result) => {
      setSites(result.sites);
      const firstSelectable = result.sites.find((site) => site.selectable);
      setSiteUrl(firstSelectable?.siteUrl ?? "");
      if (result.sites.length === 0) {
        toast.error("That key works, but the Bing account has no sites.");
      }
    },
    // Bing has no "validate key" endpoint, so a bad key only shows up here.
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      setBingSiteWithApiKey({ data: { projectId, apiKey, siteUrl } }),
    onSuccess: () => {
      toast.success("Bing Webmaster connected");
      setApiKey("");
      onConnected();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const trimmedKey = apiKey.trim();

  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/70">
        Paste the API key from Bing Webmaster Tools → Settings → API Access. It
        covers the whole Bing account, and is stored encrypted.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-base-content/80">
          API key
        </span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="input input-bordered w-full max-w-md font-mono text-sm"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            // A changed key invalidates the site list it produced.
            setSites(null);
            setSiteUrl("");
          }}
          placeholder="Bing Webmaster API key"
        />
      </label>

      {sites ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-base-content/80">
            Site
          </span>
          <select
            className="select select-bordered w-full max-w-md"
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
          >
            <option value="" disabled>
              Select a site…
            </option>
            {sites.map((site) => (
              <option
                key={site.siteUrl}
                value={site.siteUrl}
                disabled={!site.selectable}
              >
                {site.siteUrl}
                {site.selectable ? "" : "  (not verified)"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {sites ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => saveMutation.mutate()}
            disabled={!siteUrl || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save site"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => listMutation.mutate(trimmedKey)}
            disabled={trimmedKey.length < 8 || listMutation.isPending}
          >
            {listMutation.isPending ? "Checking…" : "Check key"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

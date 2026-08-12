import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@/lib/auth";
import { AppError } from "@/server/lib/errors";

/**
 * At-rest protection for Bing's account-wide API key.
 *
 * Same key and helper that protect the OAuth tokens in `account`
 * (`BETTER_AUTH_SECRET` via `ctx.secretConfig`), so a deployment that can read
 * one can read the other and there is no second secret to rotate. Unlike the
 * token columns this is NOT gated on `account.encryptOAuthTokens`: that flag
 * is about Better Auth's own table, and a Bing API key grants full account
 * access without expiring, so it is always encrypted.
 */

/** Same value selfHostedOAuth passes to symmetricEncrypt — better-auth widens
 *  it beyond `string`, so the type is inferred rather than narrowed here. */
async function getKey() {
  const ctx = await getAuth().$context;
  return ctx.secretConfig;
}

export async function encryptBingApiKey(apiKey: string): Promise<string> {
  return symmetricEncrypt({ key: await getKey(), data: apiKey });
}

/**
 * Throws rather than returning null: a connection row marked `api_key` whose
 * key will not decrypt is a broken connection, and calling Bing without a
 * credential would surface as a confusing auth error instead of the real one
 * (usually BETTER_AUTH_SECRET having changed since the key was saved).
 */
export async function decryptBingApiKey(stored: string): Promise<string> {
  try {
    return await symmetricDecrypt({ key: await getKey(), data: stored });
  } catch {
    // Never rethrow the original: a crypto error can carry fragments of the
    // ciphertext, and this one runs on every API-key-mode call.
    throw new AppError(
      "CONFLICT",
      "This project's stored Bing API key could not be read. Re-enter it to reconnect.",
    );
  }
}

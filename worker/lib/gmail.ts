// Google's sign-in and the part of the Gmail API that "Zoek bijlage" uses: read only, nothing is ever sent, moved or
// changed in the mailbox. The client secret and the refresh token stay on the Worker. A failure is named by a fixed
// code, never by what Google said.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 15_000;

/**
 * `expired`: Google no longer accepts the link (revoked, or unused too long); `forbidden`: Google refuses the call, as when
 * the Gmail API is not switched on in Google Cloud; `failed`: anything else.
 */
export type GmailFailure = "expired" | "forbidden" | "failed";

export class GmailError extends Error {
  constructor(public failure: GmailFailure) {
    super(`gmail_${failure}`);
  }
}

export type GmailKeys = { clientId: string; clientSecret: string };

/** The page at Google where the penningmeester allows read-only access; `offline` and `consent` so a refresh token comes back. */
export function authUrl(keys: GmailKeys, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: keys.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GmailError("failed");
  }
}

async function token(keys: GmailKeys, form: Record<string, string>): Promise<{ accessToken: string; refreshToken: string | null }> {
  const response = await call(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: keys.clientId, client_secret: keys.clientSecret, ...form }),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; error?: unknown } | null;
  if (response.status === 400 && body?.error === "invalid_grant") throw new GmailError("expired");
  if (!response.ok || typeof body?.access_token !== "string") throw new GmailError("failed");
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null };
}

/** The code Google sent the browser back with, for an access token and the refresh token kept on the Worker. */
export const exchangeCode = (keys: GmailKeys, code: string, redirectUri: string) =>
  token(keys, { grant_type: "authorization_code", code, redirect_uri: redirectUri });

/** A fresh access token, good for about an hour; only ever kept for the one request. */
export const accessToken = async (keys: GmailKeys, refreshToken: string): Promise<string> =>
  (await token(keys, { grant_type: "refresh_token", refresh_token: refreshToken })).accessToken;

/** Tells Google the link is ended. Best effort: unlinking on the Worker happens whatever Google answers. */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await call(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }) });
  } catch {
    // Nothing to do: the token is gone from the Worker either way.
  }
}

async function get<T>(access: string, path: string): Promise<T> {
  const response = await call(`${API}${path}`, { headers: { Authorization: `Bearer ${access}` } });
  if (response.status === 401) throw new GmailError("expired");
  if (response.status === 403) throw new GmailError("forbidden");
  if (!response.ok) throw new GmailError("failed");
  return (await response.json()) as T;
}

/** The address of the linked mailbox, to show in beheer. */
export async function profileEmail(access: string): Promise<string> {
  const profile = await get<{ emailAddress?: unknown }>(access, "/profile");
  if (typeof profile.emailAddress !== "string") throw new GmailError("failed");
  return profile.emailAddress;
}

export type GmailPart = {
  partId?: string;
  filename?: string;
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; snippet?: string; internalDate?: string; payload?: GmailPart };

/** Only what is read of a message: its headers, snippet, date and the tree of parts, never the bodies themselves. */
const PART = "partId,filename,mimeType,body(attachmentId,size)";
const MESSAGE_FIELDS = `id,snippet,internalDate,payload(headers,${PART},parts(${PART},parts(${PART},parts(${PART}))))`;

/** The ids of the messages a Gmail search finds, newest first, at most `max`. */
export async function searchMessages(access: string, q: string, max: number): Promise<string[]> {
  const page = await get<{ messages?: { id: string }[] }>(access, `/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
  return (page.messages ?? []).map((message) => message.id);
}

export const getMessage = (access: string, id: string): Promise<GmailMessage> =>
  get<GmailMessage>(access, `/messages/${encodeURIComponent(id)}?${new URLSearchParams({ format: "full", fields: MESSAGE_FIELDS })}`);

// The runtime's own decoder: a scanned invoice of some MB decoded character by character in JavaScript would cost more
// CPU than the free plan gives one request. TypeScript's library does not know it yet, hence the cast.
const decoder = Uint8Array as unknown as { fromBase64(text: string, options: { alphabet: "base64url" }): Uint8Array };

/** The bytes of one file of a message. Gmail gives a new attachment id each time a message is read: use the latest. */
export async function getAttachment(access: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const body = await get<{ data?: unknown }>(access, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (typeof body.data !== "string") throw new GmailError("failed");
  return decoder.fromBase64(body.data, { alphabet: "base64url" });
}

/** The parts of a message that are a file with a name, at any depth. */
export function filesOf(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  const own = part.filename && part.body?.attachmentId ? [part] : [];
  return [...own, ...(part.parts ?? []).flatMap(filesOf)];
}

export function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((one) => one.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

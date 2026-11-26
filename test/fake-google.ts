// A Google that lives in memory: the token endpoint and the part of the Gmail API that "Zoek bijlage" uses, answering
// the way Google's references describe them. The Worker tests reach it through a stubbed `fetch`. No Vitest or Node imports.
// Like the real Gmail, it hands out a new attachment id each time a message is read, so a file is found again by its part.

export type FakeFile = { partId: string; filename: string; mimeType: string; data: Uint8Array };
export type FakeMessage = { id: string; from: string; subject: string; date: string; snippet: string; files: FakeFile[] };

export type FakeGoogle = {
  handle(request: Request): Promise<Response>;
  /** Every request so far: host, path, query, the form of a token call (never a secret's value) and the bearer token. */
  requests: { method: string; host: string; path: string; query: Record<string, string>; grant: string | null; bearer: string | null }[];
  /** The mailbox. A search answers every message, newest first, unless `find` says otherwise. */
  messages: FakeMessage[];
  /** Which message ids a search for `q` finds; the default finds every message. */
  find: (q: string) => string[];
  email: string;
  /** From now on the refresh token is refused (invalid_grant), as after a revoke or a long time unused. */
  expire(): void;
  /** Tokens revoked so far. */
  revoked: string[];
};

export const FAKE_GOOGLE_CLIENT_ID = "client-id-fake.apps.googleusercontent.com";
export const FAKE_GOOGLE_CLIENT_SECRET = "client-secret-fake";
export const FAKE_REFRESH_TOKEN = "refresh-token-fake";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createFakeGoogle(): FakeGoogle {
  let expired = false;
  let nextAttachment = 0;
  // attachment id → message and part, for every id handed out so far.
  const handedOut = new Map<string, { messageId: string; partId: string }>();
  const fake: FakeGoogle = {
    requests: [],
    messages: [],
    find: (_q) => fake.messages.map((message) => message.id),
    email: "speeltuin@gmail.com",
    revoked: [],
    expire: () => {
      expired = true;
    },
    async handle(request) {
      const url = new URL(request.url);
      const form = request.method === "POST" ? new URLSearchParams(await request.text()) : null;
      const bearer = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
      fake.requests.push({ method: request.method, host: url.host, path: url.pathname, query: Object.fromEntries(url.searchParams), grant: form?.get("grant_type") ?? null, bearer });

      if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") {
        fake.revoked.push(form?.get("token") ?? "");
        return new Response("", { status: 200 });
      }
      if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
        if (form?.get("client_id") !== FAKE_GOOGLE_CLIENT_ID || form?.get("client_secret") !== FAKE_GOOGLE_CLIENT_SECRET) return json({ error: "invalid_client" }, 401);
        if (form.get("grant_type") === "authorization_code") {
          if (form.get("code") !== "code-1" || !form.get("redirect_uri")) return json({ error: "invalid_grant" }, 400);
          return json({ access_token: "access-1", refresh_token: FAKE_REFRESH_TOKEN, expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.readonly" });
        }
        if (form.get("grant_type") === "refresh_token") {
          if (expired || form.get("refresh_token") !== FAKE_REFRESH_TOKEN) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
          return json({ access_token: "access-2", expires_in: 3599, token_type: "Bearer" });
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }
      if (url.host !== "gmail.googleapis.com") throw new Error(`fake Google: unexpected host ${url.host}`);
      if (!bearer?.startsWith("access-")) return json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401);

      const path = url.pathname.replace("/gmail/v1/users/me", "");
      if (path === "/profile") return json({ emailAddress: fake.email, messagesTotal: fake.messages.length });
      if (path === "/messages") {
        const max = Number(url.searchParams.get("maxResults") ?? 100);
        const ids = fake.find(url.searchParams.get("q") ?? "").slice(0, max);
        return json(ids.length === 0 ? { resultSizeEstimate: 0 } : { messages: ids.map((id) => ({ id, threadId: id })), resultSizeEstimate: ids.length });
      }
      const attachment = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
      if (attachment) {
        const where = handedOut.get(decodeURIComponent(attachment[2]!));
        const file = fake.messages.find((m) => m.id === where?.messageId)?.files.find((f) => f.partId === where?.partId);
        if (!where || where.messageId !== decodeURIComponent(attachment[1]!) || !file) return json({ error: { code: 404 } }, 404);
        return json({ size: file.data.byteLength, data: toBase64Url(file.data) });
      }
      const one = /^\/messages\/([^/]+)$/.exec(path);
      if (one) {
        const message = fake.messages.find((m) => m.id === decodeURIComponent(one[1]!));
        if (!message) return json({ error: { code: 404 } }, 404);
        const parts = message.files.map((file) => {
          const attachmentId = `att-${++nextAttachment}`;
          handedOut.set(attachmentId, { messageId: message.id, partId: file.partId });
          return { partId: file.partId, mimeType: file.mimeType, filename: file.filename, body: { attachmentId, size: file.data.byteLength } };
        });
        return json({
          id: message.id,
          snippet: message.snippet,
          internalDate: String(Date.parse(message.date)),
          payload: {
            partId: "",
            mimeType: "multipart/mixed",
            filename: "",
            headers: [
              { name: "From", value: message.from },
              { name: "Subject", value: message.subject },
              { name: "Date", value: new Date(message.date).toUTCString() },
            ],
            body: { size: 0 },
            parts: [{ partId: "0", mimeType: "multipart/alternative", filename: "", body: { size: 0 }, parts: [{ partId: "0.0", mimeType: "text/plain", filename: "", body: { size: 40 } }] }, ...parts],
          },
        });
      }
      return json({ error: { code: 404 } }, 404);
    },
  };
  return fake;
}

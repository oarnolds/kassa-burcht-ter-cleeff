import { isLocalHost } from "../../shared/local-host";

/**
 * The https address of a page that was opened over plain http, or null when it is fine where it is.
 * Cloudflare serves the app over both; over http the pairing code and the kassa's token would travel readable.
 */
export function secureAddress(href: string): string | null {
  const url = new URL(href);
  if (url.protocol !== "http:" || isLocalHost(url.hostname)) return null;
  url.protocol = "https:";
  return url.href;
}

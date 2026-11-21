import { createServer } from "node:http";
import { createFakeMollie } from "../test/fake-mollie";

const PORT = 4174;

/**
 * Plays Mollie for the length of the end-to-end run: the kassa's server is pointed at this address by
 * .dev.vars.e2e, so no test ever reaches the real Mollie. Returns the function that stops it.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const origin = `http://localhost:${PORT}`;
  const fake = createFakeMollie({ key: "test_e2e", origin });

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const method = req.method ?? "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
      const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
      fake
        .handle(new Request(`${origin}${req.url ?? "/"}`, { method, headers, body }))
        .then(async (answer) => {
          res.writeHead(answer.status, Object.fromEntries(answer.headers));
          res.end(Buffer.from(await answer.arrayBuffer()));
        })
        // The fake playing a Mollie that does not answer: the connection just ends.
        .catch(() => res.destroy());
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, resolve);
  });
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

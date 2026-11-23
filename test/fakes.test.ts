import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { enableBankingFor } from "../worker/lib/enable-banking";
import { mollieFor } from "../worker/lib/mollie";
import { TEST_EB_APP_ID, testRsaKey, useFakeBoth } from "./helpers";

const fakes = useFakeBoth();

it("sends each request to the fake of its own host", async () => {
  const { pem } = await testRsaKey();
  const eb = enableBankingFor({ ...env, ENABLE_BANKING_APP_ID: TEST_EB_APP_ID, ENABLE_BANKING_PRIVATE_KEY: pem })!;
  expect((await eb.maxConsentDays()).ok).toBe(true);
  expect((await mollieFor({ ...env, MOLLIE_API_KEY: "test_fake" })!.listTerminals()).ok).toBe(true);
  expect(fakes.eb.current.requests).toHaveLength(1);
  expect(fakes.mollie.current.requests).toHaveLength(1);
});

it("fails loudly on any other host", async () => {
  await expect(fetch("https://example.com/")).rejects.toThrow(/example\.com/);
});

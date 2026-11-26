import { configure, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { calls, mockApi, mockLoggedIn, renderAt } from "../../test-utils";
import { base } from "./ledger-test-data";

const callback = `${base}/gmail/callback`;
const posts = () => calls("POST").filter((c) => c.url === callback);

beforeEach(() => {
  configure({ reactStrictMode: true });
  mockLoggedIn();
});
afterEach(() => configure({ reactStrictMode: false }));

it("finishes the Gmail link once, also when the page is opened again", async () => {
  mockApi({ [`POST ${callback}`]: { status: "active", email: "speeltuin@gmail.com" } });
  const first = renderAt("/beheer/gmail?code=abc&state=xyz");
  expect(await screen.findByText("Gmail is gekoppeld met speeltuin@gmail.com.")).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
  expect(posts()[0]!.body).toEqual({ code: "abc", state: "xyz" });
  expect(screen.getByRole("link", { name: "Naar Instellingen" })).toHaveAttribute("href", "/beheer/boekhouding/instellingen");
  first.unmount();

  renderAt("/beheer/gmail");
  expect(await screen.findByText("Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen.")).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
});

it("says so when Google gave no permission", async () => {
  mockApi({});
  renderAt("/beheer/gmail?error=access_denied&state=xyz");
  expect(await screen.findByText("Google gaf geen toestemming.")).toBeInTheDocument();
  expect(posts()).toHaveLength(0);
});

it("says so when the state is spent or stale", async () => {
  mockApi({ [`POST ${callback}`]: [409, { error: "state_invalid" }] });
  renderAt("/beheer/gmail?code=abc&state=old");
  expect(await screen.findByText("Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen.")).toBeInTheDocument();
});

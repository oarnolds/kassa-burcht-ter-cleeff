import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import "./test-utils";
import { App } from "./App";

it("opens on the pairing page on an iPad that is not paired yet", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Kassa koppelen" })).toBeInTheDocument();
});

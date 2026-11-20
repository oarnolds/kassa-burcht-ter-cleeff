import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { OpenOrder } from "../../shared/types";
import { render, tap } from "../test-utils";
import { DeliveryBar } from "./DeliveryBar";

const order: OpenOrder = {
  id: "o1",
  createdAt: "2026-07-30T08:00:00.000Z",
  note: null,
  lines: [{ productId: "a", name: "Aardbeitje", boxes: 2, looseUnits: 0, units: 48 }],
};
const second: OpenOrder = {
  id: "o2",
  createdAt: "2026-07-31T08:00:00.000Z",
  note: "Komt vrijdag",
  lines: [{ productId: "b", name: "Bosfruit", boxes: 0, looseUnits: 6, units: 6 }],
};

it("is absent without open orders", () => {
  const { container } = render(<DeliveryBar orders={[]} online onReceive={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

it("confirms a delivery once (Review Focus 4)", async () => {
  const onReceive = vi.fn().mockResolvedValue("ok");
  render(<DeliveryBar orders={[order]} online onReceive={onReceive} />);
  await tap("Levering onderweg");
  expect(screen.getByRole("dialog", { name: "Levering onderweg" })).toBeInTheDocument();
  expect(screen.getByText("2 dozen Aardbeitje (48 stuks)")).toBeInTheDocument();
  await userEvent.dblClick(screen.getByRole("button", { name: "Ontvangen" }));
  expect(onReceive).toHaveBeenCalledTimes(1);
  expect(onReceive).toHaveBeenCalledWith("o1");
  expect(await screen.findByText("Levering ontvangen, voorraad bijgewerkt")).toBeInTheDocument();
  // The bar is gone at once; it does not wait for the next catalog.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Levering onderweg" })).not.toBeInTheDocument());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("waits for a connection", async () => {
  const onReceive = vi.fn();
  render(<DeliveryBar orders={[order]} online={false} onReceive={onReceive} />);
  await tap("Levering onderweg");
  expect(screen.getByText("Bevestigen kan pas als er weer internet is.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ontvangen" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Ontvangen" }));
  expect(onReceive).not.toHaveBeenCalled();
});

it("lets the beheerder try again after an error", async () => {
  const onReceive = vi.fn().mockResolvedValueOnce("error").mockResolvedValueOnce("ok");
  render(<DeliveryBar orders={[order]} online onReceive={onReceive} />);
  await tap("Levering onderweg");
  await tap("Ontvangen");
  expect(await screen.findByText("Dat lukte niet. Probeer het nog eens.")).toBeInTheDocument();
  await tap("Ontvangen");
  expect(onReceive).toHaveBeenCalledTimes(2);
  expect(await screen.findByText("Levering ontvangen, voorraad bijgewerkt")).toBeInTheDocument();
});

it("says so when the connection drops at the moment of confirming", async () => {
  const onReceive = vi.fn().mockResolvedValue("offline");
  render(<DeliveryBar orders={[order]} online onReceive={onReceive} />);
  await tap("Levering onderweg");
  await tap("Ontvangen");
  expect(await screen.findByText("Bevestigen kan pas als er weer internet is.")).toBeInTheDocument();
  expect(screen.queryByText("Levering ontvangen, voorraad bijgewerkt")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Levering onderweg" })).toBeInTheDocument();
});

it("counts the deliveries when there is more than one, and confirms each on its own", async () => {
  const onReceive = vi.fn().mockResolvedValue("ok");
  render(<DeliveryBar orders={[order, second]} online onReceive={onReceive} />);
  await tap("Levering onderweg (2)");
  expect(screen.getByText("2 dozen Aardbeitje (48 stuks)")).toBeInTheDocument();
  expect(screen.getByText("6 los Bosfruit (6 stuks)")).toBeInTheDocument();
  expect(screen.getByText("Komt vrijdag")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Ontvangen" })[1]!);
  expect(onReceive).toHaveBeenCalledWith("o2");
  expect(await screen.findByRole("button", { name: "Levering onderweg" })).toBeInTheDocument();
  expect(screen.queryByText("6 los Bosfruit (6 stuks)")).not.toBeInTheDocument();
});

it("closes without confirming", async () => {
  const onReceive = vi.fn();
  render(<DeliveryBar orders={[order]} online onReceive={onReceive} />);
  await tap("Levering onderweg");
  await tap("Sluiten");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onReceive).not.toHaveBeenCalled();
});

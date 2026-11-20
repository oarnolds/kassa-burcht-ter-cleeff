import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { expect, it, vi } from "vitest";
import { adminApi } from "../lib/api";
import { calls, catalog, mockApi, mockLoggedIn, mockOffline, render, renderAt, rowIn, tap } from "../test-utils";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { EuroInput } from "./EuroInput";
import { Logo } from "./Logo";
import { colorLabels, tileColors } from "./palette";
import { useToast } from "./Toast";

function ToastOnMount({ onClick, ms }: { onClick: () => void; ms?: number }) {
  const toast = useToast();
  useEffect(() => {
    toast.show("Bon gewist", { action: { label: "Ongedaan maken", onClick }, ms });
  }, [toast, onClick, ms]);
  return null;
}

it("EuroInput reports cents, or null while the text is not an amount", async () => {
  const onChange = vi.fn();
  render(<EuroInput valueCents={null} onChange={onChange} aria-label="Bedrag" />);
  const input = screen.getByLabelText("Bedrag");
  expect(input).toHaveAttribute("inputmode", "decimal");
  await userEvent.type(input, "4,5");
  expect(onChange).toHaveBeenLastCalledWith(450);
  await userEvent.type(input, "x");
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it("EuroInput shows the amount it is given and follows it when it changes", () => {
  const { rerender } = render(<EuroInput valueCents={1250} onChange={() => {}} aria-label="Bedrag" />);
  expect(screen.getByLabelText("Bedrag")).toHaveValue("12,50");
  rerender(<EuroInput valueCents={null} onChange={() => {}} aria-label="Bedrag" />);
  expect(screen.getByLabelText("Bedrag")).toHaveValue("");
});

it("Dialog closes on Escape unless it is not dismissable", async () => {
  const onClose = vi.fn();
  const { rerender } = render(
    <Dialog open title="Test" onClose={onClose}>
      x
    </Dialog>,
  );
  expect(screen.getByRole("dialog", { name: "Test" })).toHaveAttribute("aria-modal", "true");
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
  rerender(
    <Dialog open title="Test" onClose={onClose} dismissable={false}>
      x
    </Dialog>,
  );
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Dialog closes on a click beside it, not on a click inside it", async () => {
  const onClose = vi.fn();
  render(
    <Dialog open title="Test" onClose={onClose}>
      <p>inhoud</p>
    </Dialog>,
  );
  await userEvent.click(screen.getByText("inhoud"));
  expect(onClose).not.toHaveBeenCalled();
  await userEvent.click(screen.getByTestId("dialog-backdrop"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Dialog shows nothing while it is closed", () => {
  render(
    <Dialog open={false} title="Test" onClose={() => {}}>
      x
    </Dialog>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("a toast with an action disappears after its time", () => {
  vi.useFakeTimers();
  render(<ToastOnMount onClick={() => {}} />);
  expect(screen.getByText("Bon gewist")).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(screen.getByText("Bon gewist")).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByText("Bon gewist")).not.toBeInTheDocument();
});

it("a toast's action runs once and takes the toast away", async () => {
  const onClick = vi.fn();
  render(<ToastOnMount onClick={onClick} />);
  await tap("Ongedaan maken");
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Bon gewist")).not.toBeInTheDocument();
});

it("Button does not submit a form unless asked to", () => {
  render(
    <>
      <Button>Gewoon</Button>
      <Button type="submit" variant="danger" size="lg">
        Verstuur
      </Button>
    </>,
  );
  expect(screen.getByRole("button", { name: "Gewoon" })).toHaveAttribute("type", "button");
  expect(screen.getByRole("button", { name: "Verstuur" })).toHaveAttribute("type", "submit");
});

it("Logo carries the name of the speeltuin", () => {
  render(<Logo />);
  expect(screen.getByText("BURCHT TER CLEEFF")).toBeInTheDocument();
});

it("has a tile colour and a Dutch name for every colour key", () => {
  expect(tileColors).toEqual({
    rose: { bg: "#F6DDE2", border: "#E3A9B5", text: "#6E1F33" },
    blue: { bg: "#DCE7EE", border: "#A9C3D4", text: "#1F4257" },
    brown: { bg: "#EADBCB", border: "#CFAE8C", text: "#5A3113" },
    yellow: { bg: "#F5E7BF", border: "#E0C36A", text: "#5E4500" },
    green: { bg: "#E1EACB", border: "#B5C98A", text: "#3F5512" },
    grey: { bg: "#E0E1DA", border: "#BFC1B6", text: "#3A3B36" },
  });
  expect(colorLabels).toEqual({ rose: "Roze", blue: "Blauw", brown: "Bruin", yellow: "Geel", green: "Groen", grey: "Grijs" });
});

it.each([
  "/",
  "/koppelen",
  "/beheer",
  "/beheer/login",
  "/beheer/instellen",
  "/beheer/rapporten",
  "/beheer/verkopen",
  "/beheer/kluisje",
  "/beheer/voorraad",
  "/beheer/producten",
  "/beheer/instellingen",
])("has a page at %s", (path) => {
  mockLoggedIn();
  renderAt(path);
  expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
});

it("mockApi answers by path, with a method key winning, and records the calls", async () => {
  mockApi({
    "/api/admin/me": { authenticated: true },
    "POST /api/admin/me": [409, { error: "nope" }],
    "/api/admin/echo": (req: { method: string; url: string; body: { n: number } }) => ({ twice: req.body.n * 2 }),
  });
  expect(await adminApi("/api/admin/me?x=1")).toEqual({ ok: true, data: { authenticated: true } });
  expect(await adminApi("/api/admin/me", { method: "POST" })).toEqual({ ok: false, status: 409, error: "nope" });
  expect(await adminApi("/api/admin/echo", { method: "PUT", json: { n: 4 } })).toEqual({ ok: true, data: { twice: 8 } });
  expect(await adminApi("/api/admin/elders")).toEqual({ ok: false, status: 404, error: "not_found" });
  mockApi({ "/api/admin/elders": { ok: true } });
  expect(await adminApi("/api/admin/elders")).toEqual({ ok: true, data: { ok: true } });
  expect(calls()).toHaveLength(5);
  expect(calls("PUT")).toEqual([{ method: "PUT", url: "/api/admin/echo", body: { n: 4 } }]);
  expect(calls()[0]).toEqual({ method: "GET", url: "/api/admin/me?x=1", body: null });
});

it("mockOffline makes every request fail like a dropped connection", async () => {
  mockOffline();
  expect(await adminApi("/api/admin/me")).toEqual({ ok: false, status: 0, error: "offline" });
});

it("rowIn finds a table row inside a named section", () => {
  render(
    <section aria-label="IJs">
      <table>
        <tbody>
          <tr>
            <td>Aardbeitje</td>
            <td>
              <button>Bewerken</button>
            </td>
          </tr>
          <tr>
            <td>Bosfruit</td>
            <td>geen knop</td>
          </tr>
        </tbody>
      </table>
    </section>,
  );
  expect(rowIn("IJs", "Aardbeitje").getByRole("button", { name: "Bewerken" })).toBeInTheDocument();
  expect(rowIn("IJs", "Bosfruit").queryByRole("button")).not.toBeInTheDocument();
});

it("the catalog fixture has the three products the screen tests use", () => {
  expect(catalog.products.map((p) => [p.name, p.priceCents, p.categoryId])).toEqual([
    ["Aardbeitje", 110, "ijs"],
    ["Koffie", 140, "warm"],
    ["Statiegeld", 15, "statiegeld"],
  ]);
  expect(catalog.products[0]).toMatchObject({ trackStock: true, stock: 20, reorderAt: null });
  expect(catalog.products[2]).toMatchObject({ quantityPad: true });
  expect(catalog.categories.map((c) => c.color)).toEqual(["rose", "brown", "grey"]);
  expect(catalog.openOrders).toEqual([]);
});

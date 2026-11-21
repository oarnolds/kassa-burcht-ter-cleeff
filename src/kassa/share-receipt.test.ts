import { afterEach, expect, it, vi } from "vitest";
import { prepareReceiptShare, receiptRows, type FinishedSale } from "./share-receipt";

const NBSP = String.fromCharCode(160);
const euro = (text: string) => text.replace(" ", NBSP);

const sale = (over: Partial<FinishedSale> = {}): FinishedSale => ({
  id: "39577a58-0000-4000-8000-000000000000",
  // 11:27 UTC is 12:27 in Amsterdam in November.
  soldAt: "2026-11-21T11:27:20.547Z",
  lines: [
    { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 2 },
    { productId: "entree", name: "Entreegeld", unitPriceCents: 60, qty: 1 },
  ],
  totalCents: 340,
  method: "cash",
  cashGivenCents: 500,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("puts the day and time, the bon number, every line, the total and how it was paid on the receipt", () => {
  expect(receiptRows(sale())).toEqual({
    when: "21-11-2026 12:27",
    number: "Bon 39577a58",
    lines: [
      { label: "2 × Koffie", amount: euro("€ 2,80") },
      { label: "1 × Entreegeld", amount: euro("€ 0,60") },
    ],
    total: euro("€ 3,40"),
    paid: [
      { label: "Contant", amount: euro("€ 5,00") },
      { label: "Wisselgeld", amount: euro("€ 1,60") },
    ],
  });
});

it("says pin, without change, for a pin payment", () => {
  expect(receiptRows(sale({ method: "pin", cashGivenCents: null })).paid).toEqual([{ label: "Pin", amount: euro("€ 3,40") }]);
});

it("leaves the change out when the customer paid the exact amount", () => {
  expect(receiptRows(sale({ cashGivenCents: 340 })).paid).toEqual([{ label: "Contant", amount: euro("€ 3,40") }]);
});

it("offers nothing to share where the device cannot share a picture", async () => {
  // jsdom, like a desktop browser without the share sheet, has no navigator.share.
  expect(await prepareReceiptShare(sale())).toBeNull();
  vi.stubGlobal("navigator", { ...navigator, share: vi.fn(), canShare: () => false });
  expect(await prepareReceiptShare(sale(), async () => new Blob(["png"], { type: "image/png" }))).toBeNull();
});

it("hands the picture to the share sheet, where AirDrop is, at once when the beheerder taps", async () => {
  const share = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { ...navigator, share, canShare: () => true });
  const send = await prepareReceiptShare(sale(), async () => new Blob(["png"], { type: "image/png" }));
  expect(send).toBeTypeOf("function");
  send!();
  // Called straight from the tap: Safari opens the share sheet only from a tap, not after waiting for something.
  expect(share).toHaveBeenCalledTimes(1);
  const [{ files }] = share.mock.calls[0] as unknown as [{ files: File[] }];
  expect(files.map((file) => [file.name, file.type])).toEqual([["bon-39577a58.png", "image/png"]]);
});

it("stays quiet when the beheerder closes the share sheet without sending", async () => {
  const share = vi.fn(() => Promise.reject(new DOMException("closed", "AbortError")));
  vi.stubGlobal("navigator", { ...navigator, share, canShare: () => true });
  const send = await prepareReceiptShare(sale(), async () => new Blob(["png"], { type: "image/png" }));
  expect(() => send!()).not.toThrow();
  await Promise.resolve();
});

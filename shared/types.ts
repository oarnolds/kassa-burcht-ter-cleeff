// Shapes that travel between the Worker and the app.

export type ColorKey = "rose" | "blue" | "brown" | "yellow" | "green" | "grey";

export type Category = { id: string; name: string; color: ColorKey; sort: number };

export type CatalogProduct = {
  id: string;
  name: string;
  priceCents: number;
  categoryId: string;
  sort: number;
  quantityPad: boolean;
  trackStock: boolean;
  stock: number | null;
  reorderAt: number | null;
};

export type OpenOrder = {
  id: string;
  createdAt: string;
  note: string | null;
  lines: { productId: string; name: string; boxes: number; looseUnits: number; units: number }[];
};

export type Catalog = { fetchedAt: string; categories: Category[]; products: CatalogProduct[]; openOrders: OpenOrder[]; pin: PinState };

export type RejectReason =
  | "invalid"
  | "total_mismatch"
  | "unknown_product"
  | "original_not_found"
  | "not_cash"
  | "already_reversed"
  | "too_late"
  | "other_device";

export type ItemResult = { id: string; status: "accepted" | "duplicate" | "rejected"; reason?: RejectReason };

export type Totals = { cashCents: number; pinCents: number; totalCents: number; saleCount: number };

export type CategoryRow = {
  categoryId: string;
  categoryName: string;
  qty: number;
  cashCents: number;
  pinCents: number;
  totalCents: number;
};

export type ProductRow = {
  productId: string;
  name: string;
  categoryName: string;
  qty: number;
  cashCents: number;
  pinCents: number;
  totalCents: number;
};

export type DayReport = { date: string; totals: Totals; byCategory: CategoryRow[]; byProduct: ProductRow[] };

export type MonthReport = {
  month: string;
  totals: Totals;
  days: ({ date: string } & Totals)[];
  byCategory: CategoryRow[];
  byProduct: ProductRow[];
};

/** A week from Monday to Sunday, as the kassa shows it. Only days with sales are listed. */
export type WeekReport = {
  first: string;
  last: string;
  totals: Totals;
  days: ({ date: string } & Totals)[];
  byCategory: CategoryRow[];
  byProduct: ProductRow[];
};

export type Summary = {
  today: { date: string } & Totals;
  month: { month: string } & Totals;
  cashExpectedCents: number;
  reorderCount: number;
  openOrderCount: number;
  pinAttention: PinAttention[];
};

/** Something about pin the penningmeester should look at, with the day to open. */
export type PinAttention = { kind: "pending" | "double"; date: string; totalCents: number };

export type Handover = {
  id: string;
  kind: "opening" | "handover";
  countedAt: string;
  expectedCents: number;
  receivedCents: number;
  leftCents: number;
  differenceCents: number;
  note: string | null;
  createdAt: string;
};

export type CashState = { expectedCents: number; handovers: Handover[] };

export type StockItem = {
  productId: string;
  name: string;
  categoryName: string;
  stock: number;
  unitsPerBox: number | null;
  reorderAt: number | null;
  belowReorder: boolean;
};

export type StockOrder = OpenOrder & {
  status: "open" | "received" | "cancelled";
  receivedAt: string | null;
  receivedBy: "device" | "admin" | null;
};

export type AdminProduct = Omit<CatalogProduct, "stock"> & { active: boolean; unitsPerBox: number | null };

export type AdminSale = {
  id: string;
  method: "cash" | "pin";
  totalCents: number;
  soldAt: string;
  soldAtLocal: string;
  businessDate: string;
  late: boolean;
  reversed: boolean;
  reversesSaleId: string | null;
  reversalReason: string | null;
  /** Cash was taken for a receipt whose pin payment went through after all; shown on both sales until one is reversed. */
  possiblyDouble: boolean;
  lines: { name: string; categoryName: string; unitPriceCents: number; qty: number }[];
};

/** A pin payment that did not go through (`outcome`), or is still waiting for Mollie (`outcome` null). */
export type AdminPinAttempt = {
  id: string;
  soldAt: string;
  soldAtLocal: string;
  totalCents: number;
  outcome: Exclude<PinOutcome, "paid"> | null;
  reason: string | null;
  lines: AdminSale["lines"];
};

/** The payments of one day: what beheer lists under Verkopen, and the kassa under Betalingen. */
export type KassaPayments = { sales: AdminSale[]; pinAttempts: AdminPinAttempt[] };

export type Device = { id: string; name: string; createdAt: string; lastSeenAt: string | null; revoked: boolean };

/** The weekly copies in the backup bucket, as beheer sees them. Not `available` while the bucket is not switched on. */
export type BackupState = { available: boolean; latest: { key: string; at: string; sizeBytes: number } | null; count: number };

/** Which Mollie key the kassa runs on: with a test key no money moves. */
export type PinMode = "test" | "live";

/** How a pin payment ended. `start_failed`: the terminal was never asked, or the kassa gave up asking. */
export type PinOutcome = "paid" | "declined" | "canceled" | "expired" | "start_failed";

/** Where a pin payment stands. `outcome` null: still running. `sent`: the terminal has been asked. `testUrl`: test mode only, Mollie's page to choose the ending. */
export type PinStatus = { id: string; outcome: PinOutcome | null; reason: string | null; sent: boolean; testUrl: string | null };

/** A payment terminal as Mollie lists it. */
export type PinTerminal = { id: string; description: string; status: string; brand: string | null; model: string | null; serialNumber: string | null };

/** What the kassa needs to know about pin: `mode` null means there is no Mollie key; `ready` means a terminal is chosen for this key. */
export type PinState = { mode: PinMode | null; ready: boolean };

/** Beheer's view of pin: the key's mode, the chosen terminal and Mollie's own list, or why that list is missing. */
export type PinSettings = {
  mode: PinMode | null;
  terminalId: string | null;
  terminals: PinTerminal[];
  problem: "no_key" | "unauthorized" | "unreachable" | null;
};

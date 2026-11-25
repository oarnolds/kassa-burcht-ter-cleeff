// A made-up auditfile (XML Auditfile Financieel 4.0) of 2026 as e-Boekhouden writes it, kept as a string because a
// .xaf file is git-ignored. Laid out like the real one: the header, the company with its customers and suppliers,
// the general ledger, VAT codes and periods, the opening balance and the transactions per journal. Every name,
// number, description and amount here is invented.

export type XafLineSpec = {
  account: string;
  /** As the file writes it: no, one or two decimals ("84", "123.4", "185938.91"). */
  amount: string;
  type: "D" | "C";
  /** Without one, the line takes the booking's description, as e-Boekhouden does. */
  desc?: string;
  custSupID?: string;
};
export type XafBooking = { journal: string; nr: string; date: string; desc: string; lines: XafLineSpec[] };

export const debit = (account: string, amount: string, desc?: string): XafLineSpec => ({ account, amount, type: "D", desc });
export const credit = (account: string, amount: string, desc?: string): XafLineSpec => ({ account, amount, type: "C", desc });
export const booking = (journal: string, nr: string, date: string, desc: string, ...lines: XafLineSpec[]): XafBooking => ({
  journal,
  nr,
  date,
  desc,
  lines,
});

const NAMESPACE = "http://www.odb.belastingdienst.nl/Belastingdienst/BCPP/1.1/structures/XmlauditfileXAF_4.0";

const LEDGER: { id: string; name: string }[] = [
  { id: "0130", name: "Speeltoestellen" },
  { id: "0135", name: "Afschrijving speeltoestellen" },
  { id: "0800", name: "Voorziening vervanging toestellen" },
  { id: "0801", name: "Voorziening groot onderhoud" },
  { id: "1000", name: "Kas" },
  { id: "1010", name: "Betaalrekening" },
  { id: "1011", name: "Kwartaalrekening" },
  { id: "1012", name: "Revolut" },
  { id: "1020", name: "Spaarrekening" },
  { id: "1021", name: "Deposito" },
  { id: "1080", name: "Kruisposten" },
  { id: "1300", name: "Debiteuren" },
  { id: "1400", name: "Eigen vermogen" },
  { id: "1590", name: "Overige vorderingen" },
  { id: "1700", name: "Crediteuren" },
  { id: "1890", name: "Overige schulden" },
  { id: "4304", name: "Terrein" },
  { id: "4305", name: "Buitenmeubilair" },
  { id: "4513", name: "Website" },
  { id: "4514", name: "Diversen" },
  { id: "8000", name: "Contributie" },
  { id: "8010", name: "Verhuur" },
  { id: "8011", name: "Kiosk" },
  { id: "8012", name: "Entree" },
  { id: "9998", name: "Tussenrekening" },
];

const JOURNALS: Record<string, { desc: string; type: string }> = {
  "1000": { desc: "Kas", type: "C" },
  "1010": { desc: "Betaalrekening", type: "B" },
  "1012": { desc: "Revolut", type: "B" },
  MEMO: { desc: "Memoriaal", type: "G" },
};

/**
 * Does not balance: debit 212.042,46 against credit 223.278,68 (signed sum -11.236,22). Zero lines on 0801, 1021 and
 * 9998; 1590 and 1890 join 1300 and 1700; 0800 goes to 0135.
 */
const OPENING: { account: string; amount: string; type: "D" | "C" }[] = [
  { account: "0130", amount: "185938.91", type: "D" },
  { account: "0135", amount: "71623.68", type: "C" },
  { account: "0800", amount: "1500", type: "C" },
  { account: "0801", amount: "0", type: "D" },
  { account: "1000", amount: "84", type: "D" },
  { account: "1010", amount: "12345.6", type: "D" },
  { account: "1011", amount: "2500", type: "D" },
  { account: "1020", amount: "10883.45", type: "D" },
  { account: "1021", amount: "0", type: "D" },
  { account: "1300", amount: "250", type: "D" },
  { account: "1590", amount: "40.5", type: "D" },
  { account: "1700", amount: "120", type: "C" },
  { account: "1890", amount: "35", type: "C" },
  { account: "1400", amount: "150000", type: "C" },
  { account: "9998", amount: "0", type: "C" },
];

/**
 * The bookings of 2026, numbered in date order. The file lists them per journal (1000, 1010, 1012, MEMO), so not in
 * date order. 10001 and 10002 merge two old accounts into one new one; 10005 and 10008 fall away; 10013 corrects with
 * negative amounts, as e-Boekhouden sometimes writes them (-9.99 D is a credit, -9.99 C a debit); 10014 is from the
 * overstap on. The payouts' descriptions have a letter glued to the reference, as e-Boekhouden writes ING's text.
 */
export const XAF_BOOKINGS: XafBooking[] = [
  booking("1010", "10001", "2026-01-20", "Energie december", credit("1010", "155"), debit("1700", "120"), debit("1890", "35", "Afrekening water")),
  booking(
    "1010",
    "10002",
    "2026-02-10",
    "Factuur 2025-031",
    debit("1010", "290.5"),
    { ...credit("1300", "250"), custSupID: "D0001" },
    credit("1590", "40.5"),
  ),
  booking("1010", "10003", "2026-03-14", "Kas gestort", debit("1010", "84"), credit("1000", "84")),
  booking("1010", "10004", "2026-04-10", "Picknickbank", debit("4305", "123.4"), credit("1010", "123.4")),
  booking("MEMO", "10005", "2026-05-20", "Voorziening naar afschrijving", debit("0800", "73.7"), credit("0135", "73.7")),
  booking(
    "1010",
    "10006",
    "2026-06-06",
    "Schoolreis De Klimop",
    debit("1010", "650"),
    credit("8010", "500", "Zaalhuur"),
    credit("8012", "150", "Entree groep"),
  ),
  booking("1010", "10007", "2026-07-01", "Naar Revolut", debit("1080", "110"), credit("1010", "110")),
  booking("1012", "10008", "2026-07-02", "Van ING", debit("1012", "110"), credit("1080", "110")),
  booking("1012", "10009", "2026-07-05", "Entree via Revolut", debit("1012", "4.2"), credit("8012", "4.2")),
  booking("1012", "10010", "2026-07-09", "Webhosting", debit("4513", "114.2"), credit("1012", "114.2")),
  booking("1010", "10011", "2026-11-02", "Mollie uitbetaling P05665564.2611.01  RF1", debit("1010", "412.35"), credit("8011", "412.35")),
  booking("1000", "10012", "2026-11-22", "Entree zaterdag", debit("1000", "37.5"), credit("8012", "37.5")),
  booking("MEMO", "10013", "2026-11-23", "Correctie website", debit("4513", "-9.99"), credit("4514", "-9.99", "Naar diversen")),
  booking("1010", "10014", "2026-11-25", "Mollie uitbetaling P05665564.2611.02  RF2", debit("1010", "98.5"), credit("8011", "98.5")),
];

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const el = (name: string, value: string | number) => `<${name}>${escape(String(value))}</${name}>`;

/** Signed by the amount's own minus only; the totals add the D and the C amounts each as written. */
const centsOf = (amount: string) => {
  const [whole, part = ""] = amount.replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return amount.startsWith("-") ? 0 - cents : cents;
};
/** As the file writes a total: without trailing zeros in the decimals. */
const amountText = (cents: number): string => {
  if (cents < 0) return `-${amountText(0 - cents)}`;
  const rest = String(cents % 100).padStart(2, "0").replace(/0+$/, "");
  return rest ? `${Math.floor(cents / 100)}.${rest}` : String(Math.floor(cents / 100));
};
const totals = (lines: { amount: string; type: "D" | "C" }[]) => {
  const sum = (type: "D" | "C") => lines.filter((l) => l.type === type).reduce((s, l) => s + centsOf(l.amount), 0);
  return el("linesCount", lines.length) + el("totalDebit", amountText(sum("D"))) + el("totalCredit", amountText(sum("C")));
};

const address = (street: string, city: string, postalCode: string) =>
  `<streetAddress>${el("streetname", street)}${el("city", city)}${el("postalCode", postalCode)}${el("country", "NL")}</streetAddress>`;

const CUSTOMERS_SUPPLIERS = [
  { id: "D0001", name: "Bakkerij De Krakeling", eMail: "info@example.org", type: "C", street: "Deegweg 3", city: "Voorbeeldstad", postalCode: "1234 AB" },
  { id: "D0002", name: "Jan Voorbeeld", eMail: "jan@example.org", type: "B", street: "Wipstraat 12", city: "Voorbeeldstad", postalCode: "1234 CD" },
]
  .map(
    (c) =>
      `<customerSupplier>${el("custSupID", c.id)}${el("custSupName", c.name)}${el("eMail", c.eMail)}${el("commerceNr", "00000000")}` +
      `${el("taxRegistrationCountry", "NL")}${el("taxRegIdent", "")}${el("custSupTp", c.type)}${address(c.street, c.city, c.postalCode)}</customerSupplier>`,
  )
  .join("");

const PERIODS = Array.from({ length: 12 }, (_, i) => {
  const month = String(i + 1).padStart(2, "0");
  const last = new Date(Date.UTC(2026, i + 1, 0)).getUTCDate();
  return `<period>${el("periodNumber", i + 1)}${el("startDatePeriod", `2026-${month}-01`)}${el("endDatePeriod", `2026-${month}-${last}`)}</period>`;
}).join("");

function transactionXml(b: XafBooking): string {
  const lines = b.lines
    .map(
      (l, i) =>
        `<trLine>${el("nr", `${b.nr}.1.${i + 1}`)}${el("accID", l.account)}${el("docRef", b.nr)}${el("effDate", b.date)}` +
        `${el("desc", l.desc ?? b.desc)}${el("amnt", l.amount)}${el("amntTp", l.type)}${l.custSupID ? el("custSupID", l.custSupID) : ""}</trLine>`,
    )
    .join("");
  return `<transaction>${el("nr", b.nr)}${el("desc", b.desc)}${el("periodNumber", Number(b.date.slice(5, 7)))}${el("trDt", b.date)}${lines}</transaction>`;
}

export type XafOptions = {
  fiscalYear?: number;
  /** Replaces the bookings above, e.g. to have exactly 41. */
  bookings?: XafBooking[];
  /** Added to the bookings, e.g. one on an unknown account or on 0130. */
  extraBookings?: XafBooking[];
  /** The opening amount of these accounts instead of the default one (same side), e.g. `{ "1011": "10883.45" }`. */
  opening?: Record<string, string>;
  /** Added to the general ledger, e.g. `{ id: "4999", name: "Onbekende kosten" }`. */
  extraAccounts?: { id: string; name: string }[];
  /** The day the file was made, instead of 2026-11-25. */
  createdOn?: string;
};

/**
 * The auditfile as text. Variants: `buildXaf({ extraAccounts: [{ id: "4999", name: … }], extraBookings: [booking(…,
 * debit("4999", "20"), credit("1010", "20"))] })` for an unknown account; a booking with a line on 0130; `bookings`
 * of 41 for a file that takes two requests; `fiscalYear: 2025` for another year.
 */
export function buildXaf(options: XafOptions = {}): string {
  const bookings = [...(options.bookings ?? XAF_BOOKINGS), ...(options.extraBookings ?? [])];
  const ledger = [...LEDGER, ...(options.extraAccounts ?? [])]
    .map((a) => `<ledgerAccount>${el("accID", a.id)}${el("accDesc", a.name)}${el("accTp", /^[0-3]/.test(a.id) ? "B" : "P")}</ledgerAccount>`)
    .join("");
  const openingLines = OPENING.map((l) => ({ ...l, amount: options.opening?.[l.account] ?? l.amount }));
  const opening = openingLines.map(
    (l, i) => `<obLine>${el("nr", String(i + 1).padStart(3, "0"))}${el("accID", l.account)}${el("amnt", l.amount)}${el("amntTp", l.type)}</obLine>`,
  ).join("");
  const journals = [...new Set(bookings.map((b) => b.journal))]
    .sort()
    .map((id) => {
      const journal = JOURNALS[id] ?? { desc: `Dagboek ${id}`, type: "G" };
      const transactions = bookings.filter((b) => b.journal === id).map(transactionXml).join("");
      return `<journal>${el("jrnID", id)}${el("desc", journal.desc)}${el("jrnTp", journal.type)}${transactions}</journal>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<auditfile xmlns="${NAMESPACE}">` +
    `<header>${el("fiscalYear", options.fiscalYear ?? 2026)}${el("startDate", "2026-01-01")}${el("endDate", "2026-12-31")}${el("curCode", "EUR")}` +
    `${el("dateCreated", options.createdOn ?? "2026-11-25")}${el("softwareDesc", "e-Boekhouden.nl")}${el("softwareVersion", "4.0")}</header>` +
    `<company>${el("Commercenr", "00000000")}${el("companyName", "Speeltuinvereniging De Zandbak")}${el("taxRegistrationCountry", "NL")}` +
    `${el("taxRegIdent", "")}${address("Schommelpad 1", "Voorbeeldstad", "1234 EF")}` +
    `<customersSuppliers>${CUSTOMERS_SUPPLIERS}</customersSuppliers>` +
    `<generalLedger>${ledger}</generalLedger>` +
    `<vatCodes><vatCode>${el("vatID", "0")}${el("vatDesc", "Geen btw")}</vatCode><vatCode>${el("vatID", "1")}${el("vatDesc", "Btw laag")}</vatCode></vatCodes>` +
    `<periods>${PERIODS}</periods>` +
    `<openingBalance>${totals(openingLines)}${opening}</openingBalance>` +
    `<transactions>${totals(bookings.flatMap((b) => b.lines))}${journals}</transactions>` +
    `</company></auditfile>`
  );
}

export const XAF_2026 = buildXaf();

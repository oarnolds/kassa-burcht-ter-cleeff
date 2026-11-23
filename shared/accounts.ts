import type { AccountKind, LedgerAccount } from "./ledger-types";

const account = (code: string, name: string, kind: AccountKind, formerly: string[] = [code], money = false): LedgerAccount => ({
  code,
  name,
  kind,
  money,
  hidden: false,
  formerly,
});

/**
 * The 44 accounts of spec §8, in its order. The numbers stay those of e-Boekhouden; `formerly` lists the old
 * numbers each account takes over (its own when it stays, none when it is new). `0006_ledger_seed.sql` inserts
 * exactly these, and a test holds the two together.
 */
export const ACCOUNTS: readonly LedgerAccount[] = [
  // Balans
  account("0130", "Speeltoestellen en inventaris", "asset"),
  account("0135", "Afschrijving speeltoestellen en inventaris", "asset"), // an asset with a credit balance
  account("1000", "Kas (kluisje)", "asset", ["1000"], true),
  account("1010", "ING betaalrekening", "asset", ["1010"], true),
  account("1011", "ING kwartaalrekening", "asset", ["1011"], true),
  account("1020", "ASN MeerSparen", "asset", ["1020"], true),
  account("1021", "ASN deposito", "asset", ["1021"], true),
  account("1030", "Mollie", "asset", [], true),
  account("1080", "Kruisposten (geld onderweg)", "asset"),
  account("1300", "Nog te ontvangen", "asset", ["1300", "1500", "1590"]),
  account("1400", "Eigen vermogen", "equity"),
  account("1700", "Nog te betalen", "liability", ["1700", "1800", "1890"]),
  // Kosten
  account("4301", "Huur", "expense"),
  account("4302", "Gebouw en inventaris", "expense", ["4302", "4303"]),
  account("4304", "Terrein en buitenmeubilair", "expense", ["4304", "4305"]),
  account("4306", "Groenonderhoud", "expense", ["4306", "4307"]),
  account("4308", "Energie", "expense"),
  account("4309", "Water", "expense"),
  account("4310", "Afvalverwerking", "expense"),
  account("4401", "Loonkosten toezichthouder", "expense"),
  account("4403", "Vrijwilligers: attenties, vergoedingen en cursussen", "expense", ["4403", "4402"]),
  account("4501", "Inkoop kiosk", "expense"),
  account("4502", "Bestuurskosten", "expense", ["4502", "4810"]),
  account("4503", "Drukwerk", "expense"),
  account("4505", "Telefoon en internet", "expense"),
  account("4507", "EHBO", "expense"),
  account("4508", "Verzekeringen", "expense", ["4508", "4760"]),
  account("4509", "Contributies en abonnementen", "expense", ["4509", "4500"]),
  account("4510", "Reclame", "expense"),
  account("4511", "Bankkosten (ook Mollie)", "expense"),
  account("4512", "Schoonmaak", "expense"),
  account("4513", "Website en hosting", "expense"),
  account("4514", "Diversen", "expense", ["4514", "4506", "4790"]),
  account("4515", "Kasverschillen", "expense", []),
  account("4601", "Afschrijving speeltoestellen en inventaris", "expense"),
  // Opbrengsten
  account("8000", "Contributie particulier", "income", ["8000", "8001", "8002", "8003"]),
  account("8004", "Contributie zakelijk", "income"),
  account("8010", "Verhuur", "income"),
  account("8011", "Kiosk (ijs, drinken, snacks, statiegeld)", "income"),
  account("8012", "Entree", "income"),
  account("8020", "Subsidie gemeente", "income", ["8020", "8021", "8022"]),
  account("8025", "Donaties", "income"),
  account("8030", "Rente", "income"),
  account("8040", "Overige opbrengsten", "income"),
];

// The overview "Vaste activa 2026" as e-Boekhouden puts it on the clipboard: one row per line, tab-separated.
// Straaljager and Dome - Kopan carry the figures of the penningmeester's paste of 23 November 2026; the columns
// the app does not read hold made-up but consistent amounts.

const row = (...cells: string[]) => cells.join("\t");

export const VASTE_ACTIVA_2026 = [
  row(
    "Omschrijving",
    "Aanschafdatum",
    "Aanschafwaarde per 1-1",
    "Investeringen",
    "Aanschafwaarde per 31-12",
    "Afschrijving tot 1-1",
    "Afschrijving boekjaar",
    "Desinvesteringen",
    "Afschrijving desinvesteringen",
    "Afschrijving t/m 31-12",
    "Boekwaarde per 31-12",
    "Afschrijven in (jaren)",
  ),
  row("Speeltoestellen", "", "", "", "", "", "", "", "", "", "", ""),
  row("Straaljager", "1-1-2008", "9.496,00", "0,00", "9.496,00", "8.546,40", "474,80", "0,00", "0,00", "9.021,20", "474,80", "20"),
  row("Dome - Kopan", "10-7-2012", "44.457,21", "0,00", "44.457,21", "28.606,42", "2.122,86", "0,00", "0,00", "30.729,28", "13.727,93", "20"),
  row("Totaal Speeltoestellen", "", "53.953,21", "0,00", "53.953,21", "37.152,82", "2.597,66", "0,00", "0,00", "39.750,48", "14.202,73", ""),
  "",
].join("\n");

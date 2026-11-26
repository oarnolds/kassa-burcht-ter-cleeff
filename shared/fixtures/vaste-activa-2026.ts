// The overview "Vaste activa 2026" as e-Boekhouden puts it on the clipboard, in the layout of the penningmeester's
// paste of 23 November 2026: the header one line per word group, then one tab-separated row per toestel with an empty
// column after "Aanschafwaarde per 31-12", the group total and the grand total. Straaljager and Dome - Kopan carry
// the figures of that paste.

const row = (...cells: string[]) => cells.join("\t");

export const VASTE_ACTIVA_2026 = [
  "Vaste activa 2026",
  "Activa",
  "Aanschafdatum",
  "Aanschafwaarde",
  "per 01-01-2026",
  "Investering",
  "boekjaar",
  "Aanschafwaarde",
  "per 31-12-2026",
  "Afschrijvingen",
  "tot 01-01-2026",
  "Afschrijvingen",
  "Boekjaar",
  "Afschrijvingen",
  "Geboekt",
  "Afschrijvingen",
  "t/m 31-12-2026",
  "Boekwaarde",
  "per 31-12-2026",
  "Afschrijven",
  "in (jaren)",
  row("Speeltoestellen", "", "", "", "", "", "", "", "", "", "", ""),
  row("Straaljager", "01-01-2008", "9.496,00", "0,00", "9.496,00", "", "8.546,40", "474,80", "0,00", "9.021,20", "474,80", "20"),
  row("Dome - Kopan", "10-07-2012", "44.457,21", "0,00", "44.457,21", "", "28.606,42", "2.122,86", "0,00", "30.729,28", "13.727,93", "20"),
  row("Totaal Speeltoestellen", "", "53.953,21", "0,00", "53.953,21", "", "37.152,82", "2.597,66", "0,00", "39.750,48", "14.202,73", ""),
  row("53.953,21", "0,00", "53.953,21", "", "37.152,82", "2.597,66", "0,00", "39.750,48", "14.202,73"),
  "",
].join("\n");

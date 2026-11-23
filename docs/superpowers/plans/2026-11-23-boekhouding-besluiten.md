# Boekhouding: besluiten van de bouwer

Hoort bij het plan `2026-11-23-boekhouding.md` en het ontwerp `../specs/2026-11-23-boekhouding-design.md`.

Tijdens het bouwen (23 november 2026, taak voor taak, met per taak een frisse bouwer en een frisse controleur, en aan het eind een controle van de hele tak) heeft de bouwer (Claude) besluiten genomen waar het plan of het ontwerp geen antwoord gaf, of waar het plan niet klopte. Hieronder staan ze allemaal, met wat het kost als het besluit verkeerd blijkt. Daarna volgen de punten die live nog moeten worden nagekeken, en de kleine punten uit de controles die bewust zijn blijven liggen. Onderaan staan de oorspronkelijke regels uit het bouwlogboek, letterlijk (in het Engels).

Stand: taken 1 tot en met 21 zijn af. Taak 22 (online zetten) is alleen voorbereid: niets is online, er is geen migratie op de live database gedaan, geen bucket aangemaakt en geen geheim gezet.

## Besluiten

### Opzet

1. Gebouwd op de tak `claude/objective-booth-5ca1b3` (met de commits van ontwerp en plan erin), niet op de tak die het plan noemt. *Kost:* niets.
2. Een fout van de boekhouding kan ook "dienst niet beschikbaar" (503) zijn, voor de bijlagen zonder bucket. *Kost:* niets.

### Boekingen en jaren

3. Een boekjaar vanaf 2027 wordt vanzelf geopend als er voor het eerst iets in wordt geboekt. Anders kon in januari 2028 niets worden geboekt zolang 2027 nog niet is afgesloten. Een datum vóór 1 januari 2027 wordt geweigerd. *Kost:* een jaar dat door een tikfout in de datum ontstaat.
4. Een verborgen rekening wordt alleen geweigerd bij een gewone boeking (memoriaal). Automatische boekingen en bankregels mogen er nog op, zodat een regel niet stukgaat als u een rekening later verbergt. *Kost:* één woord code.
5. De boekhouding schrijft nooit in de instellingen van de kassa. Haar eigen instellingen staan in een eigen tabel. *Kost:* één tabel.

### Beginbalans en kluisje

6. "Wat er volgens de kassa in het kluisje hoort" op een moment: het achtergebleven bedrag van de laatste afdracht ervoor, plus de contante verkopen tot dat moment die nog door geen afdracht zijn afgesloten. Zo telt een laat binnengekomen verkoop ook mee. *Kost:* een klein verschil in de hint als het anders bedoeld was.
7. De beginbalans typt u alleen voor 2027. Latere jaren lopen door uit het afsluiten. *Kost:* niets.

### Bankregels

8. Een bankbestand voor een rekening zonder kenmerk wordt geweigerd: "Vul eerst bij Instellingen het kenmerk van deze rekening in." *Kost:* één extra stap.
9. Twee gelijke regels die u op één dag met de hand intypt, blijven twee regels. *Kost:* een ingetypte regel en dezelfde regel uit een later bestand kunnen allebei blijven staan; u ziet dat in Te boeken.
10. Een regel zonder echte bankreferentie wordt herkend aan rekening, datum, bedrag en tegenrekening; het volgnummer van een regel in het bestand telt niet als referentie, omdat een bank dat per bestand opnieuw kan nummeren. *Kost:* niets; dubbele regels worden nog steeds herkend.
11. Saldi van vóór 31 december 2026 worden niet bewaard. Een saldo van 31 december 2026 wordt vergeleken met de beginbalans, niet met nul. *Kost:* niets.
12. Een overboeking tussen eigen rekeningen wordt ook herkend als het spaarnummer van de andere rekening in de omschrijving staat (de ING-kwartaalrekening heeft geen IBAN). *Kost:* een zeldzame regel die ten onrechte op 1080 Kruisposten komt; u ziet het.
13. Bij Te boeken: een bijlage bij een regel die nog niet geboekt is, wordt bewaard zodra u op Boeken drukt. *Kost:* niets.
14. Een geboekte bankregel houdt bij Wijzigen het bedrag op de bankrekening en de datum van de bank. Leegmaken zet de regel terug in Te boeken. *Kost:* niets.
15. ING wordt in blokken van twee weken opgehaald, de oudste eerst. Past een blok niet in één nacht, dan wordt er niets van dat blok bewaard en staat er in het overzicht in rood "ING is vannacht niet gelukt: ing_cut_short". De volgende nacht gaat verder. *Kost:* bij een grote achterstand een paar nachten rood; een bankbestand inlezen lost het meteen op.
16. "Automatisch via Enable Banking" kan alleen bij ING betaal (1010). *Kost:* niets; de andere rekeningen gaan met bestanden.
17. Een ingetypte regel met een datum in de toekomst wordt geweigerd. *Kost:* niets.

### Rapporten en overzicht

18. De kolom "jaar ervoor" naast een periode in 2027 komt uit de vergelijkingscijfers van 2026, maar alleen bij een heel kalenderjaar; bij een kortere periode blijft hij leeg. *Kost:* een lege kolom bij een maand in 2027.
19. Het kasverschil in het overzicht vergelijkt tot en met gisteren (de nacht boekt gisteren), anders stond de omzet van vandaag altijd als verschil. *Kost:* een verschil is een dag later te zien.
20. De balans op 31 december toont het resultaat apart; op 1 januari zit het in het eigen vermogen. *Kost:* niets.

### Kassa

21. De kassadag wordt opnieuw bekeken als een verkoop is binnengekomen of later is betaald (pin). Het merkteken schuift alleen op als alle verschillende dagen zijn geboekt, en blijft tien minuten achter de klok. *Kost:* wat meer lezen.
22. Zolang de kassa niet in gebruik is genomen, boekt de boekhouding niets van de kassa. *Kost:* niets.
23. Verandert u bij Omzet van de kassa de rekening van een categorie, dan geldt dat voor het hele open jaar; een afgesloten jaar verandert niet. *Kost:* één keer opnieuw lezen van het open jaar.

### ING automatisch

24. De weekkopie neemt de toestemmingen van Enable Banking mee, maar zonder het sessienummer. *Kost:* na een terugzetten opnieuw koppelen.
25. Na "ING koppelen" staat ING betaal vanzelf op "Automatisch via Enable Banking". *Kost:* één keer terugzetten als u dat niet wilt.

### Mollie

26. De kosten van een uitbetaling worden altijd als positief bedrag op 4511 geboekt; het teken in Mollie's gegevens is niet beschreven. *Kost:* niets.
27. Per nacht blijft de app onder de 50 aanroepen naar buiten: bij Mollie hoogstens 6 per lijst, met pagina's van 100; bij ING hoogstens 10 plus het saldo. *Kost:* een grote achterstand duurt meer nachten.
28. Een lange achterstand bij Mollie wordt tot het eind gelezen, over meerdere nachten. *Kost:* niets.
29. Een pinbetaling op de terminal (pointofsale) is altijd van de kassa, ook als de kassa hem nog niet kent. Hij komt nooit in Te boeken. *Kost:* niets; een pinbetaling zonder verkoop staat op de Mollie-pagina bij "Alleen bij Mollie".
30. Een regel die op Mollie wacht, kunt u ook zelf boeken. *Kost:* boekt u een echte uitbetaling zelf, dan worden de kosten van Mollie niet vanzelf geboekt.
31. Een uitbetaling van Mollie uit 2026 die pas in januari 2027 op ING binnenkomt, boekt de app niet zelf. De regel blijft open met de opmerking "boek hem tegen 1080 Kruisposten als hij in de beginbalans onderweg stond". *Kost:* één boeking met de hand.
32. Het saldo van Mollie geldt 's nachts (vóór 06:00) voor gisteren en overdag (na "Nu bijwerken") voor vandaag. *Kost:* niets.
33. Een uitbetaling die Mollie al heeft gedaan maar die nog niet op ING staat, telt niet als verschil, maar staat als "Onderweg naar ING € …". *Kost:* een echt verschil ter grootte van een uitbetaling valt minder op; het staat er wel als "onderweg".

### Speeltoestellen

34. Opnieuw plakken vervangt de geplakte lijst, zolang er over 2027 nog niet is afgeschreven en niets is afgevoerd. *Kost:* niets.
35. Afvoeren maakt één boeking: de afschrijving van dat jaar tot en met de maand, de rest van de boekwaarde (beide op 4601), en het toestel gaat van 0130 en 0135 af. *Kost:* niets.
36. Wijzigen van een boeking houdt het toestel eraan vast. *Kost:* niets.
37. Afschrijven gaat jaar voor jaar, op volgorde. De aankoop van een afgevoerd toestel kan niet meer worden gewijzigd. *Kost:* niets.

### Het jaar

38. Bij het afsluiten is er een extra controle: 0130 en 0135 kloppen met de lijst speeltoestellen (niet verplicht). *Kost:* niets.
39. Jaren worden op volgorde afgesloten: 2028 pas als 2027 dicht is. *Kost:* niets.
40. In het jaaroverzicht is de beginbalans alles van vóór 1 januari plus de beginbalans van dat jaar; de eindbalans toont het resultaat apart. *Kost:* niets.
41. Excel wordt gemaakt zonder grote bibliotheek: alleen het kleine pakket `fflate` (zip) is toegevoegd. *Kost:* niets.
42. Een pagina van 500 boekingen leest iets meer dan 2.000 rijen (zo telt Cloudflare). De kosten groeien met de pagina, niet met het jaar. *Kost:* niets.

### Kassa-app op de iPad

43. De schermen van de boekhouding worden pas geladen als u ze opent. Het opstartbestand van de kassa werd daardoor kleiner (467 kB naar 385 kB) in plaats van groter. *Kost:* niets.
44. Het overzicht en de eerste pagina van beheer zeggen in rood als een nachtelijke stap mislukt is, of als de boekhouding meer dan 36 uur niet is bijgewerkt. Vlak na het online zetten staat dat er één keer, tot de eerste nacht. *Kost:* niets.

## Live nog na te kijken (taak 22)

Zodra de sleutels er zijn, met uw ja voor elke aanroep:

- Of de pinbetalingen van de terminal in de uitbetalingen van Mollie staan, en hoe het kenmerk van een uitbetaling (`05665564.JJMM.NN`) op het ING-afschrift staat. De herkenning gebruikt het patroon `7 of 8 cijfers . 4 cijfers . 2 cijfers`.
- Of het saldo van Mollie (beschikbaar plus nog uit te betalen) gelijk loopt met 1030, of dat Mollie de kosten pas bij de uitbetaling inhoudt.
- Welke `psu_type` ING Zakelijk vraagt (nu: business), hoe lang de toestemming duurt, hoe ver terug ING de eerste keer regels geeft, en hoe groot en in welke volgorde de pagina's van Enable Banking zijn.
- Of ING bij Enable Banking en in het bankbestand dezelfde tegenrekening en boekdatum geeft voor dezelfde regel (daarop rust het herkennen van dubbele regels zonder referentie).
- Of de bankbestanden van ING betaal en ASN een referentie per regel hebben.
- Of ING een grote inhaalslag (meer dan vier keer per dag ophalen) weigert; de app bewaart dan wat al binnen is en gaat de volgende nacht verder.
- De rekentijd van een grote import en van een inhaalnacht (lokaal niet te meten).
- De precieze menu's bij ING Zakelijk, ASN en in het Mollie-dashboard, voor het handboek.

## Kleine punten die zijn blijven liggen

De eindcontrole heeft ze nagelopen. Vóór het online zetten hoeft er geen meer te worden opgelost; de zwaarste zijn in de laatste ronde al verholpen. Vóór het eerste jaaroverzicht (januari 2028) verdienen deze aandacht:

1. Bij een jaar met veel foto's houdt de zip van de bijlagen ongeveer twee keer de bijlagen in het geheugen; op een iPad kan dat te veel zijn. Maak het jaaroverzicht op de computer.
2. In het Grootboek van een afgesloten jaar zit de afsluitboeking in het eigen vermogen, terwijl de Balans (eind) het resultaat apart toont. Er hoort een zin bij die dat uitlegt.
3. Bij een heel lange bestandsnaam van een bijlage kan de extensie in de zip wegvallen.

Daarnaast, voor later: wat er elke nacht en bij het kasverschil wordt gelezen, groeit met de jaren mee (geen probleem binnen de grenzen van het gratis abonnement, wel iets om over een paar jaar na te kijken). De volledige lijst staat hieronder, letterlijk.

## Uit het bouwlogboek, letterlijk

### Besluiten, letterlijk uit het bouwlogboek

1. R1: Work on claude/objective-booth-5ca1b3, not keen-mclaren — the session task says so explicitly — cost if wrong: none (fast-forwarded, same commits).
2. R2: LedgerError status becomes 400 | 404 | 409 | 503 (Task 3 widens it) — attachments_off 503 is in the plan's own test — cost if wrong: trivial type change.
3. R3: A year ≥ 2027 that has no row yet is created `open` on demand when an entry is first written for it (createEntry, upsertSourced, statements); `year_unknown` only for dates before LEDGER_START. "First open year" = lowest open year. — otherwise no kassa day, bank line or Mollie day could be booked in Jan 2028 while 2027 is still open (spec §13: closing happens "vanaf 1 januari van het jaar erna") — cost if wrong: a stray year row from a typo date.
4. R4: In Task 1 Entry.attachments is always []; Task 3 adds the table to 0005 and fills it — plan puts the table in Task 3 — cost: none.
5. R5: Import into a money account without an identifier → 409 `identifier_missing` (UI: "Vul eerst bij Instellingen het kenmerk van deze rekening in.") — refusing is safer than guessing which account a file belongs to (spec §10: a file of another account is refused) — cost if wrong: one extra step for the penningmeester.
6. R6: A typed line's occurrence = number of lines already stored with the same four key parts (so two equal typed lines on one day stay two) — "within this import" makes sense for files/fetches carrying whole days, not for one typed line — cost if wrong: a typed line and a later file line might both stay (visible in Te boeken).
7. R7: resultReport previous column: a period whose year-earlier counterpart lies before LEDGER_START uses comparison_figures only when the period is one whole calendar year (from YYYY-01-01 to YYYY-12-31); otherwise previousCents null — a year total next to one month would mislead — cost if wrong: an empty column on partial 2027 periods.
8. R10: In Te boeken, "Bijlage" on an open line keeps the chosen file in the page and uploads it to the new entry right after "Boeken" — attachments belong to entries (spec §9) — cost if wrong: UI rework only.
9. R13: hidden accounts are refused only for `manual` entries; `bank` entries may use them — the UI only offers visible accounts, and auto rules must not start failing when an account is hidden later — cost if wrong: one-word change.
10. R11 (Task 2): expectedCashAt(T) = left_cents of the last handover with counted_at <= T, plus paid cash sales with sold_at <= T that are not closed by a handover counted at or before T (handover_id NULL or that handover's counted_at > T) — matches the kassa's own model and the ledger (kassa days by sold date), so 1000 Kas equals it; the plan's "since that handover" would miss a late-arriving sale — cost if wrong: a small mismatch on the hint.
11. R12: the boekhouding never writes the kassa's `settings` table (plan Global Constraints + session brief); its own keys (ledger_opening_eb_equity_{year}, ledger_kassa_synced_at, ledger_nightly_last, mollie_profile_id, …) go in a new table `ledger_settings(key PK, value, updated_at)` in 0005, created in Task 2 — the plan's tasks name `settings` but contradict its own constraint — cost if wrong: one table.
12. R14 (Task 2): setOpening only for the year of LEDGER_START (2027); other years → 409 `not_first_year` — later years' openings are carried by balances after closing (spec §9, plan T19); a typed opening in 2028 would count twice — cost if wrong: none now.
13. R15: parseCamt053 no longer falls back to NtryRef for bankRef (AcctSvcrRef of the entry or TxDtls/Refs only) — if a bank numbers NtryRef per file, different lines would share a ref and be dropped silently (spec §5 failure); without it the content key still dedupes — cost if wrong: none (content key covers it).
14. R16: bank balances dated before 2026-12-31 are not stored; a balance dated 2026-12-31 (CLBD, or OPBD of 2027-01-01) is compared with the opening entry's amount for that account, not balancesOn(2026-12-31) (which is 0) — otherwise a December-2026 file shows a false difference right at the start — cost if wrong: small code in moneyAccounts.
15. R17 (Task 6): an own transfer is also recognised when the line's description contains another money account's identifier as a whole word (case ignored) — spaarnummers (V…) have no IBAN and our CAMT reader only reads IBANs, so "tegenpartij is een eigen spaarnummer" (spec §10) would otherwise never match — cost if wrong: a rare false own-transfer, visible as booked on 1080.
16. R18 (Task 7): overview.cashDifferenceCents = balance of 1000 up to yesterday (Amsterdam) − expectedCashAt(end of yesterday, Amsterdam); 0 before 2027-01-02 — the nightly sync books yesterday, so comparing "now" would always show today's sales as a difference — cost if wrong: a delayed signal of a day.
17. Task 9: Ruling on Important 2 (Overview omits consent/mollie/lastNightly): not a defect — the plan adds them in Task 11 (lastNightly + Nu bijwerken), Task 13 (consent warnings) and Task 16 (Mollie difference); the controller's decision said null → nothing.
18. R19 (Task 10): change detection uses received_at OR settled_at newer than the marker (a pin sale turns paid later via the webhook without a new received_at); only days whose ledger lines differ from the kassa's totals count toward maxItems; the marker moves to the newest timestamp read at the start of the run, and only when no differing day was left over — otherwise a run that handles the oldest 40 of more changed days would never progress, or would skip later ones — cost if wrong: re-reading candidate days.
19. R20 (Task 10): without settings.in_use_since nothing is booked (the kassa is not in use yet).
20. R21: a change of a category's account applies to the whole open year: PUT /category-accounts clears ledger_kassa_synced_at so the next syncs re-compare every open day (maxItems per run). For a closed year, a date is a candidate only when a sale of it was received or settled after that year's closed_at — so a mapping change never touches a closed year — cost if wrong: one re-read of the open year after a mapping change. (Carried into Task 11.)
21. R22 (Task 13): bank_consents goes into the weekly copy and the download without its session_id column — the copy is for restoring the books; a restored consent is renewed by the penningmeester anyway — cost if wrong: one re-consent after a restore.
22. R23 (Task 13): a successful "ING koppelen" also sets 1010's source to enable_banking (that is what he connected it for; he can switch back in Instellingen) — cost if wrong: one switch back.
23. R24 (Task 16): the costs of a payout are booked as a positive amount: 4511 gets |costsCents| — the sign of cost rows in a real settlement is not documented; Task 22's live check confirms it on the first real payout — cost if wrong: none (abs).
24. R25 (Task 15): external-call budget per nightly run (free plan: 50): ING at most 10 transaction pages (+ balance), Mollie at most 8 payment pages, 6 refund, 6 chargeback, 6 settlement pages, plus profiles and balance — worst case ~42 calls; normal nights need ~8 — cost if wrong: a backlog takes more nights.
25. R25 (revised, Task 15): page caps so one nightly run stays under 50 external calls: Mollie read lists at most 6 calls each (payments, refunds, chargebacks, settlements incl. detail reads) + profiles + balance = 26; ING at most 10 transaction pages + balance = 11; total ≤ 37.
26. R26: concern 1 and 4 are correctness (spec §5 "ontbreekt zonder dat het opvalt" / double revenue) → fixed before review: (a) the payments list reports when it was cut short and the sync then keeps a resume cursor in ledger_settings, continuing older pages on the next runs before reading new ones; (b) method `pointofsale` is always a kassa payment (only the kassa uses the terminal — spec §11 export: all 2026 payments iDEAL except the kassa's one pin), whether or not a sale has its id yet; Task 16's comparison shows a pointofsale payment without a sale. Concerns 2, 3, 5 → minor (deferred).
27. R27: Mollie lists use limit=100 (not 250): at most 600 items per run within the 6-call cap, so JSON parsing stays well inside the ~10 ms CPU of a run; a backlog just takes more nights (the resume cursor carries it) — cost if wrong: slower catch-up.
28. R28 (fix before review): (a) a waiting line can be booked by hand (Boeken shown next to "wacht op Mollie"); autoBook leaves booked lines alone, so nothing doubles — otherwise a non-Mollie credit that matches the pattern waits forever and blocks closing the year; (b) settlements are read from 2026-12-01 on the first read, and a payout line whose settlement was settled before LEDGER_START is not booked automatically: it stays open with the note "Uitbetaling {reference} is van {datum} (2026): boek hem tegen 1080 Kruisposten als hij in de beginbalans onderweg stond." — its costs were booked in e-Boekhouden for 2026, and 1030 in the opening is the balance after it left Mollie — cost if wrong: one hand booking in January 2027. Handbook (Task 21) tells him to put a December payout that reaches ING in January on 1080 in the beginbalans.
29. R30: payouts in transit are left out of the 1030 comparison: settlements settled on or before the balance date without a mollie_settlement entry dated on or before it are subtracted from the ledger side and shown as "Onderweg naar ING € …" (Overzicht, Mollie page); Task 19's year check uses the same correction — cost if wrong: a hidden real difference the size of a payout (it shows as "onderweg").
30. R29: the Mollie balance is recorded under yesterday's date when the run happens before 06:00 Amsterdam (the nightly job), otherwise under today's date (a daytime "Nu bijwerken") — the nightly reading stays the year-end figure, a daytime reading no longer shows today's payments as a difference — cost if wrong: none.
31. R31 (Task 18): pasting again replaces the pasted (opening) assets while no 2027 depreciation is booked and none of them is disposed (bought assets stay); a disposal writes one entry: 4601 + this year's depreciation up to the disposal month (note "Afschrijving {jaar} t/m {maand}"), 4601 + the book value left (note "Restwaarde afgevoerd"), 0135 + all written off before that year, 0130 − cost; an asset disposed in year Y gets no line in Y's depreciation entry (rebooked if that entry already holds it) — the spec's "afschrijving tot die maand, daarna de rest naar 4601" with both parts visible, no double count.
32. R32 (fix before review): editing an entry through Boekingen must keep each line's assetId — the form carries it (hidden, the toestel's name shown on 0130/0135 lines), the route passes it, the ledger refuses an assetId on any account other than 0130/0135 (400 asset_line_account) or an unknown asset (404 asset_unknown) — otherwise a bought toestel silently loses its cost.
33. R33 (Task 19): an extra non-required year check `assets`: on 31 December, 0130 and 0135 equal the totals of the toestellen list (listAssets up to that date) — catches a manual 0130/0135 entry without a toestel.
34. R8 (Task 19): balanceReport(date) leaves out a `closing` entry dated on that same date, so the year-end balance shows the result separately and the next day shows it in 1400.
35. R34 (fix before review): closeYear refuses 409 `earlier_year_open` while a year from 2027 up to year−1 is still open — years close in order, so late items always go to the right first open year and balances carry from a closed year — cost if wrong: none.
36. R9 (Task 20): one dependency only, `fflate` (zip, ~8 KB, no dependencies); the .xlsx is written by our own small module as SpreadsheetML zipped with fflate (inline strings, numbers, one number format) — no SheetJS (its npm package is outdated and has known advisories) and no exceljs (large); both loaded with import() only on the button.
37. R35 (Task 20): the year's opening BalanceReport = all entries dated before 1 January of the year (closing entries of earlier years included) plus that year's `opening` entry; the closing BalanceReport = balanceReport("{year}-12-31") (R8 shows the result separately).
38. Task 20: implementer DONE_WITH_CONCERNS — e53abe8. Rulings on concerns: (1) the brief's "≤ 2.000 rows per page" is unreachable by D1's counting for 500 two-line entries (measured 2.000–2.007); accepted the test bound 4 × entries + 10 — the point (cost follows the page, not the year) holds; (2) YearExport.accounts added — accepted; (3) the PWA precaches the 20 kB export chunk on the iPad once — accepted: the kassa's behaviour is unchanged and every deploy refreshes the precache anyway; (4) ~20.800 rows per export of a large year — fine within 5 M/day; (5) Placeholder.tsx removed — fine. To review.
39. R36 (fix wave): ING is fetched in date windows of 14 days, oldest first; a window that hits the page cap stores nothing of that window and the step reports `ing_cut_short` (shown red) — this replaces "newest − 7 days" with a resumable, ordered read — cost if wrong: more calls on a backlog night.
40. R37 (fix wave): a bank entry keeps its money-account line and its date when edited (refused otherwise); emptying it sets its bank line back to `open` in the same batch so it returns to Te boeken; Wijzigen on an empty entry starts with two blank rows.
41. R38 (fix wave): the boekhouding pages are lazy-loaded so the kassa's start bundle on the iPad stays as it was (spec §5 "de kassa wordt trager").

### Kleine punten die zijn blijven liggen, letterlijk

1. Task 1: minor (deferred): change()/upsertSourced return the unchanged entry when a year closes mid-write (silent no-op on race) — ledger.ts:303/330
2. Task 1: minor (deferred): upsertSourcedStatements keys by `existing.id` alone; a wrong id could rewrite another entry — ledger.ts:351
3. Task 1: minor (deferred): editEntry refuses lines already on a since-hidden account (can't fix description) — ledger.ts:294
4. Task 1: minor (deferred): unchanged re-sync of a closed-year entry throws year_closed instead of no-op — ledger.ts:325
5. Task 1: minor (deferred): no YYYY-MM-DD / real-date check in checkContent — ledger.ts:38
6. Task 1: minor (deferred): entry_exists recognised by D1 error text — ledger.ts:275
7. Task 1: minor (deferred): statement form opens a year row even when nothing is written — ledger.ts:349
8. Task 1: minor (deferred): moving an entry to another year leaves a number gap in the old year — ledger.ts:251
9. Task 1: minor (deferred): no test for FK refusing unknown account in statement form; ON CONFLICT path only if calls interleave
10. Task 1: minor (deferred): BY_SOURCE / bySource duplicate condition — ledger.ts:134/219
11. Task 2: minor (deferred): setOpening writes entry and eB-equity setting in two calls, not one batch — opening.ts:386
12. Task 2: minor (deferred): endOfDay generic +1h/+2h loop used only for 31 Dec — opening.ts:312
13. Task 2: minor (deferred): last handover ORDER BY counted_at without tiebreaker — opening.ts:330
14. Task 2: minor (deferred): getOpening `_now` unused — opening.ts:341
15. Task 2: minor (deferred): tests lack handover exactly at atIso, setOpening on closed year
16. Task 3: minor (deferred): ArrayBuffer body trusts sizeBytes (no byteLength check) — attachments.ts:311 → carried into Task 7 route dispatch
17. Task 3: minor (deferred): readAttachment null for both unknown id and missing R2 object — attachments.ts:343
18. Task 3: minor (deferred): `entrySnapshot = snapshot` alias export — ledger.ts
19. Task 3: minor (deferred): tests lack multi-entry attachment grouping, double hide, hide without binding, stream length mismatch
20. Task 3: minor (deferred): upsertSourced reads attachments on every sync read
21. Task 4: minor (deferred): counterparty from first TxDtls only while Ustrd joins all — camt.ts:261
22. Task 4: minor (deferred): Number(m[1])*100 precision above 9e13 — camt.ts:227
23. Task 4: minor (deferred): fixture(name) helper redundant — camt.test.ts:25
24. Task 4: minor (deferred): tests lack Stmt without account, credit with only Cdtr
25. Task 5: minor (deferred): key run can get a gap when one import repeats a new reference, or a known ref moves group → later double — bank.ts:103
26. Task 5: minor (deferred): INSERT OR IGNORE also swallows NOT NULL/CHECK failures; ON CONFLICT DO NOTHING would not — bank.ts:127
27. Task 5: minor (deferred): "double tap keeps it once" comment only true for overlapping requests; Task 9 form should disable while pending — bank.ts:229
28. Task 5: minor (deferred): no test for file-first then EB with extra equal line then reordered re-fetch
29. Task 6: minor (deferred): duplicate import from shared/ledger-types — bank.ts:322
30. Task 6: minor (deferred): AUTO_LINES_PER_RUN 4000 → up to 41 calls on top of an import's own — bank.ts:415
31. Task 6: minor (deferred): autoBook throwing after a good import gives 500 and loses ImportResult — admin-ledger-bank.ts:553
32. Task 6: minor (deferred): re-booking without description resets an edited description — bank.ts:398
33. Task 6: minor (deferred): suggestion subqueries with lower(trim()) unindexed — bank.ts:352
34. Task 6: minor (deferred): `Auto` type adds little — bank.ts:411
35. Task 6: minor (deferred): no test for booking on a hidden account (R13) or two simultaneous books
36. Task 7: minor (deferred): yearBefore maps 29 Feb to 28 Feb, Feb report after a leap year drops the 29th — ledger-reports.ts:63
37. Task 7: minor (deferred): balanceReport/cashDifference read all lines since the start — ledger-reports.ts:72/221
38. Task 7: minor (deferred): filename* encoding leaves '()* unencoded — admin-ledger.ts:150
39. Task 7: minor (deferred): yearOf accepts 0001 — admin-ledger.ts:55
40. Task 7: minor (deferred): kind check duplicates isResult — ledger-reports.ts:122
41. Task 7: minor (deferred): tests lack whole-year 2028 vs 2027, leap day, accountLines with closing
42. Task 7: minor (deferred): attachments served inline without CSP sandbox (pdf only)
43. Task 7: minor (deferred): mutation table without raw output
44. Task 8: minor (deferred): `void tap;` hack — SettingsLedgerPage.test.tsx:708
45. Task 8: minor (deferred): saved.get(code) || null drops a saved 0 — OpeningPage.tsx:454
46. Task 8: minor (deferred): unreadable set + mark helper duplicated in Opening/Comparison pages
47. Task 8: minor (deferred): Opening/Comparison errors all "Opslaan is niet gelukt"; reuse explain() from Settings
48. Task 8: minor (deferred): ComparisonPage lists hidden result accounts too (probably right)
49. Task 9: minor (deferred): Overzicht counts open only, dashboard open+waiting — OverviewPage.tsx:1206 / DashboardPage.tsx:168
50. Task 9: minor (deferred): Wijzigen on an emptied entry opens a form with zero rows — EntryForm.tsx:747
51. Task 9: minor (deferred): unreadable-mark helper and account select duplicated — BankLineRow.tsx:338 / EntryForm.tsx:785
52. Task 9: minor (deferred): BankUpload re-declares bank sources — BankUpload.tsx:454
53. Task 9: minor (deferred): overview "verschil" signed ledger−bank without saying which side — OverviewPage.tsx:1226
54. Task 9: minor (deferred): exported-but-unused parseSigned, MAX_LINES, readText
55. Task 9: minor (deferred): no test for buttons disabled while pending
56. Task 9: minor (deferred): EntryPage nests three Loaded, a failing history hides the entry — EntryPage.tsx:1134
57. Task 9: minor (deferred): vi.useFakeTimers({toFake:["Date"]}) not restored in the new EntriesPage test
58. Task 10: minor (deferred): a late entry for a closed-year date after a mapping change also carries a reclassification of that frozen day (needs per-sale tracking; very rare) — kassa-ledger.ts:230
59. Task 10: minor (deferred): no test for a day that nets to zero (empty entry, second run writes nothing)
60. Task 10: minor (deferred): a kassa_late itself in a closed year is skipped silently — kassa-ledger.ts:233
61. Task 10: minor (deferred): marker upsert can move backward under overlapping runs (safe; docstring says "only forward") — kassa-ledger.ts:156
62. Task 10: minor (deferred): "Kassa 6-3-2027" without leading zeros vs formatDateNl elsewhere — kassa-ledger.ts:45
63. Task 10: minor (deferred): race test tied to the SQL text "INTO ledger_years" — test/kassa-ledger.test.ts:264
64. Task 10: minor (deferred): only the first refused day's LedgerError is thrown; result lost — kassa-ledger.ts:131
65. Task 11: minor (deferred): nightly logs error.message; ING/Mollie steps must log only fixed text + code (carry into 13/15); test writes "secret-token-in-message" to stderr — nightly.ts:772
66. Task 11: minor (deferred): nightly and Nu bijwerken can overlap (idempotent; last write wins)
67. Task 11: minor (deferred): long doc-comment line — kassa-ledger.ts:457; import order cosmetic
68. Task 12: minor (deferred): key_format maps to {refused, 0}, same as "ING not listed"; doc comment says unauthorized — enable-banking.ts:151/18
69. Task 12: minor (deferred): valid_until sent unchanged; normalise via Date — enable-banking.ts:191
70. Task 12: minor (deferred): balance date from last_change_date_time is the UTC date; unreadable CLBD does not fall back to ITBD — enable-banking.ts:108/248
71. Task 12: minor (deferred): 8 s timeout untested (same as fake-mollie)
72. Task 12: minor (deferred): fake origin option unused; helper doc mentions a key param — fake:104, helpers.ts:77
73. Task 12: minor (deferred): baseOf duplicated from mollie.ts — enable-banking.ts:80
74. Task 12: minor (deferred): fixture IBANs: one real public (Belastingdienst), one invalid checksum — fake:52/59
75. Task 12: minor (deferred): fetch follows redirects; redirect:"error" would pin the Bearer JWT to the API host — enable-banking.ts:154
76. Task 12: minor (deferred): 16th test without recorded RED
77. Task 13: minor (deferred): finishConsent answers consentState (newest row), not the activated one; with two tabs BankReturnPage runs businessDate(null) — bank-consent.ts:80 / BankReturnPage.tsx:46 (crash in a rare two-tab case — final review should weigh)
78. Task 13: minor (deferred): a pending row hides the active consent (and its warning) up to 30 min — bank-consent.ts:84
79. Task 13: minor (deferred): EB session not closed after account_not_in_consent / failed batch — bank-consent.ts:67
80. Task 13: minor (deferred): address replacement after posting untested — BankReturnPage.test.tsx
81. Task 13: minor (deferred): "ING betaal ()" with empty brackets while money accounts load — BankReturnPage.tsx:39
82. Task 13: minor (deferred): a wrong key (401) also expires a valid consent (per brief) → handbook note
83. Task 13: minor (deferred): OverviewPage dates unpadded vs formatDateNl elsewhere
84. Task 14: minor (deferred): baseOf/failureOf copied from mollie.ts — drift risk — mollie-read.ts:591
85. Task 14: minor (deferred): 12 integer digits allowed beyond safe integer — mollie-read.ts:611
86. Task 14: minor (deferred): page cap returns ok with partial data (no truncated flag) — mollie-read.ts:674
87. Task 14: minor (deferred): cached profile id not tied to the token — mollie-read.ts:692
88. Task 14: minor (deferred): profileId() D1 error escapes the MollieResult contract — mollie-read.ts:712
89. Task 14: minor (deferred): tests lack 401 on a list, unreadable list item, malformed periods
90. Task 14: minor (deferred): console spies restored only on the success path; wrapped fetch may persist — test/mollie-read.test.ts:270/295
91. - R26: concern 1 and 4 are correctness (spec §5 "ontbreekt zonder dat het opvalt" / double revenue) → fixed before review: (a) the payments list reports when it was cut short and the sync then keeps a resume cursor in ledger_settings, continuing older pages on the next runs before reading new ones; (b) method `pointofsale` is always a kassa payment (only the kassa uses the terminal — spec §11 export: all 2026 payments iDEAL except the kassa's one pin), whether or not a sale has its id yet; Task 16's comparison shows a pointofsale payment without a sale. Concerns 2, 3, 5 → minor (deferred).
92. Task 15: minor (deferred): payments created >3 days before paid are not read (slow methods; none in use)
93. Task 15: minor (deferred): a queued refund booked as a line stays if it later fails
94. Task 15: minor (deferred): settlement_id refreshed only within the 3-day window
95. Task 15: minor (deferred): late entry itself in a closed year skipped silently — mollie-ledger.ts:255
96. Task 15: minor (deferred): refund of an unstored pointofsale payment whose sale lacks mollie_payment_id → Te boeken line (narrow) — mollie-ledger.ts:285
97. Task 15: minor (deferred): a corrupt resume note stops the step every night, no UI to clear — mollie-ledger.ts:51
98. Task 15: minor (deferred): unknown account in a rule gives account_unknown, not not_income_account
99. Task 15: minor (deferred): tests lack a second late arrival, a line payment in a closed year, a racing first import
100. Task 15: minor (deferred): a day with no work marks waiting rule payments booked, also in the unreachable "late entry in a closed year" skip — mollie-ledger.ts:249
101. Task 15: minor (deferred): no test pins the year-open guard on booked
102. Task 15: minor (deferred): a reversals list always cut short (>600) stops payments every night (unrealistic)
103. Task 15: minor (deferred): two simultaneous runs, last writer wins on an old backlog day (rare)
104. Task 17: minor (deferred): NaN/non-finite inputs and negative residual slip through the guard — depreciation.ts:123
105. Task 17: minor (deferred): no tests for December purchase, January disposal, disposal before purchase
106. Task 16: minor (deferred): hand booking racing autoBook can create a second payout entry (ms window, one user) — bank.ts:421/609
107. Task 16: minor (deferred): "al geboekt" guard only knows payouts booked via a settlement — bank.ts:501
108. Task 16: minor (deferred): bookLine does not clear note — bank.ts:425
109. Task 16: minor (deferred): in-transit counts settlements up to end of the balance date while the balance is a snapshot at run time → one-night differences that heal — bank.ts:333 / mollie-ledger.ts:69
110. Task 16: minor (deferred): setMoneyAccount in-transit adjustment untested — bank.ts:415
111. Task 16: minor (deferred): an open payout line ("Bedrag wijkt af") keeps counting as onderweg (still in Te boeken)
112. Task 18: minor (deferred): depreciation_first looks one year back only
113. Task 18: minor (deferred): pasted names up to 200 chars vs 60 elsewhere
114. Task 18: minor (deferred): a disposal debits 0135 with written-off-before-the-year only; a linked 0135 line earlier in the disposal year (API only) is left — assets.ts:291
115. Task 18: minor (deferred): a paste may write off more than the cost — asset-paste.ts:47
116. Task 18: minor (deferred): paste replaces the list and re-saves the opening in two calls — assets.ts:134
117. Task 18: minor (deferred): no tests for asset_linked, asset_booked_later, bookLine on a disposed toestel, paste with 2027 closed, disposing a bought toestel, GET /assets?date=
118. Task 18: minor (deferred): "leegmaken" of a year can drop a disposed toestel's 0135 line of that year (recoverable by booking again) — assets.ts:291
119. Task 18: minor (deferred): rebook test asserts 409 only, not the code — test/assets.test.ts:486
120. Task 18: minor (deferred, final review should weigh — possibly Important): checkDisposed ignores a change of the entry's date; moving a disposed toestel's purchase date changes its depreciation plan — ledger.ts:89
121. Task 18: minor (deferred): POST /entries accepts a disposed toestel's assetId on 0130 (API only)
122. Task 18: minor (deferred): depreciation_first only fires when the year before has rows
123. Task 19: minor (deferred): depreciation check condition redundant — year.ts:115
124. Task 19: minor (deferred): open-bank-lines condition written twice — year.ts:37/49
125. Task 19: minor (deferred): reopen race bumps updated_at; not_closed vs not_newest in a race — year.ts:254
126. Task 19: minor (deferred): race guard covers only the required check — year.ts:164
127. Task 19: minor (deferred): dayMonthYear copied into YearPage — YearPage.tsx:13
128. Task 19: minor (deferred): failed reopen does not reload years — YearPage.tsx:128
129. Task 19: minor (deferred): tests lack a year with only fully written-off toestellen, and closing a year without result lines
130. Task 20: minor (deferred): a 401 during the zip shows a fetch error instead of going to login — YearExportButtons.tsx:633
131. Task 20: minor (deferred): zip peak memory ~2× the attachments — year-export.ts:1491
132. Task 20: minor (deferred): the zip flow reads the whole export only for entryCount — YearExportButtons.tsx:622
133. Task 20: minor (deferred): Grootboek builds lists with spread per line (quadratic) — year-export.ts:1602
134. Task 20: minor (deferred): attachment name slice can cut the extension — year-export.ts:1457
135. Task 20: minor (deferred): Grootboek 1400 end of a closed year includes the closing entry, Balans eind leaves it out (R8) — needs a note — year-export.ts:1597
136. Task 20: minor (deferred): AbortSignal.timeout needs iOS Safari 16+ — ledger-api.ts
137. Task 21: minor (deferred): README "Een echt verschil staat in rood" on the Mollie page unverified; "krijgt een vinkje" unverified; "03:00" example (04:00 in summer)
138. Task 21: minor (deferred): e2e finds the upload area via xpath=.. — e2e/boekhouding.spec.ts:358
139. Task 21: minor (deferred): external menu paths (ING Zakelijk, ASN, Mollie dashboard) generic → Task 22 live

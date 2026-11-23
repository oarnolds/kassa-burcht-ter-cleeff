# Ontwerp: eigen boekhouding in de kassa-app

Datum: 23 november 2026
Status: goedgekeurd door de penningmeester op 23 november 2026

Dit ontwerp vervangt "fase 3: Moneybird" uit `2026-11-20-kassa-design.md` (§13). Het bouwt voort op de kassa en pin via Mollie, die live draaien vanaf `main`.

## 1. Waarom

De penningmeester van Speeltuin Burcht ter Cleeff (vereniging, Haarlem, niet btw-plichtig) wil van e-Boekhouden af en een eenvoudige eigen boekhouding in de kassa-app. De ledenlijst in e-Boekhouden wil hij ook niet meer gebruiken, maar die hoort niet bij dit ontwerp: dit is alleen de boekhouding.

Wat het beter moet maken dan nu:
- De omzet van de kassa, de afdrachten van het kluisje en de pinbetalingen staan al in de app. Die hoeven niet meer overgetypt te worden.
- De bankregels van ING komen vanzelf binnen.
- De kosten van Mollie worden zichtbaar door de pinomzet van de kassa te vergelijken met wat Mollie uitbetaalt.
- De speeltoestellen staan in een lijst met jaarlijkse afschrijving.
- Aan het eind van het jaar is het resultaat met één handeling geboekt, en er is een overzicht voor de kascommissie en een opvolger dat zonder de app te lezen is.

Het eerste boekjaar in de app is 2027. e-Boekhouden doet 2026 nog af, inclusief de jaarafsluiting. De app hoeft op 1 januari 2027 niet af te zijn: bankregels en kassa-omzet vanaf 1 januari kunnen later worden ingelezen.

## 2. Wie gebruikt het

- **De penningmeester**, in beheer (`/beheer`), op computer en telefoon. Hij boekt, controleert en sluit het jaar af. Er blijft één beheerdersaccount.
- **De kascommissie** krijgt het jaaroverzicht (Excel, PDF en de bijlagen). Ze krijgt geen eigen inlog.
- **Een opvolger** moet met het jaaroverzicht en het handboek verder kunnen.
- **De beheerder in de kiosk** merkt er niets van: op de iPad verandert niets.

## 3. Doelen

1. Een echte boekhouding (debet en credit) met een balans die altijd sluit, achter eenvoudige schermen.
2. Een korter rekeningschema (§8), dat de penningmeester zelf kan aanvullen.
3. Een beginbalans per 1 januari 2027 waarin het eigen vermogen wordt uitgerekend.
4. Bankregels: ING betaal automatisch via Enable Banking; de andere rekeningen met een bankbestand of met de hand. Per rekening te kiezen.
5. De kassa boekt zichzelf: omzet per dag per soort, afdrachten van het kluisje.
6. Mollie: uitbetalingen en kosten automatisch geboekt, pinomzet van de kassa vergeleken met Mollie.
7. Bij elke boeking een factuur of bonnetje (PDF of foto).
8. Speeltoestellen met jaarlijkse afschrijving.
9. Jaar afsluiten met één knop, na controles, en een jaaroverzicht voor de kascommissie.

## 4. Wat er niet in zit

- Ledenadministratie, incasso en contributie per lid. Contributie komt binnen als bankregel en wordt op 8000 of 8004 geboekt.
- Facturen maken of versturen (ook niet voor verhuur).
- Een begroting.
- Btw.
- Meer gebruikers of een aparte inlog voor de kascommissie.
- Betalingen doen vanuit de app. Enable Banking wordt alleen gebruikt om te lezen.
- Iets op de iPad. De kassa blijft zoals hij is.
- De jaren tot en met 2026. Die blijven in e-Boekhouden (en in de exports van de penningmeester); alleen de totalen van 2026 komen als vergelijkingscijfers in de app (§13).

## 5. Wat het een mislukking zou maken, ook als het technisch werkt

- De balans sluit niet, of er komt een "saldo" dat niemand kan uitleggen (zoals in e-Boekhouden sinds 2020).
- Een bankregel, kassadag of uitbetaling van Mollie staat dubbel in de boeken of ontbreekt zonder dat het opvalt.
- De kassa wordt trager, verandert, of valt uit door de boekhouding.
- Een sleutel (Enable Banking, Mollie) staat in de code, in de chat of in een bestand in git.
- Iets van een afgesloten jaar verandert zonder dat het te zien is.
- Gegevens of bijlagen raken binnen 7 jaar kwijt.
- Bijhouden kost meer werk dan e-Boekhouden nu.
- De boekhouding werkt niet meer als Enable Banking stopt met gratis toegang.

## 6. Randvoorwaarden

- Cloudflare gratis abonnement: ongeveer 10 ms rekentijd per verzoek (er is wat speling, zie besluiten 120 en 132 van fase 1), 50 databaseaanroepen per verzoek (een batch telt als één), 50 externe aanroepen per verzoek, 5 miljoen gelezen rijen per dag. Dit geldt ook voor een geplande taak (cron).
- Er draait al een cron: `0 3 * * MON` voor de wekelijkse kopie naar R2. Bij Cloudflare is dag 1 de zondag; daarom staat er `MON`.
- R2 is ingeschakeld; gratis tot 10 GB opslag.
- Bedragen zijn hele centen; een dag is een dag in Europe/Amsterdam; alle schermteksten in het Nederlands.
- Beheer is beveiligd met een sessiecookie en een CSRF-header (bestaande `requireAdmin`).
- Sleutels typt de penningmeester zelf als Worker-secret. Ze komen nooit in de chat, in git of in een test.
- Accounts bij Enable Banking en Mollie maakt de penningmeester zelf.
- Huisregels van het project: TDD; niet pushen; niet samenvoegen in `main`, niet deployen en de live database niet aanraken zonder zijn uitdrukkelijke ja.
- Bewaarplicht: de administratie van een vereniging moet 7 jaar bewaard blijven (art. 2:10 BW), inclusief facturen en bonnetjes.

## 7. Overwogen aanpakken

**Waar de boekhouding komt**

| Aanpak | Afweging |
|---|---|
| **In de kassa-app, als deel van beheer (gekozen)** | Eén inlog. Verkopen, afdrachten en pinbetalingen staan al in dezelfde database. De wekelijkse kopie neemt alles mee. Blijft gratis. Risico: de kassa draait in dezelfde Worker; de boekhouding mag de kassa daarom alleen lezen. |
| Een aparte app naast de kassa | Twee keer inloggen en onderhouden; kassa en boekhouding moeten elkaar gegevens sturen die nu op één plek staan. |
| Een spreadsheet | Geen koppeling met kassa, bank of Mollie. |
| Bij e-Boekhouden blijven en dagtotalen via de API sturen | De penningmeester wil juist van e-Boekhouden af. |

De penningmeester koos de kassa-app.

**Hoe de bankregels binnenkomen**

| Aanpak | Afweging |
|---|---|
| Alleen bankbestanden (CAMT.053) uploaden | Gratis, geen derde partij ziet de regels, een paar minuten werk per maand. |
| Ponto (Isabel) | Ongeveer € 4 per rekening per maand (prijs van een derde bron), elke 3 tot 6 maanden opnieuw toestemming, ING en ASN alleen via derde bronnen bevestigd. |
| **Enable Banking voor ING betaal, bestanden voor de rest (gekozen)** | Gratis in de "restricted" vorm. Volgens hun voorwaarden (bijgewerkt 9 januari 2026) is die bedoeld voor evaluatie of privégebruik; zakelijke rekeningen worden gedoogd als evaluatie tot Enable Banking schriftelijk laat weten dat het stopt. Daarom blijft het uploaden van bestanden de basis en is Enable Banking een extra. |
| GoCardless Bank Account Data | Neemt geen nieuwe klanten aan. |

De penningmeester heeft op 23 november 2026 zelf een applicatie bij Enable Banking aangemaakt en de ING-betaalrekening gekoppeld. ASN en de ING-kwartaalrekening doet hij met de hand.

**Hoe de kosten van Mollie zichtbaar worden**

| Aanpak | Afweging |
|---|---|
| **Een tweede Mollie-sleutel met alleen leesrechten (gekozen)** | De sleutel van de kassa (`live_…`, een profielsleutel) mag alleen betalingen en terugbetalingen zien, niet de uitbetalingen (Settlements), saldi (Balances) of facturen (bron: docs.mollie.com, 22 november 2026). Een organisatie-toegangssleutel met leesrechten mag dat wel. De penningmeester maakt die zelf. |
| Elke maand de factuur van Mollie met de hand boeken | Geen extra sleutel, maar geen automatische vergelijking per uitbetaling. |

## 8. Rekeningschema

De nummers blijven gelijk aan die in e-Boekhouden, zodat 2027 naast eerdere jaren te leggen is. Van 77 rekeningen naar 44. De penningmeester kan in beheer zelf een rekening toevoegen, een naam wijzigen of een rekening verbergen. Een rekening waarop is geboekt kan niet worden verwijderd.

**Balans**

| Nr | Naam | Soort | Herkomst |
|---|---|---|---|
| 0130 | Speeltoestellen en inventaris | bezit | was "Speeltoestellen"; ook vriezer, banken en picknicktafels staan erop |
| 0135 | Afschrijving speeltoestellen en inventaris | bezit (min) | blijft |
| 1000 | Kas (kluisje) | bezit, geld | blijft |
| 1010 | ING betaalrekening | bezit, geld | blijft |
| 1011 | ING kwartaalrekening | bezit, geld | blijft |
| 1020 | ASN MeerSparen | bezit, geld | blijft |
| 1021 | ASN deposito | bezit, geld | blijft |
| 1030 | Mollie | bezit, geld | nieuw |
| 1080 | Kruisposten (geld onderweg) | bezit | blijft |
| 1300 | Nog te ontvangen | bezit | was Debiteuren, met 1500 en 1590 |
| 1400 | Eigen vermogen | vermogen | blijft |
| 1700 | Nog te betalen | schuld | was Crediteuren, met 1800 en 1890 |

**Kosten**

| Nr | Naam | Herkomst |
|---|---|---|
| 4301 | Huur | blijft |
| 4302 | Gebouw en inventaris | 4302 + 4303 |
| 4304 | Terrein en buitenmeubilair | 4304 + 4305 |
| 4306 | Groenonderhoud | 4306 + 4307 |
| 4308 | Energie | blijft |
| 4309 | Water | blijft |
| 4310 | Afvalverwerking | blijft |
| 4401 | Loonkosten toezichthouder | blijft |
| 4403 | Vrijwilligers: attenties, vergoedingen en cursussen | 4403 + 4402 |
| 4501 | Inkoop kiosk | was "Winkel inkoop" |
| 4502 | Bestuurskosten | blijft; ook wat op 4810 stond (KvK en dergelijke) |
| 4503 | Drukwerk | blijft |
| 4505 | Telefoon en internet | blijft |
| 4507 | EHBO | blijft |
| 4508 | Verzekeringen | 4508 + 4760 |
| 4509 | Contributies en abonnementen | 4509 + 4500 |
| 4510 | Reclame | blijft |
| 4511 | Bankkosten (ook Mollie) | blijft |
| 4512 | Schoonmaak | blijft |
| 4513 | Website en hosting | blijft |
| 4514 | Diversen | 4514 + 4506 + 4790 |
| 4515 | Kasverschillen | nieuw |
| 4601 | Afschrijving speeltoestellen en inventaris | blijft |

**Opbrengsten**

| Nr | Naam | Herkomst |
|---|---|---|
| 8000 | Contributie particulier | 8000 + 8001 + 8002 + 8003 |
| 8004 | Contributie zakelijk | blijft |
| 8010 | Verhuur | blijft |
| 8011 | Kiosk (ijs, drinken, snacks, statiegeld) | was "Winkelverkoop-Toegang contant" |
| 8012 | Entree | was "Winkelverkoop-Toegang pin" |
| 8020 | Subsidie gemeente | 8020 + 8021 + 8022 |
| 8025 | Donaties | blijft |
| 8030 | Rente | blijft |
| 8040 | Overige opbrengsten | blijft |

**Vervallen:** 0800, 0801, 1012 (Revolut, nooit gebruikt), 1410, 4311, 4520, 4530, 4590, 4600, 4602, 4603, 4810, 4850, 7000, 9951, 9952, 9998 en 9999.

De omzet van de kassa gaat **per soort** (keuze van de penningmeester, 23 november 2026), niet per betaalwijze: contant en pin zijn te zien op de balans (1000 Kas en 1030 Mollie) en in de rapporten van de kassa. In beheer staat per categorie van de kassa op welke rekening de omzet komt; bij de start Entree → 8012 en alle andere categorieën → 8011.

## 9. Boeken

- **Boekjaar** = kalenderjaar. Een jaar is open of afgesloten (§13).
- **Een boeking** heeft een datum, een omschrijving, regels (rekening en bedrag) en eventueel bijlagen. Debet en credit zijn samen nul; een boeking die niet sluit wordt niet opgeslagen. Elke boeking heeft een volgnummer per jaar, dat ook op de bijlagen in het jaaroverzicht staat.
- **Wie boekt.** De meeste boekingen maakt de app zelf: uit bankregels (§10), de kassa en Mollie (§11) en de afschrijving (§12). Voor de rest is er een gewone boeking (memoriaal), bijvoorbeeld voor nog te betalen kosten aan het eind van het jaar.
- **Corrigeren.** Zolang het jaar open is, kan de penningmeester een boeking aanpassen. De app bewaart bij elke wijziging wanneer, wat ervoor stond en wat erna. De kascommissie ziet dat in het jaaroverzicht. Een boeking verwijderen kan alleen door hem leeg te maken (alle regels weg); hij blijft dan met zijn geschiedenis bestaan. In een afgesloten jaar verandert niets.
- **Boekingen die de app zelf maakt** (kassadag, afdracht, uitbetaling Mollie, afschrijving) past de penningmeester niet met de hand aan; ze volgen hun bron. Een verkeerd aangeslagen verkoop wordt in de kassa teruggedraaid, zoals nu. Een afdracht kan in de kassa niet worden gewijzigd; is daar een bedrag verkeerd getypt, dan corrigeert de penningmeester dat met een gewone boeking (bijvoorbeeld tussen 1080 Kruisposten en 4515 Kasverschillen), met de afdracht in de omschrijving. Een gewone boeking mag op elke rekening.
- **Bijlagen.** Bij elke boeking kan de penningmeester een of meer PDF's of foto's zetten, ook vanaf zijn telefoon (foto van een bonnetje). Een bijlage wordt nooit gewist: weghalen in een open jaar verbergt hem, met een regel in de geschiedenis.
- **Beginbalans 2027.** Een scherm waarin de penningmeester per balansrekening het saldo van 31 december 2026 intypt, uit de eindbalans van e-Boekhouden na de jaarafsluiting. Uitzonderingen:
  - 0130 en 0135 komen uit de lijst met speeltoestellen (§12).
  - 1000 Kas is het bedrag dat volgens de kassa op 31 december 2026 in het kluisje hoort; de app toont het.
  - 1030 Mollie is het saldo bij Mollie op 31 december 2026 (nog niet uitbetaalde betalingen van kassa, website en QR-code); de app haalt het op of de penningmeester typt het uit het Mollie-dashboard.
  - 1400 Eigen vermogen rekent de app uit als sluitpost (alles wat bezit is min alles wat schuld is). Het verschil met 1400 in e-Boekhouden laat de app zien, ter informatie. De penningmeester heeft op 22 november 2026 gezegd dat het oude verschil (sinds 2020) niet uitgezocht hoeft te worden.
  - De beginbalans van latere jaren maakt de app zelf bij het afsluiten.

## 10. Bankregels

**Bron per rekening.** In beheer, onder Boekhouding → Instellingen, kiest de penningmeester per geldrekening hoe de regels binnenkomen (verzoek van de penningmeester, 23 november 2026):
- **Automatisch via Enable Banking.** Alleen mogelijk voor een rekening die via Enable Banking is gekoppeld; nu alleen 1010 ING betaal.
- **Bankbestand uploaden of met de hand.** Een CAMT.053-bestand inlezen, of een regel intypen.

Wisselen kan altijd. Ook bij "automatisch" kan een bestand worden geüpload, bijvoorbeeld om een gat te vullen. Bij elke geldrekening staat het kenmerk waaraan de app de rekening in een bestand of bij Enable Banking herkent: een IBAN, of voor een spaarrekening het spaarnummer (de ING-kwartaalrekening heeft een nummer dat met V begint en geen IBAN). Een bestand van een andere rekening wordt geweigerd met die reden.

**Bankbestand (CAMT.053).** Dit formaat kunnen ING Zakelijk en ASN downloaden. Een voorbeeld van de ING-kwartaalrekening (1 januari t/m 22 november 2026) liet zien:
- versie `camt.053.001.02`; de rekening staat in `Acct/Id/Othr/Id` (spaarnummer) of `Acct/Id/IBAN`;
- begin- en eindsaldo (`Bal` met `OPBD`/`PRCD` en `CLBD`) kloppen met e-Boekhouden (€ 10.883,45 en € 11.027,47);
- een regel (`Ntry`) heeft datum, bedrag, bij/af, een omschrijving (`RmtInf/Ustrd`) en soms een tegenpartij; er is **geen unieke referentie van de bank**.

De app leest elke regel één keer in. Omdat een unieke referentie kan ontbreken, herkent de app een regel aan rekening, boekdatum, bedrag, omschrijving en tegenpartij, en telt hij gelijke regels op dezelfde dag (twee keer € 5,00 "Rente" op één dag zijn twee regels). Overlappende bestanden of twee keer hetzelfde bestand geven dus geen dubbele regels. Heeft de bron wel een referentie (Enable Banking geeft er meestal een), dan gebruikt de app die. Een regel die automatisch is binnengekomen en daarna ook in een bestand staat, telt één keer.

**Enable Banking (ING betaal).** De app vraagt zelf toestemming via de API; het koppelen in het Control Panel heeft alleen de applicatie geactiveerd.
- In beheer: knop "ING koppelen". De app vraagt Enable Banking om een toestemming voor ING (Nederland, zakelijk) met de langste geldigheid die ING toestaat (meestal 180 dagen), stuurt de penningmeester naar ING, en krijgt hem terug op `/beheer/bank` (het adres dat in Enable Banking is ingesteld).
- Elke nacht haalt de app de nieuwe regels en het saldo op.
- Twee weken voor de toestemming verloopt staat er in beheer een melding met de knop om te vernieuwen. Is de toestemming verlopen of ingetrokken, dan staat de rekening op "wacht op nieuwe toestemming" en kan de penningmeester een bestand uploaden; er gaat niets mis.
- Stopt Enable Banking met de gratis toegang, dan zet de penningmeester 1010 op "bestand". Verder verandert er niets.

**Saldo-controle.** Per geldrekening vergelijkt de app zijn eigen saldo met het laatste saldo dat de bank opgaf (uit het bestand of van Enable Banking), op dezelfde datum. Een verschil staat in beeld bij de rekening en op het overzicht.

**Te boeken.** Nieuwe bankregels komen in een lijst "Te boeken", per rekening of allemaal samen. Per regel: datum, tegenpartij, omschrijving, bedrag, een voorgestelde rekening, knop "Boeken", en de mogelijkheid een bijlage toe te voegen of de regel over meer rekeningen te verdelen. Het voorstel komt van de vorige keer dat een regel met dezelfde tegenpartij (IBAN, anders naam) werd geboekt. Zonder voorstel kiest de penningmeester zelf.

```
Te boeken (3)                                ING betaal · bijgewerkt vannacht om 03:00
───────────────────────────────────────────────────────────────────────────────────────
 3 jan  Gemeente Haarlem   subsidie Q1      + 6.091,47  [8020 Subsidie gemeente ▾]  [Boeken]
 4 jan  Goodoo BV          factuur 0001       − 412,80  [4501 Inkoop kiosk ▾] [Bijlage] [Boeken]
 6 jan  Mollie             uitbetaling        + 98,12   vanzelf geboekt: kosten Mollie € 1,88
```
(Verzonnen bedragen en namen.)

**Wat de app zelf boekt:**
- Een uitbetaling van Mollie (§11).
- Een overboeking tussen eigen rekeningen (tegenpartij is een eigen IBAN of spaarnummer): tegen 1080 Kruisposten. Elke kant wordt apart geboekt, zodat het niet uitmaakt welke kant eerst binnenkomt; 1080 staat weer op nul als beide er zijn.
- Het kasgeld: de penningmeester stort het contante geld niet meer bij de bank (te weinig geld voor de kosten per storting). Hij maakt het bedrag van een afdracht over van zijn eigen rekening naar ING betaal, altijd met de omschrijving "kasstorting". Een bijschrijving op 1010 met "kasstorting" in de omschrijving boekt de app zelf tegen 1080 Kruisposten.

## 11. Kassa, kluisje en Mollie

**Omzet van de kassa.** Per kassadag één boeking "Kassa {datum}":
- debet 1000 Kas: de contante omzet van die dag (betaalde contante verkopen, inclusief statiegeld, min contante terugdraaiingen);
- debet 1030 Mollie: de pinomzet van die dag (betaalde pinverkopen, min pinterugdraaiingen);
- credit per categorie de rekening die bij die categorie hoort (§8), voor het verkochte bedrag.

De kassa is sinds 21 november 2026 echt in gebruik: de proefgegevens zijn toen gewist met het vinkje "Dit is de ingebruikname", iZettle is eruit en pin loopt live via Mollie (stand van fase 2). Wissen kan sindsdien niet meer. De boekhouding boekt alleen kassadagen vanaf de ingebruikname (`settings.in_use_since`) én in een boekjaar van de app, dus vanaf 1 januari 2027; de kassa-omzet van 21 november tot en met 31 december 2026 boekt de penningmeester nog in e-Boekhouden.

Alleen verkopen met status `paid` tellen; `pending` en `failed` niet. Een terugdraaiing staat in de kassa al op de dag van terugdraaien en telt dus op die dag. Een verkoop die later binnenkomt (iPad offline) hoort bij zijn eigen dag. De boeking van een dag volgt de kassa zolang het jaar open is: komt er een verkoop bij, dan past de app die dag aan. Het totaal van een dag in de boekhouding is dus altijd gelijk aan het rapport van de kassa voor die dag. Komt er een verkoop binnen voor een dag in een afgesloten jaar, dan boekt de app hem op 1 januari van het eerste open jaar, met de vermelding "nagekomen kassaverkoop {datum}".

**Afdracht van het kluisje.** Een afdracht die de penningmeester onder Kluisje vastlegt (bestaand), wordt vanzelf een boeking op het moment van de afdracht:
- credit 1000 Kas: wat er uit het kluisje is gegaan volgens de kassa (verwacht min achtergebleven);
- debet 1080 Kruisposten: het ontvangen bedrag;
- debet of credit 4515 Kasverschillen: het verschil (een tekort is debet, een overschot credit), met de toelichting van de afdracht.

Maakt de penningmeester het bedrag over met "kasstorting" (§10), dan boekt de app die bankregel tegen 1080. Zo is het saldo van 1000 Kas altijd gelijk aan wat er volgens de kassa in het kluisje hoort, en laat 1080 zien welk geld nog onderweg is. Het beginbedrag van het kluisje bij de ingebruikname is geen boeking; het zit in de beginbalans.

**Mollie: niet alleen de kassa.** Ook de website en een QR-code bij de speeltuin ontvangen betalingen via hetzelfde Mollie-account, onder meer "Lid worden" (€ 32 per jaar) en dagkaartjes (bevestigd door de penningmeester, 23 november 2026). 1030 Mollie is daarom een geldrekening met eigen regels, net als een bankrekening:
- De app haalt elke nacht de betaalde betalingen, terugbetalingen en terugboekingen (chargebacks) bij Mollie op.
- Een betaling die bij een pinverkoop van de kassa hoort (zelfde Mollie-betaling als `sales.mollie_payment_id`), zit al in de kassadag en wordt alleen afgevinkt.
- De andere betalingen (website en QR-code) boekt de app per dag in één boeking "Mollie overig {datum}", per rekening opgeteld, met vaste regels op de omschrijving die de penningmeester één keer instelt (bijvoorbeeld "Dagkaart" → 8012 Entree, "Lid" → 8000 Contributie particulier). Een betaling die bij geen enkele regel past, en elke terugbetaling of terugboeking van zo'n betaling, komt los in "Te boeken".

Wat er via Mollie binnenkomt, volgens een export van de penningmeester (alle betalingen van april 2019 tot 22 november 2026, gelezen op 23 november 2026, zonder namen over te nemen):
- In 2026 waren alle betaalde betalingen iDEAL, op één na: de eerste echte pinbetaling van de kassa (€ 0,60 op 21 november, methode `pointofsale`, omschrijving "Kassa bon …").
- In 2026 betaald: 614 dagkaartjes (€ 944,15), 127 keer lidmaatschap of verlenging (€ 3.757,50) en 74 keer verhuur (€ 2.960). Elke betaling van 2026 valt in een van die drie soorten.
- De omschrijvingen verschillen per jaar en per pagina van de website. De regels waarmee de app begint (de penningmeester kan ze aanpassen; hoofdletters tellen niet):

| Omschrijving bevat | Rekening | Voorbeelden uit de export |
|---|---|---|
| "dagkaart" of "dagticket" | 8012 Entree | "Burcht ter Cleeff - 2x dagkaartje", "Dagticket" |
| "lidm", "lidmaatschap" of "verl" | 8000 Contributie particulier | "Lidm. Speeltuin ter Cleefte", "Burcht ter Cleeff - Verlenging L…" |
| "reserver" of "verhuur" | 8010 Verhuur | "Verhuur reservering", reserveringen met "TELNR_RESERVERING" |

- Een zakelijk lidmaatschap (in de export een paar keer € 250) valt zo onder 8000. De penningmeester verplaatst het met een gewone boeking naar 8004, of maakt er een eigen regel voor.
- In de export staan geen kosten per betaling: het uitbetaalde bedrag is steeds gelijk aan het betaalde bedrag. De kosten komen daarom uit de uitbetalingen (Settlements).
- Het kenmerk van een uitbetaling ziet eruit als `05665564.2611.01` (nummer van het account, jaar en maand, volgnummer).

**Uitbetalingen van Mollie.** Met een tweede sleutel (§16) haalt de app elke nacht de uitbetalingen (settlements) op: per uitbetaling het kenmerk dat ook op het bankafschrift staat, de datum, het uitbetaalde bedrag, de omzet, de terugbetalingen en de kosten. Een uitbetaling bevat kassa-, website- en QR-betalingen door elkaar.
- Komt de uitbetaling op ING binnen (herkend aan het kenmerk), dan boekt de app die regel zelf: debet 1010 het uitbetaalde bedrag, debet 4511 de kosten, credit 1030 de omzet min terugbetalingen. Is de uitbetaling bij Mollie nog niet opgehaald, dan wacht de regel in "Te boeken" met de melding "wacht op Mollie".
- **Vergelijken**, per maand: de pinomzet volgens de kassa naast de pinbetalingen (methode `pointofsale`) volgens Mollie, met de verschillen per betaling (een pinverkoop zonder betaling bij Mollie of omgekeerd); daaronder de overige betalingen (website en QR-code) per rekening. Daarnaast het saldo van 1030 naast het saldo bij Mollie (Balances). Haalt Mollie iets anders van het saldo af, bijvoorbeeld de aankoop van een terminal, dan staat dat als verschil in beeld en boekt de penningmeester het zelf.
- Een terugbetaling in Mollie legt de penningmeester nu al vast door de verkoop in de kassa terug te draaien. Die tegenboeking komt via de kassadag in de boeken; Mollie trekt hem van een uitbetaling af.

## 12. Speeltoestellen en inventaris

**De lijst.** Per toestel: naam, aankoopdatum, aanschafwaarde, restwaarde, levensduur in jaren, en (bij de start) wat er al is afgeschreven. Restwaarde komt voor in de huidige lijst: Dome-Kopan € 2.000, Pizza € 1.000, Banken (mei 2024) de helft.

**De start.** e-Boekhouden heeft een lijst vaste activa (export van 23 november 2026): 31 regels, aanschafwaarde samen € 209.081,20, afgeschreven € 97.333,37, huidige waarde € 111.747,83; 12 toestellen staan op nul. De penningmeester downloadt die lijst opnieuw nadat hij de afschrijving van 2026 in e-Boekhouden heeft geboekt. Die lijst komt in de app; de penningmeester controleert hem in beheer. 0130 en 0135 in de beginbalans zijn de totalen van de lijst. De lijst wijkt af van de balans in e-Boekhouden (op 23 november 2026 € 2.493,70 in boekwaarde; de afschrijving van 2025 is daar rechtstreeks op 0130 geboekt). Dat verschil komt in het uitgerekende eigen vermogen (§9).

Twee regels lijken niet te kloppen en worden bij het overnemen nagekeken door de penningmeester:
- Stadsbanken (aankoop 11 juni 2018, € 3.968,80): er is maar € 60 af te schrijven; de restwaarde is dan € 3.908,80.
- Banken (aankoop 1 mei 2024): in 2,5 jaar is € 243,51 afgeschreven.

De export bevat **geen levensduur** per toestel. Die zoekt de penningmeester op in e-Boekhouden, of vult hij zelf in.

**Kopen.** Een bankregel voor een nieuw toestel boekt de penningmeester op 0130 en koppelt hem aan een toestel (bestaand, of hij maakt het daar aan). De aanschafwaarde is wat er op 0130 is geboekt voor dat toestel.

**Afschrijven.** Lineair: (aanschafwaarde − restwaarde) gedeeld door de levensduur, per maand. In het jaar van aankoop vanaf de maand van aankoop; een toestel gaat nooit onder zijn restwaarde. Eén knop per jaar, "Afschrijving {jaar} boeken", toont per toestel het bedrag en boekt het totaal op 31 december: debet 4601, credit 0135. Opnieuw drukken in hetzelfde jaar vervangt de boeking (bijvoorbeeld na een nieuw toestel).

**Afvoeren.** Gaat een toestel weg, dan kiest de penningmeester "Afvoeren" met een datum: de afschrijving tot die maand wordt geboekt, daarna de rest van de boekwaarde naar 4601, en het toestel gaat van 0130 en 0135 af. Een opbrengst (verkoop van een oud toestel) boekt hij op 8040. Toestellen op nul die er niet meer staan, voert hij bij de start in één keer af.

## 13. Jaar afsluiten, jaaroverzicht en bewaren

**Jaar afsluiten.** Vanaf 1 januari van het jaar erna. De knop toont eerst de controles:
1. alle bankregels van dat jaar zijn geboekt;
2. per geldrekening is het saldo op 31 december gelijk aan dat van de bank;
3. 1000 Kas is gelijk aan wat er volgens de kassa op 31 december in het kluisje hoort;
4. 1030 Mollie is gelijk aan het saldo bij Mollie op 31 december;
5. de afschrijving van dat jaar is geboekt;
6. 1080 Kruisposten staat op nul, of de penningmeester legt uit waarom niet.

Controle 1 moet kloppen. Bij de andere kan de penningmeester toch afsluiten met een toelichting; die komt in het jaaroverzicht. Daarna boekt de app het resultaat (opbrengsten min kosten) naar 1400 Eigen vermogen, zet het jaar op slot en zet de beginbalans van het volgende jaar klaar. De winst-en-verliesrekening van het afgesloten jaar blijft zichtbaar zoals vóór het afsluiten.

**Heropenen.** Vindt de kascommissie een fout, dan kan de penningmeester het jaar heropenen met een reden. Het jaar en de beginbalans van het volgende jaar staan dan weer open tot hij opnieuw afsluit. Heropenen en de reden staan in het jaaroverzicht.

**Jaaroverzicht** (op elk moment te maken, ook voor een open jaar, met "voorlopig" erop):
- een Excel-bestand met de balans (begin en eind), de winst-en-verliesrekening naast het jaar ervoor, per rekening alle mutaties, alle boekingen met hun volgnummer, de lijst speeltoestellen, de controles van het afsluiten en de geschiedenis van gewijzigde boekingen;
- een PDF met de balans en de winst-en-verliesrekening;
- een map (zip) met alle bijlagen, met het volgnummer van de boeking in de bestandsnaam.

Het is te lezen zonder de app. De penningmeester bewaart het buiten de app (bijvoorbeeld op de schijf van de vereniging). Dat is het archief voor de 7 jaar.

**Vergelijkingscijfers 2026.** De penningmeester typt één keer per rekening het totaal van 2026 in, zodat 2027 ernaast staat. De app toont daarbij welke oude rekeningen in een nieuwe zijn opgegaan (§8).

**Bewaren.** In de app wordt niets gewist: geen boekingen, geen bankregels, geen bijlagen. De wekelijkse kopie naar R2 neemt de nieuwe tabellen mee; de bijlagen staan in een eigen bucket, buiten de kopie, en worden nooit opgeruimd.

## 14. Wat er in beheer bijkomt

Een menu-item **Boekhouding** met:
- **Overzicht**: te boeken regels, saldo per geldrekening met de controle tegen de bank, verloopdatum van de ING-toestemming, verschillen met Mollie, en het resultaat tot nu toe.
- **Te boeken** (§10).
- **Boekingen**: zoeken op datum, rekening, bedrag of omschrijving; nieuwe boeking; bijlagen.
- **Rapporten**: balans en winst-en-verliesrekening over een gekozen periode, naast dezelfde periode een jaar eerder; per rekening de mutaties.
- **Mollie** (§11).
- **Speeltoestellen** (§12).
- **Jaar**: beginbalans, vergelijkingscijfers, afschrijving, afsluiten, heropenen, jaaroverzicht.
- **Instellingen**: rekeningen, bron en kenmerk per geldrekening, ING koppelen, rekening per kassacategorie.

Het bestaande Overzicht van beheer krijgt een regel als er iets aandacht vraagt (te boeken regels, verlopende toestemming, een saldoverschil).

## 15. Techniek

Deze keuzes zijn door de bouwer gemaakt; de penningmeester sprak over uitkomsten.

- **Opbouw.** Nieuwe routes onder `/api/admin/boekhouding/*` achter `requireAdmin`, nieuwe pagina's onder `/beheer/boekhouding`, nieuwe tabellen via migraties. De boekhouding leest de tabellen van de kassa (`sales`, `sale_lines`, `handovers`, `categories`) en schrijft er nooit in. De kassa-routes en de iPad veranderen niet.
- **Bedragen.** Hele centen; per boekingsregel één bedrag, debet positief en credit negatief; de som per boeking is nul. Dat wordt bij elke schrijfactie gecontroleerd, en getest.
- **Geplande taak.** Een tweede cron, dagelijks om 02:00 UTC (`0 2 * * *`), naast de bestaande `0 3 * * MON`. De `scheduled`-handler kiest op `controller.cron`. Om 02:00 UTC is de vorige dag in Amsterdam voorbij. De nachtelijke taak: kassadagen bijwerken, ING-regels en -saldo ophalen, Mollie-uitbetalingen en -saldo ophalen, Mollie-uitbetalingen op ING herkennen. Elke stap staat los: mislukt er één, dan gaan de andere door en staat de fout in beheer. De taak blijft binnen 50 databaseaanroepen en 50 externe aanroepen (schrijven in batches; bij veel werk de rest de volgende nacht of met een knop "Nu bijwerken").
- **Enable Banking.** De API wordt aangeroepen met een JWT (RS256) die de Worker tekent met de privésleutel van de applicatie (WebCrypto, `importKey` in pkcs8). Velden volgens hun quick start: `iss` "enablebanking.com", `aud` "api.enablebanking.com", `iat`, `exp` (hoogstens 1 uur), header `kid` = id van de applicatie. Stappen: `POST /auth` (aspsp ING/NL, `psu_type`, `valid_until`, `redirect_url`, `state`), terugkeer met `code`, `POST /sessions`, daarna `GET /accounts/{uid}/transactions` (met vervolgsleutel) en `GET /accounts/{uid}/balances`. ING mag zonder de penningmeester erbij ongeveer vier keer per dag worden bevraagd (PSD2); de app doet het één keer per nacht plus de knop.
- **Mollie.** Een eigen kleine client naast `worker/lib/mollie.ts`, met de tweede sleutel: Payments, Refunds en Chargebacks (lijsten, voor de betalingen van website en QR-code), Settlements (lijst, met de betalingen per uitbetaling), Balances. Niet `settlementAmount` van een betaling gebruiken: dat veld vervalt op 1 januari 2027 volgens Mollie.
- **Bankbestanden** worden in de browser gelezen (de browser kan XML lezen; de Worker zou er rekentijd aan kwijt zijn). De browser stuurt de regels en saldi naar de API; de Worker controleert ze en slaat ze op.
- **Excel en PDF** maakt de browser: Excel met een bibliotheek, de PDF door de pagina af te drukken ("Bewaren als PDF"), de zip met een bibliotheek. Zo blijft de Worker binnen zijn rekentijd.
- **Bijlagen** in een nieuwe R2-bucket `boekhouding-bijlagen` (niet in `kassa-backups`: die wordt opgeruimd tot 26 kopieën). Hoogstens 10 MB per bestand; PDF, JPEG en PNG. Uploaden en downloaden via de Worker, achter de inlog.
- **Testen.** Volgens TDD, zoals fase 1 en 2. Een nagebootste Enable Banking en een uitgebreide nagebootste Mollie, net als `test/fake-mollie.ts`. Geen test praat met de echte diensten. CAMT.053-voorbeelden in de tests zijn verzonnen, met de vorm van het echte bestand.

## 16. Wat de penningmeester zelf doet

1. In Enable Banking de naam van de applicatie verbeteren ("oekhouding" mist de B).
2. De privésleutel van Enable Banking (het `.pem`-bestand) en het id van de applicatie als Worker-secret zetten, met een opdracht die de bouwer in het handboek zet. De sleutel komt nooit in de chat.
3. In het Mollie-dashboard een organisatie-toegangssleutel maken met alleen leesrechten (betalingen, terugbetalingen, uitbetalingen, saldi), en die als Worker-secret zetten.
4. Eén keer de regels instellen voor de betalingen bij Mollie die niet van de kassa komen (welke omschrijving op welke rekening).
5. 2026 afsluiten in e-Boekhouden, met de afschrijving van 2026. Daarna de eindbalans en de lijst vaste activa downloaden.
6. De levensduur per toestel opzoeken.
7. In de app: beginbalans, vergelijkingscijfers 2026, lijst speeltoestellen nakijken, ING koppelen.
8. Elk kwartaal (of vaker) de bankbestanden van de ING-kwartaalrekening en de ASN-rekeningen downloaden en uploaden.
9. Twee keer per jaar de toestemming van ING vernieuwen.
10. Na het afsluiten van een jaar het jaaroverzicht bewaren en aan de kascommissie geven.

## 17. Volgorde

Elke stap is los te gebruiken en gaat pas online met een ja van de penningmeester.

1. **Basis.** Rekeningen, beginbalans, boekingen met bijlagen, bankbestanden inlezen, Te boeken, balans en winst-en-verlies. *Klaar als:* een CAMT.053-bestand van de kwartaalrekening twee keer inlezen geeft de regels één keer; het saldo klopt met het eindsaldo uit het bestand; een geboekte regel staat in de winst-en-verliesrekening; de beginbalans sluit met het uitgerekende eigen vermogen.
2. **Kassa.** Kassadagen en afdrachten. *Klaar als:* de omzet per dag en per soort in de boekhouding is gelijk aan het rapport van de kassa, ook na een terugdraaiing en een nagekomen verkoop; 1000 Kas is gelijk aan "In het kluisje hoort".
3. **ING automatisch.** Koppelen, nachtelijk ophalen, verloopmelding, terugval op bestand. *Klaar als:* regels van ING komen vanzelf binnen, een overlappend bestand geeft geen dubbele regels, en een verlopen toestemming staat in beheer.
4. **Mollie.** Betalingen van website en QR-code, uitbetalingen, kosten, vergelijken. *Klaar als:* betalingen van website en QR-code die bij een regel passen staan per dag geboekt en de rest staat in Te boeken; een uitbetaling op ING wordt vanzelf geboekt met de kosten op 4511; en 1030 is gelijk aan het saldo bij Mollie.
5. **Speeltoestellen.** Lijst, overnemen uit e-Boekhouden, afschrijving, afvoeren.
6. **Jaar afsluiten en jaaroverzicht.** Nodig vóór januari 2028.

Stap 1 en 2 zijn het nuttigst om in januari 2027 te hebben; de rest kan later in 2027.

## 18. Keuzes van de bouwer

Niet met de penningmeester besproken; kunnen worden teruggedraaid:
- Boekingen zijn aan te passen zolang het jaar open is, met geschiedenis. Reden: een volgnummer met tegenboekingen voor elke tikfout maakt het jaaroverzicht onleesbaar voor de kascommissie.
- Afschrijving per maand, in het aankoopjaar vanaf de maand van aankoop.
- Kasverschillen op een eigen rekening 4515.
- De uitbetaling van Mollie wordt geboekt op het moment dat hij op ING binnenkomt, niet wanneer Mollie hem aanmaakt.
- Dubbele bankregels worden herkend aan datum, bedrag, omschrijving en tegenpartij als er geen bankreferentie is.
- Een nieuwe R2-bucket voor bijlagen.
- Excel, PDF en het lezen van bankbestanden in de browser.
- De nachtelijke taak om 02:00 UTC.
- De melding over de ING-toestemming twee weken van tevoren.
- Een nagekomen kassaverkoop in een afgesloten jaar komt op 1 januari van het open jaar.
- Afsluiten mag met toelichting als alleen de controles 2 tot en met 6 niet kloppen.
- Betalingen bij Mollie die niet van de kassa komen, worden per dag per rekening opgeteld tot één boeking, met regels op de omschrijving. Reden: losse dagkaartjes van € 0,60 als losse boekingen maken de boeken onleesbaar.
- 0130 en 0135 heten "Speeltoestellen en inventaris".
- De waarden van de speeltoestellen komen uit de lijst vaste activa, niet uit de balans van e-Boekhouden.
- Een verkeerd getypte afdracht wordt met een gewone boeking gecorrigeerd, niet in de kassa. Reden: de boekhouding schrijft niet in de tabellen van de kassa, en de kluisjesberekening blijft zo onaangeroerd.

## 19. Nog na te gaan

Op de echte diensten, zodra de sleutels er zijn:
- Of pinbetalingen op de terminal (methode `pointofsale`) in de uitbetalingen van Mollie staan zoals iDEAL-betalingen; de eerste (€ 0,60 op 21 november 2026) had op 23 november nog geen uitbetaling. En hoe het kenmerk van een uitbetaling (`05665564.JJMM.NN`) op het ING-afschrift staat.
- Welke `psu_type` ING Zakelijk bij Enable Banking vraagt, hoe lang de toestemming maximaal is, en hoe ver terug de eerste keer regels zijn op te halen.
- Of de bankbestanden van de ING-betaalrekening en ASN een unieke referentie per regel hebben.

## 20. Aan de bouwer

Vrij in te vullen: de opbouw van de tabellen, de indeling van de code, de bibliotheken voor Excel en zip, de vormgeving van de schermen binnen de huisstijl, en de precieze teksten. Te testen: dat elke boeking sluit, dat de kassadagen gelijk zijn aan de kassarapporten, dat dubbele bankregels niet dubbel komen, het afschrijven en afvoeren, het afsluiten en heropenen, en dat de kassa-routes onveranderd blijven.

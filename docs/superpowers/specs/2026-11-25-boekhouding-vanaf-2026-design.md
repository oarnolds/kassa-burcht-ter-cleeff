# Ontwerp: de boekhouding begint op 1 januari 2026

Datum: 25 november 2026
Status: goedgekeurd door de penningmeester op 25 november 2026, met één wijziging: de Revolut-rekening komt niet in de app (§7.1)

Dit ontwerp wijzigt `2026-11-23-boekhouding-design.md` (hierna: het ontwerp van 23-11). Dat ontwerp is gebouwd en staat live vanaf `main` (`a6f0856`), inclusief Eerdere jaren en de begroting. Waar dit ontwerp niets zegt, blijft het ontwerp van 23-11 gelden.

## 1. Waarom

De penningmeester wil heel 2026 als echte boekhouding in de app, niet alleen als vergelijkingscijfers. Zijn vraag (25 november 2026): "stel ik zou toch 2026 willen hebben in de boekhouding. is dat mogelijk?" Na uitleg van de twee mogelijkheden koos hij "Ja, uitwerken" voor heel 2026 als echte boekingen.

Wat het hem oplevert:
- Hij sluit 2026 af in de app, niet in e-Boekhouden. De kascommissie krijgt het jaaroverzicht van 2026 uit de app.
- Hij hoeft de kassa-omzet van 21 november tot en met 31 december 2026 niet meer in e-Boekhouden te typen, en de bankregels vanaf 25 november niet meer in e-Boekhouden te boeken.
- De beginbalans van 2027 volgt vanzelf uit het afsluiten van 2026. Hij hoeft hem niet meer te typen.
- 2027 staat naast een 2026 dat uit dezelfde boeken komt.

De ledenlijst en de incasso blijven voorlopig in e-Boekhouden. Dat hoort niet bij dit ontwerp.

## 2. Wat er verandert ten opzichte van 23-11

| Ontwerp van 23-11 | Nu |
|---|---|
| Eerste boekjaar 2027; 2026 alleen als vergelijkingscijfers (§1, §4, §13). | Eerste boekjaar 2026. |
| Beginbalans 1-1-2027, door de penningmeester getypt (§9). | Beginbalans 1-1-2026, uit het auditbestand van e-Boekhouden. 2027 volgt uit het afsluiten. |
| De app boekt kassa, bank en Mollie vanaf 1-1-2027 (§10, §11). | De kassa vanaf de ingebruikname (21-11-2026); bank en Mollie vanaf de overstap op 25-11-2026 (§6). |
| Wat ervoor ligt, blijft in e-Boekhouden. | Alle boekingen van 1-1-2026 tot en met 24-11-2026 komen uit het auditbestand in de app (§7). |
| Toestellen starten met hun stand van 31-12-2026, na de afschrijving 2026 in e-Boekhouden (§12). | Toestellen starten met hun stand van 31-12-2025; de app boekt de afschrijving 2026 (§8). |
| De penningmeester sluit 2026 af in e-Boekhouden (§16). | Niet meer nodig. |

## 3. Doelen, niet-doelen en wat het een mislukking zou maken

**Doelen**
1. 2026 is een gewoon boekjaar in de app: met beginbalans, alle boekingen, afsluiten, heropenen en jaaroverzicht, zoals elk later jaar.
2. Elke boeking die e-Boekhouden tot en met 24 november 2026 heeft, staat als losse boeking in de app, met datum, omschrijving en bedragen, en is terug te vinden.
3. Vanaf de overstap boekt de app alles zelf, zoals in het ontwerp van 23-11.
4. De penningmeester doet daarvoor zo weinig mogelijk: één bestand downloaden en inlezen, en zijn toestellenlijst opnieuw plakken.

**Niet-doelen**
- De bijlagen van januari tot en met november 2026. Die zitten niet in het auditbestand en blijven in e-Boekhouden. De penningmeester kan er zelf een bij een boeking zetten (§7).
- De omzet van januari tot 21 november 2026 achteraf verdelen naar kiosk en entree. e-Boekhouden boekte die naar betaalwijze (§13).
- Jaren vóór 2026 als echte boekingen. Die blijven vergelijkingscijfers (Eerdere jaren).
- Ledenadministratie en incasso.
- Een koppeling met e-Boekhouden. Het gaat om één overstap; een bestand is genoeg.

**Een mislukking, ook als het technisch werkt**
- Een bankregel, kassadag, uitbetaling of betaling van Mollie staat zowel uit e-Boekhouden als van de app in de boeken, of ontbreekt in allebei, zonder dat het opvalt.
- De balans van 2026 sluit niet, of er komt een saldo dat niemand kan uitleggen.
- Het auditbestand komt in git, in een test of in de chat. Er staan namen, e-mailadressen en omschrijvingen van leden en leveranciers in.
- Opnieuw inlezen geeft dubbele boekingen.
- Er verandert iets op de iPad.

## 4. Randvoorwaarden

Die van het ontwerp van 23-11 (§6) blijven gelden: het gratis abonnement van Cloudflare (ongeveer 10 ms rekentijd per verzoek, 50 databaseaanroepen per verzoek, 5 miljoen gelezen rijen per dag), hele centen, dagen in Europe/Amsterdam, Nederlandse schermteksten, TDD, niet pushen, en niet samenvoegen, deployen of de live database aanraken zonder zijn uitdrukkelijke ja. Daarnaast:
- **Het auditbestand is persoonsgegevens.** Het echte bestand komt nooit in git, in een fixture of in een test. Tests gebruiken een zelfgemaakt bestand met verzonnen namen. Een bouwer mag het echte bestand alleen op deze Mac inlezen om te controleren, met `python3 -I` of in de browser, en meldt dan alleen aantallen en bedragen, nooit namen of omschrijvingen. Een kopie wordt daarna gewist.
- **Het bestand wordt in de browser gelezen**, zoals een bankbestand (CAMT): 350 kB XML lezen past niet in 10 ms in de Worker. De Worker krijgt alleen de omgezette boekingen en controleert ze opnieuw.
- **Niets wordt verwijderd** (ontwerp van 23-11, §9 en §13). Een boeking uit e-Boekhouden die bij opnieuw inlezen niet meer in het bestand staat, wordt leeggemaakt en blijft met zijn geschiedenis bestaan.

## 5. Overwogen aanpakken

**De overstapdatum**

| Aanpak | Afweging |
|---|---|
| 21 november, de eerste dag van de kassa | Eén datum voor alles. Maar e-Boekhouden had op dat moment de bankregels maar tot 15 november. |
| 1 december, een hele maand | Netjes per maand. Maar dan moet de kassa-omzet van 21 tot en met 30 november nog in e-Boekhouden. |
| **25 november 2026 (gekozen)** | De penningmeester koos "de datum van vandaag". Het auditbestand van 25 november heeft ING tot en met 24 november. De kassa boekt de app toch vanaf de eerste dag (21 november), omdat die nooit in e-Boekhouden heeft gestaan. |

**Hoe de boekingen van 2026 overkomen**

| Aanpak | Afweging |
|---|---|
| **Elke boeking apart uit het auditbestand (gekozen)** | Eén bestand (XML Auditfile Financieel 4.0, `.xaf`) met de beginbalans van 1-1-2026 en elke boeking met al haar regels en bedragen. Alles is per boeking terug te vinden; de maandcijfers kloppen. |
| Totalen per maand uit hetzelfde bestand | Iets minder bouwwerk, dezelfde jaarcijfers. Maar een vraag van de kascommissie over één boeking moet dan in e-Boekhouden worden opgezocht. |
| Het mutatieoverzicht (dat de begroting gebruikt) | Bij een gesplitste boeking staat daar alleen het totaal; welke rekening welk deel kreeg, staat er niet in. Niet bruikbaar voor echte boekingen. |
| Een koppeling met e-Boekhouden (API) | Geen bestand nodig, maar een extra sleutel en veel meer bouwwerk voor één overstap. |

De penningmeester koos "Elke boeking".

## 6. Wie boekt wat

Er komen twee data, die nu samen `LEDGER_START` zijn:
- **Begin van de boeken: 1 januari 2026.** Het eerste boekjaar. Jaren daarvoor zijn vergelijkingsjaren.
- **De overstap: 25 november 2026.** Vanaf die dag boekt de app bank en Mollie zelf. Daarvoor komt alles uit e-Boekhouden, behalve de kassa.

| Bron | Uit e-Boekhouden (auditbestand) | Door de app |
|---|---|---|
| ING betaal (1010), ING kwartaal (1011), ASN (1020, 1021) | bankregels tot en met 24-11-2026 | bankregels vanaf 25-11-2026 (Enable Banking en bestanden); eerdere regels in een bestand worden overgeslagen en geteld, zoals nu "vóór de start" |
| Kassa en kluisje (1000, 8011, 8012 enz.) | de oude kas, tot en met 22-11-2026 (e-Boekhouden heeft geen kassa-omzet) | kassadagen en afdrachten vanaf de ingebruikname, 21-11-2026 |
| Mollie (1030) | elke uitbetaling die vóór 25-11 op ING is binnengekomen, als omzet op ING (zo deed e-Boekhouden het; de laatste was op 2-11-2026) | alle betalingen die niet in zo'n uitbetaling zitten, dus in de praktijk die vanaf 1-11-2026, en elke uitbetaling die vanaf 25-11 binnenkomt (§12) |
| Speeltoestellen (0130, 0135, 4601) | niets: in 2026 staat daar tot en met 24-11 niets op, behalve één overboeking van 0800 die wegvalt (§7.1) | de lijst, de afschrijving 2026 en later (§8) |
| Al het andere | alle boekingen tot en met 24-11-2026 | gewone boekingen van de penningmeester |

Bekeken in het auditbestand van 25 november 2026 (alleen aantallen en bedragen, geen namen): 312 boekingen met 632 regels, elk in evenwicht. ING betaal loopt tot en met 24-11, de kas tot en met 22-11, ASN tot en met 15-11. Op 22-11 is de oude kas (€ 268,72) naar 1080 Kruisposten geboekt en op 24-11 als kasstorting op ING; kas en kruisposten staan daarna op nul.

## 7. Het auditbestand inlezen

**Waar.** In beheer, Boekhouding → Instellingen → Eenmalig, naast "Eerdere jaren": **"2026 uit e-Boekhouden inlezen"**. De penningmeester kiest het `.xaf`-bestand. De app leest het in de browser en laat eerst zien, zonder iets op te slaan:
- het boekjaar en de datum waarop het bestand is gemaakt;
- de beginbalans van 1-1-2026 per nieuwe rekening (§9);
- hoeveel boekingen er van 1-1 tot en met 24-11 zijn, en hoeveel er vanaf 25-11 in het bestand staan en worden overgeslagen;
- per oude rekening naar welke nieuwe rekening hij gaat (§7.1);
- per geldrekening het saldo aan het eind van 24-11 volgens het bestand;
- wat niet past (§7.2) en wat er op 24-11 open staat op 1300 en 1700 (§7.3).

Met **"Overnemen"** komen de beginbalans en de boekingen in 2026. Staan er al boekingen uit e-Boekhouden, dan vraagt de app eerst of hij ze mag vervangen (zoals bij Eerdere jaren).

**De boekingen.** Elke boeking (`transaction`) uit het bestand wordt één boeking in de app:
- datum: de boekdatum (`trDt`);
- omschrijving: die van de boeking; een regel krijgt zijn eigen omschrijving als notitie als die anders is;
- regels: per regel de nieuwe rekening en het bedrag, debet positief, credit negatief. Twee regels van één boeking die op dezelfde nieuwe rekening uitkomen, worden opgeteld; een boeking die zo helemaal op nul uitkomt, vervalt en staat in het overzicht als "valt weg";
- bron: nieuw, `eboekhouden`, met als kenmerk het dagboek en het boekingsnummer uit het bestand (bijvoorbeeld `1010:16665`);
- de penningmeester kan zo'n boeking niet wijzigen, net als een kassadag. Corrigeren doet hij met een gewone boeking, of in e-Boekhouden met daarna opnieuw inlezen. Een bijlage zetten mag wel.

**Opnieuw inlezen.** Zolang 2026 open is, mag het bestand opnieuw worden ingelezen, bijvoorbeeld na een correctie in e-Boekhouden. Een boeking met hetzelfde kenmerk wordt bijgewerkt (met geschiedenis als er iets verandert), een nieuwe komt erbij, en een die niet meer in het bestand staat, wordt leeggemaakt. Er komt dus nooit iets dubbel. In een afgesloten jaar weigert de app.

**Weigeren.** De app weigert een bestand dat geen auditbestand is, dat over een ander jaar dan 2026 gaat, of waarin een boeking niet in evenwicht is.

### 7.1 Welke oude rekening waarheen

Volgens de lijst `formerly` van het rekeningschema (ontwerp van 23-11, §8), met de oude nummers die in 2026 voorkomen:

| Oud (e-Boekhouden) | Nieuw | Opmerking |
|---|---|---|
| 0130, 0135, 4601 | 0130, 0135, 4601 | In de beginbalans niet uit het bestand, maar uit de toestellenlijst (§8). In 2026 staat er tot en met 24-11 geen boeking op, behalve de overboeking van 0800 hieronder. Staat er in een later bestand toch een, dan kan "Overnemen" niet (§7.2). |
| 0800 Reservering vervanging speeltoestellen | 0135 | De enige boeking (20-05-2026: 0800 naar 0135, € 73,70) valt daardoor weg. De beginbalans van 0800 gaat op in het eigen vermogen. |
| 1000, 1010, 1011, 1020, 1021, 1080, 1300 | dezelfde | |
| 1012 Revolut | 1080 Kruisposten | Revolut komt niet in de app (zie onder). |
| 1590 | 1300 | |
| 1890 | 1700 | |
| 1400 | 1400 | In de beginbalans rekent de app hem uit (§9). |
| 0801, 9998 | — | Komen alleen met € 0 in de beginbalans voor; ze vallen weg. |
| 4305 → 4304, 4307 → 4306, 4790 → 4514, 4810 → 4502 | | samengevoegd |
| overige kosten en opbrengsten | hetzelfde nummer | |

**1012 Revolut** heeft in 2026 zeven boekingen: wat kleine ontvangsten (8012, samen € 4,20), betalingen voor de website (4513, samen € 114,20) en één overboeking van € 110 vanaf ING via 1080. Het saldo is aan het begin en eind nul. De penningmeester wil Revolut niet in de app: "we hebben daarmee getest maar willen deze niet meer gebruiken" (25 november 2026). Er komt dus geen rekening 1012. De regels op 1012 gaan naar 1080 Kruisposten. Zo blijven de opbrengst en de kosten in 2026 staan, valt de overboeking weg (beide kanten op 1080), en staat 1080 op 24-11 gewoon op nul. Het overzicht noemt bij 1012: "Revolut: niet in de app, via 1080".

### 7.2 Wat niet past

Staat er in een nieuwer bestand een oude rekening die niet in de tabel staat, dan kan de app hem niet zomaar weglaten: de boeking zou dan niet meer sluiten. Het overzicht toont zo'n rekening met een keuzelijst van nieuwe rekeningen; "Overnemen" kan pas als elke rekening een plek heeft. De gekozen plek geldt alleen voor dit inlezen.

Staat er een boeking van 21-11 tot en met 24-11 op 8011 of 8012 (kassa-omzet), dan waarschuwt het overzicht: de app boekt de kassa vanaf 21-11 zelf. De penningmeester haalt zo'n boeking dan weg in e-Boekhouden en leest opnieuw in. In het bestand van 25 november staat er geen.

Staat er in 2026 een boeking op 0130, 0135 of 4601 (een toestel gekocht, afgevoerd of afgeschreven in e-Boekhouden), dan kan "Overnemen" niet. Het overzicht zegt waarom: de toestellen en hun afschrijving lopen in de app via de lijst, en zo'n boeking zou dubbel tellen of los van een toestel staan. De penningmeester haalt hem weg in e-Boekhouden, leest opnieuw in en legt het toestel in de app vast. Alleen een boeking die door het samenvoegen op nul uitkomt (zoals die van 0800 naar 0135), valt gewoon weg. In het bestand van 25 november staat er verder geen.

### 7.3 Open posten bij de overstap

Een factuur die vóór 25-11 in e-Boekhouden is geboekt en vanaf 25-11 wordt betaald, staat op 1300 Nog te ontvangen of 1700 Nog te betalen. De betaling komt dan als bankregel in de app en hoort op 1300 of 1700, niet op een opbrengst of kosten, anders telt hij dubbel.
- Volgens het bestand van 25 november staan 1300 en 1700 (met 1590 en 1890) op 24-11 op nul. De 8 facturen van 18-03-2026 (8004, zakelijke leden) zijn betaald. Contributie via de incasso kwam in 2026 als bankregel op 8000, niet als factuur.
- Staat er in een later bestand op 24-11 iets open op 1300 of 1700, dan toont het overzicht het bedrag met de uitleg: "Boek de betaling hiervan in Te boeken op 1300 (of 1700)." Het handboek zegt hetzelfde. Meer is niet nodig.
- Een factuur die e-Boekhouden vanaf 25-11 maakt (bijvoorbeeld voor een zakelijk lid), komt niet in de app. De betaling boekt de penningmeester gewoon op de opbrengst, zoals elke bankregel.

## 8. Speeltoestellen

De toestellen beginnen met hun stand van 31 december 2025. De app boekt de afschrijving van 2026 op 31 december 2026, met de bestaande knop.
- De penningmeester plakt het overzicht "Vaste activa 2026" uit e-Boekhouden (opnieuw) bij Toestellen. De app neemt nu per toestel de stand **op 1 januari 2026** over in plaats van die van 31 december 2026. Dat overzicht heeft beide: volgens `shared/asset-paste.test.ts` is kolom 2 (geteld vanaf 0) de aanschafwaarde op 1 januari, kolom 4 die op 31 december, kolom 5 de afschrijvingen tot 1 januari en kolom 9 die tot en met 31 december. De app leest dus kolom 2 en 5 in plaats van 4 en 9; de bouwer controleert dat aan de fixture.
- In 2026 is tot en met 24-11 geen toestel gekocht, afgevoerd of afgeschreven in e-Boekhouden (geen regels op 0130 en 4601; op 0135 alleen de overboeking van 0800, die wegvalt). Komt dat in een later bestand toch voor, dan kan "Overnemen" niet (§7.2).
- Staat er live al een geplakte lijst, dan vervangt de nieuwe hem, zolang er nog geen afschrijving of afvoer op die toestellen is geboekt.
- 0130 en 0135 in de beginbalans van 2026 zijn de totalen van die lijst (aanschafwaarde en afschrijvingen tot 1-1-2026), zoals het ontwerp van 23-11 dat voor 2027 deed. Het verschil met e-Boekhouden (daar staat op 1-1-2026 0130 € 185.938,91 en 0135 € −71.623,68) gaat op in het eigen vermogen.
- De restwaarden blijven zoals de penningmeester ze invulde (Stadsbanken nakijken; ontwerp van 23-11, §12).

## 9. De beginbalans van 1 januari 2026

Uit de beginbalans in het auditbestand (`openingBalance`), per nieuwe rekening (§7.1), behalve:
- **0130 en 0135** uit de toestellenlijst (§8);
- **1030 Mollie** is nul. e-Boekhouden boekte een uitbetaling van Mollie pas als omzet wanneer die op ING binnenkwam; de betalingen van december 2025 zitten dus in de uitbetaling van 2 januari 2026 in het bestand. Het saldo bij Mollie van eind 2025 komt daarom niet in de beginbalans;
- **1400 Eigen vermogen** rekent de app uit als sluitpost, zoals in het ontwerp van 23-11 (§9). De beginbalans in het auditbestand sluit zelf niet: er zit € 11.465,95 verschil in. Dat is het oude verschil waarvan de penningmeester zei: "vergeet het verschil". De app toont het eigen vermogen van e-Boekhouden en het verschil, ter informatie.

De beginbalans wordt één boeking op 1-1-2026 met bron `opening`, zoals nu. Het scherm Beginbalans toont hem, maar typen kan niet meer: hij komt uit het bestand en de lijst. Een getypte beginbalans van 2027, als die live al bestaat, wordt leeggemaakt (met geschiedenis), want de beginbalans van 2027 volgt nu uit het afsluiten van 2026.

## 10. Kassa en kluisje

De app boekt kassadagen en afdrachten vanaf de ingebruikname (21-11-2026), zoals de code al doet ("vanaf de ingebruikname én vanaf het begin van de boeken"). Er verandert niets aan de kassa en niets op de iPad.

De kas (1000) in de boeken is dan: wat e-Boekhouden tot en met 22-11 op de kas boekte (daarna nul), plus de kassadagen, min de afdrachten. Het beginbedrag van het kluisje bij de ingebruikname (de eerste telling) is geen boeking (ontwerp van 23-11, §11). Daarom toont het inleesscherm na het overnemen:
- 1000 Kas aan het eind van 24-11 volgens de boeken;
- wat er volgens de kassa op dat moment in het kluisje hoort;
- het verschil.

Is er een verschil, dan boekt de penningmeester het één keer met een gewone boeking. Het handboek zegt hoe: was het wisselgeld van de start uit de oude kas, dan hoort het verschil tussen 1000 en de rekening waar het vandaan kwam; anders op 4515 Kasverschillen. De controle "1000 Kas is gelijk aan het kluisje" bij het afsluiten (ontwerp van 23-11, §13) vangt het ook op.

## 11. Bank

- Bankregels van vóór 25-11-2026 worden niet opgeslagen: uit een bestand worden ze overgeslagen en geteld, en Enable Banking haalt niets van vóór 25-11 op. Dat is hetzelfde als nu met 1-1-2027, maar met de overstapdatum.
- Een regel van vóór 25-11 die e-Boekhouden mist, komt zo nergens binnen. Dat valt op in het verschil tussen de boeken en het banksaldo (scherm Rekeningen). De penningmeester boekt hem dan in e-Boekhouden en leest opnieuw in, of boekt hem met de hand in de app.
- Het saldo van de bank naast de boeken werkt al per datum. Voor 1010 moet het op 24-11 kloppen: volgens het bestand is 1010 dan € 21.734,49.
- Een kasstorting (§10 van 23-11) of eigen overboeking vanaf 25-11 boekt de app zoals nu tegen 1080.

## 12. Mollie

**Leidend is wat e-Boekhouden heeft.** e-Boekhouden boekte elke uitbetaling van Mollie als omzet op ING, op de dag dat die binnenkwam (in 2026 elke maand rond de 1e; de laatste op 2-11-2026, met de betalingen van oktober). De betalingen in zo'n uitbetaling zitten dus al in de boeken. De app boekt alle andere betalingen: in de praktijk die vanaf 1-11-2026, zowel de pin van de kassa (via de kassadag) als website en QR-code (via "Mollie overig"), en elke uitbetaling die vanaf 25-11 op ING binnenkomt (debet 1010, debet 4511 de kosten, credit 1030), zoals nu.

Hoe de app weet welke betalingen al in e-Boekhouden zitten, kiest de bouwer. Twee mogelijkheden:
- per betaling de uitbetaling waar hij in zit (Mollie geeft dat), en per uitbetaling of hij vóór de overstap is verstuurd; of
- de uitbetalingen waarvan het kenmerk (`05665564.JJMM.NN`) in de omschrijving van een ING-boeking in het auditbestand staat.

Zolang het auditbestand niet is ingelezen, boekt de app voor 2026 nog geen betalingen van vóór de overstap, zodat hij niet raadt. Het resultaat moet zijn: 1030 is aan het eind van november gelijk aan het saldo bij Mollie, min een uitbetaling die onderweg is. Het maandoverzicht van Mollie begint bij november 2026; eerdere maanden hebben in de app geen Mollie.

Een uitbetaling die vóór 25-11 door Mollie is verstuurd maar pas vanaf 25-11 op ING binnenkomt, heeft e-Boekhouden niet. Die boekt de app dus zelf, met haar betalingen. (In 2026 komt dat niet voor; de bouwer test het wel.)

## 13. Rapporten, Eerdere jaren, begroting en het jaar 2026

- **Rapporten** gaan vanaf 2026 uit de boeken. Vergelijkingscijfers voor 2026, als de penningmeester die bij Eerdere jaren heeft ingelezen, worden niet meer gebruikt: 2026 komt uit de boeken. Ze worden niet gewist, maar Eerdere jaren laat 2026 niet meer inlezen en zegt waarom.
- **Het meerjarenoverzicht** toont 2026 uit de boeken, de jaren daarvoor uit Eerdere jaren.
- **De begroting** blijft zoals hij is. Een begroting voor 2026 is niet nodig.
- **2026 afsluiten** kan vanaf 1 januari 2027, met de controles van het ontwerp van 23-11 (§13). Controle 1 (alle bankregels geboekt) gaat over de regels vanaf 25-11; controle 4 (1030 gelijk aan Mollie) over 31 december.
- **Het jaaroverzicht 2026** vermeldt bovenaan:
  - dat de boekingen tot en met 24-11-2026 uit e-Boekhouden komen (auditbestand, met de datum waarop het is gemaakt), en dat hun bijlagen in e-Boekhouden staan;
  - dat tot 21-11-2026 op 8011 de contante verkoop en op 8012 de pin- en online-verkoop staat (zo boekte e-Boekhouden het), en pas daarna kiosk en entree.

## 14. Keuzes

**Gemaakt door de ontwerper** (de penningmeester kan ze bij het lezen corrigeren):
1. Revolut (1012) komt niet in de app, op verzoek van de penningmeester; de zeven boekingen van 2026 lopen via 1080 Kruisposten, zodat opbrengst en kosten blijven staan (§7.1). Weglaten kan niet: dan verdwijnen € 114,20 kosten en € 4,20 opbrengst, en blijft er € 110 op 1080 staan.
2. 0800 gaat naar 0135; de beginbalans van 0800 (€ 73,70) en het verschil op 0130 en 0135 gaan op in het eigen vermogen (§7.1, §8).
3. 8011 en 8012 houden hun nummer; het jaaroverzicht legt uit wat ze vóór 21-11 betekenden (§13). Verdelen kan niet: e-Boekhouden weet niet wat er verkocht is.
4. Een verschil in de kas bij de start boekt de penningmeester zelf met een gewone boeking; de app toont het (§10).
5. Boekingen uit e-Boekhouden kan hij niet wijzigen, wel een bijlage bij zetten (§7).
6. Het scherm staat bij Instellingen → Eenmalig, naast Eerdere jaren (§7).
7. Een boeking op 0130, 0135 of 4601 in het bestand houdt "Overnemen" tegen; die hoort in de app via de toestellenlijst (§7.2). In het bestand van 25 november staat er geen.
8. Open posten op 1300 en 1700 bij de overstap toont het overzicht alleen, met uitleg; in het bestand van 25 november zijn er geen (§7.3).

**Aan de bouwer**
- Hoe `LEDGER_START` wordt gesplitst in begin van de boeken en overstap, en welke plek welke datum krijgt. Gebruikt nu in onder meer `worker/db/ledger.ts`, `ledger-reports.ts`, `opening.ts`, `assets.ts`, `budget.ts`, `year.ts`, `bank.ts`, `bank-consent.ts`, `mollie-ledger.ts`, `kassa-ledger.ts`, `worker/routes/admin-ledger-assets.ts`, `shared/budget.ts` en `src/beheer/boekhouding/OpeningPage.tsx` (vast jaar 2027).
- Hoe Mollie bepaalt welke betalingen al in e-Boekhouden zitten (§12).
- Het formaat van de boekingen die de browser naar de Worker stuurt, en in hoeveel verzoeken (binnen 10 ms en 50 databaseaanroepen per verzoek; 312 boekingen).
- Welke kolom van "Vaste activa 2026" de afschrijvingen tot 1 januari zijn (§8).
- Of de nieuwe bron `eboekhouden` een migratie vraagt, en hoe die eruitziet.
- Hoe een live al bestaande beginbalans 2027, toestellenlijst of vergelijkingsjaar 2026 wordt opgevangen (§8, §9, §13). Live wordt alleen gelezen of veranderd met de ja van de penningmeester.

## 15. Live zetten

Pas na zijn ja, per stap, zoals bij het ontwerp van 23-11:
1. samenvoegen in `main`;
2. de migratie, als die er is, op de live database, na het noteren van een herstelpunt;
3. deployen.

Tot het auditbestand is ingelezen, boekt de app in 2026 niets zelf; bankregels en betalingen van Mollie worden wel al opgehaald. Zo krijgen de beginbalans en de boekingen uit e-Boekhouden de eerste nummers van 2026, en weet Mollie welke uitbetalingen al in e-Boekhouden staan (§12). Daarna haalt de app de kassa vanaf 21-11, ING vanaf 25-11 en Mollie vanaf november in. (Aangescherpt in het bouwplan van 25-11.)

Daarna doet de penningmeester zelf, in beheer: de toestellenlijst plakken (§8), het auditbestand inlezen en overnemen (§7), en de controles nalopen (§10, §11, §12). Het inlezen doet hij zelf; niemand anders zet gegevens in de live database.

Het liefst staat dit live vóór 1 januari 2027, zodat er geen beginbalans van 2027 getypt hoeft te worden.

## 16. Wat de penningmeester zelf doet

1. **Klaar:** het auditbestand van 2026 gedownload op 25 november 2026, met ING tot en met 24 november.
2. **In e-Boekhouden vanaf nu niets meer boeken voor 2026**, behalve als hij een fout vindt van vóór 25 november: dan corrigeert hij die daar en leest het bestand opnieuw in. Ledenlijst en incasso blijven daar.
3. **ASN**: e-Boekhouden heeft ASN tot en met 15 november. Is er van 16 tot en met 24 november iets op ASN gebeurd, dan boekt hij dat eerst in e-Boekhouden en downloadt het auditbestand opnieuw.
4. **Na het live zetten:**
   - "Vaste activa 2026" opnieuw plakken bij Toestellen;
   - het auditbestand inlezen en overnemen;
   - een verschil in de kas, als het er is, boeken (§10);
   - de saldi van ING en ASN naast de boeken bekijken.
5. **Niet meer nodig:** 2026 afsluiten in e-Boekhouden, de eindbalans downloaden en de beginbalans van 2027 typen.

## 17. Nog na te gaan

- Of er live al een beginbalans 2027, een toestellenlijst of vergelijkingscijfers voor 2026 staan. De bouw vangt alle gevallen op; live kijken gebeurt bij het live zetten, met zijn ja.
- Of de uitbetaling van Mollie van begin december 2026 alle betalingen van november bevat. Het maandoverzicht van Mollie laat het zien.

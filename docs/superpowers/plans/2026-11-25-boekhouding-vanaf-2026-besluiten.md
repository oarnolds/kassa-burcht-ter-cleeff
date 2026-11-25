# Boekhouding vanaf 2026: besluiten van de bouwer

Hoort bij het plan `2026-11-25-boekhouding-vanaf-2026.md` en het ontwerp `../specs/2026-11-25-boekhouding-vanaf-2026-design.md`. Waar dit bestand niets zegt, gelden de besluiten van 23-11 (`2026-11-23-boekhouding-besluiten.md`).

Tijdens het bouwen (25 november 2026, taak voor taak, met per taak een frisse bouwer en een frisse controleur) heeft de bouwer (Claude) besluiten genomen waar het plan of het ontwerp geen antwoord gaf, of waar het plan niet klopte. Hieronder staan ze allemaal, met wat het kost als het besluit verkeerd blijkt. Daarna volgen: wat er op het echte auditbestand is gecontroleerd, de stappen om live te zetten (voorbereid, niet gedaan), wat live nog moet worden nagekeken, en de kleine punten uit de controles die bewust zijn blijven liggen. Onderaan staan de oorspronkelijke regels uit het bouwlogboek, letterlijk (in het Engels).

Stand: taken 1 tot en met 10 zijn af. Taken 1 tot en met 9 zijn elk door een eigen controleur nagekeken. Daarna is de hele tak nog eens nagekeken; wat die laatste controle vond, is in één ronde opgelost (besluit 57 tot en met 63). Na die ronde slaagde alles: 624 tests van de app, 526 van de Worker, de typecontrole, en 33 van de 33 tests die de kassa en beheer in de browser nalopen. Er is niets samengevoegd in `main`, niets online gezet, en de live database is niet aangeraakt.

## Besluiten

### Opzet

1. Gebouwd in de werkmap `objective-booth-5ca1b3`, op de tak `claude/musing-banach-c5220b`, bovenop `main` (`a6f0856`) met het ontwerp en het plan erin. Het plan noemde de tak `claude/objective-booth-5ca1b3`. *Kost:* niets; `main` kan er zonder samenvoegcommit naartoe.
2. Geen enkele bouwer heeft het echte auditbestand gezien. De leidende sessie maakte er op deze Mac een kopie van zonder namen en omschrijvingen, liet de lezer van de app erop los en noteerde alleen aantallen en bedragen. De kopie en de uitkomsten zijn daarna gewist. Het testbestand van de app is verzonnen; het volgt alleen de opbouw van het echte bestand (R2). *Kost:* een verschil in de vorm van het bestand valt pas op bij de controle op het echte bestand. Die is gedaan en vond twee verschillen (besluit 17 en 31).
3. Wat zowel de Worker als het scherm nodig heeft (hoogstens 40 boekingen per verzoek, de stand van het inlezen, de samenvatting na Overnemen), staat op één gedeelde plek, `shared/ledger-types.ts` (R4). *Kost:* niets.

### De drie data

Antwoord op de eerste vraag "Aan de bouwer" in het ontwerp (§14): hoe `LEDGER_START` is gesplitst, en welke plek welke datum krijgt.

4. **Begin van de boeken: 1 januari 2026** (`LEDGER_START`). Geldt voor de jaren, de rapporten, de beginbalans, de toestellen, de begroting, het afsluiten en het jaaroverzicht. De kassa boekt vanaf de ingebruikname, maar nooit vóór deze datum. Het scherm Beginbalans had 2027 vast staan; het neemt nu het eerste jaar van de boeken. *Kost:* niets; zo staat het in het ontwerp.
5. **De overstap: 25 november 2026** (`OVERSTAP`). Geldt voor alles van de bank: een bankbestand (eerdere regels worden overgeslagen), een ingetypte regel (een eerdere datum wordt geweigerd), het vanzelf boeken van bankregels, en het ophalen bij ING (nooit vóór 25 november). De boekingen uit e-Boekhouden lopen tot en met de dag ervoor. *Kost:* een bankregel van vóór 25 november die e-Boekhouden mist, komt nergens binnen. U ziet het als verschil met het banksaldo. Boek hem dan in e-Boekhouden en lees opnieuw in, of boek hem met de hand in de app.
6. **Mollie: 1 november 2026** (`MOLLIE_START`). Geldt voor de betalingen, terugbetalingen en terugboekingen, voor de maanden op de pagina Mollie, en voor "onderweg naar ING". De uitbetalingen leest de app al vanaf 1 oktober 2026, zodat die van 2 november bekend is. *Kost:* zie besluit 29.

### De app wacht op het auditbestand

7. Er is één poort voor de hele app. Zolang het auditbestand niet is ingelezen, boekt de app niets zelf: geen kassadag, geen bankregel, geen Mollie, ook niet na 2026. De poort gaat open bij het eerste Overnemen en blijft daarna open. *Kost:* leest u het bestand niet in, dan boekt de app helemaal niets zelf. Het Overzicht zegt dat bovenaan.
8. Een dichte poort laat geen spoor na: er wordt niets geboekt, niets als geboekt gemarkeerd en geen opmerking bij een bankregel gezet. Bankregels, betalingen van Mollie en saldi worden wel bewaard. Alleen een pinbetaling van de kassa wordt bij Mollie al afgevinkt; dat is geen boeking, want die pin zit in de kassadag. *Kost:* niets.
9. Betalingen van Mollie die binnenkwamen terwijl de poort dicht was, worden geboekt bij de eerste keer bijwerken nadat hij open is. Een test legt dat vast (R3). *Kost:* zonder die test konden de betalingen van november ongeboekt blijven.
10. Op het gewone Overzicht van beheer linkt de zin "Lees eerst 2026 in uit e-Boekhouden" naar het Overzicht van de boekhouding. Daar linkt dezelfde zin naar het scherm om in te lezen. *Kost:* één tik extra.
11. De poort onthoudt de datum waarop het auditbestand is gemaakt. Die datum staat in het jaaroverzicht van 2026. *Kost:* niets.

### Migraties

Antwoord op de vraag "Aan de bouwer" of de bron `eboekhouden` een migratie vraagt: ja, twee.

12. **Migratie 0012** bouwt de tabel met boekingen opnieuw op, omdat de database de lijst met toegestane bronnen niet kan aanpassen. Het plan wilde: een nieuwe tabel maken, alles overzetten, de oude weggooien en de nieuwe hernoemen. In de testdatabase liep dat vast bij het afronden: de regels, de geschiedenis, de bijlagen en de bankregels bleven verwijzen naar de weggegooide tabel. De volgorde is daarom: alle boekingen naar een kopie, de tabel weggooien, hem opnieuw maken met `eboekhouden` erbij, alles terugzetten met dezelfde nummers, en de kopie weggooien. Alle rijen, nummers en koppelingen blijven. *Kost:* dit is alleen in de testdatabase op deze Mac bewezen. Op de live database is het gewone SQL in één keer; daarom komt er eerst een herstelpunt (zie "Live zetten").
13. De test van 0012 zet boekingen, regels, geschiedenis, een bijlage en een bankregel in de database, draait dan de opdrachten van 0012 nog eens, en kijkt of alles precies gelijk is gebleven (R1). Het plan wilde de database eerst tot 0011 laten lopen en dan 0012, maar de testopzet zet alle migraties al klaar vóór de eerste test. *Kost:* klein: het is dezelfde SQL, alleen op een database die 0012 al had.
14. **Migratie 0013** zet het jaar 2026 open (R5). Migratie 0006 zette alleen 2027, toen het eerste jaar. 0006 aanpassen kan niet, want live heeft hem al gedraaid. Het is een aparte migratie, omdat de tests alleen de migraties die op `_seed.sql` eindigen opnieuw draaien. *Kost:* vóór het inlezen staat er een leeg, open 2026 bij de jaren; dat klopt ook.
15. Tests die alleen 2027 afsloten om iets "nagekomen" in 2028 te laten komen, sluiten nu 2026 en 2027. *Kost:* niets.

### Het auditbestand lezen

16. Het bestand moet een XML Auditfile Financieel 4.0 zijn. Elk probleem met de opbouw (kapotte XML, een ontbrekende waarde, een bedrag dat niet te lezen is) geeft "Dit is geen auditbestand van e-Boekhouden.". Er is geen vierde foutmelding. *Kost:* bij een kapot bestand ziet u niet precies wat er mis is. Download het dan opnieuw.
17. **Een bedrag met een min.** Het echte bestand heeft één regel met een negatief bedrag. De eerste versie weigerde daardoor het hele bestand. Nu telt de min mee: een negatief bedrag aan de debetkant werkt als credit, en andersom. Het testbestand heeft nu ook zo'n regel. *Kost:* niets; zonder dit kon het echte bestand niet worden ingelezen.
18. De lijst met klanten en leveranciers in het bestand wordt nooit gelezen. *Kost:* niets.

### Rekeningen en beginbalans

19. De beginbalans uit het bestand laat 0130, 0135, 1030 en 1400 weg (R6). 0130 en 0135 komen uit de lijst bij Toestellen; daarmee valt ook de beginbalans van 0800 weg, want 0800 gaat naar 0135. 1030 Mollie begint op nul, en 1400 rekent de app zelf uit. *Kost:* zolang de toestellenlijst er niet is, staan 0130 en 0135 niet in de beginbalans en is het eigen vermogen lager. Na het plakken klopt het.
20. Het inleesscherm toont naast het eigen vermogen van e-Boekhouden het verschil in de beginbalans van e-Boekhouden zelf (op het echte bestand € 11.465,95, het oude verschil). Het heet daarom "Verschil in de beginbalans van e-Boekhouden". Het scherm Beginbalans toont een ander getal, "Verschil met e-Boekhouden", omdat daar 0130 en 0135 uit de lijst komen. *Kost:* twee verschillende verschillen; de namen zeggen welk welk is.
21. De plek van een oude rekening: eerst de vaste lijst (0800 naar 0135, 1012 Revolut naar 1080), dan de lijst "was …" van het rekeningschema, dan uw eigen keuze. Een eigen keuze kan een vaste plek niet veranderen, en geldt alleen voor dit inlezen. *Kost:* niets.
22. Of een rekening een plek nodig heeft, kijkt alleen naar de beginbalans en de boekingen tot en met 24 november. Een onbekende rekening die alleen in een overgeslagen boeking staat (vanaf 25 november), houdt Overnemen niet tegen. *Kost:* niets; die boekingen komen niet in de app.
23. 0801 en 9998 vallen weg zolang ze nul zijn. Hebben ze toch een bedrag, dan vraagt het scherm er een plek voor, zoals bij een onbekende rekening. *Kost:* niets; in het echte bestand zijn ze nul.
24. De regels van een rekening die nog geen plek heeft, houden hun oude nummer tot u kiest. Overnemen wacht tot alles een plek heeft. *Kost:* niets.
25. Een regel krijgt zijn eigen omschrijving als notitie als die anders is dan die van de boeking. Komen twee regels samen op één rekening, dan staan hun notities achter elkaar, met "; " ertussen. *Kost:* niets.
26. Voor een onbekende rekening biedt het scherm alle zichtbare rekeningen aan, behalve 0130, 0135 en 4601 (die zouden Overnemen tegenhouden). *Kost:* u kunt ook een geld- of vermogensrekening kiezen, wat zelden goed is. Kijk uw keuze na.
27. **Vaste activa 2026** (antwoord op "Aan de bouwer"): de aanschafwaarde komt uit kolom 2 (de waarde op 1 januari) en wat al is afgeschreven uit kolom 5 (tot 1 januari), geteld vanaf 0. Nagekeken op het voorbeeld: Straaljager € 9.496,00 aanschaf en € 8.546,40 afgeschreven. *Kost:* een verkeerde kolom geeft een verkeerde stand van de toestellen op 1 januari 2026, en dus een verkeerde beginbalans en afschrijving. De controle bij het afsluiten ziet dat niet, want die vergelijkt met dezelfde lijst. Kijk na het plakken een paar toestellen na in e-Boekhouden.
28. Het scherm Beginbalans zegt "Nog niet ingelezen" als er geen regels zijn en het eigen vermogen nul is. *Kost:* niets in de praktijk.

### Mollie

29. **Welke betalingen al in e-Boekhouden zitten** (antwoord op "Aan de bouwer", §12). Voor de betalingen telt de datum: de app boekt alles vanaf 1 november 2026. Voor de uitbetalingen telt het kenmerk: de app zoekt in de ING-boekingen van het auditbestand het kenmerk van elke uitbetaling (zoals 05665564.2611.01) en bewaart die lijst bij Overnemen. Een uitbetaling uit die lijst telt niet als onderweg en wordt niet nog eens geboekt. *Kost:* een betaling van oktober die in een latere uitbetaling zit, of een van november in de uitbetaling van 2 november, zou missen of dubbel staan. Dan wijkt 1030 af van het saldo bij Mollie. De pagina Mollie en de controle bij het afsluiten laten dat zien.
30. Kenmerken worden alleen gezocht in boekingen tot en met 24 november met een regel op 1010 ING betaal, in de omschrijving van de boeking en van haar regels (R7). Ook de waarschuwing over kassa-omzet kijkt alleen naar die boekingen. *Kost:* niets. Een uitbetaling die e-Boekhouden vanaf 25 november zou hebben geboekt, komt niet in de app; die boekt de app dus zelf.
31. **Een letter vóór het kenmerk.** In het echte bestand staat er een letter direct vóór het kenmerk. Het patroon uit het plan zocht naar een los woord en vond daardoor niets. Nu mag er alleen geen cijfer direct vóór of na staan (R8). Hetzelfde patroon herkent ook de uitbetalingen op ING in de app; de bank geeft daar waarschijnlijk dezelfde tekst. Het patroon is zo geschreven dat ook een oudere Safari op de iPad het kan lezen (R8b). *Kost:* een reeks als 1234567.2611.01 midden in andere tekst wordt voor een kenmerk aangezien. Kent Mollie dat kenmerk niet, dan blijft de regel open met een opmerking; er wordt niets verkeerd geboekt.
32. Een bankregel met een kenmerk dat al in e-Boekhouden staat, blijft in Te boeken staan met "Uitbetaling … staat al in e-Boekhouden.". Dat kan alleen als een regel van vóór 25 november toch binnenkomt. *Kost:* niets.
33. **Een uitbetaling van oktober die laat binnenkomt.** Een uitbetaling die Mollie vóór 1 november deed, die niet in het auditbestand staat en pas vanaf 25 november op ING komt, krijgt geen extra bewaking. Dat komt niet voor: een uitbetaling staat binnen een paar dagen op ING, en elke uitbetaling van 2026 tot en met die van 2 november staat in het bestand (nagekeken op het echte bestand). *Kost:* zo'n uitbetaling wordt tegen 1030 geboekt zonder haar betalingen, en 1030 komt dat bedrag te laag uit. De pagina Mollie en de controle bij het afsluiten laten het zien.
34. De pagina Mollie begint bij november 2026. Een eerdere maand in het adres geeft de huidige maand. *Kost:* niets.

### Inlezen en overnemen

35. **Hoe het scherm de boekingen stuurt** (antwoord op "Aan de bouwer"). Eerst de beginbalans, het eigen vermogen van e-Boekhouden en de lijst met kenmerken. Dan de boekingen, in porties van hoogstens 40. Dan "klaar", met de datum van het bestand en de kenmerken van alle boekingen. Elke boeking heeft een kenmerk (dagboek en nummer, zoals 1010:16665), een datum, een omschrijving en haar regels. Voor de 310 boekingen van het echte bestand zijn dat 8 porties en 10 verzoeken. Een portie kost 2 databaseaanroepen (één keer lezen, één keer schrijven); met de inlog erbij gemeten 3 per verzoek, ver onder de 50. *Kost:* niets.
36. **"Klaar" weigert als er een boeking ontbreekt.** In de eerste versie kon een lege of halve lijst alle ingelezen boekingen leegmaken en de poort openen. Nu weigert de app "klaar" als er ook maar één boeking van de lijst niet met regels in de boeken staat. Het scherm stopt bij de eerste portie die niet lukt en zegt dan nooit "klaar"; opnieuw op Overnemen begint vooraan. *Kost:* de app kijkt of elke boeking er is, niet of het de nieuwste versie is. Daarom stopt het scherm bij de eerste fout.
37. Notities in de geschiedenis: "opnieuw ingelezen uit e-Boekhouden" bij een gewijzigde boeking, en "niet meer in het auditbestand" bij een boeking die is leeggemaakt. *Kost:* niets.
38. **Een getypte beginbalans van 2027** (antwoord op "Aan de bouwer"). Staat die live, dan maakt Overnemen hem leeg, met in de geschiedenis "vervangen: de beginbalans van 2027 volgt uit het afsluiten van 2026", en haalt het getypte eigen vermogen van e-Boekhouden voor 2027 weg. Is 2027 al afgesloten, dan blijft alles staan. *Kost:* niets.
39. **Een geplakte toestellenlijst** (idem). Opnieuw plakken vervangt hem, zolang er nog niets is afgeschreven of afgevoerd. Een restwaarde blijft staan bij een toestel met dezelfde naam. Plakt u vóór het inlezen, dan vult de lijst de beginbalans meteen; plakt u erna, dan wordt de beginbalans opnieuw bewaard. *Kost:* niets.
40. **Vergelijkingscijfers van 2026** (idem). Ze blijven bewaard, maar de rapporten gebruiken ze niet meer: 2026 komt uit de boeken. Eerdere jaren leest een bestand van 2026 niet meer in en zegt waarom. *Kost:* niets.
41. De beginbalans typen kan niet meer: de app weigert het en het scherm heeft geen formulier meer. *Kost:* niets.
42. Bij de start stuurt het scherm de datum van het bestand mee, maar de Worker bewaart die pas bij "klaar". *Kost:* niets.
43. De datum van de ingebruikname gaat als gewone datum naar het scherm, zodat de waarschuwing over kassa-omzet op de goede dag begint (R9). *Kost:* niets.

### Het scherm "2026 uit e-Boekhouden inlezen"

Besluit 20, 26 en 44 tot en met 48 zijn de zeven keuzes van de bouwer van dit scherm. De controleur heeft ze goedgekeurd.

44. Het aantal boekingen dat het scherm noemt, is het aantal dat wordt overgenomen. Wat wegvalt, staat er apart onder. *Kost:* niets.
45. Bij één boeking staat er "1 boeking" en "wordt overgeslagen", niet het meervoud. *Kost:* niets.
46. Bij de geldrekeningen na Overnemen staat 1000 Kas er niet bij. De kas heeft een eigen zin met het kluisje, en heeft nooit een banksaldo. *Kost:* niets.
47. Wat er staat terwijl hij bezig is ("40 van 310"), telt boekingen, geen porties. *Kost:* niets.
48. Het opnieuw indelen na een eigen keuze zit in het deel van de boekhouding dat bij het openen van het scherm wordt geladen; het lezen van het bestand pas als u een bestand kiest. De kassa op de iPad laadt geen van beide. *Kost:* niets.
49. Het verschil naast een bankrekening na Overnemen: het saldo in de boeken aan het eind van 24 november naast het nieuwste saldo van de bank op of vóór 24 november, met de datum van dat saldo erbij. *Kost:* is dat saldo ouder, dan gaan de twee over verschillende dagen. De datum staat erbij.

### Jaar, rapporten en begroting

50. **De begroting begint bij 2027** (R10). Door de verschuiving opende de pagina ineens op 2026. Het ontwerp zegt dat een begroting voor 2026 niet nodig is, dus begint de pagina weer bij 2027; 2026 is nog wel te kiezen. *Kost:* één tik als u ooit toch een begroting voor 2026 wilt.
51. Voor 2027 biedt de begroting nu ook een voorstel uit de boekingen van 2026 aan, zodra 2026 is ingelezen. Dat volgt vanzelf uit de verschuiving. *Kost:* tot 21 november 2026 staat de omzet op 8011 en 8012 naar betaalwijze, niet naar kiosk en entree. Het voorstel neemt dat over.
52. Het jaaroverzicht van 2026 krijgt bovenaan twee zinnen: waar de boekingen tot en met 24-11-2026 vandaan komen, en wat 8011 en 8012 vóór 21-11-2026 betekenden. In de Excel staan ze boven de titel van het eerste blad (Balans), in de PDF onder de titel. Andere jaren krijgen niets. *Kost:* niets.
53. Is de kassa nog niet in gebruik genomen, dan valt de tweede zin weg, want de datum komt van de ingebruikname (R11). Live is dat 21-11-2026. *Kost:* niets in de praktijk.

### Handboek

54. Het handboek raadt aan een kasverschil bij de start te boeken met als datum 21 november 2026, de eerste dag van de kassa. Elke datum tot en met 24 november geeft dezelfde eindstand. *Kost:* niets.
55. Het handboek zegt 1300 en 1700 pas te verbergen als er na het inlezen niets meer op open staat. *Kost:* niets.
56. Het handboek houdt "je", zoals het al was; de schermen en dit bestand zeggen "u". *Kost:* niets.

### Na de laatste controle

De laatste controle van de hele tak vond twee ernstige punten, één belangrijk punt en een paar kleine. Ze zijn in één ronde opgelost. Dit zijn de besluiten die daarbij hoorden.

57. **Overnemen boekt meteen de kassa** (R12). Zolang de poort dicht was, stonden de kassadagen vanaf 21 november nog niet in de boeken. Daardoor toonde de samenvatting na Overnemen het wisselgeld plus de contante verkoop van 21 tot en met 24 november als kasverschil, en het handboek zei dat verschil te boeken. Dan was 1000 Kas later die verkoop te hoog geweest, met een kasverschil dat niemand kon uitleggen. Nu boekt Overnemen de kassa direct nadat de poort opengaat, en rekent pas daarna 1000 Kas uit. Alleen het wisselgeld van de eerste telling kan dan nog verschillen. Lukt het boeken van de kassa op dat moment niet, dan geeft Overnemen toch antwoord en probeert de nachtelijke taak het opnieuw. *Kost:* een paar databaseaanroepen extra bij Overnemen (gemeten: 11 voor het hele verzoek, met 40 kassadagen; de grens is 50). Lukt de kassa bij Overnemen niet, dan klopt de kas in de samenvatting niet; de eerstvolgende keer bijwerken zegt dan dat de kassa niet lukte.
58. **Geen kasverschil op het Overzicht vóór het inlezen** (R13). Zolang het auditbestand niet is ingelezen, staan de kassadagen niet in de boeken, dus zegt een verschil niets. Het Overzicht toont dan geen "Kas wijkt af". *Kost:* niets.
59. **De regels van Mollie vanaf 1 november** (R14). Een betaling via de website of de QR-code zonder regel, een terugbetaling en een terugboeking van 1 tot en met 24 november werden weggelaten: alle regels op een geldrekening werden pas vanaf 25 november bewaard. 1030 zou dan afwijken van het saldo bij Mollie, zonder dat er iets in Te boeken stond. Nu beginnen de regels van Mollie (1030) op 1 november en die van een bank op 25 november. Het vanzelf boeken kijkt op dezelfde manier. *Kost:* niets; zo staat het in het ontwerp (§12).
60. **De toestellenlijst opnieuw plakken** (R15). Een lijst die live is geplakt vóór deze versie, heeft de stand van 31 december 2026. De beginbalans van 2026 zou dan een jaar afschrijving te veel hebben, en de app zou de afschrijving van 2026 nog eens boeken. Niets anders merkt dat op. Migratie 0013 zet daarom een merkteken als er live al geplakte toestellen zijn. Het Overzicht van beheer, het Overzicht van de boekhouding en Toestellen (boven het plakvak) zeggen dan "Plak Vaste activa 2026 opnieuw bij Toestellen: de app neemt nu de stand van 1 januari 2026 over." Opnieuw plakken haalt het merkteken weg. Toestellen haalt daarvoor het overzicht op. *Kost:* een zin extra op drie plekken tot u plakt, en één verzoek extra bij het openen van Toestellen.
61. **Een oud auditbestand** (R16). Is het bestand gemaakt vóór 25 november 2026, dan waarschuwt het scherm vóór Overnemen: "wat na het maken in e-Boekhouden is geboekt, staat er niet in; download het opnieuw." Overnemen kan wel. *Kost:* leest u toch een oud bestand in, dan ontbreken de boekingen van daarna. Het verschil met de bank laat dat zien.
62. **De geldrekeningen na Overnemen** (R17). 1030 Mollie staat er niet meer bij, net als 1000 Kas: Mollie begint in de app op nul. Heeft de bank geen saldo op of vóór 24 november, dan zegt het scherm: "Vergelijk met uw bankapp, of met het overzicht na Nu bijwerken." Bij ING betaal via Enable Banking is dat altijd zo, want die saldi krijgen de datum van het ophalen. *Kost:* niets.
63. **Lange omschrijvingen** (M4). Op het echte bestand nagekeken, alleen getallen: een omschrijving is hoogstens 200 tekens, en een boeking heeft hoogstens 4 regels. De Worker laat 500 tekens per boeking, 1000 per regel en 100 regels toe; dat blijft zo. *Kost:* komt er ooit een langere tekst, dan weigert één portie met een Nederlandse foutmelding. Er wordt niets half geschreven: het scherm stopt en zegt geen "klaar".

## Gecontroleerd op het echte auditbestand

Op 25 november 2026, door de leidende sessie, op een kopie zonder namen en omschrijvingen. Hieronder alleen aantallen, bedragen, data en kenmerken van Mollie.

- 312 boekingen met 632 regels; elke boeking sluit.
- De regels van de beginbalans tellen op tot −11.465,95. De beginbalans van e-Boekhouden sluit zelf niet; dat is het oude verschil.
- 1400 Eigen vermogen in de beginbalans van het bestand: −246.629,12 (op de balans € 246.629,12).
- 310 boekingen worden overgenomen. Er vallen er 2 weg: de memoriaal van 0800 naar 0135 van 20-05-2026, en de overboeking naar Revolut van 20-03-2026.
- 1010 ING betaal aan het eind van 24-11-2026: € 21.734,49.
- 1000 Kas, 1080 Kruisposten, 1300 Nog te ontvangen en 1700 Nog te betalen staan dan op 0.
- Geen rekening zonder plek, geen regel op een toestel-rekening, geen kassa-omzet vanaf de eerste dag van de kassa.
- 11 uitbetalingen van Mollie gevonden, van 05665564.2601.01 tot en met 05665564.2611.01 (de laatste van 2-11-2026).
- Twee dingen die het testbestand niet had, kwamen zo boven: een negatief bedrag (besluit 17) en een letter vóór het kenmerk (besluit 31). Beide zijn opgelost en daarna opnieuw gecontroleerd.

De kopie en de uitkomsten zijn daarna gewist.

## Live zetten: voorbereid, niet gedaan

Elke stap pas na uw ja. Niemand leest of verandert de live database zonder uw ja.

1. **Samenvoegen in `main`.** De tak `claude/musing-banach-c5220b` staat bovenop `main` (`a6f0856`), dus `main` schuift gewoon door, zonder samenvoegcommit.
2. **Herstelpunt, dan de migraties.** Noteer eerst het herstelpunt van de live database:

   ```bash
   npx wrangler d1 time-travel info kassa
   ```

   Schrijf de bookmark en de tijd (UTC) op. Draai daarna de migraties:

   ```bash
   npx wrangler d1 migrations apply kassa --remote
   ```

   Dit zet twee migraties op de live database: 0012 (de tabel met boekingen opnieuw opgebouwd, met de bron e-Boekhouden erbij) en 0013 (het jaar 2026 open, en het merkteken om de toestellenlijst opnieuw te plakken als er live al een staat, besluit 60). Gaat er iets mis, dan kan de database terug naar het herstelpunt:

   ```bash
   npx wrangler d1 time-travel restore kassa --bookmark=<de bookmark van hierboven>
   ```

3. **Deployen.**

   ```bash
   npm run deploy
   ```

**Na het deployen** doet u zelf, in beheer:

- Tot u het auditbestand inleest, boekt de app in 2026 niets zelf. Het Overzicht zegt dat: "Lees eerst 2026 in uit e-Boekhouden (Instellingen → Eenmalig). Tot dan boekt de app niets zelf." Bankregels en betalingen van Mollie worden wel al opgehaald.
- Is er van 16 tot en met 24 november iets op ASN gebeurd? e-Boekhouden heeft ASN tot en met 15 november. Boek dat dan eerst in e-Boekhouden en download het auditbestand opnieuw.
- Plak **Vaste activa 2026** bij **Toestellen**, ook als u de lijst al vóór 25 november 2026 had geplakt: die had de stand van 31 december 2026 (besluit 60). Plakt u vóór het inlezen, dan vullen de toestellen de beginbalans meteen; plakt u erna, dan wordt de beginbalans opnieuw bewaard. Allebei goed.
- Lees het auditbestand in bij **Boekhouding → Instellingen → Eenmalig → 2026 uit e-Boekhouden inlezen** en tik op **Overnemen**. Dat doet u zelf; niemand anders zet gegevens in de live database.
- Kijk na Overnemen de samenvatting na: de kas naast het kluisje, wat er op 1300 en 1700 open staat, en per bankrekening het saldo in de boeken naast dat van de bank. Overnemen heeft de kassadagen vanaf 21 november dan al geboekt (besluit 57): alleen het wisselgeld van de eerste telling kan nog verschillen; boek dat één keer, zie het handboek. In de boeken hoort 1010 dan op € 21.734,49 te staan.
- Tik op **Nu bijwerken** op het Overzicht, of wacht tot de nacht. Dan komen ING vanaf 25 november en Mollie vanaf november erin.

Vooraf live kijken is niet nodig: de app vangt een getypte beginbalans van 2027, een geplakte toestellenlijst en vergelijkingscijfers voor 2026 zelf op (besluit 38 tot en met 40, en 60).

## Live nog na te kijken

- Of er live al een beginbalans van 2027, een toestellenlijst of vergelijkingscijfers voor 2026 staan. De app vangt alle gevallen op.
- Of de uitbetaling van Mollie van begin december 2026 alle betalingen van november bevat. De pagina Mollie laat het zien, bij november.
- Of 1030 Mollie eind november gelijk is aan het saldo bij Mollie, min een uitbetaling die onderweg is.
- Migratie 0012 is alleen in de testdatabase op deze Mac gedraaid. Daarom eerst het herstelpunt.

## Kleine punten die zijn blijven liggen

De controleurs vonden ze. Geen ervan houdt het live zetten tegen; het gaat vooral om ontbrekende tests en kleine netheid.

1. Een paar dingen hebben geen eigen test: dat een ingetypte regel op 25 november wél mag; dat de regels van een rekening zonder plek bij de boekingen blijven; de volgorde van boekingsnummers; meer vormen van een kapot bedrag; enkele en lege tellingen en de extra foutmeldingen op het inleesscherm; een datum met één cijfer in het jaaroverzicht; de ingebruikname zonder ingelezen bestand.
2. Hier en daar staat in de naam of uitleg van een test nog 2027 waar 2026 bedoeld is.
3. De test dat de poort geen extra databaseaanroep kost, vergelijkt niet met een precieze telling.
4. Wordt 2026 precies tussen het lezen en het schrijven van "klaar" afgesloten, dan houdt niets het openen van de poort en het weghalen van het eigen vermogen van 2027 tegen. Dat kan alleen als u in twee vensters tegelijk werkt.
5. Het aantal boekingen in één verzoek wordt pas na het lezen geteld (alleen in beheer, na inloggen).
6. De start bewaart de datum van het bestand niet; "klaar" doet dat (besluit 42).
7. "Klaar" kijkt of elke boeking er is, niet of het de nieuwste versie is; het scherm stopt daarom bij de eerste fout (besluit 36).
8. Voor een onbekende rekening worden ook geld- en vermogensrekeningen aangeboden (besluit 26).
9. De zin bij een boeking uit e-Boekhouden ("Corrigeer hem daar …") hangt niet af van of de boeking te wijzigen is.
10. Is de bewaarde lijst met kenmerken van Mollie beschadigd, dan stopt het vanzelf boeken van bankregels. Alleen de app schrijft die lijst.
11. Het scherm Beginbalans leidt "Nog niet ingelezen" af uit geen regels en eigen vermogen nul (besluit 28); een rekening zonder naam valt terug op het nummer.
12. De test van de begroting kijkt niet meer of er geen voorstel uit boekingen komt voor een jaar vóór de boeken. De regel zelf is niet veranderd.
13. Het jaaroverzicht verwacht de datum van het bestand als gewone datum. Een hulp in de tests zet er een tijdstip in; in de app zet "klaar" altijd een gewone datum.
14. Kleine netheid in tests en code: een opruimstap die niet altijd draait als een test faalt, een dubbele regel in een test, een test die aanneemt dat 1010 een geldrekening is, betalingen in een test die niets toevoegen, een lange regel uitleg, een lijst die op tekst sleutelt, en een vaste tekst waarvan nagekeken moet worden of hij nog wordt gebruikt.

## Uit het bouwlogboek, letterlijk

### Besluiten, letterlijk uit het bouwlogboek

1. R1: Task 3's rebuild test writes data on the migrated DB, then re-runs migration 0012's queries (taken from `env.TEST_MIGRATIONS`) and checks everything survived. Same rebuild path with data present — why: the setup file applies all migrations before any test — cost if wrong: the rebuild on a DB at 0011 is not literally exercised; the SQL is identical, so low.
2. R2: Task 4's implementer does not touch the real file. The controller does the real-file check: a `python3 -I` script in the scratchpad makes a sanitized copy (descriptions/names replaced, customers/suppliers dropped, payout references kept), parseXaf/mapXaf run on it via a temporary, uncommitted vitest file; counts and amounts only; copies deleted afterwards. Before Task 4, the controller extracts the real file's element structure (tag names and counts only) so the fixture mirrors it — why: keeps personal data out of subagents and still tests the real parser — cost if wrong: a structure difference slips through; caught again by the end check.
3. R3: Task 2 adds a test that payments stored while the gate was closed are booked on the first sync after it opens — why: spec §15 "daarna haalt de app … Mollie vanaf november in" — cost if wrong: November payments never booked.
4. R4: MAX_ENTRIES (40), EbStatus and EbSummary live in shared/ledger-types.ts; worker/db/eboekhouden.ts imports and re-exports them — why: the client needs them; LedgerOverview etc. already live there — cost if wrong: none functional.
5. R5 (pending T3): migration 0012 also seeds the 2026 year row (INSERT OR IGNORE … 'open') — why: 0006 seeded only 2027, the first year; firstOpenYear/year lists should see 2026 — cost if wrong: an empty open 2026 row shows before import (accurate anyway).
6. Task 2: implementer dispatched (sonnet), with R3 and: gate global; closed gate leaves no trace; openGate() helper in tests, not in resetData; ledger-test-data eboekhoudenDone true.
7. R5 detail: resetData re-runs only *_seed.sql migrations, so the 2026 seed goes in its own migration `0013_ledger_2026_seed.sql` (INSERT OR IGNORE). Going-online steps then say migrations 0012 and 0013. Editing 0006 is out: live already applied it.
8. Note for T5/T8: e2e/boekhouding.spec.ts types "Beginbalans 1 januari 2027"; PUT /opening is refused in T5 and the form goes in T8 → T8 updates the e2e (opening via a made-up auditfile; *.xaf is gitignored, so the e2e fixture must not end in .xaf or must be generated from shared/fixtures/xaf-2026.ts).
9. R6 (T4): XafPlan.opening leaves out 0130 and 0135 (so 0800's opening, mapped to 0135, drops out too) and 1030, besides 1400 — why: spec §7.1 table "In de beginbalans niet uit het bestand, maar uit de toestellenlijst", §9 "1030 Mollie is nul", §7.1 "De beginbalans van 0800 gaat op in het eigen vermogen" — cost if wrong: before the list is pasted the opening has no 0130/0135 (equity lower by the net book value until pasted; Task 10 tells him to paste).
10. R7 (T4): payouts and kassaLines only from transactions dated before OVERSTAP (the ones imported); payout reference searched in the transaction's and its lines' descriptions — why: a payout e-Boekhouden booked on/after 25-11 is not imported, so the app must book it — cost if wrong: one payout booked twice or never.
11. Task 3: implementer done (a1e17a2, DONE_WITH_CONCERNS). Deviation: rebuild via copy-to-ledger_entries_old / drop / recreate / reinsert (create-new+rename left deferred FK violations at commit in miniflare). 0013 seed broke 7 tests that closed 2027 only; fixed. Reviewer dispatched.
12. Decision for besluiten: migration 0012 rebuild order (copy, drop, recreate, reinsert) instead of the plan's rename — SQLite's deferred FK counter from the DROP is only cleared by reinserting parent rows, not by a rename.
13. R2 real-file check, run 1 (controller, sanitized copy in scratchpad): parseXaf throws not_auditfile — the real file has one transaction line with a NEGATIVE amount ("-9.99" shape) with amntTp D/C. amntTp values: D 318, C 330. → fix-loop item for T4: accept a leading minus (sign = type sign × amount sign), fixture gets a negative amount, test it. Rerun the check after the fix.
14. Task 4: ruling: mapping/unplaced look only at the opening and bookings before OVERSTAP — accounts seen only in skipped bookings must not block Overnemen (spec §7.2 is about what is read in).
15. Task 4: ruling: a choice may place 0801/9998 when they carry an amount — consistent with §7.2 (every account needs a place); cannot occur in the real file.
16. R2 real-file check, run 2 (after e449b36): 312 transactions, 632 lines, opening sum −1146595, 1400 −24662912, ebEquity 24662912, atSwitch 1010 2173449, 1000/1080/1300/1700 0, fallenAway = MEMO 0800 memoriaal (2026-05-20) + 1012 transfer (2026-03-20), unplaced/assetLines/kassaLines empty, 310 entries all balanced, no entry account outside the app. All as the plan expects EXCEPT payouts = [] (expected to end with 05665564.2611.01).
17. Cause (python3 -I on the real file, counts/shapes only): the reference is glued to a letter in e-Boekhouden's ING descriptions (shape " a99999999.9999.99  aa9"), so the leading \b of PAYOUT_REFERENCE never matches; 11 references found with digit boundaries, last 2026-11-02 = 05665564.2611.01.
18. R8: PAYOUT_REFERENCE becomes /(?<!\d)\d{7,8}\.\d{4}\.\d{2}(?!\d)/ (digit boundaries instead of word boundaries), used by both xaf-map and autoBook — why: the real ING description text has a letter glued before the reference; the same ING text likely reaches autoBook via Enable Banking/CAMT, so the old \b would miss payouts there too — cost if wrong: a digit run like 1234567.2611.01 inside other text would be taken for a payout ref (then it stays open with a note; nothing booked wrongly unless Mollie knows that ref).
19. R8b: PAYOUT_REFERENCE without lookbehind: /(?:^|\D)(\d{7,8}\.\d{4}\.\d{2})(?!\d)/, group 1 — why: older iPad Safari (<16.4) cannot parse lookbehind; a SyntaxError would break a whole chunk; spec says nothing may change on the iPad — cost if wrong: none. Sent as F3 in T4 fix round 1.
20. R2 real-file check, run 3 (after 4b5deac, sanitizer fixed to keep glued refs): payouts = 11 refs 05665564.2601.01 … 05665564.2611.01 (last = 2-11-2026), entries 310, atSwitch 1010 2173449, fallenAway 2. All plan values met. (Run 2's empty payouts was partly the sanitizer's own old \b pattern; the code's \b was the real bug too, confirmed by python on the real file.)
21. Sanitized copy and result files deleted from scratchpad after run 3 (scripts kept; regenerate if needed).
22. R9 (T5): EbStatus.inUseSince is the ingebruikname as a business date (YYYY-MM-DD, via businessDate), so the page passes it straight to mapXaf as kassaSince — resolves T4's deferred kassaSince minor at the source — cost if wrong: none.
23. Task 4: fix round 1/5 (3 addressed, 0 open — F1 negative amount, F2 glued payout ref (R8), F3 no lookbehind (R8b); commits eb82ed0..4b5deac)
24. Task 5: fix round 1/5 (1 addressed, 0 open — finishImport refuses missing refs with 409 entries_missing, refs min 1; commits 1c0ff57..188e59b)
25. Task 6: implementer dispatched (opus): stop at first failed chunk, never finish then; kassaSince = status.inUseSince; bankDate shown.
26. Task 6 review: spec ✅, quality Approved. 7 judgment calls accepted (→ besluiten file).
27. Task 7: ruling: a payout settled before MOLLIE_START that is not in e-Boekhouden's list and still arrives on ING from 25-11 gets no guard — it cannot occur in practice (payouts arrive within days; every 2026 payout up to 2-11 is in the list, checked on the real file) — cost if wrong: one payout booked against 1030 without its payments; 1030 goes negative by that amount and the Mollie check on the overview and at closing shows it.
28. Task 8 review: spec ✅, quality Approved. ⚠️ confirmed as a real gap: the Begroting page now opens on 2026 (Math.max(thisYear, FIRST_LEDGER_YEAR)), a change from "opens on 2027" caused by the year move; spec §13 "De begroting blijft zoals hij is. Een begroting voor 2026 is niet nodig."
29. R10: the Begroting page keeps opening on 2027 at the earliest (a named first budget year = FIRST_LEDGER_YEAR + 1); 2026 stays selectable; the e2e workaround (select 2027) goes back out — why: spec §13 — cost if wrong: one click to pick 2026 if he ever wants a 2026 budget.
30. Task 8: fix round 1/5 (1 addressed, 0 open — budget page opens on 2027 via FIRST_BUDGET_YEAR (R10), e2e workaround removed; full e2e 33/33; commits 106c7b4..7d67062)
31. R11 (T9): when the kassa has no ingebruikname (inUseSince null), the second note (8011/8012) is left out — why: its date comes from inUseSince; live has 21-11-2026 — cost if wrong: a jaaroverzicht without that explanation in a case that does not occur live.
32. Final review (opus): With fixes. Critical C1 (kas summary after Overnemen counts float + 21–24 Nov cash as a difference, because the kassa days are not booked yet at finish; page/README tell him to book it), Critical C2 (Mollie no-rule payments, refunds, chargebacks dated 1–24 Nov dropped by storeLines' OVERSTAP floor for 1030), Important I1 (a toestellen list pasted live before this deploy holds the 31-12-2026 state and can silently stay). Minors M1–M7. Deferred-minor triage: only T1 "reversals filter untested" must be fixed (with C2).
33. M4 checked on the real file (python3 -I, numbers only): descriptions max 200 characters (Worker allows 500/1000), max 4 lines per booking (allows 100) → no change needed. Ruling: Worker zod limits stay — the real file is far within them — cost if wrong: a later file with a longer text refuses one chunk with a Dutch error; nothing half-written (page stops, no finish).
34. R12: finishImport runs syncKassa right after opening the gate (errors caught; the nightly run retries), then computes the summary — why: spec §10 defines 1000 "volgens de boeken" including the kassa days; the gate made that impossible at finish — cost if wrong: one extra sync inside the finish request (a few database calls).
35. R13: overview cashDifference is 0 while the gate is closed — why: the difference is meaningless before the import and would push him to book a wrong correction — cost if wrong: none.
36. R14: storeLines floors Mollie-origin lines (1030) at MOLLIE_START, bank lines at OVERSTAP; autoBook likewise for 1030 lines if it handles them — why: spec §12 / decision MOLLIE_START covers payments, refunds and chargebacks from 1-11 — cost if wrong: none.
37. R15: migration 0013 also sets a ledger setting marking a toestellen list pasted before this version (only when pasted assets exist); the Overzicht and Toestellen say "plak opnieuw" until the next paste clears it; README and besluiten say to paste again also if pasted before — why: a list pasted under the old rule holds the 31-12-2026 state; no other check catches it (spec §3, §17) — cost if wrong: one extra sentence on two pages until he pastes.
38. R16: an auditfile made before 25-11-2026 gets a warning on the preview, not a refusal — why: ING lines up to 24-11 might be missing from both systems; a warning is enough, he decides — cost if wrong: he imports an old file after reading the warning; the bank difference shows it.
39. R17: the import summary leaves out 1030 (like 1000) and, without a bank balance on or before 24-11, points him to his bank app or to the Overzicht after Nu bijwerken — why: Enable Banking dates balances on the fetch day, so the comparison would always be empty — cost if wrong: none.
40. Final fix wave: ONE fixer (opus) with C1, C2 (+T1 reversal tests), I1, M1–M3, M5–M7, R12–R17, docs updates. FIX_BASE=520d3c4.

### Kleine punten die zijn blijven liggen, letterlijk

1. Task 1 review: spec ✅, quality Approved. Important "no 2026 ledger_years row" → routed to Task 3 by R5 (migration 0012 seeds 2026; T3 implementer removes hand-inserted 2026 rows in tests that would now conflict). Minors parked for final review: reversals filter (mollie-ledger.ts:332) untested; typed-line test (2026-11-24) cannot fail on this change — no assertion that 2026-11-25 is accepted; stale "2027" in some test names/comments.
2. Task 2 review: spec ✅, quality Approved. Minors parked: gate test "adds no database call" compares closed==1 and open>1 only (no exact baseline); Dashboard gate link goes to /beheer/boekhouding (OverviewPage links the import page).
3. Task 3 review (re-dispatched after a session restart): spec ✅, quality Approved. Minors parked: schema.test cleanup not in finally; redundant INSERT OR IGNORE 2026 in ledger.test.ts:232; money_accounts 1010 assumption. ⚠️ live D1 apply → Task 10: note a Time Travel restore point first (already in plan).
4. Task 4: minor (deferred): kassaSince must be a business date (in_use_since is an ISO moment) → carried into T6 dispatch: pass businessDate(inUseSince).
5. Task 4: minor (deferred): no test pins that an unplaced account's lines stay in entries.
6. Task 4: minor (deferred): malformed amounts only "12,50" tested; numeric nr ordering untested; no guard trDt in 2026 (T5 refuses outside_period anyway).
7. Task 5: minor (deferred): gate key and 2027-equity DELETE not guarded against 2026 closing between read and write (finishImport).
8. Task 5: minor (deferred): entriesBody array uncapped before zod parse (admin-only).
9. Task 5: minor (deferred): openGate() test helper stores an ISO timestamp, while IMPORTED_KEY now holds createdOn (YYYY-MM-DD) → carry into T9 dispatch (notes read the key).
10. Task 5: minor (deferred): startImport ignores input.createdOn.
11. Task 5: minor (deferred): finish guard checks presence, not newest version → T6 page must stop at the first failed chunk and never call finish then.
12. Task 6: minor (deferred): singular/plural forms differ from the brief's plural template; singular and emptied===1 branches untested.
13. Task 6: minor (deferred): unknown-account select also offers money/equity accounts.
14. Task 6: minor (deferred): EntryPage e-Boekhouden line not tied to !editable; explainImport extra codes untested.
15. Task 7: minor (deferred): JSON.parse of PAYOUTS_KEY in autoBook unguarded (only startImport writes it); first-payout test's payments are decoration; long JSDoc line.
16. Task 8: minor (deferred): "not read in" on OpeningPage inferred from empty lines + zero equity; blank name fallback; check FROM_LEDGER still used.
17. Task 8: minor (deferred): BudgetPage test lost the "no bookings proposal for a pre-books base year" assertion (rule itself unchanged).
18. Task 9: minor (deferred): no single-digit date in the notes test; no test inUseSince set without IMPORTED_KEY; dayMonthYear(importedOn) assumes a plain date (openGate writes ISO); key={note}.

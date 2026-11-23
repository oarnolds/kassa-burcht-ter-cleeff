# Kassa Burcht ter Cleeff

## Wat is dit

De eigen kassa van Speeltuin Burcht ter Cleeff. Hij draait als app op de iPad in de kiosk en heeft een beheerdeel voor de penningmeester. Alles staat bij Cloudflare, op één adres:

- **Kassa:** https://kassa-burcht-ter-cleeff.kassa-burcht-ter-cleeff.workers.dev
- **Beheer:** https://kassa-burcht-ter-cleeff.kassa-burcht-ter-cleeff.workers.dev/beheer

De kassa kan aanslaan, contant en pin afrekenen, statiegeld innemen, en houdt de overzichten, het kluisje en de voorraad van de ijsjes bij. Pinnen gaat via Mollie. Zolang de kassa op de testsleutel van Mollie draait, staat er bovenaan een gele balk **TEST**: pinbetalingen zijn dan nagespeeld en er wordt geen geld afgeschreven. Tot de ingebruikname blijft iZettle de echte kassa; in deze kassa staan dan alleen proefverkopen.

Vanaf 1 januari 2027 houdt de app ook de boekhouding van de vereniging bij, in plaats van e-Boekhouden. Zie het hoofdstuk **Boekhouding**.

## Eerste keer instellen

1. Open `/beheer` op een computer of telefoon. De eerste keer vraagt de kassa om een instelcode en een wachtwoord.
2. **Instelcode:** de code die de penningmeester bij het online zetten zelf heeft gekozen (`SETUP_TOKEN`).
3. **Nieuw wachtwoord:** minimaal 10 tekens. Bewaar het in een wachtwoordmanager. Er is één beheerdersaccount.
4. Log daarna in met dat wachtwoord.
5. Ga naar **Kluisje** en leg het beginbedrag vast dat nu als wisselgeld in het kluisje ligt.
6. Ga naar **Producten** en vul bij de ijsjes in hoeveel stuks er in een doos zitten en bij welk aantal je wilt bijbestellen.
7. Ga naar **Voorraad** en leg met **Tellen** vast wat er nu in de vriezer ligt.

## De iPad koppelen

De volgorde is belangrijk: de app op het beginscherm heeft zijn eigen geheugen, los van Safari. Koppel dus in de app, niet in Safari.

1. In beheer: **Instellingen → Nieuwe koppelcode**. De code is 10 minuten geldig.
2. Op de iPad: open het adres van de kassa in **Safari**.
3. Tik op **Deel** (het vierkantje met de pijl) en kies **Zet op beginscherm**.
4. Sluit Safari en open de app **Kassa** vanaf het beginscherm.
5. Vul de koppelcode in, geef de kassa een naam (bijvoorbeeld "iPad kiosk") en tik op **Koppelen**.
6. In de Instellingen van de iPad: **Beeldscherm en helderheid → Automatisch slot → Nooit**, zodat het scherm in de houder aan blijft.

De iPad blijft gekoppeld tot de penningmeester hem in beheer ontkoppelt. De kassa heeft de eerste keer internet nodig; daarna start hij ook zonder.

## Dagelijks gebruik

**Aanslaan.** Tik op een product. Het komt op de bon rechts en de tegel toont het aantal. Nog een tik is nog een stuk.

**Corrigeren.**
- **−** en **+** op een bonregel: een stuk minder of meer.
- **Verwijder**: de hele regel weg.
- **Wis alles**: de bon is meteen leeg. Terughalen kan niet; tik de producten opnieuw aan.

**Contant.** Tik op **Contant**. Betaalt de klant gepast, tik dan op **Gepast** en de verkoop is klaar. Geeft de klant een biljet, tik dan op dat biljet: de kassa toont het wisselgeld. Tik op **Klaar** als je het hebt teruggegeven.

**Bonnetje.** Wil een klant een bon, tik dan na het afrekenen bovenaan op **Bon** (met het deel-symbool). Het deelvenster van de iPad gaat open met een afbeelding van de bon: de producten, het totaal, contant of pin, en het bonnummer. Kies **AirDrop** en de telefoon van de klant; de klant moet AirDrop wel aan hebben staan. De knop staat er tot je het eerste product van de volgende klant aantikt. Een pinbetaling die niet is gelukt, krijgt geen bon. De kassa bewaart of verstuurt de afbeelding verder nergens.

**Pin.** Tik op **Pin**. De kassa toont het bedrag en "Houd pas of telefoon tegen de betaalterminal". De klant betaalt op de terminal; jij hoeft niets te doen. De bon blijft staan tot de betaling is goedgekeurd. Daarna staat er kort "Pin betaald" en is de bon leeg voor de volgende klant. Een pinbetaling komt in het scherm **Omzet** bij pin te staan, niet bij contant, en telt niet mee voor het kluisje.

Wat er anders kan gebeuren:

- **Betaling geweigerd, geannuleerd of verlopen.** De kassa zegt wat er is gebeurd, soms met de reden (bijvoorbeeld "Onvoldoende saldo."). Er is niets geboekt. Je kiest: **Opnieuw proberen** (de terminal vraagt opnieuw om de pas), **Toch contant** (de klant betaalt contant) of **Terug naar de bon** (om de bon aan te passen of later af te rekenen).
- **Annuleren.** Bedenkt de klant zich terwijl de terminal wacht, breek de betaling dan af op de betaalterminal zelf. De kassa toont daarna "Betaling geannuleerd". De knop **Annuleren** op de kassa vraagt Mollie om te annuleren, maar Mollie staat dat niet toe zolang de terminal op een pas wacht (zo bleek bij de proef op 21 november 2026). Dan staat er "Annuleren lukte niet. Kijk op de betaalterminal.": breek af op de terminal, of wacht de uitkomst af.
- **Uitkomst onbekend.** Valt de verbinding weg terwijl de klant betaalt, reageert Mollie niet, of heeft de betaalterminal na 2 minuten nog geen uitkomst, dan weet de kassa niet of het is gelukt. De bon wordt geparkeerd en je kunt verder met **Volgende klant**. Kijk op de betaalterminal: die laat zien of de betaling is goedgekeurd. Onder **Betalingen** staat de betaling als "wacht". De kassa haalt de uitkomst zelf op, zodra er verbinding is en zolang de kassa-app open staat. Is het gelukt, dan staat er kort "Pinbetaling van € … is gelukt". Is het niet gelukt, dan staat er "Pinbetaling van € … is niet gelukt" (zie hieronder). Rondt niemand de betaling af, dan laat Mollie hem na een tijd verlopen; met de testterminal is dat na een kwartier.
- **Toch contant bij een onbekende uitkomst.** Kies in het venster **Toch contant**, of later bij de betaling onder **Betalingen**. Doe dat alleen als de terminal de betaling niet heeft goedgekeurd. Blijkt de pin daarna toch gelukt, dan heeft de klant twee keer betaald. De kassa zegt dan "Pinbetaling van € … is toch gelukt. Er is ook contant afgerekend: geef niets terug, de penningmeester regelt het". Geef dan niets terug aan de kassa: de penningmeester ziet het in beheer ("Mogelijk dubbel betaald") en betaalt één van de twee terug.
- **"Pinbetaling van € … is niet gelukt".** Een geparkeerde betaling is achteraf niet gelukt. Er is niets geboekt. Staat de klant er nog, reken dan opnieuw af. Onder **Betalingen** zie je welke bon het was ("niet gelukt"). De kassa opent hiervoor nooit zelf een venster: je kunt altijd eerst de klant helpen die voor je staat.

Zonder internet kan er niet gepind worden. De knop Pin is dan grijs en eronder staat waarom. Contant werkt gewoon door.

**De balk TEST.** Staat er bovenaan een gele balk "TEST Pinbetalingen zijn nagespeeld: er wordt geen geld afgeschreven.", dan draait de kassa op de testsleutel van Mollie. Er gaat geen echt geld om; in het pinvenster staat dan ook een link "Test: kies de uitkomst bij Mollie" waarmee de penningmeester een betaling laat slagen of mislukken. Zie je de balk terwijl de kassa echt in gebruik is, meld dat dan meteen aan de penningmeester: klanten betalen dan niet echt.

**Statiegeld.** Tik op de tegel **Statiegeld**, typ het aantal ingeleverde stuks en tik op **Toevoegen**. Reken daarna af met **Contant**. Statiegeld telt als inkomst en gaat het kluisje in.

**Verkeerd aangeslagen en al afgerekend.** Op de kassa kun je een afgerekende verkoop niet terugdraaien: één verkeerde tik zou een goede verkoop ongedaan maken. Geef de klant zo nodig het geld terug, schrijf de tijd en het bedrag op en meld het dezelfde dag aan de penningmeester. Die draait de verkoop terug in beheer onder **Verkopen**. Voor een contante verkoop kan dat alleen vóór de volgende afdracht; daarna blijft het een kasverschil met een toelichting. Is er gepind, geef dan geen contant geld terug: de penningmeester betaalt het bedrag terug via Mollie.

**Levering van ijsjes.** Staat er boven in beeld een gele balk **Levering onderweg**, dan heeft de penningmeester een bestelling ingevoerd. Staan de dozen in de vriezer? Tik op de balk, kijk of het klopt en tik op **Ontvangen**. De voorraad wordt bijgewerkt. Klopt de levering niet, bevestig dan toch en geef de afwijking door aan de penningmeester.

**Onderaan het scherm.** Links staat of de kassa online is. Daarnaast staat de laatste betaling die gelukt is, bijvoorbeeld "Laatste betaling: € 0,60 pin · 13:27": zo zie je meteen of de vorige klant betaald heeft. Daarnaast staan de knoppen **Betalingen** en **Omzet**. De bon rechts loopt door tot de onderkant van het scherm.

**Betalingen bekijken.** Tik onderaan op **Betalingen**. Je ziet alle betalingen van vandaag, de nieuwste bovenaan: de tijd, contant of pin, wat er verkocht is, het bedrag en hoe het staat: betaald, wacht, niet gelukt, teruggedraaid, nog niet verstuurd (een contante verkoop die de iPad nog moet versturen) of contant afgerekend. Bij een pinbetaling die nog wacht staat **Toch contant**. Verder is het alleen om te bekijken: terugdraaien doet de penningmeester in beheer. Zonder internet zie je alleen wat op de iPad zelf staat. Tik op **Sluiten** om terug te gaan.

**Omzet bekijken.** Tik onderaan op **Omzet**. Je ziet de omzet van vandaag: het totaal, contant en pin, en wat er per categorie en per product is verkocht. Met **Week** zie je de week van maandag tot en met zondag, met een regel per dag; tik op een datum om die dag te openen. Met de pijltjes ga je een dag of een week terug. Het is alleen om te bekijken: downloaden kan alleen de penningmeester in beheer. Verkopen die nog op verzending wachten tellen pas mee als ze verstuurd zijn; dat staat er dan bij. Zonder internet is de omzet niet te zien. Tik op **Sluiten** om terug te gaan; de bon blijft staan.

**Voorraad op de tegel.** "nog 5" betekent dat die smaak bijna op is, "op?" dat hij volgens de kassa op is. De tegel blijft altijd werken: wat in de vriezer ligt is leidend.

**De regel onderaan.** "Online" betekent dat de kassa verbinding heeft. "Offline · contant werkt door" betekent dat er geen internet is: je kunt gewoon doorwerken, de verkopen worden verstuurd zodra er weer verbinding is. Staat er "… wacht op verzending", dan zijn die verkopen nog niet bij de penningmeester aangekomen. Dat lost zichzelf op. Blijft het langer dan een paar minuten staan terwijl er "Online" staat, meld het dan aan de penningmeester.

## Voor de penningmeester

Alles staat onder `/beheer`. Het werkt op de computer en op de telefoon.

- **Overzicht.** Vandaag en deze maand: omzet (contant en pin apart), aantal verkopen, en wat er in het kluisje hoort te liggen. Staat er bovenaan een kaart **Pin: let op**, dan is er een pinbetaling die nog op bevestiging wacht of een bon die mogelijk dubbel is betaald; de regel brengt je naar de verkopen van die dag.
- **Rapporten.** Kies een maand. Je ziet de omzet per dag, per categorie en per product, met contant en pin in eigen kolommen. Leg de kolom Pin naast de uitbetalingen van Mollie. Onderaan download je de maand als CSV, in twee vormen: dagtotalen en losse verkopen.
- **Verkopen.** De losse verkopen van een dag, contant en pin. Een verkoop terugdraaien kan met een reden. De oorspronkelijke verkoop blijft staan en er komt een tegenboeking bij. Een contante verkoop kun je alleen terugdraaien zolang hij na de laatste afdracht valt. Over pin staat hieronder meer.
- **Kluisje.** Bovenaan staat wat er in het kluisje hoort te liggen. Bij een afdracht vul je in wanneer het kluisje is geleegd, wat je hebt ontvangen en wat er als wisselgeld is achtergebleven. De kassa rekent het verschil uit en bewaart het, met je toelichting. Alle eerdere afdrachten blijven zichtbaar.
- **Voorraad.**
  - *Bijbestellen*: wat op of onder de bestelgrens staat.
  - *Stand*: de voorraad per product. Met **Tellen** leg je vast wat er werkelijk ligt.
  - *Bestelling invoeren*: wat je bij Goodoo hebt besteld, in dozen (losse stuks kan ook). De beheerder ziet dan op de iPad de balk "Levering onderweg".
  - *Onderweg*: bestellingen die nog niet zijn bevestigd. Je kunt ze zelf als ontvangen markeren of laten vervallen.
- **Producten.** Naam, prijs, categorie en volgorde van de tegels (de pijltjes). Een product verberg je in plaats van het te verwijderen, omdat oude verkopen ernaar verwijzen. Hier zet je ook aan of een product een cijferblok opent en of de voorraad wordt bijgehouden. Onderaan staan de categorieën met hun kleur. Een wijziging staat binnen een halve minuut op de kassa.
- **Instellingen.** Een iPad koppelen of ontkoppelen, de betaalterminal voor pin kiezen, het wachtwoord wijzigen, alles downloaden als één bestand, de reservekopie, en de proefgegevens wissen zolang de kassa nog niet in gebruik is.
- **Boekhouding.** Zie het hoofdstuk **Boekhouding** hieronder.
- **Reservekopie.** Elke maandagnacht bewaart de kassa zelf een kopie van alles bij Cloudflare, ook van de boekhouding; de 26 nieuwste blijven staan. De bijlagen van de boekhouding (bonnetjes en facturen) staan daar niet in, zie "Bewaren". Onder **Instellingen** staat wanneer de laatste kopie is gemaakt. Staat daar dat de laatste kopie ouder is dan een week, meld dat dan aan de bouwer. Met **Nu een kopie maken** maak je er zelf een, bijvoorbeeld vlak voor het wissen van de proefgegevens.

### Pin

- **Pin telt nooit mee in het kluisje.** "In het kluisje hoort" en de afdracht gaan alleen over contant geld. Pingeld komt van Mollie op de bankrekening.
- **Een pinverkoop terugbetalen.** De kassa betaalt zelf niets terug. Betaal eerst het hele bedrag terug in het Mollie-dashboard (open daar de betaling en kies terugbetalen). Ga daarna in beheer naar **Verkopen**, kies de verkoop en tik op **Terugdraaien** met een reden. Terugdraaien kan alleen voor het hele bedrag; een deel terugbetalen kan de kassa niet vastleggen.
- **Mogelijk dubbel betaald.** Dit rode label staat op twee verkopen van dezelfde bon: er is contant afgerekend terwijl de pinbetaling nog onbekend was, en de pinbetaling is daarna toch gelukt. Zoek uit wat er is gebeurd (de beheerder weet het vaak nog). Heeft de klant echt twee keer betaald, betaal dan de pinbetaling terug in Mollie en draai die pinverkoop terug. Het label verdwijnt zodra één van de twee is teruggedraaid.
- **Pin: niet gelukt of nog open.** Onder de verkopen van een dag staan de pinbetalingen die geen verkoop zijn geworden: geweigerd, geannuleerd, verlopen, niet gestart, of "Wacht op bevestiging". Ze tellen niet mee in de omzet. Zegt een klant dat hij heeft betaald terwijl de kassa van niet zei, dan zie je hier wat de kassa van Mollie heeft gehoord. Blijft er een betaling lang op "Wacht op bevestiging" staan, kijk dan in het Mollie-dashboard hoe die betaling is afgelopen.
- **De kassa boekt alleen wat Mollie bevestigt.** Een pinverkoop staat pas in de omzet als de server zelf bij Mollie heeft gelezen dat er is betaald. Wat de iPad of de terminal laat zien, is daarvoor niet genoeg.

### Pin instellen (eenmalig, de penningmeester zelf)

De sleutel van Mollie is een geheim. Typ of plak hem alleen in het venster van de opdracht hieronder; zet hem nooit in een bericht, een mail of de code. Ook de bouwer hoeft hem niet te zien.

1. Log in op het Mollie-dashboard en zet bij het websiteprofiel de betaalmethode **Point of sale** aan.
2. Kopieer in Mollie de testsleutel: **Developers → API-sleutels**. Hij begint met `test_`.
3. Open op de computer de Terminal in de map van de kassa en geef de opdracht hieronder. De Terminal vraagt om de waarde; plak daar de sleutel en druk op Enter. De sleutel wordt daarbij niet leesbaar getoond; dat hoort zo.
4. Ga in beheer naar **Instellingen → Pin via Mollie**. Er staat "Testmodus" en een lijst met de testterminal van Mollie. Kies hem en tik op **Opslaan**.
5. Op de iPad staat nu binnen een halve minuut de balk TEST en werkt de knop Pin. Doe een paar proefbetalingen: tik op Pin en dan op de link **Test: kies de uitkomst bij Mollie**. Kies daar betaald, geweigerd of geannuleerd en kijk wat de kassa doet.

```bash
npx wrangler secret put MOLLIE_API_KEY --name kassa-burcht-ter-cleeff
```

Staat er bij Instellingen "De sleutel van Mollie is nog niet ingesteld", dan is stap 3 niet gelukt. Staat er "Mollie accepteert de sleutel niet", dan is de sleutel niet goed overgenomen: doe stap 2 en 3 opnieuw. Staat er "Mollie geeft geen betaalterminal terug", dan staat Point of sale nog niet aan (stap 1).

### Van test naar echt (de penningmeester zelf)

1. Kijk of er geen proefbetaling meer openstaat: in beheer staat op het **Overzicht** geen kaart "Pin: let op" en op de iPad staat onder **Betalingen** geen betaling op "wacht". Een proefbetaling die bij de overstap nog openstaat, blijft op "wacht" staan tot de proefgegevens zijn gewist.
2. Zet de app **Mollie Tap** op de iPhone (iPhone XS of nieuwer) en log in met het account van de speeltuin. De iPhone is dan de betaalterminal tot er een echte terminal in de kiosk staat.
3. Kopieer in Mollie de live-sleutel (begint met `live_`) en zet hem met dezelfde opdracht als hierboven. De nieuwe sleutel vervangt de testsleutel.
4. Ga in beheer naar **Instellingen → Pin via Mollie**. Er staat nu "Echte betalingen." Kies de terminal opnieuw en tik op **Opslaan**: de testterminal bestaat niet voor echte betalingen, dus tot je kiest is de knop Pin op de kassa uit.
5. Kijk op de iPad of de balk TEST weg is. Zolang die er staat, wordt er niet echt afgeschreven.
6. Doe één echte betaling van € 0,60: sla **Entreegeld** aan, tik op Pin en betaal met je eigen pas of telefoon.
7. Kijk het na: op de iPad onder **Omzet** (pin € 0,60), in beheer onder **Verkopen**, en in het Mollie-dashboard.
8. Oefen meteen de weg terug: betaal de € 0,60 terug in het Mollie-dashboard en draai de verkoop terug in beheer.
9. Doe daarna de ingebruikname hieronder, zodat de echte administratie leeg begint.

Terug naar testen kan altijd: zet de testsleutel opnieuw met dezelfde opdracht en kies de testterminal weer. De balk TEST komt dan terug.

**Tijdens de proef** kun je de proefgegevens zo vaak wissen als je wilt: **Instellingen → Proefgegevens wissen**. Verkopen, afdrachten, bestellingen en voorraadmutaties verdwijnen; producten, prijzen en de koppeling met de iPad blijven.

**Bij de ingebruikname** (als pin werkt en de kassa echt de kiosk in gaat):

1. Kijk op de iPad of er onderaan niets meer "wacht op verzending" en niets "afgekeurd" staat. Een proefverkoop die nog op de iPad wacht, komt anders na het wissen alsnog in de echte administratie.
2. **Instellingen → Proefgegevens wissen**, en vink aan: **Dit is de ingebruikname: hierna kan wissen niet meer**.
3. Leg daarna het beginbedrag van het kluisje en de getelde voorraad opnieuw vast.

Vanaf dat moment staat bij Instellingen sinds wanneer de kassa in gebruik is en is de wisknop weg. Zo kan de echte administratie niet per ongeluk worden gewist.

## Als er iets misgaat

**Geen internet.** De kassa werkt door met contant. Onderaan staat hoeveel verkopen wachten op verzending. Ze worden vanzelf verstuurd als er weer verbinding is, en komen één keer in het overzicht. De levering bevestigen en een prijswijziging ophalen kunnen pas weer met internet.

**De knop Pin is grijs.** Onder de knop staat waarom. "Geen internet: pin kan nu niet. Contant werkt door." betekent wat er staat: wacht tot er weer "Online" staat of reken contant af. "Kassa is ontkoppeld: pin kan nu niet." betekent dat de iPad opnieuw gekoppeld moet worden (zie verderop). "Pin is nog niet ingesteld." betekent dat de penningmeester in beheer nog geen betaalterminal heeft gekozen, of dat de sleutel van Mollie ontbreekt. Is de bon leeg, dan zijn beide betaalknoppen grijs.

**"Pin starten lukt niet".** De betaling is niet begonnen en er is niets geboekt. Meestal staat de reden erbij. "De betaalterminal is niet bereikbaar": kijk of de terminal aan staat en internet heeft, en tik op **Opnieuw proberen**. "De betaalterminal is nog bezig met een andere betaling": wacht tot de terminal klaar is (of breek de betaling op de terminal af) en probeer opnieuw. Bij "Mollie weigert de betaling te starten" of "Mollie accepteert de sleutel niet": reken contant af en meld het aan de penningmeester.

**De terminal reageert niet.** Breek de betaling af op de terminal als dat kan; de kassa toont dan "Betaling geannuleerd" en je kunt **Opnieuw proberen**. Lukt dat niet, wacht dan: na twee minuten parkeert de kassa de bon vanzelf, zodat je verder kunt. Blijft er "Betaling wordt gestart…" staan, dan bereikt de kassa Mollie niet; na twintig seconden parkeert hij de bon ("Mollie reageert niet"). Reken alleen contant af met **Toch contant** als de terminal de betaling zeker niet heeft goedgekeurd.

**Een klant zegt betaald te hebben, de kassa zegt van niet.** De kassa boekt alleen wat Mollie bevestigt. Laat de klant niet opnieuw betalen op goed geluk: schrijf de tijd en het bedrag op en meld het aan de penningmeester. Die kijkt in het Mollie-dashboard of de betaling is binnengekomen, en in beheer onder **Verkopen → Pin: niet gelukt of nog open** wat de kassa ervan weet.

**"Verkoop afgekeurd".** Dat hoort niet voor te komen: de server heeft een verkoop niet geboekt. Tik op de rode knop **… afgekeurd · bekijken**. Je ziet per regel de tijd, het bedrag, wat er is verkocht en waarom het is afgekeurd. Geef dat door aan de penningmeester (een foto van het scherm is genoeg) en tik daarna op **Doorgegeven**; daarmee verdwijnt de regel van de iPad. Een afgekeurde verkoop staat niet in de boeken terwijl het geld wel in het kluisje zit: de penningmeester ziet dat bedrag bij de volgende afdracht als "meer dan verwacht" en zet het in de toelichting.

**"Opslaan mislukt. Noteer deze verkoop op papier".** De iPad kon de verkoop niet bewaren (bijvoorbeeld geen opslagruimte). Schrijf de verkoop op en meld het aan de penningmeester.

**"Kassa is ontkoppeld".** De iPad is in beheer ontkoppeld. Verkopen die nog op de iPad wachten blijven bewaard. Maak in beheer een nieuwe koppelcode, tik op de iPad op **Opnieuw koppelen** en vul de code in. De wachtende verkopen worden daarna verstuurd.

**De kassa toont een oude versie.** Sluit de app op de iPad helemaal af (veeg hem weg) en open hem opnieuw. Een nieuwe versie wordt bij het openen opgehaald.

**Wachtwoord kwijt.** Er is geen "wachtwoord vergeten". De bouwer kan het wachtwoord wissen (zie hieronder); daarna stel je het opnieuw in met de instelcode.

**Er is iets verkeerd gewist of gewijzigd.** De database kan worden teruggezet naar een eerder moment, tot 7 dagen terug (D1 Time Travel van Cloudflare). Is het langer geleden, dan is er de wekelijkse reservekopie: tot een half jaar terug, per week. Beide doet de bouwer. Download daarnaast af en toe **Alles downloaden** als eigen kopie buiten Cloudflare, in elk geval na elke maandafsluiting.

## Boekhouding

Vanaf 1 januari 2027 doet de app de boekhouding van de vereniging. Alles staat in beheer onder **Boekhouding**. De boeken beginnen op 1 januari 2027: wat daarvoor gebeurde, ook de omzet van de kassa tot en met 31 december 2026, boek je nog in e-Boekhouden.

Het meeste boekt de app zelf, elke nacht: de omzet van de kassa, de afdrachten van het kluisje, de betalingen bij Mollie, en de regels van ING betaal die hij herkent. Jij boekt wat overblijft, zet de bonnetjes erbij, leest elk kwartaal de bankbestanden in en sluit het jaar af.

### Wat staat waar

- **Overzicht.** Hoeveel regels er te boeken zijn. Per geldrekening het saldo in de boekhouding naast het saldo bij de bank; een verschil staat er in rood, met hoeveel regels daarvan nog te boeken zijn. Tot wanneer ING gekoppeld is, en het resultaat van dit jaar tot nu toe. Met **Nu bijwerken** doet de app meteen wat hij anders 's nachts doet.
- **Te boeken.** De bankregels die op jou wachten. Per bankrekening staat er de knop **Bankbestand inlezen**, en met **Regel intypen** zet je er zelf een regel bij (met een datum tot en met vandaag).
- **Boekingen.** Alle boekingen van een jaar. Zoeken kan op datum, rekening, bedrag of tekst. Hier maak je een **Nieuwe boeking**, bijvoorbeeld voor kosten die aan het eind van het jaar nog betaald moeten worden.
- **Rapporten.** De **Balans** op een datum en **Winst en verlies** over een periode, naast hetzelfde jaar ervoor. Tik op een rekening om de regels ervan te zien.
- **Mollie.** Per maand de pin van de kassa naast die van Mollie, de betalingen via de website en de QR-code, de kosten en het saldo.
- **Toestellen.** De speeltoestellen en de inventaris, de afschrijving per jaar, en afvoeren.
- **Jaar.** Per jaar de controles, **Jaar afsluiten**, heropenen, en het jaaroverzicht.
- **Instellingen.** De rekeningen, per geldrekening het kenmerk en de bron, ING automatisch, de omzet van de kassa, de regels voor Mollie, en onder **Eenmalig** de schermen voor de eerste keer: **Beginbalans** en **Vergelijkingscijfers 2026**.

Op het gewone **Overzicht** van beheer staat een regel zodra er iets te boeken is, een saldo afwijkt, de toestemming van ING bijna afloopt, een deel van de nachtelijke taak niet lukte, de boekhouding langer dan anderhalve dag niet is bijgewerkt, of de kas afwijkt van wat er volgens de kassa in het kluisje hoort.

### De eerste keer

Doe dit in januari 2027, nadat je 2026 in e-Boekhouden hebt afgesloten, met de afschrijving van 2026.

1. **Instellingen → Geldrekeningen.** Vul bij elke bankrekening het **Kenmerk** in en tik op **Opslaan**: het IBAN, of bij de ING-kwartaalrekening het spaarnummer dat met een V begint. Daaraan herkent de app een bankbestand. Een bestand van een andere rekening weigert hij.
2. Kies bij ING betaal waar de regels vandaan komen: **Automatisch via Enable Banking** (zie "ING automatisch") of **Bankbestand uploaden of met de hand**. De andere bankrekeningen werken altijd met een bankbestand of met de hand. De kas volgt de kassa en Mollie volgt Mollie; daar valt niets te kiezen.
3. **Instellingen → Omzet van de kassa.** Kijk na op welke rekening de omzet van elke categorie van de kassa komt (de entree op 8012, de kiosk op 8011) en tik op **Opslaan**.
4. **Instellingen → Regels voor Mollie.** Deze regels zijn voor de betalingen via de website en de QR-code. De app begint met: "dagkaart" en "dagticket" naar 8012 Entree; "lidm", "lidmaatschap" en "verl" naar 8000 Contributie particulier; "reserver" en "verhuur" naar 8010 Verhuur. Een regel erbij: vul **Omschrijving bevat** in, kies de **Rekening** en tik op **Regel toevoegen**. De eerste regel die past, telt. Hoofdletters tellen niet.
5. **Instellingen → Beginbalans.** Typ per rekening het saldo op 31 december 2026 uit de eindbalans van e-Boekhouden en tik op **Opslaan**. Drie rekeningen gaan anders:
   - **1000 Kas (kluisje).** Onder de lijst staat "Volgens de kassa hoort er op 31 december € … in het kluisje". Neem dat bedrag over.
   - **1030 Mollie.** Het saldo bij Mollie op 31 december 2026 (in het Mollie-dashboard): wat Mollie toen nog niet had uitbetaald. Heeft de app dat saldo zelf gelezen, dan staat naast 1030 "Mollie gaf op 31-12-2026: € … (beschikbaar plus nog uit te betalen)"; zo vergelijkt de app later ook met Mollie.
   - **1080 Kruisposten.** Een uitbetaling van Mollie uit december 2026 die pas in januari op ING binnenkomt, is op 31 december geld onderweg. Zet dat bedrag op 1080. Als hij in januari binnenkomt, staat hij in **Te boeken** met de melding "Uitbetaling … is van … (2026): boek hem tegen 1080 Kruisposten …". Boek hem dan op **1080 Kruisposten**.

   Het eigen vermogen (1400) rekent de app zelf uit. Typ ter vergelijking het eigen vermogen uit e-Boekhouden in; de app laat het verschil zien. 0130 en 0135 vult de app zelf zodra de toestellen erin staan (stap 7).
6. **Instellingen → Vergelijkingscijfers 2026.** Typ per rekening het totaal van 2026 uit e-Boekhouden en tik op **Opslaan**. Laat leeg wat nul is. Bij een rekening staat welke oude rekeningen erin zijn opgegaan. Zo staat 2026 in de rapporten naast 2027.
7. **Toestellen.** Boek eerst de afschrijving van 2026 in e-Boekhouden. Kopieer daarna in e-Boekhouden het overzicht **Vaste activa 2026**, plak het bij **Plakken uit e-Boekhouden** en tik op **Overnemen**. Kijk na wat er is gelezen en wat er is overgeslagen. De restwaarde staat niet in dat overzicht: vul hem met **Wijzigen** in bij Dome - Kopan (€ 2.000), Pizza (€ 1.000) en Banken van mei 2024 (€ 2.922,15, de helft), zoals in e-Boekhouden. Kijk de Stadsbanken van 11 juni 2018 na: uit e-Boekhouden volgt een restwaarde van € 3.908,80 (er wordt maar € 3 per jaar afgeschreven), wat op een invoerfout lijkt.
8. **ING koppelen**: zie "ING automatisch" hieronder.

### Elke week of elke maand

- **Te boeken.** Bij elke regel staat al een rekening als die tegenpartij eerder is geboekt. Klopt die, tik dan op **Boeken**. Klopt hij niet, kies dan een andere **Rekening**. Hoort een regel bij meer rekeningen, tik dan op **Verdelen** en vul per rij een rekening en een bedrag in; samen moeten ze het bedrag van de regel zijn.
- **Nu bijwerken.** De app werkt elke nacht zelf bij. Onder de knop **Nu bijwerken** op het Overzicht staat wanneer dat voor het laatst gebeurde, bijvoorbeeld "Vannacht bijgewerkt om 03:00", en in rood elk deel dat niet lukte, bijvoorbeeld "ING is vannacht niet gelukt: unreachable". Staat er "De boekhouding is sinds … niet bijgewerkt", dan heeft de nachtelijke taak meer dan anderhalve dag niet gedraaid: tik op de knop, en meld het aan de bouwer als het blijft. Wil je niet tot morgen wachten, tik dan op de knop.
- **Kasstorting.** Een afdracht die je onder **Kluisje** vastlegt, boekt de app zelf: het geld gaat van 1000 Kas naar 1080 Kruisposten (geld onderweg), een kasverschil naar 4515 Kasverschillen. Maak het bedrag daarna over van je eigen rekening naar ING betaal, met het woord **kasstorting** in de omschrijving. Die regel boekt de app zelf tegen 1080; dan staat 1080 weer op nul. Zonder dat woord komt de regel in Te boeken en boek je hem zelf op 1080 Kruisposten.
- **Bijlagen.** Zet bij een uitgave de factuur of een foto van het bonnetje. In Te boeken: tik bij de regel op **Bijlage**, kies een PDF of maak met de telefoon een foto, en tik op **Boeken**. Later kan ook: open de boeking onder **Boekingen** en tik op **Bijlage toevoegen**. Een PDF, JPEG of PNG, hoogstens 10 MB. Een bijlage gaat nooit weg: **Verbergen** haalt hem uit beeld, het bestand blijft bewaard.
- **Eigen overboekingen.** Geld tussen twee rekeningen van de vereniging boekt de app zelf, aan beide kanten tegen 1080 Kruisposten. Als beide kanten binnen zijn, staat 1080 weer op nul.
- **Een fout verbeteren.** Open de boeking onder **Boekingen** en tik op **Wijzigen** of **Leegmaken**. De app bewaart wat er eerst stond; de kascommissie ziet dat in het jaaroverzicht. Een boeking die de app zelf maakt (een kassadag, een afdracht, Mollie, de afschrijving) kun je niet wijzigen: die volgt de kassa en Mollie. Bij de boeking van een bankregel blijven de regel van de bank en de datum zoals de bank ze gaf; de andere kant en de omschrijving kun je wijzigen. Maak je zo'n boeking leeg, dan komt de bankregel terug bij **Te boeken** (een eigen overboeking of kasstorting boekt de app dan zelf opnieuw). Een verkeerd aangeslagen verkoop draai je terug onder **Verkopen**, zoals altijd. Is bij een afdracht een bedrag verkeerd getypt, maak dan een **Nieuwe boeking** tussen 1080 Kruisposten en 4515 Kasverschillen, met de afdracht in de omschrijving.

### Elk kwartaal: de bankbestanden

De ING-kwartaalrekening en de rekeningen bij ASN haalt de app niet zelf op. Lees hun regels elk kwartaal in, of vaker:

1. Download in ING Zakelijk de af- en bijschrijvingen van de kwartaalrekening, en bij ASN die van ASN MeerSparen en het deposito. Kies als bestandsvorm **CAMT.053** (een bestand dat op .xml eindigt). Laat de periode aansluiten op het vorige bestand; overlappen mag.
2. Ga naar **Te boeken** en tik bij de juiste rekening op **Bankbestand inlezen**. Kies het bestand.
3. De app zegt wat hij heeft gedaan, bijvoorbeeld "3 nieuw, 12 al bekend, 0 vanzelf geboekt.". Een regel die al bekend is, telt niet nog eens mee.
4. Boek de nieuwe regels, bijvoorbeeld de rente op **8030 Rente**.
5. Kijk op het **Overzicht** of het saldo in de boekhouding gelijk is aan het saldo bij de bank.

Lees steeds het hele bestand in, zoals de bank het geeft: haal er niets uit en plak niets samen. Het saldo aan het eind van het bestand is waarmee de app de boekhouding vergelijkt. Staat er "Dit bestand hoort bij een andere rekening", dan heb je bij de verkeerde rekening getikt, of klopt het kenmerk bij **Instellingen** niet.

### ING automatisch

ING betaal haalt zijn regels zelf op via Enable Banking, met jouw toestemming bij ING. Die toestemming geldt ongeveer een half jaar.

1. Vul eerst bij **Instellingen → Geldrekeningen** het IBAN van ING betaal in.
2. Tik bij **Instellingen → ING automatisch** op **ING koppelen**. Je gaat naar ING. Log in en geef toestemming voor de betaalrekening.
3. Je komt terug in beheer met "ING betaal is gekoppeld tot …". ING betaal staat dan op **Automatisch via Enable Banking**.

Daarna haalt de app elke nacht de nieuwe regels en het saldo van ING betaal op.

- **Twee weken voor het einde** staat er op het Overzicht, ook op het gewone Overzicht van beheer, "De toestemming van ING verloopt over … dagen." Tik op **Vernieuwen** en doe stap 2 opnieuw. Reken op twee keer per jaar.
- **Verlopen.** Staat er "ING haalt geen regels meer op: toestemming verlopen.", dan gaat er niets mis, maar komen er geen nieuwe regels bij. Vernieuw de toestemming, of lees een bankbestand van ING betaal in bij **Te boeken**. Dat kan altijd, ook om een gat te vullen: een regel die er al was, telt één keer.
- **Terug naar bestanden.** Stopt Enable Banking, of wil je het niet meer, zet ING betaal dan bij **Instellingen** op **Bankbestand uploaden of met de hand** en lees elke maand een bestand in. Verder verandert er niets.

### Mollie

Wat de app elke nacht zelf boekt:

- **Pin van de kassa.** Die zit al in de kassadag ("Kassa …": contant op 1000 Kas, pin op 1030 Mollie). De betaling bij Mollie wordt alleen afgevinkt.
- **Website en QR-code.** Per dag één boeking "Mollie overig …", per rekening opgeteld volgens de regels voor Mollie (**Instellingen → Regels voor Mollie**). Een betaling waar geen regel bij past, en elke terugbetaling of terugboeking daarvan, komt in **Te boeken** en boek je zelf. Een regel veranderen of weghalen verandert niets aan wat al geboekt is.
- **Uitbetalingen.** Komt een uitbetaling van Mollie op ING betaal binnen, dan herkent de app hem aan het kenmerk in de omschrijving en boekt hem zelf: het bedrag op ING betaal, de kosten op 4511 Bankkosten, en het geheel van 1030 Mollie af.

Staat bij een regel in Te boeken "wacht op Mollie", dan kent de app die uitbetaling bij Mollie nog niet. Meestal is hij er de volgende nacht en boekt de app hem alsnog. Blijft hij wachten, bijvoorbeeld omdat het geen uitbetaling van Mollie is, dan kun je hem zelf boeken. Staat er "Bedrag wijkt af van de uitbetaling bij Mollie", zoek dan uit waarom en boek hem zelf.

De pagina **Mollie** laat per maand zien (met **Vorige maand** en **Volgende maand**):

- **Pin**: de pin in de kassa naast de pin bij Mollie.
- **Alleen in de kassa** en **Alleen bij Mollie**: een pinverkoop zonder betaling bij Mollie, of andersom. Een verkoop van vandaag staat bij "Alleen in de kassa" tot morgen.
- **Overige betalingen** per rekening, en de **Kosten** die Mollie inhield.
- **Saldo**: het saldo bij Mollie naast 1030 in de boekhouding. **Onderweg naar ING** is een uitbetaling die Mollie al heeft gedaan maar die nog niet op ING staat; dat is geen verschil. Een echt verschil staat in rood, bijvoorbeeld als Mollie de aankoop van een terminal van het saldo heeft gehaald. Dat boek je zelf met een **Nieuwe boeking**.

### Toestellen en afschrijving

- **Kopen.** Boek de bankregel van een nieuw toestel in **Te boeken** op **0130 Speeltoestellen en inventaris**. Er komt een keuze voor het toestel bij: kies het toestel, of **Nieuw toestel** en vul de naam, de levensduur in jaren en de restwaarde in. Tik dan op **Boeken**. Het toestel staat daarna onder **Toestellen**, met wat ervoor is betaald als aanschafwaarde.
- **Afschrijving.** Eén keer per jaar, aan het eind: **Toestellen → Afschrijving … boeken**. Je ziet eerst per toestel het bedrag. De app boekt het totaal op 31 december, lineair zoals e-Boekhouden het deed. Koop je daarna in dat jaar nog een toestel, boek dan opnieuw: dat vervangt de vorige boeking. De jaren gaan op volgorde: eerst 2027, dan 2028. Moet een eerder jaar opnieuw, maak dan eerst de latere jaren leeg met **Afschrijving … leegmaken**.
- **Afvoeren.** Gaat een toestel weg, tik dan bij dat toestel op **Afvoeren**, kies de datum, tik nog eens op **Afvoeren** en bevestig. De app boekt de afschrijving tot en met die maand en zet de rest van de boekwaarde op 4601. De afschrijving van het jaar ervoor moet dan al geboekt zijn. Brengt het toestel nog iets op, boek dat apart op **8040 Overige opbrengsten**.

### Het jaar afsluiten

Een jaar sluit je af vanaf 1 januari van het jaar erna, onder **Jaar**.

1. Boek eerst alles van dat jaar: lees de bankbestanden in tot en met 31 december, boek alle regels en boek de afschrijving.
2. Kijk de **Controles** na: alle bankregels geboekt, saldo's gelijk aan de bank, kas gelijk aan de kassa, Mollie gelijk aan het saldo bij Mollie, afschrijving geboekt, kruisposten (1080) op nul, en 0130 en 0135 gelijk aan de lijst toestellen. Wat klopt, krijgt een vinkje; bij de rest staat wat er afwijkt.
3. De controle met **verplicht** erbij moet kloppen: zolang er bankregels van dat jaar te boeken zijn, kan het jaar niet dicht. Klopt een andere controle niet, dan kan het jaar toch dicht als je bij **Toelichting** schrijft waarom. Die toelichting komt in het jaaroverzicht.
4. Tik op **Jaar afsluiten** en bevestig. De app boekt het resultaat naar 1400 Eigen vermogen en zet het jaar op slot. Daarna verandert er niets meer in dat jaar.

De jaren gaan op volgorde: 2028 kan pas dicht als 2027 dicht is. Komt er na het afsluiten nog een kassaverkoop of een Mollie-betaling van dat jaar binnen, dan boekt de app die op 1 januari van het eerste jaar dat nog open is, als "nagekomen".

**Heropenen.** Vindt de kascommissie een fout, dan kun je het laatst afgesloten jaar heropenen: vul de **Reden** in en tik op **Heropenen**. Heropen alleen om iets te verbeteren, en sluit het jaar daarna meteen weer af. Let op: had de app al iets "nagekomen" van een dag in dat jaar op 1 januari van een later jaar geboekt, en verandert er aan die dag nog iets terwijl het jaar weer open is, dan kan dat bedrag twee keer meetellen.

### Het jaaroverzicht

Onder **Jaar** staat bij elk jaar de link **Jaaroverzicht** en drie knoppen:

- **Excel**: één bestand met de balans aan het begin en het eind, de winst-en-verliesrekening naast het jaar ervoor, alle boekingen met hun nummer, per rekening alle regels, de toestellen, de controles, en de geschiedenis van gewijzigde boekingen.
- **PDF**: de balans en de winst-en-verliesrekening. Er gaat een nieuw venster open met het afdrukvenster; kies daar **Bewaar als PDF**.
- **Bijlagen (zip)**: alle bijlagen van het jaar in één map, met het nummer van de boeking in de naam van elk bestand.

Zolang het jaar open is, staat er "Voorlopig" op. Maak het jaaroverzicht als het jaar is afgesloten en geef het aan de kascommissie.

**Bewaren.** De app wist niets: geen boekingen, geen bankregels, geen bijlagen. Toch is het jaaroverzicht het archief. Bewaar de drie bestanden buiten de app, bijvoorbeeld op de schijf van de vereniging, en houd ze 7 jaar. Ze zijn te lezen zonder de app. De wekelijkse reservekopie neemt de boekhouding mee, maar niet de bijlagen: die staan apart bij Cloudflare en worden nooit opgeruimd.

## Voor de bouwer

Eén Cloudflare Worker (Hono, onder `/api`) met een React-app als statische bestanden, en een D1-database. Ontwerp en plan staan in `docs/superpowers/`.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Lokaal staat de instelcode in `.dev.vars` (zie `.dev.vars.example`). Voor pin komt daar `MOLLIE_API_KEY` bij, met de testsleutel van Mollie; de penningmeester vult die zelf in. Voor de boekhouding kunnen daar `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY` en `MOLLIE_ORG_TOKEN` bij; leeg werkt de boekhouding met bankbestanden en slaat hij Mollie over. `.dev.vars` staat niet in git. Lokaal bereikt Mollie de kassa niet (`localhost`), dus er komt geen webhook: de kassa haalt de uitkomst van een betaling zelf op, elke seconde zolang het pinvenster openstaat.

Testen:

```bash
npm test
```

```bash
npm run e2e
```

`npm test` draait de tests van de app en van de Worker. `npm run e2e` bouwt de app en loopt de kassa en de boekhouding na in WebKit op iPad-formaat (1180×820), met een eigen lege database in `.wrangler/e2e`. Die run leest `.dev.vars.e2e` (verzonnen waarden, wel in git) in plaats van `.dev.vars`, en praat met een nagebootste Mollie op poort 4174 (`e2e/global-setup.ts`, `test/fake-mollie.ts`). `.dev.vars.e2e` heeft bewust geen sleutels voor Enable Banking en de organisatie van Mollie. De echte Mollie en de echte Enable Banking worden door geen enkele test aangeroepen; de tests van de Worker gebruiken nagebootste versies (`test/fake-mollie.ts`, `test/fake-enable-banking.ts`) en een sleutel die pas tijdens de test wordt gemaakt. De boekhouding wordt nagelopen met een verzonnen bankbestand uit `e2e/fixtures/`. WebKit bewaart op `http://localhost` geen koekje met Secure, dus daar geeft de test de browser de sessie van de inlog mee (`openBeheer` in `e2e/setup.ts`).

Online zetten (de penningmeester is ingelogd met `npx wrangler login`):

```bash
npx wrangler d1 migrations apply kassa --remote
```

```bash
npm run deploy
```

De instelcode is een geheim van de Worker en staat niet in de code:

```bash
npx wrangler secret put SETUP_TOKEN
```

Pin: de sleutel van Mollie is het geheim `MOLLIE_API_KEY` (zie "Pin instellen"); een sleutel die met `test_` begint zet de kassa in testmodus. De kolommen voor pin komen uit migratie `0004_pin.sql`, die vóór de eerste deploy met pin op de echte database moet staan. Online stuurt de kassa bij elke betaling het adres `/api/mollie/webhook` mee; bij Mollie hoeft daarvoor niets ingesteld te worden. De webhook is niet ondertekend en wordt daarom alleen als seintje gebruikt: de Worker haalt de betaling daarna zelf bij Mollie op.

Terug naar fase 1 (`npx wrangler rollback`, of `main` opnieuw deployen) kan zonder dat de kassa op de iPad stukgaat. De opslag van de kassa (IndexedDB `kassa`) blijft op versie 1, zoals fase 1 hem maakte; de geparkeerde pinbonnen staan in een eigen database (`kassa-pin`), die fase 1 niet ziet. Een server zonder pin antwoordt op een vraag naar een pinbetaling met `not_found`; de kassa van fase 2 laat de bon dan geparkeerd staan, want alleen het eigen antwoord `no_pin_sale` betekent "deze start is nooit aangekomen". Komt fase 2 terug, dan haalt de kassa de uitkomst alsnog op. De kolommen van `0004_pin.sql` kunnen blijven staan: fase 1 gebruikt ze niet.

Database terugzetten naar een eerder moment (tijd in UTC):

```bash
npx wrangler d1 time-travel restore kassa --timestamp=2026-07-31T16:00:00Z
```

De wekelijkse reservekopie staat in de R2-bucket `kassa-backups` als `kassa-JJJJ-MM-DD.json` (zelfde vorm als "Alles downloaden"). De Worker schrijft hem elke maandag om 03:00 UTC (`triggers.crons` in `wrangler.jsonc`, code in `worker/backup.ts`; de dag staat er als `MON`, want bij Cloudflare is dag 1 de zondag) en bewaart de 26 nieuwste. Dit staat aan sinds 21 november 2026: R2 is ingeschakeld in het Cloudflare-account, de bucket bestaat en de twee regels `r2_buckets` en `triggers` staan in `wrangler.jsonc`. Zonder die twee regels draait de kassa gewoon door en meldt beheer dat de wekelijkse kopie niet aanstaat. In een nieuw Cloudflare-account moet R2 eerst in het dashboard worden ingeschakeld (dat vraagt een betaalmethode); daarna wordt de bucket één keer aangemaakt met:

```bash
npx wrangler r2 bucket create kassa-backups
```

Een kopie ophalen:

```bash
npx wrangler r2 object get kassa-backups/kassa-2026-11-23.json --remote --file kassa-2026-11-23.json
```

Terugzetten uit zo'n bestand is handwerk: er is geen knop voor, en het is nog niet geoefend. Let daarbij op drie dingen:

- Verkopen verwijzen naar een kassa (`sales.device_id`), maar kassa's en logins staan bewust niet in de kopie. Maak die kolom leeg bij het terugzetten, of koppel eerst de iPad opnieuw en gebruik dat nummer.
- De voorraad per product (`products.stock`) wordt door de database zelf bijgehouden (migratie 0003). Wie `stock_movements` terugzet bovenop de teruggezette producten, telt de voorraad dubbel. Zet de producten daarom met voorraad 0 terug en daarna pas de mutaties.
- De ingebruikname (`settings.in_use_since`) staat niet in de kopie. Na het terugzetten is "Proefgegevens wissen" weer beschikbaar tot die regel opnieuw is gezet.

De kopie is één bestand met alles en groeit mee met de geschiedenis. Gemeten: 20.000 verkopen (100.000 rijen) geven ongeveer 22 MB en vragen meer rekentijd dan de 10 ms die het gratis abonnement per aanroep noemt. Wordt de kopie daardoor ooit afgebroken, dan staat in beheer dat de laatste kopie ouder is dan een week; de uitweg is het betaalde Workers-abonnement of de kopie per jaar opsplitsen.

Wachtwoord van beheer wissen, waarna `/beheer` opnieuw om de instelcode vraagt:

```bash
npx wrangler d1 execute kassa --remote --command "DELETE FROM sessions; DELETE FROM admin;"
```

De vergrendeling van "Proefgegevens wissen" opheffen (alleen als de ingebruikname per vergissing is aangevinkt):

```bash
npx wrangler d1 execute kassa --remote --command "DELETE FROM settings WHERE key = 'in_use_since';"
```

De pictogrammen voor het beginscherm komen uit `public/icon.svg`:

```bash
npm run icons
```

Afspraken in de code: bedragen zijn hele centen; een dag is een dag in Amsterdam; een verkoop wordt nooit gewijzigd of verwijderd, terugdraaien is een tegenboeking; de iPad bewaart een verkoop eerst zelf en verstuurt hem daarna, en de server boekt dezelfde verkoop nooit twee keer. Voor pin: een pinverkoop begint als "pending" en wordt alleen "paid" als de Worker in datzelfde verzoek "paid" bij Mollie heeft gelezen; één verkoop is één betaling bij Mollie (het nummer van de verkoop is de `Idempotency-Key`), en opnieuw proberen is een nieuwe verkoop.

### De boekhouding

Een dubbele boekhouding naast de kassa: routes onder `/api/admin/boekhouding/*` achter de inlog, schermen in `src/beheer/boekhouding/`, de code van de Worker in `worker/db/` (`ledger.ts` voor de boekingen, verder `bank.ts`, `kassa-ledger.ts`, `mollie-ledger.ts`, `assets.ts`, `year.ts`) en `worker/nightly.ts`. Ontwerp en plan: `docs/superpowers/specs/2026-11-23-boekhouding-design.md` en `docs/superpowers/plans/2026-11-23-boekhouding.md`. De boekhouding leest de tabellen van de kassa en schrijft er nooit in; de kassa-routes en de iPad zijn er niet door veranderd.

**Online zetten**, in deze volgorde, en elke stap alleen met een ja van de penningmeester:

1. De R2-bucket voor de bijlagen moet bestaan vóór de deploy: de binding `ATTACHMENTS` in `wrangler.jsonc` wijst ernaar.

```bash
npx wrangler r2 bucket create boekhouding-bijlagen
```

2. Noteer de tijd in UTC (dan kan Time Travel terug naar vlak ervoor) en zet migraties 0005 tot en met 0010 op de echte database. Ze maken alleen nieuwe tabellen en vullen er een paar: `0005_ledger`, `0006_ledger_seed` (het rekeningschema, de geldrekeningen, de rekening per kassacategorie en het jaar 2027), `0007_bank_consent`, `0008_mollie_ledger`, `0009_mollie_rules_seed` (de eerste regels voor Mollie) en `0010_assets`. De tabellen van de kassa blijven zoals ze zijn.

```bash
npx wrangler d1 migrations apply kassa --remote
```

3. `npm run deploy`.
4. De drie geheimen hieronder: die zet de penningmeester zelf.

**De drie geheimen.** Typ of plak ze alleen in het venster van de opdracht; nooit in een bericht, een mail, de code of een chat. Ook de bouwer hoeft ze niet te zien.

- `ENABLE_BANKING_APP_ID`: het id van de applicatie in het Control Panel van Enable Banking.
- `ENABLE_BANKING_PRIVATE_KEY`: de privésleutel van die applicatie, het `.pem`-bestand dat het Control Panel gaf bij het aanmaken. Het moet PKCS#8 zijn: de eerste regel is `-----BEGIN PRIVATE KEY-----`. De opdracht leest het bestand zelf in, dus de sleutel komt nergens in beeld.
- `MOLLIE_ORG_TOKEN`: een organisatie-toegangssleutel van Mollie (organization access token; alleen een beheerder van het Mollie-account kan hem maken), los van `MOLLIE_API_KEY` van de kassa. Hij heeft alleen leesrechten nodig: voor betalingen (daar horen de terugboekingen bij), terugbetalingen, uitbetalingen, saldi en profielen (`payments.read`, `refunds.read`, `settlements.read`, `balances.read`, `profiles.read`).

```bash
npx wrangler secret put ENABLE_BANKING_APP_ID --name kassa-burcht-ter-cleeff
```

```bash
npx wrangler secret put ENABLE_BANKING_PRIVATE_KEY --name kassa-burcht-ter-cleeff < pad/naar/het-bestand.pem
```

```bash
npx wrangler secret put MOLLIE_ORG_TOKEN --name kassa-burcht-ter-cleeff
```

Een verkeerde sleutel of een verkeerd id van de applicatie geeft bij ING het antwoord "unauthorized". De app kan dat niet onderscheiden van een ingetrokken toestemming: de toestemming staat daarna op verlopen, ook als de sleutel weer goed is, tot ING opnieuw is gekoppeld (**Instellingen → ING automatisch → Vernieuwen**). Zonder de twee geheimen van Enable Banking zegt beheer bij **ING koppelen** dat de koppeling nog niet is ingesteld; zonder `MOLLIE_ORG_TOKEN` slaat de nachtelijke taak Mollie over. ING stuurt de penningmeester terug naar `/beheer/bank`; dat adres van de echte kassa staat ingesteld bij de applicatie in Enable Banking.

**Twee geplande taken** (`triggers.crons` in `wrangler.jsonc`; bij Cloudflare is dag 1 de zondag):

- `0 3 * * MON`: de wekelijkse kopie, elke maandag om 03:00 UTC. Ongewijzigd.
- `0 2 * * *`: de nachtelijke taak van de boekhouding, elke dag om 02:00 UTC (03:00 of 04:00 in Nederland). Hij werkt de kassadagen en de afdrachten bij, haalt de regels en het saldo van ING betaal op, leest bij Mollie de betalingen, terugbetalingen, terugboekingen, uitbetalingen en het saldo, en herkent de uitbetalingen op ING. Elke stap staat los: mislukt er één, dan gaan de andere door en staat de fout in beheer bij **Nu bijwerken**. Die knop doet hetzelfde.

**Het gratis abonnement.** Eén run blijft binnen 50 databaseaanroepen (een batch telt als één) en 50 externe aanroepen: bij Mollie pagina's van 100 en hoogstens 6 pagina's per lijst, bij ING hoogstens 10 vragen om regels plus het saldo. ING wordt gevraagd in blokken van twee weken (`date_from`/`date_to`), het oudste eerst, vanaf een week voor de nieuwste regel van ING betaal die van ING of uit een bankbestand kwam (nooit voor 1 januari 2027) tot en met vandaag. Zijn de 10 vragen op tussen twee blokken, dan wachten de latere blokken op de volgende run; het saldo wordt pas gevraagd als de regels tot en met vandaag binnen zijn. Geeft de bank in een blok meer pagina's dan er nog gevraagd mogen worden, dan bewaart de app niets van dat blok (een half blok zou er compleet uitzien), stopt hij daar en staat ING in rood op het Overzicht met `ing_cut_short`; de blokken ervoor zijn bewaard. Lees dan een bankbestand van die weken in: daarna begint ING na dat bestand. Wat bij Mollie niet past, blijft liggen voor de volgende run, het oudste eerst. Een achterstand, zoals de eerste keer, kost dus meer nachten (of een paar keer **Nu bijwerken**).

**De wekelijkse kopie en "Alles downloaden"** hebben er een deel `ledger` bij met alle tabellen van de boekhouding: `ledger_accounts`, `ledger_years`, `ledger_entries`, `ledger_lines`, `ledger_history`, `ledger_year_events`, `ledger_attachments`, `ledger_settings`, `money_accounts`, `bank_lines`, `bank_balances`, `bank_consents`, `category_accounts`, `comparison_figures`, `mollie_payments`, `mollie_settlements`, `mollie_rules` en `assets`. Van `bank_consents` zit de kolom `session_id` er niet in, want die is een geheim van de koppeling met de bank: na het terugzetten koppelt de penningmeester ING opnieuw. De bijlagen zelf zitten niet in de kopie. Ze staan in hun eigen bucket `boekhouding-bijlagen` (in de kopie staat alleen welke bijlage bij welke boeking hoort) en worden nooit opgeruimd: de app verbergt een bijlage alleen. Buiten Cloudflare staan ze in de zip van het jaaroverzicht.

Afspraken in de boekhouding: elke boeking sluit (debet positief, credit negatief, samen nul), en dat controleert `worker/db/ledger.ts` bij elk schrijven; in een afgesloten jaar verandert niets; niets wordt verwijderd (een boeking wordt leeggemaakt, een bijlage verborgen, een bankregel blijft staan); boekingen die de app zelf maakt, schrijft alleen hun eigen bron (kassa, Mollie, afschrijving, jaarafsluiting); de boeken beginnen op 1 januari 2027.

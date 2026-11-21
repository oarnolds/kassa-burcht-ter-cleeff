# Kassa Burcht ter Cleeff

## Wat is dit

De eigen kassa van Speeltuin Burcht ter Cleeff. Hij draait als app op de iPad in de kiosk en heeft een beheerdeel voor de penningmeester. Alles staat bij Cloudflare, op één adres:

- **Kassa:** https://kassa-burcht-ter-cleeff.kassa-burcht-ter-cleeff.workers.dev
- **Beheer:** https://kassa-burcht-ter-cleeff.kassa-burcht-ter-cleeff.workers.dev/beheer

De kassa kan aanslaan, contant en pin afrekenen, statiegeld innemen, en houdt de overzichten, het kluisje en de voorraad van de ijsjes bij. Pinnen gaat via Mollie. Zolang de kassa op de testsleutel van Mollie draait, staat er bovenaan een gele balk **TEST**: pinbetalingen zijn dan nagespeeld en er wordt geen geld afgeschreven. Tot de ingebruikname blijft iZettle de echte kassa; in deze kassa staan dan alleen proefverkopen.

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
- **Reservekopie.** Elke maandagnacht bewaart de kassa zelf een kopie van alles bij Cloudflare; de 26 nieuwste blijven staan. Onder **Instellingen** staat wanneer de laatste kopie is gemaakt. Staat daar dat de laatste kopie ouder is dan een week, meld dat dan aan de bouwer. Met **Nu een kopie maken** maak je er zelf een, bijvoorbeeld vlak voor het wissen van de proefgegevens.

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

Lokaal staat de instelcode in `.dev.vars` (zie `.dev.vars.example`). Voor pin komt daar `MOLLIE_API_KEY` bij, met de testsleutel van Mollie; de penningmeester vult die zelf in. `.dev.vars` staat niet in git. Lokaal bereikt Mollie de kassa niet (`localhost`), dus er komt geen webhook: de kassa haalt de uitkomst van een betaling zelf op, elke seconde zolang het pinvenster openstaat.

Testen:

```bash
npm test
```

```bash
npm run e2e
```

`npm test` draait de tests van de app en van de Worker. `npm run e2e` bouwt de app en loopt de kassa na in WebKit op iPad-formaat (1180×820), met een eigen lege database in `.wrangler/e2e`. Die run leest `.dev.vars.e2e` (verzonnen waarden, wel in git) in plaats van `.dev.vars`, en praat met een nagebootste Mollie op poort 4174 (`e2e/global-setup.ts`, `test/fake-mollie.ts`). De echte Mollie wordt door geen enkele test aangeroepen.

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

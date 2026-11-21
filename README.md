# Kassa Burcht ter Cleeff

## Wat is dit

De eigen kassa van Speeltuin Burcht ter Cleeff. Hij draait als app op de iPad in de kiosk en heeft een beheerdeel voor de penningmeester. Alles staat bij Cloudflare, op één adres:

- **Kassa:** https://kassa-burcht-ter-cleeff.kassa-burcht-ter-cleeff.workers.dev
- **Beheer:** https://kassa-burcht-ter-cleeff.kassa-burcht-ter-cleeff.workers.dev/beheer

Dit is fase 1: aanslaan, contant, statiegeld, overzichten, het kluisje en de voorraad van de ijsjes. Pinnen via Mollie komt in fase 2. Tot die tijd is de knop Pin grijs en blijft iZettle de echte kassa; in deze kassa staan alleen proefverkopen.

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

**Statiegeld.** Tik op de tegel **Statiegeld**, typ het aantal ingeleverde stuks en tik op **Toevoegen**. Reken daarna af met **Contant**. Statiegeld telt als inkomst en gaat het kluisje in.

**Verkeerd aangeslagen en al afgerekend.** Op de kassa kun je een afgerekende verkoop niet terugdraaien: één verkeerde tik zou een goede verkoop ongedaan maken. Geef de klant zo nodig het geld terug, schrijf de tijd en het bedrag op en meld het dezelfde dag aan de penningmeester. Die draait de verkoop terug in beheer onder **Verkopen**. Dat kan alleen vóór de volgende afdracht; daarna blijft het een kasverschil met een toelichting.

**Levering van ijsjes.** Staat er boven in beeld een gele balk **Levering onderweg**, dan heeft de penningmeester een bestelling ingevoerd. Staan de dozen in de vriezer? Tik op de balk, kijk of het klopt en tik op **Ontvangen**. De voorraad wordt bijgewerkt. Klopt de levering niet, bevestig dan toch en geef de afwijking door aan de penningmeester.

**Omzet bekijken.** Tik rechtsonder op **Omzet**. Je ziet de omzet van vandaag: het totaal, contant en pin, en wat er per categorie en per product is verkocht. Met **Week** zie je de week van maandag tot en met zondag, met een regel per dag; tik op een datum om die dag te openen. Met de pijltjes ga je een dag of een week terug. Het is alleen om te bekijken: downloaden kan alleen de penningmeester in beheer. Verkopen die nog op verzending wachten tellen pas mee als ze verstuurd zijn; dat staat er dan bij. Zonder internet is de omzet niet te zien. Tik op **Sluiten** om terug te gaan; de bon blijft staan.

**Voorraad op de tegel.** "nog 5" betekent dat die smaak bijna op is, "op?" dat hij volgens de kassa op is. De tegel blijft altijd werken: wat in de vriezer ligt is leidend.

**De regel onderaan.** "Online" betekent dat de kassa verbinding heeft. "Offline · contant werkt door" betekent dat er geen internet is: je kunt gewoon doorwerken, de verkopen worden verstuurd zodra er weer verbinding is. Staat er "… wacht op verzending", dan zijn die verkopen nog niet bij de penningmeester aangekomen. Dat lost zichzelf op. Blijft het langer dan een paar minuten staan terwijl er "Online" staat, meld het dan aan de penningmeester.

## Voor de penningmeester

Alles staat onder `/beheer`. Het werkt op de computer en op de telefoon.

- **Overzicht.** Vandaag en deze maand: omzet, aantal verkopen, en wat er in het kluisje hoort te liggen.
- **Rapporten.** Kies een maand. Je ziet de omzet per dag, per categorie en per product. Onderaan download je de maand als CSV, in twee vormen: dagtotalen en losse verkopen.
- **Verkopen.** De losse verkopen van een dag. Een verkoop terugdraaien kan met een reden. De oorspronkelijke verkoop blijft staan en er komt een tegenboeking bij. Een contante verkoop kun je alleen terugdraaien zolang hij na de laatste afdracht valt.
- **Kluisje.** Bovenaan staat wat er in het kluisje hoort te liggen. Bij een afdracht vul je in wanneer het kluisje is geleegd, wat je hebt ontvangen en wat er als wisselgeld is achtergebleven. De kassa rekent het verschil uit en bewaart het, met je toelichting. Alle eerdere afdrachten blijven zichtbaar.
- **Voorraad.**
  - *Bijbestellen*: wat op of onder de bestelgrens staat.
  - *Stand*: de voorraad per product. Met **Tellen** leg je vast wat er werkelijk ligt.
  - *Bestelling invoeren*: wat je bij Goodoo hebt besteld, in dozen (losse stuks kan ook). De beheerder ziet dan op de iPad de balk "Levering onderweg".
  - *Onderweg*: bestellingen die nog niet zijn bevestigd. Je kunt ze zelf als ontvangen markeren of laten vervallen.
- **Producten.** Naam, prijs, categorie en volgorde van de tegels (de pijltjes). Een product verberg je in plaats van het te verwijderen, omdat oude verkopen ernaar verwijzen. Hier zet je ook aan of een product een cijferblok opent en of de voorraad wordt bijgehouden. Onderaan staan de categorieën met hun kleur. Een wijziging staat binnen een halve minuut op de kassa.
- **Instellingen.** Een iPad koppelen of ontkoppelen, het wachtwoord wijzigen, alles downloaden als één bestand, de reservekopie, en de proefgegevens wissen zolang de kassa nog niet in gebruik is.
- **Reservekopie.** Elke maandagnacht bewaart de kassa zelf een kopie van alles bij Cloudflare; de 26 nieuwste blijven staan. Onder **Instellingen** staat wanneer de laatste kopie is gemaakt. Staat daar dat de laatste kopie ouder is dan een week, meld dat dan aan de bouwer. Met **Nu een kopie maken** maak je er zelf een, bijvoorbeeld vlak voor het wissen van de proefgegevens.

**Tijdens de proef** kun je de proefgegevens zo vaak wissen als je wilt: **Instellingen → Proefgegevens wissen**. Verkopen, afdrachten, bestellingen en voorraadmutaties verdwijnen; producten, prijzen en de koppeling met de iPad blijven.

**Bij de ingebruikname** (als pin werkt en de kassa echt de kiosk in gaat):

1. Kijk op de iPad of er onderaan niets meer "wacht op verzending" en niets "afgekeurd" staat. Een proefverkoop die nog op de iPad wacht, komt anders na het wissen alsnog in de echte administratie.
2. **Instellingen → Proefgegevens wissen**, en vink aan: **Dit is de ingebruikname: hierna kan wissen niet meer**.
3. Leg daarna het beginbedrag van het kluisje en de getelde voorraad opnieuw vast.

Vanaf dat moment staat bij Instellingen sinds wanneer de kassa in gebruik is en is de wisknop weg. Zo kan de echte administratie niet per ongeluk worden gewist.

## Als er iets misgaat

**Geen internet.** De kassa werkt door met contant. Onderaan staat hoeveel verkopen wachten op verzending. Ze worden vanzelf verstuurd als er weer verbinding is, en komen één keer in het overzicht. De levering bevestigen en een prijswijziging ophalen kunnen pas weer met internet.

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

Lokaal staat de instelcode in `.dev.vars` (zie `.dev.vars.example`).

Testen:

```bash
npm test
```

```bash
npm run e2e
```

`npm test` draait de tests van de app en van de Worker. `npm run e2e` bouwt de app en loopt de kassa na in WebKit op iPad-formaat (1180×820), met een eigen lege database in `.wrangler/e2e`.

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

Database terugzetten naar een eerder moment (tijd in UTC):

```bash
npx wrangler d1 time-travel restore kassa --timestamp=2026-07-31T16:00:00Z
```

De wekelijkse reservekopie staat in de R2-bucket `kassa-backups` als `kassa-JJJJ-MM-DD.json` (zelfde vorm als "Alles downloaden"). De Worker schrijft hem elke maandag om 03:00 UTC (`triggers.crons` in `wrangler.jsonc`, code in `worker/backup.ts`) en bewaart de 26 nieuwste. De bucket is één keer aangemaakt met:

```bash
npx wrangler r2 bucket create kassa-backups
```

Een kopie ophalen:

```bash
npx wrangler r2 object get kassa-backups/kassa-2026-11-23.json --remote --file kassa-2026-11-23.json
```

Terugzetten uit zo'n bestand is handwerk: er is geen knop voor. De kopie is één bestand met alles en groeit mee met de geschiedenis. Gemeten: 20.000 verkopen (100.000 rijen) geven ongeveer 22 MB en vragen meer rekentijd dan de 10 ms die het gratis abonnement per aanroep noemt. Wordt de kopie daardoor ooit afgebroken, dan staat in beheer dat de laatste kopie ouder is dan een week; de uitweg is het betaalde Workers-abonnement of de kopie per jaar opsplitsen.

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

Afspraken in de code: bedragen zijn hele centen; een dag is een dag in Amsterdam; een verkoop wordt nooit gewijzigd of verwijderd, terugdraaien is een tegenboeking; de iPad bewaart een verkoop eerst zelf en verstuurt hem daarna, en de server boekt dezelfde verkoop nooit twee keer.

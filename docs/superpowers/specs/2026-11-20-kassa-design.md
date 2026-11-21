# Ontwerp: eigen kassa voor Speeltuin Burcht ter Cleeff

Datum: 20 november 2026
Status: goedgekeurd door de penningmeester op 20 november 2026

## 1. Waarom

Speeltuin Burcht ter Cleeff (Haarlem, gerund door vrijwilligers, niet btw-plichtig) rekent in de kiosk af met de iZettle-kassa-app op een iPad en een pinterminal van PayPal/iZettle. De penningmeester wil daar vanaf en alles via Nederlandse partijen laten lopen: pinbetalingen via Mollie en de boekhouding straks in Moneybird (nu nog e-Boekhouden).

Er is een tweede reden. De beheerder bewaart het contante geld in een kluisje en brengt het één keer per maand naar de penningmeester, die het stort en boekt. Er is nu geen manier om te controleren of dat bedrag klopt met wat er contant is aangeslagen. De nieuwe kassa moet die controle geven.

## 2. Wie gebruikt het

- **De beheerder** staat in de kiosk achter de iPad, die liggend in een houder aan de muur hangt. Hij slaat pin en contant aan. Hij boekt ook statiegeld als hij verzamelde blikjes heeft ingeleverd. Hij is aanwezig als de ijsjes geleverd worden, zet ze in de vriezer en bevestigt de ontvangst op de iPad. Op drukke dagen moet het snel gaan.
- **De penningmeester** bekijkt de cijfers op zijn eigen computer of telefoon, beheert de producten, en legt de maandelijkse afdracht van het contante geld vast.

## 3. Doelen

1. **Snel aanslaan.** Eén tik per product, zo min mogelijk handelingen, directe reactie op het scherm.
2. **Intuïtief corrigeren.** Eén stuk minder, een product weghalen en helemaal opnieuw beginnen werken zonder uitleg.
3. **Pin via Mollie.** Getest met de iPhone van de penningmeester als betaalterminal (Mollie Tap-app). In de kiosk komt een Mollie-terminal die de speeltuin koopt zodra de test slaagt; de kassa hoeft daarvoor niet te veranderen.
4. **Contant vastleggen**, met een hulpje voor wisselgeld.
5. **Controle op het kluisje.** De kassa weet hoeveel contant geld er hoort te liggen en laat bij de afdracht het verschil zien.
6. **Overzicht voor de boekhouding.** Omzet per dag en per maand, per categorie, gesplitst in pin en contant.
7. **Zelf producten beheren**: toevoegen, prijs wijzigen, verbergen, volgorde aanpassen.
8. **Huisstijl van burchttercleeff.nl.**
9. **Voorraad van de ijsjes bijhouden**, zodat op tijd duidelijk is wat er bijbesteld moet worden (zie 17).

## 4. Wat er niet in zit (eerste versie)

- Btw. De speeltuin is niet btw-plichtig; de kassa rekent en toont nergens btw.
- Bonnen printen of mailen.
- Barcodes scannen.
- Bestellen bij de leverancier vanuit de kassa. De penningmeester blijft zelf bestellen bij Goodoo.
- Inkoopprijzen en marges.
- Terugbetalen van pinbetalingen vanuit de kassa. Dat gaat via het Mollie-dashboard; de penningmeester legt de terugbetaling daarna met de hand vast in het beheer (zie 9).
- Vrije bedragen en kortingen. Alles wat verkocht wordt is een product.
- Meerdere kassa's tegelijk. Het ontwerp sluit het niet uit, maar het wordt niet gebouwd of getest.
- Een koppeling met de ledenadministratie en de dagkaartjes van de website.
- De koppeling met Moneybird. Die komt in fase 3 en krijgt dan een eigen ontwerp (zie 13).
- Het kluisje dagelijks tellen. De controle is maandelijks, bij de afdracht.

## 5. Wat het een mislukking zou maken, ook als het technisch werkt

- Aanslaan kost meer tikken of voelt trager dan iZettle nu.
- De kassa is onbruikbaar zodra de wifi hapert. Contant moet altijd doorgaan.
- Een verkoop raakt kwijt of wordt dubbel geteld.
- Een pinbetaling staat als betaald in de kassa terwijl Mollie hem niet heeft goedgekeurd, of andersom.
- De geheime sleutel van Mollie staat op de iPad of in de broncode.

## 6. Randvoorwaarden

- iPad in een muurhouder, liggend, met wifi. De iPad is ongeveer twee jaar oud en draait dus een actuele Safari; oudere iPads hoeven niet ondersteund te worden.
- Eén kassa, één beheerder tegelijk.
- Er is een Mollie-account op naam van de speeltuin. Point of Sale moet daarin nog worden aangezet.
- De kassa komt in een nieuw Cloudflare-account op naam van de speeltuin, binnen de gratis limieten. Het domein burchttercleeff.nl zit niet in Cloudflare.
- Alle schermteksten in het Nederlands. Bedragen in euro, intern als hele centen.
- Dagen en maanden volgens Nederlandse tijd (Europe/Amsterdam).

## 7. Overwogen aanpakken

| Aanpak | Wat het is | Afweging |
|---|---|---|
| **Web-app op Cloudflare (gekozen)** | Een beveiligde webpagina die op de iPad op het beginscherm staat en schermvullend opent. App, online deel en database in één Cloudflare-account. | Wijzigingen staan direct live. Overzicht voor de penningmeester zit in dezelfde app. Cloudflare pauzeert niet bij weinig gebruik en kan gegevens tot 7 dagen terugzetten. Inloggen moet zelf gebouwd worden. |
| Web-app op Supabase | Zelfde opzet, database bij Supabase. | Kant-en-klaar inloggen, maar het gratis abonnement pauzeert een project na een week met weinig activiteit (een probleem voor een speeltuin die in de winter dicht kan zijn), heeft geen automatische back-ups, en vraagt een tweede account voor de app zelf. |
| Echte iPad-app | Een app via Apple. | Voelt het meest als iZettle, maar kost € 99 per jaar, elke wijziging moet langs Apple, en voor het overzicht is toch nog een website nodig. |
| Alleen de Mollie Tap-app | Geen eigen kassa. | Legt geen contant geld vast, dus geen controle op het kluisje. |

De penningmeester koos de web-app op Cloudflare.

## 8. Het kassascherm (iPad)

De penningmeester koos uit drie aanklikbare schetsen **variant A**. De schets staat in `.superpowers/brainstorm/8477-1795168180/content/kassa-scherm.html` en is de referentie voor het gedrag hieronder.

**Indeling.** Links, op ongeveer twee derde van het scherm, staan alle producten als tegels in een raster van vijf kolommen, gegroepeerd en gekleurd per categorie. Er zijn geen tabbladen en er hoeft niet gescrold te worden bij het huidige assortiment van 22 producten. Rechts staat de bon met onderaan het totaal en twee grote knoppen: Contant en Pin.

**Aanslaan.** Een tik op een tegel zet één stuk op de bon. De tegel toont het aantal in een rondje. De reactie is direct: de bon leeft op de iPad en wacht nergens op het netwerk.

**Corrigeren.**
- Elke bonregel heeft een min- en plusknop. Bij min op het laatste stuk verdwijnt de regel.
- Elke bonregel heeft "Verwijder" voor de hele regel.
- "Wis alles" leegt de bon direct, zonder bevestigingsvraag en zonder melding. *(Gewijzigd op 21 november 2026 door de penningmeester: eerst stond er vijf seconden lang een melding "Bon gewist" met "Ongedaan maken"; die was verwarrend voor de gebruiker.)*

**Statiegeld.** De tegel Statiegeld opent een cijferblok. De beheerder typt het aantal ingeleverde stuks en ziet de som (40 × € 0,15 = € 6,00). Dit is een inkomst die contant wordt afgerekend, geen toeslag bij een verkoop. Of een product zo'n cijferblok opent is een instelling per product.

**Contant.** Een venster toont het te betalen bedrag en knoppen voor wat de klant geeft: Gepast, en de biljetten die hoger zijn dan het bedrag (€ 5, € 10, € 20, € 50). Gepast rondt direct af. Bij een biljet toont de kassa het wisselgeld en rondt "Klaar" af.

**Pin.** Een venster toont het bedrag en "Houd pas of telefoon tegen de betaalterminal". De bon blijft staan tot Mollie de betaling heeft goedgekeurd. Mogelijke uitkomsten:
- Betaald: korte bevestiging, bon leeg, klaar voor de volgende klant.
- Geweigerd, geannuleerd of verlopen: melding met drie keuzes: opnieuw proberen, toch contant, terug naar de bon.
- Geen internet: de Pin-knop is uitgeschakeld met de reden erbij. Contant blijft werken.
- Uitkomst onbekend (de iPad verliest de verbinding terwijl de betaling loopt): de kassa meldt dat en vraagt de beheerder op de betaalterminal te kijken. De bon wordt geparkeerd als "wacht op bevestiging" en de kassa is direct vrij voor de volgende klant. Zodra er weer verbinding is haalt de kassa de uitkomst op. Is de betaling gelukt, dan is de verkoop al vastgelegd en verdwijnt de geparkeerde bon. Is hij niet gelukt, dan krijgt de beheerder een melding met het bedrag. Kiest de beheerder intussen "toch contant" en blijkt de pinbetaling later toch gelukt, dan staan beide verkopen in het overzicht met de markering "mogelijk dubbel betaald". *(Eigen keuze, zie 14.)*

**Na een verkoop.** Een afgerekende verkoop is op de iPad niet terug te draaien. Een vergissing meldt de beheerder aan de penningmeester, die de verkoop terugdraait in beheer (zie 9). Teruggedraaide verkopen blijven zichtbaar in het overzicht van de penningmeester, gemarkeerd als teruggedraaid. *(Gewijzigd op 21 november 2026 door de penningmeester, zie 14: eerst stond hier vijf minuten lang een regel "Laatste verkoop" met een knop om terug te draaien.)*

**Voorraad op de tegel.** Een product waarvan de voorraad op of onder de bestelgrens staat toont het resterende aantal op de tegel ("nog 5"), en bij nul "op?". De tegel blijft altijd werken; de kassa blokkeert nooit een verkoop vanwege de voorraad (zie 17).

**Levering onderweg.** Zolang er een bestelling openstaat die de penningmeester heeft ingevoerd, toont de kassa een smalle balk "Levering onderweg". Zonder openstaande bestelling staat er niets en is het scherm gelijk aan de schets. Een tik op de balk opent een venster met wat er besteld is, per product in dozen, en één knop "Ontvangen". Daarmee gaat de voorraad omhoog en verdwijnt de balk. Bij meerdere openstaande bestellingen toont het venster ze onder elkaar, elk met een eigen knop. Bevestigen vraagt internet; zonder verbinding meldt de kassa dat het later kan (zie 17).

**Status.** Een klein teken laat zien of de kassa online is en of er verkopen wachten op verzending. In de testmodus van Mollie staat er een duidelijke balk "TEST" in beeld.

**Niet vergrendeld.** De kassa vraagt geen pincode voor het aanslaan. *(Eigen keuze, zie 14.)*

**Snelheid, meetbaar.** Een contante verkoop van drie producten kost vijf tikken (drie producten, Contant, Gepast). Een tik geeft binnen 100 milliseconden zichtbare reactie. De app start vanaf het beginscherm binnen twee seconden, ook zonder internet.

## 9. Beheer en overzicht (penningmeester)

Bereikbaar op hetzelfde adres onder `/beheer`, achter een eigen login. Werkt op computer en telefoon.

- **Vandaag en deze maand.** Omzet, aantal verkopen, verdeling pin en contant, en wat er in het kluisje hoort te liggen.
- **Overzicht per dag en per maand.** Omzet per categorie en per product, gesplitst in pin en contant. Statiegeld en entree staan als eigen categorie. Te downloaden als CSV, per maand, in twee vormen: dagtotalen en losse verkopen.
- **Pin-controle.** Het pintotaal per dag, om naast de uitbetalingen van Mollie te leggen. Het automatisch afstemmen met Mollie-uitbetalingen hoort bij fase 3.
- **Verkopen.** Lijst van losse verkopen met regels. Een verkoop terugdraaien kan met een verplichte reden en werkt als tegenboeking: de oorspronkelijke verkoop blijft staan op zijn eigen dag en de tegenboeking komt op de dag van terugdraaien. Een maand die al is gedownload verandert daardoor niet meer. Terugdraaien kan alleen hier, niet op de iPad (zie 8).
  - Contante verkopen zijn alleen terug te draaien zolang ze na de laatste afdracht vallen. Wat daarvoor ligt zit al in het verschil van die afdracht.
  - Bij pinverkopen is terugdraaien bedoeld om een terugbetaling vast te leggen die in het Mollie-dashboard is gedaan, altijd voor het hele bedrag. De kassa betaalt zelf niets terug en controleert dit niet bij Mollie.
- **Kluisje.** Zie 10.
- **Producten.** Toevoegen, naam en prijs wijzigen, categorie en kleur kiezen, volgorde aanpassen, verbergen (niet verwijderen, omdat oude verkopen ernaar verwijzen), en aangeven of het product een cijferblok opent.
- **Voorraad.** Stand per product, de lijst "bijbestellen", een bestelling invoeren die de beheerder bij ontvangst bevestigt, en een telling invoeren (zie 17).
- **Instellingen.** Een iPad koppelen of ontkoppelen, de Mollie-terminal kiezen uit de lijst die Mollie teruggeeft, het wachtwoord wijzigen, en bij de ingebruikname eenmalig de proefgegevens wissen (met een extra bevestiging; producten en instellingen blijven staan).

Er is in de eerste versie één beheerdersaccount.

## 10. Controle op het contante geld

De kassa houdt één doorlopende kasstand bij: het bedrag dat in het kluisje hoort te liggen.

- Elke contante verkoop (ook statiegeld) verhoogt de kasstand. Een teruggedraaide verkoop verlaagt hem weer.
- Bij de **afdracht** vult de penningmeester drie dingen in: het moment waarop het kluisje is geleegd (standaard nu), wat hij heeft ontvangen, en wat er als wisselgeld in het kluisje is achtergebleven. De kassa vergelijkt met de kasstand op dat moment: verschil = kasstand − ontvangen − achtergebleven.
- Een contante verkoop van voor dat moment die pas later binnenkomt (de iPad was offline) verandert een vastgelegde afdracht niet meer. Hij telt mee in de lopende periode en staat in het overzicht als "nagekomen".
- Het verschil wordt vastgelegd bij de afdracht, met een vrij tekstveld voor een toelichting. Daarna is de kasstand gelijk aan het achtergebleven bedrag.
- Bij de ingebruikname wordt het beginbedrag in het kluisje op dezelfde manier vastgelegd.
- Alle afdrachten blijven zichtbaar met datum, bedragen, verschil en toelichting.

Er zijn geen losse kasmutaties (bijvoorbeeld een boodschap uit de kas). Die komen bij de afdracht in het verschil terecht, met toelichting.

## 11. Techniek

Deze keuzes zijn door de bouwer gemaakt; de penningmeester sprak over uitkomsten en liet het hoe open, op de keuze voor Cloudflare na.

**Opbouw.** Eén Cloudflare Worker serveert de web-app en de API. De gegevens staan in een Cloudflare D1-database. De web-app is geschreven in TypeScript met React en Tailwind, dezelfde technieken als de website. De API gebruikt Hono.

**Lokaal eerst.** De kassa bewaart het assortiment op de iPad en ververst het op de achtergrond. De app zelf wordt op de iPad bewaard (service worker), zodat hij ook zonder internet start. Een contante verkoop krijgt op de iPad een uniek nummer, wordt daar eerst opgeslagen en daarna naar de server gestuurd. Lukt dat niet, dan blijft hij in een wachtrij en gaat hij later mee. De server accepteert elk uniek nummer één keer, zodat opnieuw versturen nooit dubbel telt.

**Pin loopt via de server.** De iPad stuurt de bon naar de server. De server legt de verkoop vast als "in afwachting", maakt bij Mollie een betaling aan (methode `pointofsale`, met het gekozen `terminalId`) en geeft het betalingsnummer terug. De iPad vraagt elke seconde de status op; de server haalt die bij Mollie op zolang hij niet definitief is. Daarnaast meldt Mollie de uitkomst via een webhook, zodat een betaling ook goed wordt vastgelegd als de iPad halverwege de verbinding verliest. De verkoop wordt pas "betaald" als de server dat zelf bij Mollie heeft gezien. Annuleren op de iPad annuleert de betaling bij Mollie als dat nog kan.

**Testmodus.** Met een testsleutel van Mollie gebruikt de kassa de nagespeelde testterminal. Mollie geeft dan een link mee waarmee de uitkomst van een betaling gekozen kan worden; de kassa toont die link alleen in de testmodus.

**Toegang.**
- De iPad wordt één keer gekoppeld met een eenmalige code uit het beheer (tien minuten geldig). Daarna heeft hij een eigen sleutel die in het beheer kan worden ingetrokken.
- De penningmeester logt in met een wachtwoord. Wachtwoorden worden alleen versleuteld (gehasht) bewaard. Inlogpogingen en koppelcodes hebben een limiet op het aantal pogingen.
- De sleutel van Mollie staat als geheim in Cloudflare, niet in de app en niet in de broncode.

**Gegevens.** Producten en categorieën; verkopen met hun regels (naam en prijs van het moment van verkoop worden meegeschreven, zodat een latere prijswijziging oude cijfers niet verandert); pinbetalingen met hun status; afdrachten; bestellingen met hun regels en status (onderweg, ontvangen, vervallen); voorraadmutaties (levering, verkoop, terugdraaiing, telling), zodat altijd terug te zien is hoe een stand is ontstaan; gekoppelde apparaten; instellingen. Er worden geen gegevens van klanten opgeslagen; kaartgegevens blijven bij Mollie.

**Startassortiment.** De 22 producten uit de iZettle-export van 20 november 2026 worden bij de eerste ingebruikname ingeladen, met de categorieën IJs, Koude dranken, Warme dranken, Snacks, Entree en Statiegeld.

**Back-up.** D1 kan tot zeven dagen terug worden hersteld. Daarnaast schrijft een wekelijkse taak een volledige kopie weg naar Cloudflare R2-opslag. *(Eigen keuze met een voorbehoud, zie 14.)* De penningmeester kan in het beheer altijd zelf alles downloaden.

**Adres.** Het standaardadres van Cloudflare (eindigt op `workers.dev`). Een eigen adres zoals `kassa.burchttercleeff.nl` kan pas als het domein naar Cloudflare verhuist; dat valt buiten dit ontwerp.

## 12. Huisstijl

Overgenomen van burchttercleeff.nl:

- Lettertype DM Sans, gewoon en halfvet. Het lettertype wordt met de app meegeleverd, zodat het ook zonder internet klopt.
- Kleuren: bijna-zwart `#252628` voor tekst, crème `#F3EEE2` als achtergrond, groen `#78992B` als accent, roodbruin `#853F21` voor waarschuwingen, zandgrijs `#E0E1DA` voor lijnen en vlakken.
- Ronde, pilvormige knoppen zoals op de website.
- Het kasteeltje en de naam "BURCHT TER CLEEFF" in de kop van het beheer en op het beginscherm-icoon van de iPad.

De tegels houden een eigen kleur per categorie, omdat de beheerder daarmee sneller het juiste product vindt. Die kleuren worden afgestemd op het palet hierboven. Witte tekst op het groen is alleen leesbaar bij grote, vette letters; voor kleine tekst gebruikt de bouwer een donkerder groen.

## 13. Volgorde

1. **Fase 1: kassa met contant.** Kassascherm, contant, statiegeld, beheer, overzicht, kluisje en voorraad. Online op Cloudflare. In deze fase test de penningmeester met proefverkopen; iZettle blijft de echte kassa in de kiosk.
2. **Fase 2: pin via Mollie.** Eerst volledig met de testterminal. Daarna één echte betaling van € 0,60 op de iPhone van de penningmeester. Slaagt die, dan koopt de speeltuin een Mollie-terminal.
3. **Ingebruikname.** De penningmeester kiest de gekochte terminal in het beheer en wist met één handeling alle proefverkopen en proefafdrachten. De nieuwe kassa gaat de kiosk in en iZettle gaat eruit. De kassa wordt dus pas echt gebruikt als pin werkt; een pinbetaling via iZettle hoeft er nooit in te worden aangeslagen.
4. **Fase 3: Moneybird**, zodra de penningmeester overstapt van e-Boekhouden. Het idee is één boeking per dag met een regel per categorie, pin naar een tussenrekening voor Mollie en contant naar de kas. De gegevens uit fase 1 en 2 zijn daarvoor genoeg. Dit krijgt een eigen ontwerp.

**Klaar is het als:**
- Fase 1: de beheerder slaat een contante verkoop van drie producten aan in vijf tikken; met de wifi uit gaat dat door en de verkoop staat na herstel één keer in het overzicht; de penningmeester ziet maandtotalen en de kasstand en kan een afdracht met verschil vastleggen; een prijswijziging in het beheer staat binnen een minuut op de iPad; een bestelling van twee dozen die de penningmeester invoert verschijnt als balk op de iPad en verhoogt na "Ontvangen" de voorraad met twee keer het aantal per doos, een verkoop verlaagt hem met één, en een product onder de bestelgrens staat in de lijst "bijbestellen" en toont het aantal op de tegel.
- Fase 2: in de testmodus leiden een geslaagde, een geweigerde en een geannuleerde betaling elk tot de juiste uitkomst op de iPad en in het overzicht; een echte betaling van € 0,60 via de iPhone staat als betaald in de kassa en in het Mollie-dashboard.
- Ingebruikname: een echte betaling via de gekochte Mollie-terminal in de kiosk staat als betaald in de kassa; na het wissen van de proefgegevens staan omzet en kasstand op nul, op het beginbedrag in het kluisje na.

## 14. Keuzes die de bouwer heeft gemaakt

Deze zijn niet met de penningmeester besproken en kunnen worden teruggedraaid:

- Vervallen op 21 november 2026: "de laatste contante verkoop is vijf minuten terug te draaien op de iPad". De penningmeester heeft de knop na de eerste proef van de kassa laten halen: het is te gevaarlijk dat iemand erop tikt en zo een goede verkoop ongedaan maakt. Een vergissing loopt nu via de penningmeester, die in beheer terugdraait. De prijs daarvan: een vergissing die niet vóór de afdracht is gemeld, blijft een kasverschil met een toelichting. De server neemt een terugboeking van een kassa nog wel aan (eigen contante verkoop, binnen vijf minuten), zodat een iPad met de oude versie niet vastloopt; de kassa stuurt er geen meer.
- De kassa is niet vergrendeld met een pincode. Reden: elke extra handeling kost snelheid, en iZettle is nu ook niet vergrendeld.
- Geen losse kasmutaties; uitzonderingen gaan via het verschil bij de afdracht.
- Eén beheerdersaccount.
- De wekelijkse kopie naar R2. Voorbehoud: R2 is gratis binnen de limieten, maar Cloudflare vraagt mogelijk een betaalmethode in het account om het aan te zetten. Als dat zo is en de penningmeester wil dat niet, vervalt de automatische kopie en blijft het bij zeven dagen terugzetten plus zelf downloaden.
- De kassa staat los van de website en de ledenadministratie.
- De iPad hangt liggend.
- Terugdraaien werkt als tegenboeking op de dag van terugdraaien, en voor contant alleen na de laatste afdracht. Reden: cijfers van een afgesloten maand en een vastgelegde afdracht veranderen dan nooit achteraf.
- Een terugbetaling via Mollie legt de penningmeester met de hand vast. De kassa volgt Mollie daarin niet automatisch.
- Bij een pinbetaling met onbekende uitkomst blijft de kassa bruikbaar en worden twijfelgevallen gemarkeerd voor de penningmeester, in plaats van de kassa te blokkeren tot de uitkomst bekend is.
- Een afdracht hoort bij het moment waarop het kluisje is geleegd, niet bij het moment van invoeren.
- Voorraad: de beheerder bevestigt op de iPad alleen de ontvangst van een hele bestelling. Afwijkingen in een levering en tellingen van de vriezer voert de penningmeester in. Reden: het kassascherm blijft zo schoon mogelijk.
- Het bevestigen van een levering vraagt internet. Reden: het is niet tijdkritisch, en zo kan een bestelling nooit twee keer worden ontvangen.
- Voorraad blokkeert nooit een verkoop.

## 15. Wat nog open staat

De penningmeester heeft alle vragen beantwoord. Wat overblijft is pas te beantwoorden door te testen in fase 2. De eerste drie punten gaan over de iPhone en spelen alleen tijdens het testen, omdat er in de kiosk een Mollie-terminal komt:
- Hoe de iPhone met de Mollie Tap-app aan een `terminalId` komt. Mollie's documentatie noemt de Tap-app als doel voor betalingen via de API, maar beschrijft niet waar het nummer vandaan komt.
- Of de Tap-app open moet staan om een betaling te ontvangen.
- Welke passen de iPhone accepteert (Maestro en V PAY zijn niet bevestigd).
- Of Mollie een goedkeuring vraagt voor het aanzetten van Point of Sale.
- Of een lopende pinbetaling via de API te annuleren is.

## 16. Aan de bouwer

Vrij in te vullen: de precieze opbouw van de database, de indeling van de code, de keuze van hulpbibliotheken voor validatie en testen, de precieze kleuren per categorie, en de vormgeving van de beheerpagina's binnen de huisstijl.

Te testen: de rekenregels (bon, wisselgeld, kasstand, verschil, voorraadstand), de API tegen een lokale database, de wachtrij voor contante verkopen bij wegvallende verbinding, en het pinverloop tegen een nagebootste Mollie en daarna tegen de echte testmodus.

## 17. Voorraad

Toegevoegd op verzoek van de penningmeester na het eerste akkoord op het ontwerp.

**Waarom.** De speeltuin bestelt ijsjes per doos (een bestelling is bijvoorbeeld 24 dozen). Nu stuurt de beheerder een bestelling door aan de penningmeester, die hem invoert bij leverancier Goodoo. Met voorraad in de kassa ziet de penningmeester zelf wanneer een smaak opraakt.

**Hoe het werkt.**
- **Per product aan of uit.** Voorraad staat bij de start aan voor de tien ijsjes en uit voor de rest. De penningmeester kan dat per product wijzigen.
- **Stuks per doos.** Bij elk product met voorraad legt de penningmeester één keer vast hoeveel stuks er in een doos zitten.
- **Bestelling invoeren.** De penningmeester voert in het beheer in wat hij bij Goodoo heeft besteld: per product het aantal dozen. De kassa rekent om naar stuks. Losse stuks invullen kan ook. De bestelling krijgt de status "onderweg" en verandert de voorraad nog niet.
- **Ontvangst bevestigen.** De beheerder is aanwezig bij de levering en zet de dozen in de vriezer. Daarna tikt hij op de iPad op de balk "Levering onderweg", ziet wat er besteld was en bevestigt met "Ontvangen" (zie 8). Op dat moment gaat de voorraad omhoog en ziet de penningmeester in het beheer dat de bestelling binnen is, met het tijdstip. De penningmeester kan een bestelling ook zelf als ontvangen markeren, of laten vervallen zolang hij onderweg is.
- **Afwijking in een levering.** Klopt de levering niet (een doos te weinig, een andere smaak), dan bevestigt de beheerder de ontvangst toch en geeft hij de afwijking door aan de penningmeester, die de voorraad met een telling corrigeert.
- **Verkoop.** Elke verkoop verlaagt de voorraad met het verkochte aantal. Een teruggedraaide verkoop zet het aantal terug.
- **Bestelgrens.** Per product een aantal stuks. Staat de voorraad op of onder de grens, dan staat het product in de lijst "bijbestellen" in het beheer, met de huidige stand, en toont de tegel op de iPad het resterende aantal.
- **Tellen.** De penningmeester vult het getelde aantal in (de beheerder telt de vriezer en geeft het door). De kassa legt het verschil vast als correctie, met een optionele toelichting (gesmolten, weggegeven, misgeteld).
- **Nooit blokkeren.** De voorraad mag onder nul komen. De teller is een hulpmiddel; wat er werkelijk in de vriezer ligt is leidend.

**Wat de beheerder ervan merkt.** Het aantal op de tegel als een smaak bijna op is, en de balk "Levering onderweg" met één tik om de ontvangst te bevestigen. Hij hoeft geen aantallen in te voeren en hoeft geen bestelling meer door te sturen.

**Ingebruikname.** Het wissen van de proefgegevens wist ook de proefmutaties van de voorraad. Stuks per doos en bestelgrenzen blijven staan. De beginvoorraad wordt daarna met een telling vastgelegd.

**Kanttekening.** De stand klopt alleen zolang elke bestelling wordt ingevoerd en bij ontvangst bevestigd. Een vergeten bestelling blijft scheef tot de volgende telling; een bestelling die lang "onderweg" blijft staan valt de penningmeester in het beheer op. Als de iPad offline is kan het aantal op de tegel kort achterlopen.

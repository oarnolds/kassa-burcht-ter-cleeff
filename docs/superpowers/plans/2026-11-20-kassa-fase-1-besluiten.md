# Kassa fase 1: besluiten van de bouwer

Hoort bij het plan `2026-11-20-kassa-fase-1.md` en het ontwerp `../specs/2026-11-20-kassa-design.md`.

Tijdens het bouwen heeft de bouwer (Claude) besluiten genomen waar het plan of het ontwerp geen antwoord gaf, of waar het plan niet klopte. Hieronder staan ze allemaal, in de volgorde waarin ze zijn genomen, elk met wat het kost als het besluit verkeerd blijkt. Daarna volgen de kleine punten uit de controles die bewust zijn blijven liggen. Onderaan staan de oorspronkelijke regels uit het bouwlogboek, letterlijk (in het Engels).

Een besluit met **Vervallen**, **Herzien** of **Afgehandeld** is later ingehaald; de regel zegt waardoor.

## Besluiten

### Opzet

1. De map was nog geen git-opslag. Die is aangemaakt, de documenten staan op `main` en alles is gebouwd op de tak `fase-1`, zonder aparte werkmap. *Kost als het fout is:* één keer samenvoegen met `main` aan het eind.
2. De git-opslag en `.gitignore` (stap 1 van taak 1) zijn al bij de opzet gemaakt. *Kost:* niets.

### Taak 1: projectopzet

3. Het ontwikkelpakket `@types/node` is toegevoegd; de configuratie had het nodig. *Kost:* één ongebruikt pakket.
4. De tests van de server hebben een eigen typecontrole, zodat ook zij worden gecontroleerd. *Kost:* niets.
5. Na elke schermtest wordt het scherm opgeruimd, omdat het testgereedschap dat niet vanzelf doet. *Kost:* niets.
6. `.claude/launch.json` is toegevoegd om de ontwikkelserver vanuit de app te starten. *Kost:* één extra bestand.

### Taak 2: geld en tijd

7. De vaste spatie in bedragen ("€ 1,10") wordt in code opgebouwd in plaats van getypt, omdat het schrijfgereedschap het teken anders onzichtbaar maakt. *Kost:* niets.

### Taak 3: database

8. Twee tests controleren de precieze foutmelding van de database in plaats van alleen "er gaat iets mis". *Kost:* wijzigt Cloudflare die tekst, dan breken twee tests, niet de kassa.

### Taak 4: inloggen in beheer

9. De test "geen instelcode ingesteld" stuurt ook een lege code mee. Zonder dat bewees de test niets: een lege code zou iedereen het wachtwoord laten zetten. *Kost:* niets.
10. Extra tests: de blokkade vervalt na 15 minuten, andere sessies eindigen bij een nieuw wachtwoord, en de foutantwoorden. *Kost:* drie tests meer om te onderhouden.
11. De inlogbewaking staat op één plek voor alle beheer-adressen. *Kost:* een adres dat vóór die regel wordt toegevoegd is openbaar; de volgorde in `worker/app.ts` is het controlepunt.
12. Tekstvelden bij inloggen, instellen en wachtwoord wijzigen zijn maximaal 200 tekens. *Kost:* een wachtwoord van meer dan 200 tekens wordt geweigerd.

### Taak 5: iPad koppelen

13. Een nieuwe koppelcode wist alle oudere codes, ook de gebruikte. *Kost:* geen geschiedenis van gebruikte codes; niets gebruikt die.
14. De naam van de iPad is 1 tot 40 tekens, anders volgt een foutmelding zonder dat de code is verbruikt. Een onbekende iPad ontkoppelen geeft "niet gevonden". *Kost:* het koppelscherm moet die foutmelding tonen; dat doet het.
15. Extra tests voor de 10 minuten geldigheid, de nieuwste code, een lege naam, "laatst gezien" en de beveiliging. *Kost:* meer tests.

### Taak 6: producten

16. De antwoorden van de server bij volgorde wijzigen, bewerken en een nieuwe categorie zijn vastgelegd; het plan noemde ze niet. *Kost:* een beheerpagina zou een antwoord verkeerd kunnen lezen.
17. Onbekende velden in een product worden genegeerd, niet geweigerd. *Kost:* een verkeerd gespelde veldnaam verandert niets, zonder foutmelding.
18. Twee hulpfuncties zijn beschikbaar gemaakt voor andere onderdelen. *Kost:* niets.

### Taak 7: verkopen ontvangen

19. Alle verkopen van één verzending worden in één keer weggeschreven in plaats van per stuk. Het gratis abonnement staat 50 databaseaanroepen per verzoek toe; per stuk zou een dag offline verkopen nooit verstuurd raken. *Kost:* meer code. Schiet ook de terugvaloptie tekort, dan mislukt het verzoek en probeert de iPad het opnieuw; dubbele worden herkend.
20. Bij terugdraaien wordt de voorraad teruggezet op basis van wat de verkoop zelf heeft afgeboekt. *Kost:* niets gevonden.
21. Een iPad-klok die meer dan 5 minuten voorloopt wordt ook bij terugdraaien gecorrigeerd naar de tijd van de server. *Kost:* zo'n terugdraaiing wordt op servertijd beoordeeld.
22. Tijdstippen worden in één vaste vorm opgeslagen. *Kost:* niets.
23. De test voor verkopen rond middernacht is uitgebreid met 00:30 uur en een wintergeval. *Kost:* niets.

### Taak 8: kas en afdracht

24. Een afdracht berekent "verwacht" en controleert zichzelf in dezelfde databasestap. Twee keer tegelijk opslaan, of een verkoop tijdens het tellen, geeft daardoor geen dubbele afdracht of fout totaal. *Kost:* moeilijker leesbare code.
25. Grenzen: bedragen tot € 1.000.000, een notitie tot 500 tekens, en een reden bij terugdraaien is verplicht en hoogstens 200 tekens. *Kost:* een heel lange notitie wordt geweigerd.

### Taak 9: voorraad

26. Een levering ontvangen sluit de bestelling en boekt de voorraad in één stap. *Kost:* niets gevonden.
27. De kassa haalt categorieën, producten met voorraad en open bestellingen in één aanroep op. *Kost:* niets.
28. Grenzen: een telling tot 100.000, dozen tot 1.000, losse stuks tot 10.000 en 100 regels per bestelling. Een onbekende bestelling geeft "al afgehandeld". *Kost:* een absurd groot getal wordt geweigerd.
29. Een bestaande test is aangepast: een product met voorraad bijhouden toont 0 in plaats van niets. *Kost:* niets.

### Taak 10: rapporten

30. De CSV-tests lezen de ruwe bytes, omdat het merkteken voor Excel anders ongezien wordt weggehaald. *Kost:* niets.
31. Dat merkteken wordt in code opgebouwd, om dezelfde reden als bij 7. *Kost:* niets.
32. Datum en maand worden op één plek gecontroleerd; 31 februari wordt geweigerd. *Kost:* niets.
33. Rapporten en de verkooplijst tonen alleen betaalde verkopen. *Kost:* in fase 2 wil je mislukte pinbetalingen misschien wel in de lijst zien.

### Taak 11: alles downloaden

34. De downloadfunctie krijgt het tijdstip van buiten mee. *Kost:* niets.

### Taak 12: huisstijl en basis

35. Het kasteel-icoon is overgenomen van burchttercleeff.nl, na controle dat het een gewoon plaatje is zonder scripts. *Kost:* wil de vereniging dat niet, dan wordt één bestand vervangen.
36. Vensters kregen een testkenmerk en een brede variant. *Kost:* niets.
37. Elk verzoek van de kassa stopt na 15 seconden en telt dan als "offline". *Kost:* een trage maar gelukte verzending wordt opnieuw gedaan. Dat is onschuldig, want een verkoop wordt maar één keer geaccepteerd.
38. Tijdelijke pagina's tonen het logo; een onbekend adres toont "Pagina niet gevonden". *Kost:* niets.
39. De testhulpmiddelen zijn uitgebreid; de testopslag wordt na elke test gewist. *Kost:* niets in de kassa zelf.

### Taak 13: kassascherm

40. Na het sluiten van een venster is het scherm 0,3 seconde ongevoelig. De tweede tik van een dubbele tik zet daardoor geen spookproduct op de volgende bon. *Kost:* een bewuste tik binnen 0,3 seconde wordt genegeerd.
41. Het contant-venster en het aantalvenster sluiten niet door ernaast te tikken, alleen met Terug of Annuleren. *Kost:* één knop meer om te leren.
42. Beide stappen van het contant-venster zijn even hoog en Klaar staat waar Terug stond. Een dubbele tik op een bankbiljet slaat daardoor het wisselgeld niet over. *Kost:* niets.
43. Er is geen extra "maar één keer"-slot in het contant-venster; het venster is al weg voordat een tweede tik aankomt. *Kost:* is dat fout, dan boekt een dubbele tik twee verkopen. De schermtest daarvoor is groen.
44. "Ongedaan maken" na Wis alles zette de bon terug met behoud van wat daarna was getikt. **Vervallen:** op verzoek van de penningmeester is Ongedaan maken op 21 november 2026 verwijderd (zie 123).
45. Een bonregel stopt bij 999 stuks. *Kost:* 1.000 of meer vraagt twee verkopen.
46. De wis-toets van het aantalvenster heet "Wis cijfer"; tegels staan in de volgorde van categorie en product. *Kost:* niets.

### Taak 14: opslag op de iPad en verzenden

47. In tests wordt alleen de klok nagebootst, niet de rest van de timing. *Kost:* niets in de kassa.
48. De testhulpmiddelen wachten op de kassa, die niet in één keer start. *Kost:* een test kan wankel worden als de opslag trager is dan 25 ms.
49. Drie tests uit het plan zijn aangescherpt omdat ze te vroeg keken. *Kost:* niets.
50. Krijgt de iPad voor een verkoop geen antwoord, dan blijft die bewaard en volgt een nieuwe poging na 30 seconden. *Kost:* zulke verkopen wachten een ronde langer.
51. Na het antwoord "ontkoppeld" stopt de kassa met verzenden tot hij opnieuw is gekoppeld. Valt het internet weg, dan staat er direct Offline. *Kost:* na een onterecht "ontkoppeld" blijft de kassa zo tot herladen of opnieuw koppelen; de verkopen blijven bewaard.
52. Kan een verkoop niet op de iPad worden opgeslagen, dan staat er 30 seconden "Opslaan mislukt. Noteer deze verkoop op papier en meld het aan de penningmeester." *Kost:* niets.
53. Teksten die het plan openliet: bij het opstarten, op het koppelscherm en bij fouten. Het codeveld neemt alleen cijfers. *Kost:* alleen tekst.

### Taak 15: levering op de kassa

54. Meldingen verschijnen boven elke pagina. *Kost:* niets.
55. De balk "Levering onderweg" verdwijnt direct na een gelukte bevestiging. *Kost:* mislukt het ophalen daarna, dan blijft de balk weg tot herladen; de levering is wel geboekt.
56. Teksten bij de levering ("Staan de dozen in de vriezer? …", "Besteld op …", "1 stuk"). *Kost:* alleen tekst.
57. De kassa onthoudt wat er sinds de laatste voorraadstand is verkocht, voor het getal op de tegel. *Kost:* niets.
58. Een venster bepaalt zijn eigen tekstkleur. *Kost:* niets.

### Taak 16: beheer, overzicht, rapporten en verkopen

59. Gedeelde bouwstenen voor de beheerpagina's zijn toegevoegd. *Kost:* niets in de werking.
60. Het veld Reden wordt door de pagina zelf gecontroleerd (minstens 3 tekens) met "Vul een reden in." *Kost:* bij 1 of 2 letters is die melding net niet precies.
61. De maand kies je met een maandveld en de knoppen Vorige maand en Volgende maand. *Kost:* in Safari en Firefox op de computer is het een tekstveld; dan gebruik je de knoppen of typ je jjjj-mm.
62. Boven elk rapport staat een totaalblok en in de tabellen staan totaalregels. *Kost:* regels waar niemand om vroeg.
63. Op een telefoon is de kolom Verkopen verborgen. *Kost:* het aantal verkopen per dag zie je dan alleen op een breder scherm en in de CSV.
64. De instelpagina controleert zelf de wachtwoordlengte (10) en stuurt door naar inloggen als er al is ingesteld. *Kost:* wie op een verse installatie direct /beheer/login opent, ziet een inlogscherm dat niet kan lukken.
65. Uitloggen staat aan het eind van het menu en zegt eerlijk als het niet lukt. *Kost:* niets.
66. Een venster laat de cursor in het veld dat erom vraagt (Reden). *Kost:* niets.
67. De tests uit het plan zijn aangescherpt en uitgebreid. *Kost:* niets.
68. Teksten in beheer die het plan openliet ("Laden…", "Geen verkopen in deze maand.", "Leg de kolom Pin naast de uitbetalingen van Mollie." en andere). *Kost:* alleen tekst.

### Taak 17: beheer, kas en voorraad

69. Het moment van een afdracht is het einde van de gekozen minuut, nooit later dan nu. *Kost:* een verkoop in de laatste seconden van die minuut, ná het legen van het kluisje, valt in die afdracht en geeft één keer een verschil van dat bedrag.
70. Naast "Verschil" staat in woorden welke kant het op gaat. *Kost:* één zin te veel.
71. Geen bevestigingsstap voor een afdracht. **Herzien** in de eindcontrole: beginbedrag en afdracht worden nu eerst teruggelezen in een venster.
72. Een ingedrukte knop "Markeer als ontvangen" of "Laat vervallen" blijft grijs tot de nieuwe lijst er is. *Kost:* na een gelukte actie met mislukt herladen blijft de knop grijs tot de pagina wordt ververst.
73. "Deze bestelling was al afgehandeld." als de beheerder hem intussen op de iPad bevestigde. *Kost:* niets.
74. Tabelstijlen zijn verplaatst naar een gedeelde plek. *Kost:* niets.
75. Op een telefoon staan "per doos" en "bestelgrens" onder de productnaam; de geschiedenis van afdrachten schuift zijwaarts. *Kost:* die geschiedenis leest lastig op een telefoon.
76. Teksten bij kas en voorraad die het plan openliet. *Kost:* alleen tekst.

### Taak 18: beheer, producten en instellingen

77. Een productregel is één blok (naam, prijs, knoppen) in plaats van kolommen. *Kost:* niets in de werking.
78. Omhoog en Omlaag zijn pijltjes. *Kost:* één keer raden wat ze doen.
79. Een nieuw product dat verborgen moet zijn wordt eerst gemaakt en dan verborgen. Mislukt het verbergen, dan staat dat er. *Kost:* in dat zeldzame geval staat het product op de kassa tot het met de hand wordt verborgen.
80. "Stuks per doos" en "Bestelgrens" worden op de pagina gecontroleerd en blijven bewaard als voorraad bijhouden uitgaat. *Kost:* een oude doosgrootte komt terug als het weer aangaat.
81. De kleur van een categorie wordt direct opgeslagen. *Kost:* een mistik verandert de tegelkleur tot hij wordt teruggezet.
82. "Nieuw product" kan pas als er een categorie is; Opslaan pas met een naam en een geldige prijs. *Kost:* niets.
83. Zolang een koppelcode in beeld staat, wordt de lijst met kassa's elke 5 seconden ververst; de code verdwijnt na 10 minuten. *Kost:* een verlopen code kan nog even in beeld staan.
84. Extra zin bij ontkoppelen: wachtende verkopen blijven op de iPad bewaard. *Kost:* één zin te veel.
85. Wachtwoord wijzigen controleert de 10 tekens en onderscheidt een fout huidig wachtwoord van een verlopen sessie. *Kost:* één extra verzoek.
86. Proefgegevens wissen vraagt alleen het getypte woord WISSEN. **Aangevuld** in de eindcontrole met het vinkje "Dit is de ingebruikname" (zie 100).
87. Teksten bij producten en instellingen die het plan openliet. *Kost:* alleen tekst.
88. Meer tests dan het plan vroeg (16 en 11 in plaats van 6 en 5). *Kost:* meer tests.

### Taak 19: app op het beginscherm en schermtests

89. Eigen iconen met een crèmekleurige achtergrond. *Kost:* alleen het uiterlijk.
90. Marges voor de ronde hoeken en de thuisbalk van de iPad. *Kost:* een paar pixels marge.
91. Een nieuwe versie wordt opgehaald als de kassa wordt geopend; er is geen tussentijdse controle. *Kost:* een kassa die nooit wordt gesloten houdt de oude versie. Een bon die in de eerste seconden na het openen wordt getikt, kan bij het verversen verdwijnen.
92. 10 schermtests in plaats van 5; inmiddels zijn het er 11. *Kost:* meer tests.
93. De schermtests hebben een eigen typecontrole en starten altijd een eigen server. *Kost:* niets.
94. De schermtests draaien alleen in WebKit, de motor van de iPad. *Kost:* niets.
95. `npm audit` meldt 4 matige waarschuwingen in bouwgereedschap. Ze blijven staan: de aangeboden oplossing breekt iets anders, en niets ervan draait op de iPad of de server. *Kost:* geen tijdens gebruik.

### Taak 20: online zetten, eerste deel

96. De handleiding is geschreven en de eindcontrole is gedaan voordat er iets online ging. *Kost:* de controle zag het databasenummer en het adres in de handleiding niet.
97. De handleiding noemt terugzetten via een commando door de bouwer (7 dagen), niet via een knop bij Cloudflare. *Kost:* de penningmeester vraagt de bouwer iets wat hij misschien zelf had kunnen klikken.
98. De handleiding bevat meer dan het plan vroeg: koppelen in de app, de ingebruikname, "Opslaan mislukt", een oude versie op de iPad en een verloren wachtwoord. *Kost:* een langere handleiding.

### Eindcontrole van 20 november 2026

99. "Doorgegeven" haalt een geweigerde verkoop definitief van de iPad. *Kost:* wie hem wegtikt zonder hem door te geven, laat een onverklaard overschot achter bij de volgende afdracht.
100. Het slot op "Proefgegevens wissen" gaat erop met het vinkje "Dit is de ingebruikname", niet vanzelf na de eerste keer wissen. *Kost:* wie het vinkje nooit zet, houdt een wisknop op echte gegevens. Het woord WISSEN en 7 dagen terugzetten zijn dan het vangnet.
101. Een proefverkoop die bij de laatste keer wissen nog op de iPad wacht, wordt daarna als echte verkoop geboekt. *Kost:* een paar euro proefverkopen op de eerste echte dag, zichtbaar en terug te draaien in Verkopen.
102. De voorraad per product wordt door de database zelf bijgehouden. *Kost:* had Cloudflare dat geweigerd, dan was de eerste installatie mislukt. Dat is niet gebeurd.
103. Het logboek van de server staat aan. *Kost:* is het gratis tegoed op, dan worden de regels uitgedund; er gaat niets stuk.
104. Er is geen code gewijzigd om de twijfel of het gratis abonnement inloggen en grote verzendingen aankan. Dat is gemeten op de echte kassa (zie 120 en 132). *Kost:* zie daar.
105. De schermtests en de bouw heeft de bouwer zelf gedraaid, omdat de controleur dat niet deed. *Kost:* niets.
106. De limieten van Cloudflare zijn nagekeken op 20 november 2026. *Kost:* limieten veranderen. Is een dagtegoed op, dan ligt de database stil tot middernacht UTC en verkoopt de kassa offline door.
107. Taak 20 en 21 wachtten op de penningmeester. *Kost:* niets.
108. Pin blijft grijs en iZettle blijft de echte kassa tot Mollie werkt. *Kost:* niets.
109. Twee kassa's tegelijk valt buiten het ontwerp. *Kost:* de voorraad op een tegel loopt achter met wat de andere kassa verkocht.
110. Een iPad waarvan de klok ver achterloopt: de verkoop komt op de verkeerde dag in het rapport, het kasbedrag klopt wel. *Kost:* een dagrapport dat met de hand moet worden uitgelegd.
111. Een terugdraaiing op de kassa van een verkoop die net is afgedragen blijft toegestaan. *Kost:* niets gevonden. De kassa biedt terugdraaien sinds 21 november niet meer aan.
112. Het wachtwoord wordt 100.000 keer versleuteld, minder dan het huidige advies; meer staat Cloudflare niet toe. *Kost:* een gestolen database met een zwak wachtwoord is sneller gekraakt.
113. Of de 0,3 seconde tikbescherming goed voelt, kan alleen een echte iPad zeggen. *Kost:* één getal aanpassen.
114. De 4 waarschuwingen van `npm audit` blijven (zie 95); terugzetten kan 7 dagen. *Kost:* niets tijdens gebruik.
115. De rekentijd van "Alles downloaden" en de CSV's is niet gemeten. *Kost:* na enkele seizoenen kan "Alles downloaden" mislukken op het gratis abonnement.
116. Bestanden die de controleur niet regel voor regel las, steunen op de tests. *Kost:* een fout in een ongelezen hoek.

### Taak 20 en 21: online, 21 november 2026

117. Er zijn drie databasestappen toegepast, niet twee; de derde kwam uit de eindcontrole. *Kost:* niets.
118. Het adres kreeg de naam twee keer, omdat het installatieprogramma die zelf registreerde. De penningmeester heeft daarna besloten het zo te laten. *Kost:* een lang adres; later wijzigen betekent de iPad opnieuw koppelen.
119. De losse bestanden van de app worden nog over gewoon http uitgedeeld. De pagina schakelt zelf over naar https en de server antwoordt niets over http. *Kost:* een browser zonder JavaScript toont over http een lege pagina; er kan niets geheims mee worden verstuurd.
120. Inloggen kost 15 tot 30 ms rekentijd tegen de 10 ms die het gratis abonnement noemt. Het blijft zo, omdat alle logins slaagden. *Kost:* gaat Cloudflare strikt handhaven, dan mislukt inloggen tot de versleuteling lager gaat of het betaalde abonnement (5 dollar per maand) wordt genomen.
121. "Laatste verkoop terugdraaien" is van de kassa gehaald, op verzoek van de penningmeester. *Kost:* elke fout aangeslagen, betaalde verkoop heeft de penningmeester nodig vóór de volgende afdracht; anders blijft het een kasverschil met een notitie.
122. De server accepteert nog wel een terugdraaiing van een kassa, voor een iPad die nog een oude versie draait. *Kost:* een ongebruikt pad blijft bestaan. Een gekoppelde iPad kan technisch nog een eigen contante verkoop binnen 5 minuten terugdraaien.
123. "Wis alles" wist zonder melding en zonder weg terug, op verzoek van de penningmeester. Er is geen bevestigingsvraag voor in de plaats gekomen. *Kost:* een mistik wist de bon en de beheerder tikt de producten opnieuw aan.
124. Taak 21 is gebouwd voordat taak 20 was afgesloten. *Kost:* niets.
125. De reservekopie krijgt de Nederlandse datum in de naam. *Kost:* niets.
126. Toegevoegd buiten het plan: het blok Reservekopie in beheer met "Laatste kopie", de waarschuwing na 8 dagen en de knop "Nu een kopie maken". *Kost:* één knop meer; elke druk schrijft één bestand, dat van dezelfde dag wordt overschreven.
127. De kopie blijft één volledig bestand. *Kost:* na een seizoen of meer kan de kopie (en "Alles downloaden") worden afgebroken door de rekentijdgrens, na jaren door de geheugengrens. De uitweg is het betaalde abonnement of opsplitsen per jaar.
128. Nieuw op de kassa, op verzoek van de penningmeester: de knop Omzet. *Kost:* iedereen bij de iPad kan de omzet van elke dag of week lezen.
129. Keuzes van de bouwer daarbinnen: een week loopt van maandag tot en met zondag, het scherm opent op vandaag, bladeren kan terug en vooruit tot vandaag, alleen dagen met verkopen staan erin, wachtende verkopen tellen nog niet mee, en zonder internet is er geen rapport. *Kost:* een detail dat anders moet, vraagt een kleine wijziging.
130. De kopie stond uit zolang R2 niet aanstond. **Afgehandeld:** sinds 21 november 2026 staat hij aan en is de eerste kopie gecontroleerd.
131. De proefronde is gesloten op het woord van de penningmeester, terwijl een deel niet op de echte kassa is gezien: een afdracht met verschil, een prijswijziging, een levering van twee dozen, een product onder de bestelgrens en het scherm Omzet. Die zijn alleen op een proefopstelling getest. *Kost:* een fout die alleen op de echte kassa of iPad optreedt, komt pas bij gebruik boven. De kassa is nog niet in echt gebruik, dus er is tijd om ze te lopen.
132. Een verzending van drie verkopen kostte 14 ms rekentijd tegen de 10 ms van het gratis abonnement en werd geaccepteerd. Er is niets gewijzigd. *Kost:* na een lange storing kan een grote verzending worden geweigerd. De verkopen blijven dan op de iPad en worden opnieuw geprobeerd; er gaat niets verloren, maar de teller blijft wachten. De uitweg is het betaalde abonnement of kleinere verzendingen.
133. Er is een tweede, kleinere controle gedaan over de wijzigingen van 21 november. *Kost:* één controleronde voor niets.

### Tweede controle van 21 november 2026

Deze controle ging over de wijzigingen van 21 november: geen antwoord over http, terugdraaien en Ongedaan maken van de kassa af, het scherm Omzet en de wekelijkse kopie. Ze vond twee fouten in het scherm Omzet en een verkeerde weekdag bij de kopie; die drie zijn gerepareerd (zie "Wat de controles hebben gerepareerd").

134. Een verkoop die nog onderweg is naar de server op het moment dat Omzet wordt geopend, kan in de cijfers ontbreken zonder melding, tot het scherm opnieuw wordt geopend. Dit is niet aangepast: de reparatie dekt alle gevallen waarin de kassa wist dat er iets wachtte. *Kost:* op trage wifi ziet iemand die direct na een verkoop Omzet opent de dag één verkoop te laag.
135. Terugzetten uit een wekelijkse kopie is nooit geoefend en heeft drie valkuilen. Die staan nu in de handleiding voor de bouwer; oefenen is niet gedaan. *Kost:* de eerste echte terugzetting duurt langer dan gehoopt en de beschreven stappen zijn ongetest.
136. Onbeperkt terugbladeren in Omzet blijft (zie 128 en 129). *Kost:* iedereen bij de iPad leest ook oude omzet.
137. De schermtests en de bouw zijn na de reparaties opnieuw gedraaid (12 geslaagd). Het scherm Omzet is nog niet op de echte iPad gezien. *Kost:* een opmaakfout die alleen de echte iPad toont.
138. De eerste automatische kopie, op maandag 23 november 2026 om 04:00 uur, is nog niet gezien. *Kost:* loopt die nooit, dan staat na acht dagen de waarschuwing in beheer.
139. Rekentijd en geheugen van de kopie bij veel gegevens: besluit 127 blijft. De controleur vermoedt dat de geheugengrens eerder knelt dan "na jaren". *Kost:* de wekelijkse kopie stopt eerder dan geschat; beheer waarschuwt na acht dagen.
140. Losse bestanden over gewoon http: blijft (zie 119). *Kost:* zie daar.
141. "Wis alles" zonder bevestiging: blijft, het is de keuze van de penningmeester (zie 123). De reparatie van de dubbele tik haalt de enige manier weg waarop het scherm Omzet het kon veroorzaken. *Kost:* zie daar.
142. De server accepteert nog een terugdraaiing van een kassa: blijft (zie 122), tot elke gekoppelde iPad de nieuwe versie draait. *Kost:* een ongebruikt pad blijft bestaan.
143. De rekentijd van inloggen en van verzendingen: blijft (zie 120 en 132). *Kost:* zie daar.
144. Een gestolen kassasleutel kan via de omzetadressen het dagtegoed van de database opmaken. Blijft: dat kon al via de catalogus, en ontkoppelen in beheer stopt het. *Kost:* de database ligt stil tot middernacht UTC; de kassa verkoopt intussen offline door.
145. Ontwikkelen vanaf een andere computer via het netwerkadres wordt door de https-regel geweigerd. Blijft. *Kost:* een ontwikkelaar moet localhost gebruiken.
146. Toetsenbord en schermlezer in het scherm Omzet: blijft, de iPad werkt met aanraking. *Kost:* met een toetsenbord sluit Escape het scherm niet; Sluiten is wel bereikbaar.
147. Extreme datums (jaar 0 of 9999) geven een onleesbare periode. Blijft: vanaf het scherm is dat niet te bereiken. *Kost:* niets.

## Kleine punten die zijn blijven liggen

Uit de eindcontrole van 20 november 2026:

1. De statusregel zegt "Online" in groen terwijl de server fouten geeft. Het aantal wachtende verkopen is het echte signaal; de handleiding zegt dat.
2. Na een tik op het verkeerde bankbiljet is er geen weg terug vanaf het wisselgeldscherm.
3. De CSV-downloads maken cellen die met = + - of @ beginnen niet onschadelijk (formules in Excel). Alleen eigen invoer van de penningmeester komt daarin.
4. De rem op inlogpogingen werkt per internetadres en is met gelijktijdige pogingen te omzeilen: ongeveer 100 pogingen per kwartier in plaats van 5. Het instel-adres laat na het instellen nog merken of een instelcode juist is.
5. Een telling die voor een eerder moment wordt ingevoerd, toont het verschil met de voorraad van nu.
6. De tekst "Contant sinds de laatste afdracht." op het overzicht leest vreemd vóór de eerste afdracht.
7. Dubbele interne sleutels in de rapporttabellen; zonder zichtbaar gevolg.
8. Categorieën kunnen in beheer niet van volgorde wisselen.
9. Een download met een verlopen sessie slaat de foutmelding op als .csv- of .json-bestand.
10. De kaspagina leest elke verkoop sinds het begin (alleen in beheer). Een bijgehouden totaal zou dat constant maken.

Uit de tweede controle van 21 november 2026:

11. Een tweede druk op "Nu een kopie maken" op dezelfde dag overschrijft de eerste, en handgemaakte kopieën nemen een van de 26 plaatsen van de wekelijkse in.
12. Elk bestand in de opslag waarvan de naam met `kassa-` begint, telt als kopie. Een met de hand geüploade export zou voor altijd "de laatste" zijn en een plaats bezet houden.
13. Een mislukte of ontbrekende wekelijkse kopie is alleen te zien onder Instellingen, na acht dagen. Is er nog helemaal geen kopie, dan komt er geen waarschuwing.
14. Randgevallen bij Reservekopie: na een mislukte poging toont de pagina de stand van het laden; er staat "niet gelukt" terwijl de kopie wel is geschreven als alleen het opruimen mislukte; een kopie die langer dan 15 seconden duurt toont "Geen verbinding".
15. Kleine punten in Omzet: een ontkoppelde iPad krijgt "Probeer het opnieuw", wat niet kan lukken; via het weekoverzicht is een dag in de toekomst te bereiken; de melding over wachtende verkopen staat ook bij dagen in het verleden.
16. Resten van het verwijderen: de mogelijkheid van een knop in een melding heeft geen gebruiker meer (de test noemt nog "Bon gewist"), en een opmerking en tests beschrijven nog terugdraaien vanaf de kassa.
17. De kassa gebruikt bouwstenen uit de map van beheer, en de functie voor "vandaag" bestaat twee keer.
18. Er is geen blijvende test dat de omzetadressen van de kassa goedkoop blijven als de geschiedenis groeit. De controleur heeft met de hand nagekeken dat ze de indexen gebruiken.

## Open punten voor de penningmeester

- Op de echte kassa nog te lopen: een afdracht met een verschil, een prijswijziging, een levering van twee dozen bevestigen op de iPad, een product onder de bestelgrens, en het scherm Omzet (ook een dubbele tik op Sluiten met een product op de bon).
- Na maandag 23 november 2026 in beheer onder Instellingen kijken of bij "Laatste kopie" 23-11-2026 staat.
- Vóór de ingebruikname: de proefgegevens wissen met het vinkje "Dit is de ingebruikname", en eerst op de iPad kijken of er niets meer wacht.
- De keuzes in Omzet (week van maandag tot en met zondag, onbeperkt terugbladeren) gelden tot de penningmeester iets anders wil.

## Wat de controles hebben gerepareerd

Letterlijk uit het bouwlogboek; elke reparatie heeft een test die eerst faalde en daarna slaagde.

- Final: fixed Important 1 (an opening amount left earlier cash sales open, so the cash-box figure counted them twice) — test/cash.test.ts "counts from the opening amount: cash sold before it is already in that amount" RED (expected 5720 to be 5360) → GREEN, suite 219/219 + 125/125
- Final: fixed (reviewer disagreed with the Task 17 ruling "no confirmation before a handover") the opening amount and a handover are read back in a dialog before they are recorded — src/beheer/CashPage.test.tsx "reads a handover back before recording it, and records nothing on Terug" and the changed opening test RED (6 failing) → GREEN, suite 219/219 + 125/125. The dialog repeats what was typed (moment, ontvangen, achtergebleven), not the difference: for a back-dated moment the server works that out (reviewer Minor 7).
- Final: fixed double tap on "Ja, terugdraaien" landed on the screen behind (reviewer Minor 1, re-graded Important: a stray product on the next receipt) — e2e "a double tap on Ja, terugdraaien takes the sale back once and leaves the next receipt empty" RED→GREEN, suite 221/221 + 125/125
- Final: fixed reversal offer outlived five real minutes when the iPad slept (reviewer Minor 2, re-graded Important: kassa said "teruggedraaid" while the server refuses) — KassaPage "does not reverse a sale of more than five minutes ago…" and "takes the reversal offer away when the iPad wakes up after five minutes" RED→GREEN, suite 221/221 + 125/125
- Final: fixed refused sales were a dead end on the iPad (reviewer Important 3) — KassaPage "shows what the server refused, and forgets it once it has been passed on", StatusBadge "explains a refused reversal: the sale is still in the books" and "lists every refused item, oldest first, and keeps the others when one is passed on" RED→GREEN, suite 224/224 + 125/125; README corrected (status line, "Verkoop afgekeurd")
- Final: fixed "Proefgegevens wissen" stayed available forever (reviewer Important 4, and the disputed Task 18 ruling) — maintenance "locks wiping for good at the ingebruikname", "can be wiped again as long as the trial lasts", "refuses a final flag that is not yes or no, and wipes nothing"; SettingsPage "locks wiping when this is the ingebruikname", "offers no wipe once the kassa is in use", "says so when the server refuses a wipe because the kassa went into use meanwhile" RED→GREEN, suite 227/227 + 128/128; README: ingebruikname in three steps, unlock command for the builder
- Final: fixed the catalog poll added up every stock movement ever made (reviewer Important 2, and the disputed Task 9 ruling) — growth "reads no more rows for the daily work after a season of sales" (catalog 85→702 rows with 600 movements before; 84→87 after; reversal 14→620 before, 16→16 after; delivery 12→618 before, 10→11 after) and "keeps the stock as the sum of the movements, through sales, reversals, deliveries, counts and a wipe" RED→GREEN, suite 227/227 + 130/130; migration 0003: products.stock kept by triggers on stock_movements, index on ref_id
- Final: fixed (own finding, not the reviewer's) the home-screen-app plugin also ran for the Worker build and uploaded registerSW.js with the Worker — vite.config.ts limits it to the client environment; evidence: dist/worker held manifest.webmanifest + registerSW.js before and holds only index.js, its map and wrangler.json after; dry-run deploy no longer attaches a module; dist/client/sw.js still built (15 entries); e2e 11/11
- Task 20: fixed (the TODO above, found on the live address) plain http — test/health "refuses every api call over plain http, also the ones that need no login" and "answers over https, and tells the browser to keep using it", src/lib/secure-address tests RED→GREEN; suite 230/230 + 133/133, e2e 11/11; deployed as version 484106b7; live evidence: http api → 400 https_required, https api → 200 with Strict-Transport-Security, a page opened over http lands on https://…/beheer/instellen; SETUP_TOKEN (set by the penningmeester) still listed, admin still not configured
- Final: fixed (review 2, Important 1) a double tap on "Sluiten" in Omzet cleared the receipt (the panel left no tap shield and "Wis alles" sits right under the button) — e2e "a double tap on Sluiten closes Omzet and leaves the receipt as it was" RED (Koffie gone from the receipt) → GREEN; suite 238/238 client, 144/144 worker, typecheck clean, e2e 12/12
- Final: fixed (review 2, Important 2) the Omzet figures stayed as they were after waiting sales had been sent, while the note about them disappeared — RevenuePanel "fetches the figures again once the waiting sales have been sent" RED (still "contant € 3,30") → GREEN; suite 238/238, 144/144, e2e 12/12
- Final: fixed (review 2, Minor 1 re-graded) the weekly copy was scheduled for Sunday: cron `0 3 * * 1` → `0 3 * * MON` — a config line only Cloudflare interprets, so no test; evidence is Cloudflare's own page and the schedule the deploy prints

## Bijlage: de oorspronkelijke regels uit het bouwlogboek

### Besluiten (147)

1. Setup: Ruling: the folder was not a git repo; ran `git init`, committed the docs on `main` (f7316ba) and do all work in place on branch `fase-1`, no worktree — nothing existed to protect, and the penningmeester's file pane and terminal work in this folder — cost if wrong: one merge into main at the end. The plan's "commit on branch main" becomes "commit on fase-1".
2. Setup: Ruling: Task 1 Step 1 (git init, .gitignore) was done during setup because the workspace script needs a repo — cost if wrong: none; `.dev.vars.example` is still made in Task 1.
3. Task 1: Ruling: added dev dependency `@types/node` — the config files import `node:path` and the plan's install line lacked it — cost if wrong: one unused package.
4. Task 1: Ruling: `test/tsconfig.json` is its own referenced project (the root tsconfig has no options to extend), so `tsc -b` type-checks the Worker tests too — cost if wrong: none.
5. Task 1: Ruling: `src/test-setup.ts` also runs Testing Library's `cleanup` after each test, because Vitest without globals does not do it — cost if wrong: none.
6. Task 1: Ruling: added `.claude/launch.json` (config `kassa-dev`) so the dev server runs through the app's preview tool — cost if wrong: one extra file.
7. Task 2: Ruling: tests and code build the non-breaking space with `String.fromCharCode(160)` instead of a ` ` escape — my file-writing tool turns that escape into an invisible raw character — cost if wrong: none, same string.
8. Task 3: Ruling: the two constraint tests assert the message (/CHECK constraint failed/, /UNIQUE constraint failed/) instead of a bare toThrow() — in the RED run the bare version passed because the table was missing, so it proved nothing — cost if wrong: a D1 wording change breaks two tests, not the app.
9. Task 4: Ruling: the "no setup code configured" test also sends an empty setupToken — with only the brief's value the test passes without the guard (an empty code would match an empty guess and let anyone set the password); verified by removing the guard: 201 instead of 403 — cost if wrong: none, the test is stricter.
10. Task 4: Ruling: added tests for the block lifting after 15 minutes, other sessions ending on a password change, and the 401/403 bodies — the brief names these behaviours but pins none of them — cost if wrong: three extra tests to maintain.
11. Task 4: Ruling: admin-auth.ts exports two routers (adminAuthPublic: status/setup/login; adminAuth: me/logout/password) and app.ts mounts requireAdmin between them with app.use("/api/admin/*") — later tasks then get the guard on every /api/admin route without repeating it — cost if wrong: a route mounted before the app.use line would be public; the order in app.ts is the thing to check.
12. Task 4: Ruling: text fields in login/setup/password bodies are capped at 200 characters (400 invalid) — keeps a huge body from tying up PBKDF2 — cost if wrong: a password longer than 200 characters is refused.
13. Task 5: Ruling: a new pairing code deletes ALL older codes, used ones too (brief: "unused older codes") — the table then never holds more than one row and a repeated six-digit code cannot collide on the primary key — cost if wrong: no history of used codes (nothing reads it).
14. Task 5: Ruling: pair body validation: name trimmed, 1 to 40 characters, else 400 invalid without spending the code; revoke of an unknown device id answers 404 not_found; GET /api/kassa/ping lives in app.ts — the brief leaves all three open — cost if wrong: Task 14's pairing screen must show a message for 400.
15. Task 5: Ruling: added tests for the 10-minute validity, the newest code still working, a blank name, last_seen_at, the admin guard on the new routes and the hashed code — behaviours the brief states without a test — cost if wrong: extra tests to maintain.
16. Task 6: Ruling: PUT /api/admin/products/order answers 400 invalid for an unknown or repeated id (and an empty list) and 200 { ok: true } otherwise; PATCH answers the changed AdminProduct/Category; POST /categories answers 201 with the Category (id a UUID, sort max + 1); category sort accepts int 0 to 10000 — the brief names the routes but not these answers; Task 18's mocks expect exactly { ok: true } and a product — cost if wrong: a beheer page would mis-handle one answer.
17. Task 6: Ruling: unknown fields in a product/category body are ignored, not refused — beheer may send a whole product back — cost if wrong: a misspelt field name changes nothing without an error.
18. Task 6: Ruling: worker/db/products.ts also exports listCategories and toAdminProduct (not in the Interfaces block) — both routers need them — cost if wrong: none.
19. Task 7: Ruling: ingestItems reads what a request needs in at most four queries and writes ALL accepted items in ONE db.batch; only if that batch fails does it fall back to the plan's one batch per item (PK conflict → duplicate, reversal index conflict → already_reversed, anything else rethrown) — the free plan allows 50 D1 calls per Worker request and a batch counts as one (checked on developers.cloudflare.com/d1/platform/limits on 2026-11-20); the plan's read + batch per item needs about 100 for a full outbox request of 50, so a day of offline sales would never sync — cost if wrong: more code in sales.ts; if the fallback itself runs out of calls the request fails and the iPad's retry sees the stored items as duplicates. Pinned by a test that counts the calls (5 for 50 items) and two same-moment tests that fail without the fallback.
20. Task 7: Ruling: a reversal puts back the stock by mirroring the original sale's own stock_movements rows (brief: "for tracked products") — a product whose "voorraad bijhouden" was switched between sale and reversal would otherwise leave the stock one off — cost if wrong: none seen; pinned by a test.
21. Task 7: Ruling: the clock-ahead rule (soldAt more than 5 minutes after now → now) also applies to a reversal's soldAt before the 5-minute "too_late" check — otherwise an iPad whose clock runs ahead could never undo a sale — cost if wrong: a reversal from such an iPad is judged on server time.
22. Task 7: Ruling: sold_at is stored re-formatted with new Date(...).toISOString() — handover and report queries compare these strings, and the schema accepts timestamps without milliseconds — cost if wrong: none.
23. Task 7: Ruling: Review Focus 1 test extended with 22:30Z (00:30 local next day) and a winter case — the brief's 21:30Z case has the same UTC and Amsterdam day and so cannot tell them apart — cost if wrong: none.
24. Task 8: Ruling: the handover insert computes "expected" and re-checks its precondition inside the SQL itself (INSERT ... SELECT ... WHERE NOT EXISTS), in one batch with the UPDATE that closes the sales — a count sent twice at the same moment, or a sale arriving during the count, cannot produce two handovers or a wrong total; the second request answers 400 counted_before_last — cost if wrong: harder-to-read SQL in cash.ts. Pinned by a same-moment test that fails without the guard.
25. Task 8: Ruling: handover body: cents capped at 100000000, note trimmed, at most 500 characters, empty note stored as null; a reverse request without a usable reason answers 400 reason_required (reason over 200 characters too) — the brief gives no limits — cost if wrong: a very long note is refused with "invalid".
26. Task 9: Ruling: receiveOrder closes the order and books the delivery in ONE batch (the insert only runs when the order is now 'received' and has no delivery rows yet) instead of the plan's update-then-insert in two steps — if the Worker stopped between the two steps the order would be received without its stock; a second call still answers 409 not_open and can never add stock — cost if wrong: none seen; pinned by the Review Focus 4 tests, one with three calls at the same moment.
27. Task 9: Ruling: the catalog reads categories, products with stock, and open orders in one db.batch (one D1 call per minute per iPad) and the stock module does not import getProduct — keeps products.ts → stock.ts a one-way import — cost if wrong: none.
28. Task 9: Ruling: an unknown order id on receive/cancel answers 409 not_open (as the brief's rule reads); a count on an unknown or untracked product answers 400 not_tracked; count capped at 100000, boxes at 1000, loose units at 10000, order lines at 100, note at 500 characters — limits the brief does not give — cost if wrong: an absurdly large number is refused with "invalid".
29. Task 9: Ruling: test/products.test.ts now expects stock 0 for a tracked product and null for an untracked one in the catalog (the brief says that file stays unchanged) — my Task 6 version pinned stock null for every product, which this task changes by design — cost if wrong: none.
30. Task 10: Ruling: the CSV tests read the response as bytes (TextDecoder with ignoreBOM) instead of res.text() — text() strips the byte-order mark by the fetch standard, so the brief's expectation of a leading BOM after text() can never hold; the BOM is in the bytes, which is what Excel reads — cost if wrong: none.
31. Task 10: Ruling: the BOM is written as String.fromCharCode(0xfeff) in csv.ts and in the tests — the editing tool turns a ﻿ escape into the raw character — cost if wrong: none.
32. Task 10: Ruling: added worker/lib/params.ts (parseDate, parseMonth; a day must be a real calendar day, so 2026-02-31 is refused) shared by the report routes and the sales list — the brief names no file for this — cost if wrong: none.
33. Task 10: Ruling: the sales list and every report leave out sales whose status is not 'paid'; byProduct ties are ordered by name; each report reads all its figures in one db.batch — unspecified details — cost if wrong: fase 2 may want failed pin payments in the list.
34. Task 11: Ruling: exportAll takes a second argument now (for exportedAt), where the brief's signature has only db — keeps the clock out of the database module, like every other function there — cost if wrong: none.
35. Task 12: Ruling: public/icon.svg is the castle icon copied from the speeltuin's own site (burchttercleeff.nl/icon.svg), inspected first (plain SVG, no scripts or external references) — the plan names this file and the approved design asks for the site's look — if the vereniging would rather not reuse it, replace one file.
36. Task 12: Ruling: the Dialog backdrop carries data-testid="dialog-backdrop" and the Dialog has an extra `wide` prop — the backdrop has no accessible role to query by; later dialogs with a number pad need more width — none beyond one test-only attribute in the markup.
37. Task 12: Ruling: api.ts gives every request a 15 s timeout (AbortSignal.timeout) that is reported as "offline" — a request that hangs on bad wifi must not freeze the kassa — a slow but successful request is treated as failed and retried; harmless because a sale is accepted only once by its id.
38. Task 12: Ruling: placeholder pages show the Logo above the heading, and an unknown path shows "Pagina niet gevonden" — the brief's look step expects the logo at /beheer — none.
39. Task 12: Ruling: test-utils also exports `user()`, palette also exports `colorKeys`; the test reset deletes the IndexedDB database "kassa" and moves on even when the delete is blocked — later tasks need them; a blocked delete must not hang the suite — a connection left open by Task 14's db module would leak data between tests, so that module must close its connection on versionchange.
40. Task 13: Ruling: a closing Dialog leaves an invisible "tap shield" over the page for 300 ms (CSS animation, src/ui/Dialog.tsx + app.css; changes a Task 12 file) — on a real iPad the second tap of a double tap on Gepast/Klaar/Toevoegen/Terug lands on whatever was under the dialog and would put a ghost product on the next receipt — a deliberate tap within 0.3 s after a dialog closes is swallowed. Measured in the browser: shield takes the hit at 50 ms, is gone at 450 ms. TODO Task 19: pin with a Playwright double-click test (jsdom has no hit-testing).
41. Task 13: Ruling: the cash dialog and the number pad cannot be closed by tapping beside them (dismissable=false); they close with Terug / Annuleren — a double tap on Contant would otherwise open and close the dialog at once, and a stray tap must not hide the change — one extra tap target to learn; matches the approved sketch.
42. Task 13: Ruling: both steps of the cash dialog have the same height and Klaar sits exactly where Terug was — a double tap on a banknote must not land on Klaar and skip the change (measured: notes y 396–536, Terug/Klaar y 556–620) — none; TODO Task 19: pin with a Playwright double-click on a banknote.
43. Task 13: Ruling: no extra "only once" guard inside the cash dialog — React removes the dialog before a second tap can arrive, and the brief's double-tap test passes without one — if wrong, a double tap would book two sales; the e2e double-click test of Task 19 would show it.
44. Task 13: Ruling: "Ongedaan maken" puts the cleared receipt back and keeps what was tapped since (restore merges instead of replaces) — tapping a product within the five seconds must not lose it — the brief's restore test still holds; nobody loses a line.
45. Task 13: Ruling: a receipt line stops at 999 pieces (cart.MAX_QTY), and a zero in front on the number pad is ignored — the server rejects more than 999 per line, so two pad entries could otherwise produce a sale that is set aside — a line of 1000+ pieces needs two sales.
46. Task 13: Ruling: the pad's delete key is named "Wis cijfer"; the Dialog got a `centered` option; tiles keep the order of the catalog (the server sorts by category, then product) — copy and layout the brief leaves open — none.
47. Task 14: Ruling: client tests that fake the clock fake only setTimeout/setInterval/Date (vitest.client.config.ts fakeTimers.toFake) — the stand-in for IndexedDB runs on setImmediate; with that faked its transactions closed before the awaiting code went on (noteSold threw InvalidStateError) — none in production; a test that needs a faked setImmediate must ask for it itself.
48. Task 14: Ruling: test-utils: `tap` waits for its button (findByRole) because the kassa page starts asynchronously; the reset after each test first unmounts the page, waits 25 ms when the kassa database exists and then deletes it; `deleteKassaDatabase` is exported — the brief's sellOne taps right after renderAt — storage work slower than 25 ms could leak into the next test and make it flaky.
49. Task 14: Ruling: three of the brief's tests were tightened: "sends a sale…" waits for the POST before checking the queue (pending is 0 before the sale too), "unpaired" waits for the queue, a dialog name is matched with its non-breaking space; App.test and the route test now expect the pairing page at `/` on an unpaired iPad — the brief's versions raced or no longer described the page — none.
50. Task 14: Ruling: flush keeps an item the server gave no answer for, and stops with "server" when a whole answer matches none of the items — otherwise a misbehaving server is asked for ever in a tight loop — such items wait for the next round (30 s).
51. Task 14: Ruling: sync stops calling the server once it got a 401 (until the iPad is paired again and the page starts afresh), shows Offline at once on the browser's offline event, drops a fetched catalog when a sale was made while it was on its way, and catches and logs an error in a round — avoids hammering with a dead token and double-counted stock; a thrown storage error must not end the background work — after a wrongly received 401 the kassa stays "ontkoppeld" until reloaded or paired again; sales are kept either way.
52. Task 14: Ruling: a sale or reversal that cannot be stored on the iPad shows "Opslaan mislukt. Noteer deze verkoop op papier en meld het aan de penningmeester." for 30 s and withdraws the reversal offer; a failed stock note is ignored — the brief is silent; a silently lost cash sale is the worst case for the kluisje check — none.
53. Task 14: Ruling: copy the brief leaves open: "De kassa wordt gestart…" while the first catalog is fetched, an explanation line on the pairing page and in the reversal dialog, "Koppelen is niet gelukt. Probeer het opnieuw." for other pairing errors (400 gets the wrong-code text); the code field takes digits only and Koppelen needs six digits and a name; status and last sale share one footer bar, toasts moved up to stay clear of it; noteSold drops a product whose count is back at zero — none.
54. Task 15: Ruling: toasts are rendered directly under the body (a portal in src/ui/Toast.tsx, a Task 12 file) — the brief's "is absent without open orders" test wants an empty container, and a message belongs above whatever page shows — none.
55. Task 15: Ruling: the DeliveryBar hides an order as soon as its confirmation succeeded, without waiting for the next catalog, and closes its dialog — otherwise the bar stays for a moment and invites a second confirmation — if the catalog fetch then fails the bar stays hidden until the page is reloaded; the order itself is received on the server.
56. Task 15: Ruling: copy the brief leaves open: the hint beside the bar ("Staan de dozen in de vriezer? Tik hier om de ontvangst te bevestigen."), "Besteld op {datum}" and the note per order, a "Sluiten" button, "1 stuk" in the singular; an "offline" answer at the moment of confirming shows the offline sentence; the bar counts as offline while the kassa is unpaired — none.
57. Task 15: Ruling: KassaPage keeps the sold-since-fetch count in memory beside the database (read at start, after every sale or reversal, cleared with a fresh catalog) and added KassaPage tests for the tile notes and the delivery — the brief tests only the two new modules — none.
58. Task 15: Ruling: a Dialog sets its own text colour and weight (src/ui/Dialog.tsx) — opened from the yellow delivery bar its title came out brown — none.
59. Task 16: Ruling: added src/beheer/parts.tsx (Card, Loaded, Problem, TotalsBlock, field/link styles, today, count) and useGo/useAdminWrite/loadProblem in useAdmin.ts, none of them in the brief's file list — Tasks 17–18 build four more pages from the same pieces, and a write that meets a 401 must lead to login like a read does — costs nothing functionally if wrong; a few more shared names to keep consistent.
60. Task 16: Ruling: the field Reden is checked by the page itself (noValidate, aria-required, at least 3 characters as the server asks) instead of the browser's `required` — the brief wants "Vul een reden in." on screen with no POST, a native required field shows the browser's own bubble instead — if wrong: a reason of one or two letters gets "Vul een reden in.", which is slightly beside the point.
61. Task 16: Ruling: the month field is an input type=month with buttons Vorige maand / Volgende maand beside it; Volgende is disabled at the current month — desktop Safari and Firefox have no month picker and show a plain text field (a complete jjjj-mm opens that month) — if wrong: in such a browser the penningmeester uses the arrows or types the month.
62. Task 16: Ruling: added a totals card above each report and total rows in the tables ("Hele maand" in Per dag, "Samen" in Per categorie and Per product) — the brief lists only the columns; the month total per column is what gets compared with the bank and the cash box — if wrong: rows nobody asked for.
63. Task 16: Ruling: on a phone (under 640 px) the column Verkopen of Per dag is hidden and the tables use smaller text — five columns do not fit 375 px without scrolling sideways inside the card — if wrong: the number of sales per day is only visible on a wider screen and in the CSV.
64. Task 16: Ruling: the setup page checks the password length itself (10), leaves for login when the kassa is already set up (status or a 409) and confirms with a toast; the login page does not ask the status — a fresh installation reaches setup through /beheer — if wrong: someone who opens /beheer/login directly on a fresh installation sees a login form that cannot succeed.
65. Task 16: Ruling: Uitloggen sits at the end of the navigation row, not beside the logo, and says "Uitloggen is niet gelukt" instead of pretending when the server cannot be reached — saves a row on a phone; a session that is still open must not look closed — if wrong: nothing lost.
66. Task 16: Ruling: changed the shared Dialog (Task 12) so it leaves the focus with a field inside that asked for it (autoFocus on Reden), with two tests — typing the reason should not need an extra tap — if wrong: the kassa's dialogs have no such field and behave as before.
67. Task 16: Ruling: brief tests tightened and extended (logout, ended session, retry after a failed load, setup refusals, month and date fields, empty month, sale card contents, focus); the day-view test waits for its rows with findAllByRole because the date heading is on screen before the data — the brief's getAllByRole right after the heading cannot hold with a page that shows its title while loading — if wrong: none, the assertions are the brief's.
68. Task 16: Ruling: copy the brief leaves open: "Laden…", "Er ging iets mis. Probeer het opnieuw.", "Geen verbinding. Probeer het opnieuw.", "Opnieuw proberen", "Geen verkopen in deze maand." / "Geen verkopen op deze dag.", "Leg de kolom Pin naast de uitbetalingen van Mollie.", dialog title "Verkoop terugdraaien" with one explaining sentence, toasts "Verkoop teruggedraaid" and "Wachtwoord ingesteld. Log nu in.", links "Bekijk het maandrapport", "Naar de voorraad", "Bekijk het rapport van deze dag", extra refusals "Een tegenboeking kan niet worden teruggedraaid." and "Deze verkoop bestaat niet meer." — wording only.
69. Task 17: Ruling: the moment of a handover is the end of the chosen minute, but never later than now (the field only knows minutes) — a sale made in the minute the box was emptied belongs to that handover, and a handover recorded in the same minute as the opening amount would otherwise be refused as "voor de vorige afdracht" — if wrong: a sale made in the last seconds of that minute, after the box was emptied, lands in the handover instead of the next period (it shows as a difference of that sale's amount, once).
70. Task 17: Ruling: next to "Verschil: {bedrag}" the page says in words which way it goes ("Er zit minder in dan verwacht." / "Er zit meer in dan verwacht." / "Het klopt precies.") — the sign convention (verwacht − ontvangen − achtergebleven) is not obvious from a bare amount — if wrong: one sentence too many.
71. Task 17: Ruling: no confirmation step before a handover is recorded, as the brief's test has it; the live difference is the check — a handover cannot be changed afterwards, a typo ends up in that handover's difference and is explained in the next one's note — if wrong: a mistyped amount is recorded for good.
72. Task 17: Ruling: a pressed "Markeer als ontvangen" / "Laat vervallen" stays disabled until the fresh list arrives (it comes back after a failure); the other button of the same order stays usable, as the brief's test presses both — the first version re-enabled the button when the answer came, and a double click then sent the request twice (the server refuses the second, but the page showed "al afgehandeld" over the success) — if wrong: after a success with a failed reload the button stays grey until the page is reloaded.
73. Task 17: Ruling: a server answer `not_open` on receive/cancel is told as "Deze bestelling was al afgehandeld." and the lists are fetched again — the beheerder may have confirmed on the iPad in the meantime — if wrong: none.
74. Task 17: Ruling: moved the table and section styles from ReportsPage into parts.tsx (Section, table, head, cell, amount) — three pages now use them — behaviour unchanged, ReportsPage tests still green.
75. Task 17: Ruling: on a phone the Stand table shows "per doos" and "bestelgrens" under the product name instead of in columns, and the order fields are narrower, so "Tellen" stays in view; the history of handovers (six columns) scrolls sideways inside its block — if wrong: the handover history is awkward to read on a phone.
76. Task 17: Ruling: copy the brief leaves open: "Beginbedrag vastgelegd.", note under Beginbedrag ("Tel wat er nu in het kluisje zit…"), "Het beginbedrag is al vastgelegd.", "Vastleggen is niet gelukt. Probeer het opnieuw.", opening row marked "Beginbedrag" with dashes for verwacht/ontvangen/verschil, "Geen levering onderweg.", "Van geen enkel product wordt de voorraad bijgehouden. Dat stel je per product in bij Producten.", count dialog "{naam} tellen" with "Volgens de kassa zijn er nu {n}." and "Vul het getelde aantal in.", toasts "Telling opgeslagen: {naam} staat nu op {n}.", "Bestelling opgeslagen. De kassa toont nu “Levering onderweg”.", "Bestelling vervallen", column "Samen" with "{n} stuks" in the order form — wording only.
77. Task 18: Ruling: a product row is one table cell (name, price and badges, then the buttons) instead of separate columns — on a phone the three buttons did not fit beside the name (page scrolled sideways, 396 px on 375); in one cell they drop below the name — cost if wrong: none in function; a screen reader announces a one-column table per category
78. Task 18: Ruling: Omhoog and Omlaag are shown as arrows (↑ ↓) with the words as accessible name and tooltip — the words made the row too wide and arrows are the common sign for reordering — cost if wrong: the penningmeester has to guess once what the arrows do; swapping in the words is a one-line change
79. Task 18: Ruling: a new product that should be hidden is made with POST and hidden with a PATCH right after, because the server's POST takes no `active` (Task 6); if the hiding fails the dialog closes with "{naam} is toegevoegd, maar verbergen is niet gelukt. Verberg het via Bewerken." instead of staying open — a second Opslaan would have made the product twice — cost if wrong: in that rare case the product is on the kassa until it is hidden by hand
80. Task 18: Ruling: Stuks per doos and Bestelgrens are checked on the page (whole number, 1–500 and 0–10.000, empty allowed) with an own message, and keep their old value when Voorraad bijhouden is switched off — the server only answers "invalid", and losing the box size on an accidental untick would break the next order — cost if wrong: a stale box size comes back when stock keeping is switched on again
81. Task 18: Ruling: the colour of a category is saved as soon as it is chosen (no Opslaan), reordering and colour changes show a short message only when they fail — one tap, easy to put back — cost if wrong: a mis-tap on the select changes the tile colour on the kassa until it is put back
82. Task 18: Ruling: Nieuw product is disabled while there is no category; Opslaan is disabled without a name or a readable price — the server would refuse both — cost if wrong: none
83. Task 18: Ruling: while a pairing code is on screen the device list is fetched again every 5 seconds and the code disappears from the page after 10 minutes (counted on the page, the server decides what really works) — the penningmeester sees the iPad appear without reloading — cost if wrong: a code that the server already replaced or expired can stay on screen for a while; the iPad then says the code is wrong
84. Task 18: Ruling: the unpair dialog has an extra line "Verkopen die nog op de iPad wachten, blijven daar bewaard en worden verstuurd zodra hij opnieuw is gekoppeld." (Review Focus 5), and after unpairing a toast "{naam} is ontkoppeld" — cost if wrong: one sentence too many
85. Task 18: Ruling: Wachtwoord wijzigen checks the 10 characters on the page ("Wachtwoord is te kort."), and after a 401 asks /api/admin/me to tell a wrong current password ("Huidig wachtwoord klopt niet.") from an ended session (then to the login page) — the server gives the same answer for both — cost if wrong: one extra request after a wrong password
86. Task 18: Ruling: wiping the trial data asks nothing beyond the typed word WISSEN, and empties the field afterwards — the brief names the typed word as the guard — cost if wrong: someone who types WISSEN and taps the button loses the trial data without a second question (that is the stated design)
87. Task 18: Ruling: open copy written by me — "Een wijziging staat binnen een halve minuut op de kassa.", "Nog geen producten in deze categorie.", "De kleur is die van de tegels op de kassa.", "Er is nog geen kassa gekoppeld.", "Na het wijzigen zijn andere apparaten uitgelogd.", the note under Gegevens, dialog titles "Product bewerken" / "Nieuw product" / "Naam wijzigen" / "Nieuwe categorie" / "Kassa ontkoppelen", toast "Opgeslagen" — cost if wrong: wording to adjust
88. Task 18: Ruling: the brief's tests were extended (16 for products, 11 for settings instead of 6 and 5): list and marks, null box size, refused box size, Omlaag, hidden new product and its failure, failed save, category colour/rename/new, polling of the device list, device rows, wrong and short password, field cleared after wiping — cost if wrong: more tests to maintain
89. Task 19: Ruling: the icons come from an own pwa-assets.config.ts (cream background instead of the preset's white margin, the castle kept inside the maskable icon's safe zone, the planned file names, no 64 px icon) plus a favicon.ico and an npm script `icons`; the manifest also lists the maskable icon — the default preset gave a small castle in a white frame on the iPad — cost if wrong: only the look of the icon
90. Task 19: Ruling: index.html also gets theme-color, mobile-web-app-capable and icon links, and #root gets padding for the safe areas — with viewport-fit=cover the page runs under the iPad's home bar and rounded corners, where the status line sits — cost if wrong: a few pixels of cream margin on devices that report a safe area
91. Task 19: Ruling: the service worker is registered from src/main.tsx with registerSW({ immediate: true }) (autoUpdate): a new version is fetched when the kassa is opened and the page reloads once; there is no periodic check — a kassa that is never closed keeps the old version until it is closed and opened again (goes into the README in Task 20); a receipt being typed in the first seconds after opening is lost when that reload comes — cost if wrong: an update that seems not to arrive, or a few lost taps right after opening
92. Task 19: Ruling: 10 end-to-end tests instead of the brief's 5 — the five were sharpened (the report is polled instead of trusting "Online", which also shows while a sale is still waiting; offline is proven by a failed fetch and the Offline badge; the 100 ms check looks inside the receipt, because the tile itself already shows "€ 1,40"; the grid may not scroll either), and five were added: touch-action/user-select of the kassa, double tap on Gepast, on a banknote and Klaar (the TODOs of Task 13), on Ontvangen (Review Focus 4), and an unpaired kassa with an unsent sale that sends it after pairing again (Review Focus 5) — cost if wrong: more tests to keep green
93. Task 19: Ruling: e2e files are type-checked by their own tsconfig.e2e.json (with DOM types) referenced from tsconfig.json; the preview runs with --strictPort and never reuses a running server; setup.ts also hands out a small `beheer` helper and `expectToday` — the brief named none of these — cost if wrong: none in the app
94. Task 19: Ruling: no second Playwright project: WebKit registers the service worker and starts offline, so every test runs in the iPad's engine — cost if wrong: none
95. Task 19: Ruling: `npm audit` reports 4 moderate advisories (glob/minimatch under workbox-build, build tooling of vite-plugin-pwa); left as they are — the fix offered is `--force` (a breaking downgrade) and none of it is in the app that is deployed — cost if wrong: a build-time tool with a known slow-pattern weakness that needs a hostile glob pattern, which this build never takes from outside
96. Task 20: Ruling: the README (Step 6) is written and committed before the deployment steps, and the final whole-branch review runs before Task 20's Steps 1–5 and 7 and before Task 21 — those steps wait for the penningmeester (Cloudflare account, wrangler login, subdomain, setup code) and nothing should go online unreviewed — cost if wrong: the review does not see the one-line database id in wrangler.jsonc and the address in the README, which are added after it
97. Task 20: Ruling: the README names `wrangler d1 time-travel restore` (done by the builder) instead of a button in the Cloudflare dashboard, and says 7 days (free plan) — wrangler's own help confirms the command; I could not confirm that the dashboard offers a restore — cost if wrong: the penningmeester asks the builder for something he could have clicked himself
98. Task 20: Ruling: the README has more than the brief lists — pairing inside the home-screen app and not in Safari (the app has its own storage), what to do at the ingebruikname, "Opslaan mislukt", an old version on the iPad, a lost password (delete the admin row, then setup again with the setup code), `npm run icons` — cost if wrong: a longer handbook
99. Final: Ruling: "Doorgegeven" removes the refused item from the iPad for good (no archive) — the red line must be able to go away and the reviewer asked for an acknowledge button; the button's name states what the tap asserts and a passed-on item keeps its place in the open list so a double tap cannot pass on the next one — cost if wrong: an item tapped away without being passed on leaves an unexplained surplus of that amount at the next handover
100. Final: Ruling: the lock is opt-in (a checkbox "Dit is de ingebruikname") instead of locking after the first wipe — the trial needs repeated wipes and the e2e run wipes before every test; the spec says "eenmalig" about the ingebruikname, not about the trial — cost if wrong: a penningmeester who never ticks the box keeps a wipe button on live data (it still needs the typed word WISSEN, and D1 Time Travel goes 7 days back)
101. Final: Ruling: a trial sale still waiting on the iPad when the final wipe is done is booked as a real sale when it arrives — the server cannot tell it from a late real sale without a new refusal rule; the README tells the penningmeester to check the iPad first, and the ingebruikname plan should add the rule (refuse sales rung up before in_use_since) — cost if wrong: a few euros of trial sales in the first real day, visible in Verkopen and reversible there
102. Final: Ruling: the stock column is kept by database triggers, not by the code paths that insert movements — four code paths insert or delete movements and one forgotten path would let the tile and the books drift apart silently; D1 documents triggers only in passing ("create indexes and triggers") — cost if wrong: if remote D1 refuses the triggers, migration 0003 fails at the first deploy (nothing is live yet, so nothing is lost) and the column has to be kept in code instead
103. Final: Ruling: Worker logs are switched on in wrangler.jsonc ("observability": enabled) — without them a failing request on the live kassa leaves no trace anyone can read (reviewer Minor 12, second half); the logs hold request paths and errors, no bodies — cost if wrong: if the free plan's log allowance is used up the logs are sampled, nothing fails; the penningmeester can switch it off in one line
104. Final: Ruling: reviewer Important 5 (free-plan assumptions not proven: PBKDF2 at 100,000 iterations against 10 ms CPU per request; a batch counting as one of 50 calls) gets no code change — the docs say a batch is one query and that the CPU limit has leeway for infrequent overruns, but only the live Worker can show it; both are checked at the first deploy (several logins in a row, one request of 50 sales) before the kassa is used — cost if wrong: logins fail with error 1102 on the free plan and the iteration count has to go down or the paid plan (5 dollar a month) is needed
105. Final: Ruling: (declined to judge: e2e and build not run by the reviewer) I ran them after the fix pass: e2e 11 passed in WebKit at 1180×820, build and dry-run deploy succeed, 227 + 130 unit tests green — cost if wrong: none beyond what those runs cover
106. Final: Ruling: (declined to judge: Cloudflare limits) checked against developers.cloudflare.com on 2026-11-20: D1 Free 5 million rows read and 100,000 rows written a day, 50 queries per invocation with a batch as one, Workers Free 100,000 requests a day and 10 ms CPU, Time Travel 7 days on Free; after the stock fix the catalog poll reads about 85 rows — cost if wrong: limits change; a day's quota exceeded stops the database until 00:00 UTC while the kassa keeps selling offline
107. Final: Ruling: (declined to judge: Task 20 and 21 still open) both need the penningmeester: his Cloudflare account, his login, his setup code; Task 21 (weekly backup to R2) only if he wants it — cost if wrong: none, nothing is live until he does them
108. Final: Ruling: (declined to judge: fase 2 not built) pin stays greyed out and iZettle stays the real kassa until Mollie works, as the spec says — cost if wrong: none
109. Final: Ruling: (declined to judge: two kassas at once) stands as excluded by spec §4; the server already refuses a reversal from another kassa (other_device) and both kassas' sales add up — cost if wrong: the stock on a tile lags by what the other kassa sold until the next catalog fetch
110. Final: Ruling: (declined to judge: an iPad whose clock is far behind) the sale is stored at the iPad's time, so it lands on the wrong day in the reports while the cash-box total stays right; iPads set their clock from the network — cost if wrong: a day report that has to be explained by hand
111. Final: Ruling: (declined to judge: a kassa reversal of a sale that a handover has just closed) stands: the handover counted the money, the refund leaves the box afterwards and lowers what the next period expects, so the books and the box agree — cost if wrong: none found; beheer itself refuses such a reversal, the kassa has only its five minutes
112. Final: Ruling: (declined to judge: PBKDF2 at 100,000 iterations, below current guidance) stands: it is the most the Workers runtime allows, the password is at least 10 characters and the hash never leaves the database — cost if wrong: a stolen database with a weak password is cracked sooner
113. Final: Ruling: (declined to judge: whether the 300 ms tap shield feels right) only a real iPad can say; it is on the acceptance walk-through of Task 20 — cost if wrong: one constant in app.css
114. Final: Ruling: (declined to judge: npm audit and Time Travel) npm audit reports 4 moderate advisories, all minimatch inside the build tooling of vite-plugin-pwa, none in what runs on the iPad or the Worker; the fix is a breaking downgrade, so they stay; Time Travel is 7 days on Free as the README says — cost if wrong: none at run time
115. Final: Ruling: (declined to judge: CPU cost of the full export and the CSV downloads) not measured; they run only when the penningmeester asks and grow with the history — cost if wrong: after some seasons "Alles downloaden" fails with error 1102 on the free plan and needs paging or the paid plan
116. Final: Ruling: (declined to judge: files the reviewer did not read line by line) stands on the tests: 357 unit tests and 11 end-to-end tests, each fix of this pass seen red first — cost if wrong: a defect in an unread corner
117. Task 20: Ruling: the plan's Step 3 expects two migrations; three were applied (0003 came from the final review's stock fix) — cost if wrong: none
118. Task 20: Ruling: the workers.dev subdomain became "kassa-burcht-ter-cleeff" because wrangler registered it by itself during the deploy (the account had none and my shell cannot be asked a question); the plan made the name the penningmeester's choice, so I told him at once and left the choice with him: keep it, or change it on the dashboard page wrangler printed — cost if wrong: a long address with the name twice; changing it later means pairing the iPad again on the new address
119. Task 20: Ruling: the static files themselves are still handed out over plain http (Cloudflare serves them without calling the Worker); the page's own start-up script moves to https and the API answers nothing over http — sending every file through the Worker would cost a Worker request per file against the free plan's daily allowance — cost if wrong: a browser without JavaScript shows a blank page over http; nothing secret can be sent from it
120. Task 20: Ruling: PBKDF2 stays at 100,000 iterations although a login costs 15–20 ms cpu against the free plan's nominal 10 ms — the docs allow infrequent overruns and all four hashing requests succeeded; logins are a handful a day and the limiter refuses a blocked address before any hashing — cost if wrong: if Cloudflare starts enforcing strictly, logging in fails with error 1102 until the iteration count is lowered (weaker hashing) or the paid plan (5 dollar a month) is taken
121. Task 20: Ruling: the kassa no longer offers to reverse the last sale (LastSaleBar, five-minute offer and its client logic removed; spec 8, 9 and 14 and README amended) — the penningmeester asked for it on 2026-11-21 after the first trial on the iPad ("te gevaarlijk dat gebruiker op terugdraaien knop klikt"); this overrides the builder's own choice in spec 14 — cost if wrong: every wrongly rung-up paid sale now needs the penningmeester before the next handover, otherwise it stays a cash difference with a note.
122. Task 20: Ruling: the server keeps accepting a reversal from a kassa (own cash sale, within five minutes) and RejectedDialog keeps its reversal texts — an iPad still running the cached old version may have a reversal queued, and removing the route changes the API under a live device — cost if wrong: a dead path stays in the API; a paired device token can still reverse its own cash sale within five minutes, exactly as before.
123. Task 20: Ruling: "Wis alles" clears the receipt with no message and no undo (toast and the cart's restore action removed; spec 8 and README amended) — the penningmeester asked for it on 2026-11-21 ("is verwarrend voor gebruiker"); no confirmation question was added in its place, because the spec says clearing is immediate and another pop-up is what he wanted gone — cost if wrong: an accidental tap on Wis alles loses the receipt being built, and the beheerder taps the products again.
124. Task 21: Ruling: Task 21 is built before Task 20 has its completion line — the penningmeester said yes to the weekly copy on 2026-11-21 ("ja, wekelijkse kopie graag!") while the acceptance round of Task 20 is still his to do — cost if wrong: none; the ledger order differs from the plan order.
125. Task 21: Ruling: the object key takes the Amsterdam date (businessDate) instead of the UTC date — the same on the cron's hour, and the same rule as the export file name; a copy made by hand just after midnight gets the day the penningmeester sees on his clock — cost if wrong: none.
126. Task 21: Ruling: added beyond the brief: backupState, GET and POST /api/admin/backups, and the section "Reservekopie" in beheer → Instellingen (last copy, warning after eight days, "Nu een kopie maken") — the brief gives no way to notice a weekly copy that stopped and no way to prove on live that it works before the next Monday; the measurement below shows the copy outgrows the free plan's nominal CPU limit — cost if wrong: one more admin action; every press writes one object (the same day's is overwritten).
127. Task 21: Ruling: the copy stays one full file, as spec 11 says ("volledige kopie"), although it grows with the history — a week of trial and the first season fit easily, and beheer now warns when a copy is missed — cost if wrong: after a season or more the weekly copy (and "Alles downloaden") can be cut off by the CPU limit of the free plan, and after several years by the 128 MB memory limit; the way out is the paid Workers plan or splitting the copy per year.
128. Task 20: Ruling: new on the kassa, outside the plan: a button "Omzet" in the footer opening the revenue of a day or a week (GET /api/kassa/reports/day and /week behind the device token; WeekReport, weekRange, shiftDate; src/kassa/RevenuePanel.tsx; report tables shared in src/reports/ReportTables.tsx; spec 8 and README amended) — the penningmeester asked on 2026-11-21: "de kassa gebruiker mag ook een rapport met dagopbrengst/weekopbrengst zien. 'rapporten' in beheer maar dan zonder de downloadfunctie erbij" — cost if wrong: anyone at the iPad can read the revenue of any day or week; the device token now opens those figures too.
129. Task 20: Ruling: choices of mine inside that request: a week runs Monday to Sunday; the screen opens on today and has arrows back and forward (not past today); a date in the week opens its day; only days with sales are listed, as in beheer; sales still waiting on the iPad are named as not counted; no report without a connection — he asked for "Rapporten zonder download" and named day and week, the rest follows beheer's page — cost if wrong: a detail he would have wanted differently (for example a week from Sunday) needs a small change.
130. Task 21: Ruling: the bucket and the cron are parked as comments in wrangler.jsonc, `Env.BACKUPS` is optional, runBackup returns null and POST /api/admin/backups answers 409 not_available without a bucket, and beheer then says "De wekelijkse reservekopie staat nog niet aan" (BackupState gained `available`) — a deploy with a binding to a bucket that does not exist fails, which would have held back everything else he asked for today; spec 14 already says the copy lapses if he does not want a payment method on the account — cost if wrong: the weekly copy is NOT running until someone puts the two lines back, creates the bucket and deploys; beheer says so in plain words, but nobody is warned by e-mail.
131. Task 20: Ruling: Step 7 is closed on the penningmeester's word "Proefronde klaar" although he walked only part of the list on the live address — not seen live: a handover with a difference, a price change reaching the kassa, an order of two boxes confirmed on the iPad, a product below its reorder level, and the kassa's Omzet screen (no 200 on /api/kassa/reports/*); these are covered by the unit and end-to-end tests on a local build only — cost if wrong: a fault that shows only on the live address or the real iPad in those screens is found during real use; the kassa is not in real use until pin works (iZettle stays), so there is time to walk them.
132. Task 20: Ruling: a multi-sale batch cost 14 ms cpu against the free plan's nominal 10 ms and was accepted (outcome ok) — no code change; a batch is at most 50 sales and only happens after an outage — cost if wrong: after a long outage a large batch is refused by Cloudflare (error 1102), the sales stay on the iPad and are retried, so nothing is lost but the count keeps waiting; the way out is the paid Workers plan or a smaller batch size.
133. Final: Ruling: a second, smaller review by a fresh reviewer over the seven commits made after the first final review (3e886d3..1b258b6: plain http, reversal and undo removed from the kassa, Omzet on the kassa, weekly copy) — the skill grants one review, but these commits added live features nobody but their author had read — cost if wrong: one reviewer's run spent for nothing
134. Final: Ruling: (review 2, the note under Important 2) a sale whose upload is still on its way when Omzet is opened can be missing from the figures without a note until the screen is opened again — left as is: the waiting count the screen gets is only refreshed after a send, the fix covers every case where that count was above zero, and the 300 ms shield after the cash dialog plus the speed of an upload keep the window small — cost if wrong: on slow wifi a volunteer who opens Omzet right after a sale sees the day one sale short
135. Final: Ruling: (review 2, Minor 5: restoring from a weekly copy was never rehearsed and has three traps) the three traps (sales refer to a device that is not in the copy; the stock triggers double the stock when movements are put back over restored products; in_use_since is not in the copy) are now in the README for the builder, checked against the schema and the export code; no rehearsal was done — it is a job of its own and a restore is only needed after the 7 days of Time Travel — cost if wrong: the first real restore takes longer than hoped and the written steps are untested
136. Final: Ruling: (review 2 declined to judge: a volunteer paging back through all history) stands — rulings 235/236; the penningmeester was told on 2026-11-21 and has not asked for a limit — cost if wrong: anyone at the iPad reads old revenue
137. Final: Ruling: (review 2 declined to judge: e2e, build and the real iPad) I ran e2e (12 passed in WebKit at 1180×820) and the build after the fix pass; the Omzet screen has not been seen on the real iPad — open point for the penningmeester — cost if wrong: a layout fault only the real iPad shows
138. Final: Ruling: (review 2 declined to judge: live state) the bucket exists, the deploy printed the binding and the schedule, the first hand-made copy was fetched and checked; the first scheduled run (Monday 2026-11-23 03:00 UTC) has not been seen — the penningmeester looks at "Laatste kopie" after it — cost if wrong: a cron that never fires shows as the eight-day warning in beheer
139. Final: Ruling: (review 2 declined to judge: CPU and memory of the copy at scale) ruling 233 stands; the reviewer suspects the 128 MB memory limit binds earlier than "several years" — cost if wrong: the weekly copy stops earlier than estimated; beheer warns after eight days
140. Final: Ruling: (review 2 declined to judge: static files over plain http) stands, ruling 214 — cost if wrong: as there
141. Final: Ruling: (review 2 declined to judge: "Wis alles" without a confirmation) stands, the penningmeester's own choice (ruling 227); the double-tap fix removes the one way the panel could trigger it — cost if wrong: as there
142. Final: Ruling: (review 2 declined to judge: the server still accepts a reversal from a kassa) stands, ruling 221; to be removed once every paired iPad runs the new version — cost if wrong: a dead path stays in the API
143. Final: Ruling: (review 2 declined to judge: PBKDF2 and batch CPU) stand, rulings 217 and 248 — cost if wrong: as there
144. Final: Ruling: (review 2 declined to judge: a stolen device token burning the database's daily read allowance through the report routes) stands — the same exposure as the catalog route; unpairing the device in beheer stops it — cost if wrong: the database stops until midnight UTC and the kassa sells offline meanwhile
145. Final: Ruling: (review 2 declined to judge: development from another machine by its LAN address is refused by the https rule) stands — no documented way of working uses it — cost if wrong: a developer has to use localhost
146. Final: Ruling: (review 2 declined to judge: keyboard and screen reader in the Omzet panel) stands — the iPad is touch only — cost if wrong: someone with a keyboard cannot close with Escape; Sluiten is still reachable
147. Final: Ruling: (review 2 declined to judge: extreme dates such as year 0 or 9999 give a garbled period) stands — not reachable from the screen — cost if wrong: none

### Kleine punten die zijn blijven liggen (18)

1. Final: minor (deferred): the status line says "Online" in green while the server answers with errors; the waiting count is the real signal (README now says so)
2. Final: minor (deferred): no way back from the change screen after tapping the wrong banknote
3. Final: minor (deferred): CSV downloads do not neutralise cells that start with = + - @ (formula injection in Excel); only the penningmeester's own input ends up there
4. Final: minor (deferred): the login limiter is per IP address and can be outrun by parallel requests (about 100 tries per quarter of an hour instead of 5); the setup endpoint tells a right setup code from a wrong one after setup (it should answer already_configured first)
5. Final: minor (deferred): a count entered for an earlier moment shows the difference against today's stock
6. Final: minor (deferred): dashboard caption "Contant sinds de laatste afdracht." reads oddly before the first handover
7. Final: minor (deferred): duplicate React keys in ReportsPage.tsx:76
8. Final: minor (deferred): categories cannot be reordered in beheer
9. Final: minor (deferred): a download with an expired session saves the JSON error as the .csv or .json file
10. Final: minor (deferred): getCashState reads every sale since the start (beheer pages only); an index or a kept total would make it constant
11. Final: minor (deferred): a second "Nu een kopie maken" on the same day overwrites the first, and hand-made copies take one of the 26 weekly places
12. Final: minor (deferred): any object in the bucket whose name starts with kassa- counts as a copy (a hand-uploaded export would be "the latest" for ever and hold a place)
13. Final: minor (deferred): a failed or missing weekly copy shows only on Instellingen, after eight days; with no copy at all there is no warning
14. Final: minor (deferred): Reservekopie edge cases — after a failure the page shows the state of page load; "niet gelukt" although the copy was written when listing or deleting failed; a copy that takes over 15 s shows "Geen verbinding"
15. Final: minor (deferred): Omzet small points — an unpaired iPad gets "Probeer het opnieuw", which cannot work; a future day can be reached through the week view; the note about waiting sales also shows on past days
16. Final: minor (deferred): leftovers of the removals — the Toast's action option has no user left (its test still says "Bon gewist"), and a comment and tests in store/catalog.ts describe reversals from the kassa
17. Final: minor (deferred): the kassa imports pieces from src/beheer/parts, and `today` exists twice
18. Final: minor (deferred): no kept test that the kassa's report routes stay cheap as the history grows (the reviewer checked the query plans by hand: they use the indexes)

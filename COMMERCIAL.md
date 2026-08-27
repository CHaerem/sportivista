# COMMERCIAL.md — veien til et kommersielt Sportivista

Strategi- og sekvenseringsdokumentet for kommersialisering. `PLAN.md` er fortsatt
arbeidspakke-backloggen; dette dokumentet er *hvorfor og i hvilken rekkefølge*.
WP-tabellene nederst er skrevet i PLAN.md-format og kan limes inn der.

Utarbeidet 29.07.2026 fra åtte uavhengige analyser (marked, enhetsøkonomi, produkt,
juss, visjon, vekst, avrisikering, lansering). Påstander merket **[verifisert]** er
sjekket direkte i koden; resten er analyse med kilder, og de juridiske punktene er
risikokartlegging som må bekreftes av norsk advokat.

---

## 1 · Visjonen

**Hit-tesen:** Sportivista er appen du drar frem når noen i rommet spør *«når begynner
det — og hvor ser vi det?»*, og du svarer på to sekunder for hvilken som helst sport,
med kanal du kan stole på.

Det avgjørende er at øyeblikket er **sosialt**. Spørsmålet stilles høyt, i et rom, og
demonstrasjonen *er* anbefalingen — du viser skjermen idet du svarer. Det er derfor
dette kan spres uten budsjett.

**Kategorien:** ikke «sportsapp» — der vinner FotMob på dybde og Apple Sports på
distribusjon. Sportivista er **den personlige sende-planen**: arvtakeren til TV-guiden,
som døde med lineær-TV uten at noen bygde erstatningen for sport spredt over syv
tjenester. Kategorifamilien er kalender/agenda, ikke match-center. Ro-kontrakten i
DESIGN.md er ikke en begrensning på visjonen — den er kategoriens definisjon. En agenda
som maser er en dårlig agenda.

**Du konkurrerer på LAGET, ikke på sporten** (eier-beslutning 29.07). Dette er den
presise formen på posisjonen, og den avgjør en strid som ellers går i sirkel:

> **FotMob eier kampen. Sportivista eier uka — for alle sporter, inkludert fotball og F1.**

En adversarisk analyserunde 29.07 anbefalte det motsatte: å droppe fotball og F1 fra
verdiløftet og bli «spesialist på langhalen», med utlenking til FotMob for de store
idrettene. **Det er forkastet**, og begrunnelsen er verdt å skrive ned, fordi feilen er
lett å gjøre igjen: analysen blandet sammen *hva vi er differensiert på* med *hva vi må
inneholde*.

- Differensieringen er langhalen. Verdien er **unionen**. I det øyeblikket brukeren må
  åpne FotMob for Brann-kampen, har agendaen sluttet å være deres agenda — og da er hele
  premisset borte.
- Halen er grunnen til at noen **kommer** (ingen andre sier når sjakken går). De store
  idrettene er grunnen til at de **blir**, fordi det er de som gir appen noe å si nesten
  hver dag. Å kutte fotball er å bytte bort det daglige for det distinkte.
- Det sparer heller ingenting: fotball er den billigste sporten å dekke godt — flest
  kilder, mest struktur. `catalog.json` har alt tatt avgjørelsen (`football` og `f1` er
  tier1, dekket wholesale).

**Langhalen er derfor beviset, ikke omfanget.** Hvem som helst kan liste
Premier League-runden. At tavla *også* vet når sjakken går, når Uno-X sykler og når
skiskytingen sendes, er det som gjør fullstendighets-løftet troverdig. Halen beviser
påstanden; de store idrettene gjør at påstanden betyr noe daglig.

Det som overlever av kritikken, og som står: **vi hevder aldri å slå FotMob på
fotballdybde.** Oppstilling, xG, direktestatistikk, spillerbørs — den kampen tas ikke, og
match-center bygges ikke. Det er en påstand om lag, ikke om sport.

**Vollgraven:** funksjoner kan kopieres, forretningsstrukturen kan ikke. FotMob lever av
annonser og engasjement — de kan ikke bygge ro uten å rive egen inntekt. En redaksjon
som dekker langhalen (sjakk, sykkel, vintersport, CS2) koster normalt årsverk; her
koster den nær null. Parret med null datainnsamling er posisjonen **en redaksjon som
aldri sover, for en bruker vi aldri overvåker**. Det paret er strukturelt ukopierbart
for en annonsefinansiert aktør.

**Løftet har en pris:** «Hele sporten» betyr at hvert dekningshull nå er merkeskade.
Coverage-loopene er merkevarearbeid, ikke bare QA.

---

## 2 · Dommen — hva dette kan og ikke kan bli

Vær ærlig om taket før pengene brukes.

- **Markedet:** realistisk 500–3 000 betalende i Norge. Det er **ikke et selskap**.
- **Trusselen:** FotMob (norsk, gratis, 20 mill. brukere) har allerede norsk TV-guide
  med kanal per kamp. Apple Sports er gratis i 170+ land. «Hvor ser jeg det» er en
  funksjon hos de største, ikke en vollgrav i seg selv.
- **Apple-muren finnes ikke — korrigert 29.07.** En tidligere versjon av dette dokumentet
  antok at Apple *strukturelt ikke kan* levere norske rettighetsdata. Det er feil:
  **Gracenote (Nielsen) selger ferdigpakket «where to watch» for 50+ land**, normalisert,
  med dyplenker — Apple trenger ikke forhandle med NRK, TV 2 og Viaplay hver for seg. Og
  Apple Sports dekker allerede ecuadoriansk Serie A og 2. Bundesliga, så terskelen er
  ikke folketall. Riktig formulering er mye svakere: **Apple har ikke *prioritert*
  småmarkeds-europeisk sport** — hver vertikal de har lagt til er en amerikansk
  kommersiell eiendom. Det er en prioritering, ikke en mur. **Varselsignalet er ikke at
  de tar Eliteserien, men at de legger til sin første ikke-amerikanske vertikal.**
- **Det som likevel står:** tverrsnittet. Ingen andre gir deg skiskyting *og* sjakk *og*
  sykkel *og* fotballen i én rolig agenda med verifisert norsk kanal. 68 av 72 events
  kommer fra AI-research — dekningen er ekte.
- **Men løftet er ikke innfridd ennå. [verifisert 29.07]** 46 av 47 strømme-oppføringer
  på tavla peker på en **generisk landingsside** (26 × `play.tv2.no/sport`,
  7 × `viaplay.no/no-no/sport`); bare 7 er dyplenker. Produktet sier «TV 2 Play» og sender
  deg til TV 2 Plays sportsforside. Det er et *rettighetskart*, ikke et svar på «hvor ser
  jeg det» — og et rettighetskart er nøyaktig det enhver språkmodell produserer gratis.
  Dette er produktgapet, uavhengig av hvilke sporter som dekkes, og det er spor E som
  lukker det.

**Konklusjon: dette er en solid biinntekt og et uvanlig godt produkt, ikke en exit.**
Blir det en hit, er neste steg Norden — Sverige og Danmark har samme rettighetskaos, og
arkitekturen gjør ekspansjon nesten gratis. Det må sies høyt før pengene brukes, ikke
oppdages etterpå.

---

## 3 · Regnestykket

Modellen er **freemium på iOS**: gratis katalogtavle (wedgen demonstreres), betalt
personalisering. Grensen faller sammen med arkitekturens egen søm — server = dekning,
enhet = presisjon.

**Pris: 39 kr/mnd · 349 kr/år · 1 mnd prøve.** Referansen er FotMob-tieren, ikke
strømmetjenestene. Netto etter MVA og Apples 15 %: **26,50 kr/mnd**.

**Løpende kostnad etter at alt er gjort lovlig (anslag):**

| Post | Kost/mnd |
|---|---|
| Anthropic API (batch −50 %, caching, tiering; rå målt kost er ~1 050 $/mnd, se PLAN.md:2603) | 2 800–4 700 kr |
| Datakilder (API-Football $19 + TheSportsDB $9 + Jolpica gratis) | ~350 kr |
| Cloudflare Workers + R2 | ~100 kr |
| EPG-avtale (NRK gratis; øvrige kanaler ukjent) | 0–3 000 kr |
| **Sum** | **~4 500–6 500 kr** |

**Break-even: ~170–250 betalende.** Mot et tak på 500–3 000. Marginen er reell, men
tynn — og hele regnestykket forutsetter at API-kosten faktisk lar seg ingeniøre ned fra
den målte råkosten. Det er den viktigste økonomiske antakelsen i dokumentet.

Engangskost for å bli lovlig: **~25–80 000 kr** (ENK 2 181 kr eller AS 36 825 kr,
Apple $99, advokat 15–40 000 kr).

**Billigste lovlige minimum for første krone:** ENK + Apple org + `logoPolicy:
free-only` + ESPN ut + tvkampen av + Cloudflare + API-nøkkel for agentene + malbaserte
vilkår med tydelig datafeil-forbehold, med full advokatpakke utsatt til man har
betalende brukere. **~5 000 kr engangs + ~4 500 kr/mnd.**

---

## 4 · Fem spor

Sporene går parallelt. Spor B er på kritisk sti mot lansering; **spor E er det som
avgjør om produktet i det hele tatt har et fundament å stå på.**

### Spor A · Produkt (WP-200–207)

Det som må være sant før en fremmed kan bruke dette.

Den viktigste enkeltoppgaven er **WP-200**. **[verifisert]** Profilen former ikke tavla
i dag, og det er *to* lekkasjer, ikke én:

- `docs/js/profile-sync.js:276` returnerer `followBroadly: null` →
  `docs/js/lens.js:149` faller tilbake til default-lista med ni sporter.
  iOS: `EffectiveInterests.swift:73` sender `base.followBroadly` urørt videre.
- `docs/js/lens.js:158` og `ios/Sportivista/Feed/FeedCompiler.swift:112` slipper
  **alt** norsk / favoritt / `importance ≥ 4` gjennom uansett profil.

Følgen: en som velger kun «Formel 1» i onboardingen får golf, sykkel og skiskyting.
Onboardingen lover «velg det du bryr deg om»; tavla svarer med eierens sportsunivers.
Hit-tesen forutsetter at dette er fikset — den er ikke sann før det.

Verste kombinasjon: velger man kun «Vintersport» (`StarterPacks.swift:147–148`) former
valget ingenting **og** det valgte er tomt til november.

### Spor B · Juss og infrastruktur (WP-210–220) — kritisk sti

Nullinfrastruktur er i dag null *egen* infrastruktur. Den lånte er lånt på
forbrukervilkår som ikke tillater kommersiell drift, og må kjøpes fri før første krone:

- **ESPN** — Disneys vilkår forbyr automatisert henting og kommersiell bruk. Apples
  guideline 5.2.2 kan kreve dokumentert tillatelse som aldri vil finnes. Dette er den
  ene risikoen som kan drepe alt.
- **GitHub Pages + Claude Max** — begge forbrukervilkår. De ni agentene som genererer
  produktdataene kjører på en konsument-OAuth-token.
- **tvkampen-skrapingen** — trolig sui generis databasevern (åvl. § 24), og de er en
  direkte konkurrent med egne apper.

Men **erstatningen er ikke å kjøpe en annen aggregator** — se spor E. Der det finnes
åpne, uttrykkelig tillatte kilder brukes de: Jolpica (F1) er gratis og Apache 2.0, og
NRK gir eksplisitt tillatelse til EPG-bruk hos tredjepart.
Terminlister som *fakta* er ikke opphavsrettsbeskyttet — eksponeringen ligger i
hentemåten, ikke i dataene.

### Spor E · Datainnhentingen (WP-240–245) — det egentlige produktet

Dette sporet er lagt til etter eierens innvending 29.07, og det korrigerer en feil i
den opprinnelige analysen: den grep etter «kjøp en datakilde» som det trygge svaret.
Det konsederer stille feil premiss — det behandler AI-innhentingen som *risikoen* og
betalt data som *fiksen*, når det motsatte er sant.

**Argumentet, presist.** Tre uavhengige ting blandes ofte sammen:

1. **Opphavsrett i faktaene** — ingen. EU-domstolen (Football Dataco, C-604/10) slo
   fast at terminlister mangler den kreative friheten opphavsrett krever.
2. **Sui generis databasevern** — fester seg til investering i å *samle, verifisere og
   presentere*, ikke i å *skape* (Fixtures Marketing-sakene). Organet som **lager**
   kampprogrammet har derfor svakt vern over det; en aggregator som samler og
   verifiserer har et sterkere krav.
3. **Kontrakt og tilgang** — uavhengig av opphavsrett. Det er dette ESPN faktisk er.

Konsekvensen er at **«gå til den som skaper faktumet» er både det juridisk sterkeste
og det mest nøyaktige trekket samtidig.** Den trygge sonen, presist: fakta per event,
fra organet som skaper eller offisielt publiserer dem, i det volumet en journalist
ville tatt, presentert redaksjonelt med attribusjon — ikke systematisk replikering av
noens kuraterte samling.

Ærlig forbehold: primærkilde betyr ikke automatisk tillatt. `fotball.no` forbyr selv
roboter uten avtale, så NFF-avtalen (WP-211) består.

**Vi gjør ikke dette ennå. [verifisert]** Evidensen på en faktisk Tour de
France-etappe på tavla i dag:

| Kilde | Type |
|---|---|
| `en.wikipedia.org` | encyklopedi — og eneste `verificationSource` |
| `cyclingstage.com` | aggregator, reliability **0,53** i egen kalibreringsledger |
| `velo.outsideonline.com` | magasin |
| `idlprocycling.com` | aggregator |
| `hjelp.tv2.no` | TV 2s egen side — den eneste primærkilden |

`letour.fr` — A.S.O., som faktisk lager ruta og starttidene — er ikke sitert i det hele
tatt. Research-laget siterer det som er *praktisk*, ikke det som er *autoritativt*. Det
er samtidig den svakeste juridiske posisjonen, den svakeste datakvaliteten, og
fikserbart.

**Det som må bygges:**

- **WP-240 · Kilderegister med rettslig grunnlag** (`scripts/config/sources.json`,
  schema-validert). Per kilde: hvem publiserer, hva de er autoritative for, rolle
  (primær / offisiell kringkaster / forbund / aggregator / encyklopedi), hva vilkårene
  sier om automatisert tilgang, robots-status, attribusjonskrav, sist gjennomgått.
  Dette gjør den juridiske posisjonen **etterprøvbar i stedet for påstått** — og det er
  nøyaktig artefaktet man legger frem for Apple under guideline 5.2.2 og for advokaten
  i WP-220.
- **WP-241 · Autoritetskart per konkurranse.** For hver dekket konkurranse: hvem lager
  *tidspunktet* (arrangør, liga, forbund) og hvem lager *kanalen* (kringkasteren selv).
  To ulike kilder per event, som svarer nøyaktig til produktets to kjernefelt.
- **WP-242 · Proveniens per FAKTUM, ikke per event.** Dagens `evidence: [urls]` er en
  flat liste for hele eventet. Erstattes med per-felt: `{ time: {sourceId, url,
  retrievedAt, basis}, streaming: {...} }`. Da kan `validate-events.js` håndheve
  kontrakten mekanisk: **høy tillit krever primær eller offisiell basis for tid, og
  kringkasterens egen kilde for kanal.** Dette er den høyeste enkeltgevinsten — det
  gjør en myk redaksjonell norm til en validert kontrakt, i samme form som dagens
  «høy tillit ⇒ 2+ evidens-URL-er», bare skjerpet fra *hvor mange* lenker til *hva
  slags* kilde.
- **WP-243 · Dekningskontrakt per konkurranse.** I dag er research opportunistisk
  hullfylling. For å være primærkilde trengs en garanti: hver konkurranse har en
  navngitt autoritet og en frist («Eliteserien runde N komplett 10 dager ut»), med
  målbar dekningsgrad. Det er dette som lar oss droppe leverandørene helt, og det
  mater G2-porten. **✅ Bygd 27.08** (`contract`-blokker i authority.json +
  `scripts/lib/coverage-contracts.js` — se statusraden i § 7).
- **WP-244 · Høflighetslaget.** Betingede forespørsler (ETag / If-Modified-Since),
  caching, takt per vert, ærlig User-Agent med kontaktadresse, robots.txt respektert.
  Billig, og konverterer «skraper» til «veloppdragen leser» både teknisk og optisk.
- **WP-245 · Kalibreringen styrer kildevalget hardt.** `calibration.json` og
  `source-quirks` finnes og virker allerede, men mater ikke kildevalget bindende. En
  kilde på 0,53 skal mekanisk aldri kunne stå som eneste grunnlag. **✅ Bygd 27.08**
  (`scripts/lib/calibration-gate.js` — se statusraden i § 7).
- **WP-246 · Kanalen skal peke på kampen, ikke på forsiden.** Det verifiserte funnet fra
  29.07: 46 av 47 strømme-oppføringer er landingssider. Kontrakten blir **dyplenke med
  tidsstempel og kilde, eller «ikke bekreftet» i klartekst** — aldri en forside som
  utgir seg for å være et svar. Tavla blir ærligere og tynnere før den blir bedre, og
  det er riktig rekkefølge. Dette er den mest direkte oversettelsen av spor E til noe
  brukeren faktisk ser.

**Hvorfor dette er selve løftet, ikke infrastruktur under det:** «hele sporten» er et
bredere løfte etter at fotball og F1 ble værende i omfanget (§ 1) — ikke et smalere.
Bredden gjør per-event-proveniens mer nødvendig, ikke mindre: jo flere sporter tavla
hevder å dekke, jo billigere er det å avsløre at dekningen er et rettighetskart.

**Ærlig caveat om endringsloggen.** En «3 endringer siden i går»-linje er foreslått som
den synlige kvitteringen for at vi fører protokoll. Historikken sier at den blir stille:
**4 rettelser på 60 sjekker over 8 verify-kjøringer**, og null i de tre siste. Det er
ærlig og passer ro-kontrakten — «ingenting har flyttet seg siden 05:30» er et gyldig
svar — men som *betalt* funksjon alene bærer den ikke. Bygg den som tillitsmarkør, ikke
som bærebjelke.

**Hva det endrer:** WP-210 (API-Football) og WP-213 (TheSportsDB) faller fra fundament
til **reservekilde og korroborering**. Det sparer ~350 kr/mnd, men viktigere: produktet
bygges ikke på noen andres database.

**Ærlige risikoer ved denne strategien:**

1. **Korrektheten blir helt vår.** Ingen leverandør-SLA å peke på når en betalende
   kunde får feil kanal. Kalibreringsledgeren (121 sjekker) tyder på at det virker —
   og leverandører tar også feil, de gir bare noen å skylde på.
2. **AI-kosten går OPP, ikke ned.** Research som primærkilde er mer arbeid enn research
   som hullfylling. Det motvirker delvis de sparte ~350 kr/mnd. Nettoeffekten er trolig
   fortsatt gunstig, men den må modelleres, ikke antas.
3. **Avtalesporet forsvinner ikke helt** — fotball.no krever fortsatt NFF-avtale.

### Spor C · Vekst (WP-230–233)

Kaldstarten skjer i navngitte rom, ikke i en kampanje. **Nisje først: vintersport**
(skiskyting + langrenn) — størst smerte (rettighetene er spredt over NRK/TV 2/MAX),
størst publikum av nisjene, og sesongen starter akkurat når sporene A og B er ferdige.

Den ene vekstmekanismen som betyr noe: **offentlige event-sider**. **[verifisert]** I
dag lander enhver delt lenke på `<body class="gated">` i `docs/index.html:45`, og
WP-182-delekortene er bygget mot en vegg. Det finnes ett statisk `og-default.png` for
hele siden og ingen per-event-side. Uten dette er all deling og SEO død; med det blir
hvert «hvor ser jeg rennet»-svar en landingsside.

### Spor D · Kvalitet (WP-205)

Når folk betaler, blir feil kampstart eller feil kanal en reklamasjon. Målingen finnes
allerede: `port-report.json` (fire porter, 14-dagers vindu) og `calibration.json` (121
sjekker over 180 dager, per-kilde reliability). **[verifisert]**

Akseptabel feilrate for et betalt produkt: **≤3 % tid/kanal-korrigeringer på
<72t-events over rullerende 28 dager, og null feil oppdaget etter avspark.**

---

## 5 · Kalenderen

Én tidslinje som forener sporene. Den ene faste ytre rammen er den norske
vintersesongen — den kan ikke flyttes, så alt annet planlegges rundt den.

| Når | Hva |
|---|---|
| **Aug 2026** | Spor A bølge 1 (WP-200, WP-201). Spor B starter samtidig: enhet (WP-217) og D-U-N-S (WP-218) har ~30 dagers ledetid — start dag 1. Be om NRK-API-nøkkel. |
| **Sept 2026** | Spor A bølge 2 (WP-202, WP-203). **App-transfer (WP-219) FØR eksterne testere** — Apple krever at alle TestFlight-bygg og -testere fjernes først, så dette må skje før G1, ikke midt i. |
| **Medio sept – medio okt** | **G1-vinduet** med 5 eksterne testere. Kildeexit (WP-210–214) og infrastruktur (WP-215/216) bygges parallelt. |
| **Okt 2026** | Spor B ferdig: hosting migrert, ESPN ute, agentene på API-nøkkel. Advokatrunden (WP-220) løper parallelt. WP-230 (event-sider) bygges. |
| **Uke 48 · 23.–29. nov 2026** | **OFFENTLIG GRATIS LANSERING.** Verdenscupåpningen i skiskyting og langrenn. Facebook-miljøene, kode24-pitch, r/norge. 18 ukers sesong foran seg. |
| **Des 2026 – jan 2027** | Sesongen ER testen. Betalingsmuren (WP-204) bygges mens brukerne kommer. Tour de Ski og hoppuka gir ukentlige delingsmomenter. |
| **Feb 2027** | Ski-VM-vinduet: **betalingsmuren slås på**, pressefremstøt nr. 2. |

**Hvorfor uke 48 og ikke en lukket beta:** en marslansering får seks uker sesong;
november får atten. Den lukkede 25-personers betaen ville brent nettopp den uken som er
verdt mest. Sesongen er en bedre test enn en testgruppe — og gratis-lanseringen *er*
betaen, med portene målt på ekte brukere.

---

## 6 · Portene

G1 er allerede definert og bindende i `PLAN.md:2424` — den beholdes som den er.
G2 og G3 bygger videre i samme ånd: ASC-metrikker og strukturert dagbok, ingen telemetri.

**G0 · Antakelsen bak alt sammen (august, koster ingenting).** Produktet er formet av én
person som er *flersport-fan*, og det er en legitim metode — den som kjenner smerten ekte
bygger ofte det riktige. Risikoen er smalere enn «tar eieren feil»: den er om det finnes
**nok** nordmenn som følger fire–fem sporter på tvers, eller om de fleste egentlig følger
én og skummer resten. For en enkeltsport-fan er Sportivista tynn uansett hvor god den er.

Test: **fem samtaler** med norske sykkel-, sjakk- og skifans. Ikke «finnes jobben», men:

> *«Hvor mange sporter følger du faktisk — og irriterer fragmenteringen deg nok til at du
> ville byttet app?»*

Dette er den ene antakelsen hele forretningen står på, og den er billig å sjekke. Nevner
ingen av de fem fragmenteringen uoppfordret, bør planen re-planlegges før noe bygges.

- **G1 · intern → offentlig** (medio okt): WP-200–203 merget og vektorene bit-like;
  ≥5 eksterne testere; ≥3 med sessions ≥5 av siste 7 dager; ≥3 av 5 svarer 4–5 på
  «hvor lei deg blir du om den forsvinner»; 0 uløste krasj-klynger; port-report
  near-term-feilrate ≤5 %.
- **G2 · gratis → betalt** (jan 2027): ≥600 installasjoner etter to sesongtopper;
  ≥150 ukentlig aktive; ≥5 sier eksplisitt ja til 39 kr/mnd; port-report over 28 dager:
  coverage grønn ≥25/28 dager, near-term-feilrate ≤3 %, **null** kanal-feil oppdaget
  etter avspark; spor B fullført.
- **G3 · betalt lansering GO** (feb 2027): G2-tallene holdt i et nytt 28-dagers vindu;
  StoreKit-sandbox-matrisen 100 % grønn; ≥5 testere gjennom kjøpsflyten uten
  friksjonsfunn; App Review godkjent med IAP; reklamasjonsrutine definert
  (feil kanal → rettelse og svar <24t).

**Stopp-signalet:** færre enn 100 ukentlig aktive etter VM-uka i mars 2027. Da er to
sesongtopper og presse brukt uten feste → tilbake til hobbyprodukt, som er et helt
ærverdig utfall.

---

## 7 · Arbeidspakkene

Nummerblokkene er adskilt så sporene kan gå parallelt uten kollisjon. WP-192 er
høyeste nummer i bruk i dag.

### Spor A · Produkt (FASE 1A)

| WP | Tittel | Fase | Avhenger av | Størrelse | Status |
|---|---|---|---|---|---|
| WP-200 | Profilen former tavla (begge flater) + vektor-refrys | 1A | — | STOR, 2–3 uker | ✅ #423 + #425 (web-agendaen) merget 29.07 (statusrad etter-rettet 27.08) |
| WP-201 | Ungate web-forsmaken | 1A | — | LITEN, ~1 uke | ✅ #427 merget 29.07 (funksjonsgate i stedet for sidegate; statusrad etter-rettet 27.08) |
| WP-202 | Onboarding selger ritualet: brief + varsel-priming + widget | 1A | WP-200 | MEDIUM, 1–2 uker | ✅ 27.08 — nytt `ritual`-steg mellom startpakkene og dybde-finishen: morgenbriefen + widget-instruksjonen som ro-celler, og ÉN varsel-beslutning primet FØR system-prompten (RitualPriming: ja = opt-in til brief-pinget, nei = ærlig Innstillinger-peker); UI-flytene oppdatert |
| WP-203 | Sesongærlighet i startpakker og tomtilstand | 1A | WP-200 | LITEN, 2–4 kvelder | ✅ 27.08 — SeasonCalendar (ren månedtabell for vintersportene): startpakke-raden beregner «Sesongstart i november — tavla fylles da.» mot DAGENS dato (hardkodet prosa fjernet), og agendaens tomtilstand forklarer et tomt brett når alt fulgt er utenfor sesong («skiskyting og langrenn er utenfor sesong …») i stedet for det generiske «ingen kommende» |
| WP-204 | StoreKit-betalingsmur (Sportivista+) | 1A | WP-200, WP-202 | STOR, 3–4 uker | planlagt |
| WP-205 | Reklamasjonsvakten: verifiseringskjeden på betalt nivå | 1A | — | MEDIUM, 1–2 uker + 28d måling | planlagt |
| WP-206 | Web-entitlement + delekort-landing | 1A | WP-201, WP-204 | LITEN–MEDIUM, ~1 uke | planlagt |
| WP-207 | App Store-innsendingspakken (IAP-review) | 1A | WP-204, WP-205 | MEDIUM, 1–2 uker | planlagt |

**WP-200 i detalj:** ikke-tom profil ⇒ `followBroadly` avledes av profilen
(sport-entiteter → bredde; lag/utøver/turnering → entity-gate i sin sport), og regel (3)
sport-scopes. Tom profil ⇒ dagens katalogtavle byte-identisk. Filer: `profile-sync.js`,
`lens.js`, `EffectiveInterests.swift`, `FeedCompiler.swift`, `lens-config.json`. **De 14
gyldne vektorene re-fryses på begge flater** og `DIVERGENCES.md` oppdateres — det er
halve jobben.

**Betalingsgrensen (WP-204):** *gratis* = katalogtavla (når · hva · hvor), brief-linja,
«Dette dekker vi», resultater, nyheter, assistentens spørrearm, delekort. *Betalt* =
profil som former tavla, alle varsler, personlig widget, iCloud-synk, assistentens
mutasjonsarm. Håndhevelse: iOS via StoreKit 2-entitlement (hard); web via
entitlement-flagg i CloudKit-snapshot (mykt, omgåelig i devtools — akseptert, fordi
dataene uansett er offentlige og betalingsflaten er iOS).

### Spor B · Juss og infrastruktur

| WP | Tittel | Type | Avhenger av | Kost |
|---|---|---|---|---|
| WP-210 | Fotball internasjonalt: API-Football erstatter ESPN | KODE | — | ~200–400 kr/mnd |
| WP-211 | Fotball norsk: avtale med NFF/Fotballdata | AVTALE | — | ukjent |
| WP-212 | F1: Jolpica (Apache 2.0) erstatter ESPN | KODE | — | 0–50 kr/mnd |
| WP-213 | Golf/tennis/øvrig: TheSportsDB + AI-research mot offisielle kilder | KODE | — | ~100 kr/mnd |
| WP-214 | Rettighetsdata: NRK PSAPI + EPG-avtaler erstatter tvkampen-skraping | KODE + AVTALE | — | 0–3 000 kr/mnd |
| WP-215 | Pages → Cloudflare Workers/R2 + proxy for live-polling | KODE | — | ~100 kr/mnd |
| WP-216 | Claude Max → Anthropic API (batch, caching, tiering) | KODE | — | 2 800–4 700 kr/mnd |
| WP-217 | Juridisk enhet (ENK først, AS ved reell ansvarseksponering) | MENNESKE | — | 2 181 / 36 825 kr |
| WP-218 | D-U-N-S + Apple org-konto | MENNESKE | WP-217 | $99/år |
| WP-219 | App-transfer — **før eksterne testere** | MENNESKE | WP-218 | — |
| WP-220 | Vilkår, personvern v2, ansvarsfraskrivelse — én advokatrunde | MENNESKE | WP-217 | 15–40 000 kr |

Kritisk sti: WP-217 → WP-218 → WP-219 → WP-220, med kode-WPene parallelt.
Flaskehalsen er D-U-N-S-ledetid og advokat, ikke koding. Realistisk 6–10 uker.

### Spor C · Vekst

| WP | Tittel | Avhenger av |
|---|---|---|
| WP-230 | Offentlige event-sider `/e/<id>` med ekte OG-metadata | WP-201, WP-215 |
| WP-231 | ASO-pakke: norske nisjesøkeord, skjermbilder, tekst | WP-207 |
| WP-232 | Lanseringskampanje uke 48 (Facebook-miljøene, r/norge) | WP-230 |
| WP-233 | Pressefremstøt: kode24/NRKbeta — «AI-agenter drifter en sportstjeneste uten servere» | WP-232 |

### Spor E · Datainnhentingen

| WP | Tittel | Avhenger av |
|---|---|---|
| WP-240 | Kilderegister med rettslig grunnlag (`sources.json` + schema) | — |
| WP-241 | Autoritetskart: hvem skaper tidspunktet, hvem skaper kanalen | WP-240 |
| WP-242 | Proveniens per faktum + validator-kontrakt på kildetype | WP-240, WP-241 |
| WP-243 | Dekningskontrakt per konkurranse med målbar dekningsgrad — ✅ 27.08: `contract`-blokker i authority.json (navngitt autoritet + «i sesong: minst N events innen H dager», sesongærlig), målt hver kjøring (`scripts/lib/coverage-contracts.js` → coverage-contracts.json); brudd = høy-alvorlighets gap for agentene + femte port `contracts` i port-report (G2-føde). Seedet for Eliteserien, PL, F1, PGA, DP World Tour, tennis-touren | WP-241 |
| WP-244 | Høflighetslaget: ETag, caching, takt, User-Agent, robots | — |
| WP-245 | Kalibreringen styrer kildevalget bindende — ✅ 27.08: `scripts/lib/calibration-gate.js`; målt reliabilitet < 0.7 kan aldri stå som eneste grunnlag (build-events demoterer high → medium, validate-events hard-feiler, research/verify-promptene bærer regelen) | WP-242 |
| WP-246 | Kanalen peker på kampen: dyplenke + kilde, ellers «ikke bekreftet» | WP-242 |
| WP-248 | Publiserings-ferskhetsvakt — ✅ 27.08: `scripts/check-publish-freshness.js` i den timelige pipelinen dømmer den LIVE kopien mot repoet (lærdom: en fastlåst Pages-deploy holdt køen i fire uker mens alle repo-signaler var grønne); self-repair fikk oppryddingsoppskriften | — |

Rekkefølge: WP-240 → WP-241 → WP-242 er kjernen; WP-244 kan gjøres når som helst og
bør gjøres tidlig fordi den er billig. WP-242 er den høyeste enkeltgevinsten.

---

## 8 · Hva vi ikke bygger

- **Egen konto- eller betalingsbackend** — bryter nullinfrastruktur. StoreKit og
  brukerens egen iCloud dekker alt.
- **Telemetri og D7-kohorter** — bruker opp tillitskapitalen produktet posisjoneres på.
  Portene måles med ASC-metrikker og dagbok.
- **Sanntids målpush og Live Activities** — allerede riktig fravalgt.
- **Android** — PWA-stopgap står; Fase 3-valg.
- **Live-score-dybde, tropp, statistikk** — FotMobs voll. Deep-link til spesialisten er
  strategien, og entitetssidens «MER»-seksjon gjør det allerede.
- **Web-LLM-assistent** — spiken konkluderte; `assistant.js` er nok.
- **Hard web-DRM** — dataene er offentlige. Obfuskering er teater.
- **Mer agent-maskineri eller høyere kadens** — kvoten er allerede presset.
- **Uendelig nyhetsstrøm eller kortvegger** — bryter ro-kontrakten.
- **Betalt annonsering, influencere, LinkedIn** — null budsjett, lav LTV.

---

## 9 · Det som må avgjøres først

Én beslutning styrer alt annet: **kommer du deg av ESPN og tvkampen, over på kilder du
har lov til å bruke kommersielt?**

Svaret er ikke å kjøpe seg til en annen aggregator. Det er **spor E**: gjøre
AI-innhentingen god nok til at den *er* primærkilden — fakta per event, hentet fra
organet som skaper dem, med etterprøvbar proveniens per faktum. Det er samtidig den
sterkeste juridiske posisjonen, den beste datakvaliteten og den eneste vollgraven en
annonsefinansiert konkurrent ikke kan kopiere uten å rive sin egen forretningsmodell.

De tre tingene faller sammen i ett arbeidsstykke. Det er derfor spor E er planens
tyngdepunkt, ikke et vedlegg til det.

Får du det til, er resten tempo og utholdenhet. Får du det ikke til, er den betalte
veien stengt — og «et subsidiert hobbyprosjekt av uvanlig høy kvalitet» er et ærlig og
godt svar, så lenge det velges med åpne øyne.

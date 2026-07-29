# Sportivista designsystem — Apple-native baseline

Dette er den **levende designkontrakten**. iOS-appen og widgeten følger denne
Apple-native baselinen: systemfont, semantiske system-farger, SF Symbols, native
lister/sheets/navigasjon — med **amber som eneste aksent-token**. Web (`docs/`)
følger nå de samme baseline-tokenene (se § Cross-surface).

> **Om en mulig senere designprofil:** Navnebyttet er GJORT (Zenji → Sportivista,
> WP-26/27), og merket, fonten og ikonet er nå egne skall-/token-valg (Kolonet
> WP-97/180, display-fonten WP-183). Det som eventuelt gjenstår på sikt er en full
> egen DESIGNPROFIL — ikke navnet. Dette dokumentet er DERFOR bevisst bygget som et
> tynt, byttbart token-lag oppå Apples plattform: en slik profil skal bli en
> **re-skin** (nye token-verdier, font, ikoner, logo), ikke en ombygging. Alt
> merkevare-bærende er isolert i § Tokens.

Normativ kontrakt for alle flater: web (docs/), iOS-app (ios/), widget, ikon.
Verifisering: HIG-sjekklista (§ HIG-samsvar) + skjermbilder i begge temaer og
ved forstørret Dynamic Type før merge. Eieren er siste smaksinstans.

---

## Grunnlov

1. **Ro i en skjerm full av støy** — hver flate er ett stille, skannbart svar på
   *når · hva · hvor ser jeg det*. Dette er ren Apple *deference* (innhold først).
2. **Native der det finnes** — bruk Apples egne kontroller, navigasjon, typografi
   og bevegelse. Vi etterligner dem aldri når vi kan bruke dem; da arver vi
   tilgjengelighet, kjennskap og samsvar gratis.
3. **Ærlig innhold** — ukjent kanal er «–», AI-funn bærer en `info`-markør med
   kilder, tomhet forklares. Aldri lat som.
4. **Skall er tokens** — alt merkevare-bærende (farge, font-rolle, ikon, bevegelse)
   er en token, aldri hardkodet i en komponent. Så en rebranding er et bytte.

## Visjon (fryst) vs. skall (byttbart)

| Fryst — visjon (overlever rebrand) | Byttbart — skall (tokens) |
|---|---|
| Rolig én-formåls agenda (når·hva·hvor) | Aksentfarge |
| Korrekt tid/streaming + dekning | Bakgrunn / flate / tekst-farger |
| Ambient, kontekstbevisst hjelper | Font-familie / rolle |
| Personvern på enheten, ærlighet | Ikon-sett |
| Følg / linser / spoilervern / varsler | Bevegelses-signatur, navn/logo |

## Tokens

Alle farger er **semantiske**, ikke rå hex i komponentene. Verdiene under er
Apple-system-farger + én amber-aksent. Ved rebrand endres KUN denne tabellen.

> **Maskinlesbar fasit:** [`design/tokens.json`](design/tokens.json) speiler denne
> tabellen (+ typografi/spacing/radius) i W3C design-tokens-format; koherens-testen
> `tests/design-tokens.test.js` håndhever takten mellom denne prosa-tabellen,
> `docs/css/base.css` og `ios/Sportivista/DesignTokens.swift` — drift på noen av de
> tre er en CI-feil, ikke en stille rettelse.

### Farge

| Token | Rolle | Mørk | Lys |
|---|---|---|---|
| `background` | sideflate | `#000000` | `#F2F2F7` |
| `groupedBackground` | bak grupperte lister | `#000000` | `#F2F2F7` |
| `cell` | liste-/kort-flate | `#1C1C1E` | `#FFFFFF` |
| `cell2` | nøstet/hevet flate | `#2C2C2E` | `#FFFFFF` |
| `label` | primærtekst | `#FFFFFF` | `#000000` |
| `secondaryLabel` | meta/kanal/dempet | `rgba(235,235,245,.6)` | `rgba(60,60,67,.6)` |
| `tertiaryLabel` | fainter, ett hakk under dempet | `rgba(235, 235, 245, 0.3)` | `rgba(60, 60, 67, 0.3)` |
| `separator` | hårlinje/skille | `rgba(84,84,88,.6)` | `#C6C6C8` |
| **`accent`** | **ENESTE aksent (amber)** | `#FFB000` | `#9A6800` |
| `live` / `good` | direkte / positiv (systemGreen) | `#30D158` | `#34C759` |
| `destructive` | slett/nullstill (systemRed) | `#FF453A` | `#FF3B30` |

- Foretrekk `Color(.systemBackground)`, `.secondaryLabel`, `.separator` osv.
  direkte der de finnes; `accent`/`live`/`destructive` er egne token-farger.
- **Amber brukes KUN til aksent:** valgt tilstand, tinting av bar-knapper,
  must-see-prikk, varsel-på, primær-knapp. Aldri brødtekst, aldri to i samme rad.
- Aldri ren svart/hvit-inversjon — bruk system-flatene (grouped/cell) for dybde.

### Typografi (BINDENDE — Dynamic Type)

- **Systemfont (San Francisco) overalt UNNTATT ordmerke, tidskolonne og
  delekort** (presisering WP-183, se § Display-font). Brødtekst, radtitler,
  meta, knapper, lister — alt annet er og forblir systemfont, via SwiftUIs
  tekststiler / web-systemstacken. ALDRI faste `.system(size:)`-punkter: hver
  rolle bindes til en tekststil så teksten skalerer med brukerens innstilling.
- **Tabular tall** (`.monospacedDigit()`) i tidskolonnen og alle steder sifre
  skal rette seg inn. Display-fonten har tabulære sifre BAKT INN (se under), så
  tidskolonnen retter seg inn uansett hvilken av de to fontene som rendrer.
- Bryt aldri til trunkering når teksten vokser — omform kilden.

| Rolle | Tekststil (iOS) | Web |
|---|---|---|
| Ordmerke (masthead) | `.title` semibold, **display-font** | `1.75rem` / 600, **display-font** |
| Seksjonstittel | `.headline` | `1.0rem` semibold |
| Radtittel | `.body` | `1.0rem` |
| Tid (rad) | `.body` semibold, **display-font** (tabulær) | tabular, **display-font** |
| Meta / kanal | `.subheadline`, `secondaryLabel` | `.9rem` dempet |
| Gruppeoverskrift | `.footnote` uppercase, `secondaryLabel` | `.8rem` |
| Caption | `.caption` | `.75rem` |

### Display-font (WP-183 — BINDENDE, eier-delegert valg 22.07.2026)

Produktets ansikt er bokstavelig talt KLOKKESLETT — den faste tidskolonnen. Alt
var systemfont, altså forvekselbart. Én distinkt display-/tallfont gir
gjenkjennelighet uten å røre lesbarheten på det folk faktisk leser.

- **Fonten:** **Space Grotesk** (Florian Karsten), SIL Open Font License 1.1.
  Selvhostet subsett — `docs/fonts/*.woff2` (web) og `design/brand/fonts/*.ttf`
  (iOS-bundle), begge generert av `design/brand/generate-display-font.py`.
  Lisensen ligger ved siden av assetene (`OFL.txt`).
- **Nøyaktig TRE flater, aldri en fjerde:** (a) ordmerket, (b) agendaens
  tidskolonne, (c) delekortene (`ShareCard.swift` / `share-card.js`). Vil du ta
  den i bruk et fjerde sted, er det en endring av DENNE listen — ikke en
  komponentavgjørelse.
- **Tre vekter og ikke flere:** 500 (flerdagsvinduet), 600 (klokka + ordmerket),
  700 (kolonet + delekortets store tid). Web laster kun 600/700.
- **Tabulære sifre er bakt inn i fontfila** (`tnum` løst opp i cmap ved
  subsetting), ikke slått på i CSS/SwiftUI. Derfor retter tidskolonnen seg inn
  også der `font-variant-numeric` ikke finnes — canvas-delekortet.
- **Dynamic Type er bevart:** iOS instansierer flata på tekststilens
  standardstørrelse og skalerer den med `UIFontMetrics` (`Font.sportivistaDisplay`).
  En fast `.system(size:)` er fortsatt forbudt.
- **Fail-soft, aldri usynlig tekst:** web bruker `font-display: swap` med
  systemstacken som fallback; iOS faller tilbake til `sportivistaTabular` om
  flata mangler i bundelen.
- **Merkelåsen står:** ordmerket i `label`, kun kolonet amber, null mellomrom,
  kolonet ETT vekttrinn tyngre (600 → 700), én a11y-etikett. Kolon-live-pulsen
  er urørt (kun opacity/glød animeres). Se `design/brand/BRAND.md`.
- **Ingen webfont-CDN.** Selvhostet, samme origin, null eksterne requests
  (forbudslista + null-infrastruktur-kravet).

### Rytme & layout

- 8pt-basisgrid (4pt for finjustering). Radhøyde ≥ 44pt.
- Inset-grupperte lister: kort med 12pt hjørne, skille innrykket til
  tekststart (ikke full bredde).
- Én lesekolonne, maks 640pt på store flater (iPad/web), sentrert.

### Ikoner

- **SF Symbols** for alle standard-handlinger — de skalerer med Dynamic Type,
  retter seg inn med tekst og har innebygd tilgjengelighet.

| Handling | Symbol | A11y-label (no) |
|---|---|---|
| Innstillinger / Deg | `gearshape` | «Innstillinger» |
| Varsel av/på | `bell` / `bell.fill` (amber når på) | «Varsel på/av» |
| AI-proveniens | `info.circle` | «Funnet av AI» |
| Se-lenke | `arrow.up.forward` | «Åpne <kanal>» |
| Følg | `plus.circle` | «Følg <navn>» |
| Demp/skjul | `eye.slash` | «Demp» |
| Del | `square.and.arrow.up` | «Del profil» |
| Nullstill/slett | `trash` | «Nullstill» |
| Diktering | `mic` | «Diktér» |
| Spoiler skjult | `eye.slash` | «Skjult — spoilervern på» |

- Egne (ikke-SF) glyfer kun der ingen SF Symbol passer OG a11y-label finnes.
  Dekorative glyfer: `accessibilityHidden`.

### Bevegelse & haptikk

- **Navigasjon:** Apples native push/sheet/tilbake-swipe. Ingen egendefinerte kurver.
- **Liquid Glass (iOS 26 — BINDENDE presisering):** plattformens kontroll-materiale
  er *native*, ikke dekor. Standard-komponenter arver det automatisk (bygg mot
  iOS 26-SDK, aldri `UIDesignRequiresCompatibility`-opt-out); appens egne
  kontroll-flater (den flytende assistent-bunn-knappen) adopterer `glassEffect` og
  flyter over innholdet (`safeAreaInset`). Glass hører KUN til kontroll-laget — innhold (agenda-rader,
  detaljark-innhold) glasses ALDRI. Egenlaget blur/glassmorfisme er fortsatt
  forbudt; det historiske forbudet gjaldt DIY-dekor, ikke systemmaterialet.
- **Hjelperens resultat:** native `.sheet` med `.presentationDetents`
  (grabber, dra-ned) — ikke et egendefinert fade-lag.
- **Haptikk (sparsom):** `.sensoryFeedback(.success, …)` på Bekreft,
  `.selection` på toggle, lett `.impact` på «varsel satt». Aldri på scroll/hvert tapp.
- **Reduce Motion:** ingen spring; overganger blir kryss-fade; ingen haptikk.
- Ingen spinnere (bruk innhold/skjelett), ingen parallakse/konfetti.

> Note: den amber-tikkende klokka og «P-nummer»-arven fra v2 er FJERNET — de var
> skall, ikke visjon. Tid bor i raden + systemets statusbar.

> **Kolon-live-signal (WP-152) — NORMATIV (eier-godkjent 21.07.2026).** Ordmerkets amber
> «:» (kandidat A «Kolonet») ER appens LIVE-signatur på iOS: når noe du
> følger sender NÅ, puster kolonet rolig — et langsomt (~1,6 s) ease-in-out,
> autoreverserende åndedrag i opacity (~1,0 ↔ ~0,5) + en myk amber-glød som puster
> med. Et rolig hjerteslag, ALDRI et blink; ingen layout-forskyvning (kun
> opacity/glød animeres, kolonets ramme står stille); ingen fargeendring utover
> amber. Drevet av det EKSISTERENDE live-signalet (samme kilde som ▌ LIVE-linja), så
> kolon og linje er alltid enige. **Reduce Motion:** ingen bevegelse — en statisk
> amber-glød bærer «på»-tilstanden i stedet. **«Amber = aksent»-invarianten holder**
> (pulsen puster den samme ene aksenten). **Web-paritet er bygd (WP-180)** — samme
> kolon-signal i web-headerens ordmerke, samme kadens og samme Reduce-Motion-regel
> (se § Cross-surface).

## Navigasjon & informasjonsarkitektur

- **`NavigationStack` med agendaen som rot.** Ingen tab bar (én permanent
  fane-rad for en sjelden-brukt «Deg» er for tungt krom).
- **Rotens to sider (Claude Design-handoff 19.07.2026):** en segmented med ORD
  under headeren — **«Uka | Nyheter»**. Begge dekker hele uka; skillet er hva
  som *skjer* (agendaen) vs. hva som er *nytt* (§ Nyheter). Ord, aldri ikoner.
- **Nav-baren (trailing):** kun `gearshape` (innstillinger). `gearshape` pusher
  **Deg**-skjermen (§ Deg). Assistent-inngangen bor IKKE i nav-baren lenger (WP-144
  flyttet den til en flytende bunn-knapp — se § Hjelperen).
- **Detaljer** vises som native `.sheet` (detents) eller push i agendaens stakk.
- **Ett navigasjonsmønster:** rad → detalj (push/sheet med ‹ tilbake); aldri
  gester som eneste vei.
- **Hjelperen** er en kompakt flytende BUNN-TRAILING-KNAPP (`sparkles` + «Assistent»)
  i tommelens nåbare hjørne som åpner samtalearket (§ Hjelperen) — ikke en fane, ikke
  et inline-felt, ikke en header-verktøylinje-knapp (WP-143→WP-144), og ikke den gamle
  bunn-kapselen (falskt søkefelt). Den flyter over innholdet (`safeAreaInset(.bottom)`);
  agendaen/Nyheter scroller rolig UNDER den og KOLLAPSER knappen til bare `sparkles`-
  glyfen mens tavla scrolles (WP-146 — jf. Foto/Musikk), re-ekspanderer i toppen.

## Agendaen (rot-skjermen)

Native `List`, inset-gruppert per dag. Bindende semantikk (uendret fra v2):

1. **I DAG først**, så I MORGEN, så ukedag + dato, 7 dager frem. Aldri passerte dager.
2. **Pågående flerdagsevents bor under I DAG** med vindu i tidskolonnen.
3. **Serie-kollaps** (≥4 events samme turnering): én rad, ekspanderes ved tapp.
4. **Live nå:** egen stille seksjon/rad øverst (`live`-farge) når noe pågår, maks to.
5. **Presentasjonsfilter:** en stille linje over lista + ett-trykks nullstilling.

### Radens anatomi (native List-rad)

```
[• amber]  [tid]  [🇳🇴 / (AR) / ⛳︎] [tittel        ] [🔔] [›]
                                    [turnering · runde · kanal]
```

- **Must-see:** liten amber-prikk (leading). Prikken er signalet — ingen emoji.
- **Identitets-kolonnen (rev. 22.07, WP-185):** ÉN kolonne mellom tid og tittel
  som holder NØYAKTIG ÉN ting, i denne kunnskaps-rekkefølgen: entitetens
  **flagg**, entitetens **farge-monogram**, eller — når vi ikke vet noen av
  delene — **sport-symbolet**. Aldri to, aldri tomt. Full spesifikasjon i
  § Entitets-avatar.
- **Sport-symbol (rev. 19.07, eier-funn):** ett stille SF-symbol per sport
  (`tertiaryLabel`, aldri farget) — «hva slags event» lesbart på et blunk uten
  å lese metateksten. Én kanonisk sport→symbol-tabell (`soccerball`,
  `figure.outdoor.cycle`, `figure.golf`, `tennisball`, …, fallback `calendar`)
  delt av rad, detalj og Nyheter. Symbol, aldri emoji/logo. Siden WP-185 er
  dette identitets-kolonnens NEDERSTE trinn, ikke dens faste innhold.
- **Tid:** tabular, semibold, fast venstrekolonne. Flerdagsvindu i samme kolonne.
- **Tittel:** `.body`, inntil to linjer, ALDRI trunkert til «…».
- **Stilling (WP-172):** for en PÅGÅENDE kamp bærer meta-linja stillingen +
  kampklokka («2–1 · 67'») — tabular, `live`-farge — FORAN kanalen; turneringen
  vikes for roens skyld. Ingen ny rad-DNA (samme meta-linje), ingen animasjon per
  oppdatering (kadens 60 s). Spoilervern vinner: en skjermet entitet/sport får
  ALDRI stillingen påtvunget (`spoilerSafe`), akkurat som RESULTAT i detaljarket.
- **Kanal:** `secondaryLabel` i meta-linjen; ukjent = «–». Krymper aldri tittelen.
  **Lenkeløftet (WP-246):** kanalNAVNET er alltid sant og vises alltid, men bare en
  URL som peker på selve sendingen (`urlKind: "deep"`) får se ut som en lenke. En
  forside/seksjon (`urlKind: "landing"`) vises som ren tekst — ingen understrek,
  ingen tapp, ingen varselikon; detaljarket sier stille «(ingen direkte lenke)».
  En forside som utgir seg for å være svaret på «hvor ser jeg det» er et brudd på
  Grunnlov 3.
- **Varsel:** `bell.fill` (amber) trailing KUN når raden armerer en påminnelse.
- **AI-funn:** `info.circle` trailing; tapp på raden åpner detalj med kilder.
- **Disclosure:** native chevron (`List` gir den) — trykkbarhet er tydelig,
  raden har pressed-state og button-rolle gratis.
- **Sveip-handlinger:** venstre → Følg / Demp / Påminn der det er meningsfullt.

### Entitets-avatar (WP-185 — eier-funn 21.07: «tavla er anonym»)

Raden var ren tekst, og sport-glyfen navngir SPORTEN, aldri entiteten. Hver rad
får derfor ett rolig visuelt ANKER for hvem den handler om. **Ingen flate henter
et bilde over nett**: merkene er innsjekkede/bundlede assets, resten tegnes
LOKALT (emoji + gradient) — null tredjeparts-CDN, null infrastruktur, null
personvern-lekkasje.

**Stigen (bindende rekkefølge, samme dom på begge flater):**

0. **Ekte merke** (WP-186, eierbeslutning 22.07) — klubbens eget merke, når
   pipelinen har ett med fullstendig proveniens OG flaten faktisk har assetet.
   Asset fra `docs/logos/` (web: samme origin; iOS: app-bundlen), ALDRI en
   hotlink. Vises **uendret** — ingen omfarging, beskjæring, maskering, tint
   eller bakgrunnsplate: et fritt merke under CC BY-SA er share-alike, og et
   omtegnet klubbmerke er uansett feil merke. Landslag har bevisst INTET merke
   (flagget er det sannere ankeret for et land), så trinn 0 og 1 konkurrerer
   aldri om samme rad. Hvilke merker som i det hele tatt shippes styres av
   `scripts/config/logo-policy.json`, ikke av designet.
1. **Flagg** — utøvere og LANDSLAG, utledet av registerets ISO-landkode
   (`country`). Emoji: null assets, null rettigheter, skalerer med Dynamic Type
   gratis. De britiske hjemnasjonene har egne flagg (`GB-ENG`/`GB-SCT`/`GB-WLS`)
   — sport behandler dem som land. Ingen ISO-kode ⇒ INTET flagg (aldri et
   gjettet nabo-flagg).
2. **Farge-monogram** — klubber/orgs: entitetens to registrerte farger delt på
   diagonalen med 1–2 initialer over (Kontakter/Kalender-idiomet).
3. **Sport-symbolet** — den ærlige fallbacken. Ingen tomme hull, ingen oppfunnet
   farge: raden ser da ut som før WP-185.

**Regler (BINDENDE):**

- **Maks ÉN farget avatar-flate per rad.** Raden har ett anker, ikke ett per lag.
  Anker-entiteten er (i tur) serverens stemplede `homeTeamEntityId`, hjemmelagets
  navn, en norsk deltaker, en navngitt deltaker.
- **Avataren er ALDRI en aksent.** Amber er fortsatt produktets ENESTE aksent
  (§ Forbudsliste): monogrammet bærer *entitetens* farger, konkurrerer aldri med
  must-see-prikken, og ingen avatar-regel rører `--accent`/`SportivistaTokens.accent`.
- **Størrelse ~24 pt** (`@ScaledMetric` på iOS, 24 px kolonne på web), sirkulær,
  plassert mellom tidskolonnen og tittelen. Skalerer med Dynamic Type; ved
  AX-størrelser følger den tid/sport-linja i den vertikale reflowen.
- **Monogram-blekket BEREGNES** fra fyllets relative luminans (WCAG) — aldri
  hardkodet hvit. Halve registerets klubber spiller i hvitt.
- **Mørk vs. lys:** klubbfargen dempes ALLTID et hakk — en 24 pt sirkel skal aldri
  være det høyeste på en rolig side, og aldri overdøve amber-prikken. Mørk modus
  demper litt hardere (≈0,85 metning + ≈0,9 opasitet) så en mettet drakt ikke
  gløder mot true-black; lys modus ≈0,9 metning. En hårlinje-kant holder en helt
  hvit eller helt svart drakt fra å løse seg opp i flaten i begge temaer.
- **Dekorativ:** `accessibilityHidden` / `aria-hidden` — tittel og meta navngir
  allerede entiteten for skjermleser. Avataren legger aldri til en lyd.
- **Entitetssiden** (0K WP-170) bruker SAMME avatar i stor variant når den lander.
- **Merket tar SAMME plass** som flagget og monogrammet (24 pt-boksen) —
  WP-186 innførte ingen layout-endring og ingen ny aksentfarge. Et klubbmerke er
  entitetens farger, aldri produktets.
- **Aldri:** spillerfoto, en ekstern bilde-URL (heller ikke for merket — det er
  alltid et lokalt asset), et modifisert klubbmerke, mer enn én farget flate i
  raden, eller en avatar som erstatter tekst.
- **Attribusjon er en del av flaten, ikke en fotnote:** CC BY / CC BY-SA KREVER
  kreditering, så «Merker og kilder» (web: egen disclosure under tavla; iOS:
  Deg › Merker og kilder) lister hvert fritt merke med lisens og opphavsperson,
  og gir de editorial-baserte merkene den nøkterne linja om at de tilhører sine
  respektive klubber og vises for å identifisere dem — uten noen påstand om
  tilknytning, sponsing eller godkjenning.

### Event-detalj (native sheet, detents `[.medium, .large]`)

Seksjoner: Arena · Om · **Hvor ser jeg det** (lenker) · **Funnet av AI**
(confidence + kilder, kun AI-events) · **Varsel** (stille status) · **Resultat**
(spoiler-maskert bak tapp når spoilervern er på) · **Tabell** (WP-171: ligatabell /
golf-ledertavle / F1-VM-stilling, rang · navn · verdi, maks 5 rader + de involverte;
result-avledet, så den ligger bak SAMME spoiler-maskering som Resultat).
Ingen kort-i-kortet.

## Hjelperen (ambient, kontekstbevisst)

Visjonens kjerne, bygd som native mønstre — ikke en bespoke kontroll.

Rev. 20.07.2026 (WP-144, eier-beslutning — iterasjonens endestasjon): assistent-
INNGANGEN er en **kompakt flytende BUNN-KNAPP** i tommelens nåbare sone. Den
avslutter en iterasjon: (a) WP-104s bunn-KAPSEL var en falsk affordance (så ut som
et søkefelt, var en knapp); (b) WP-143 flyttet inngangen til en ærlig header-
verktøylinje-knapp, men den var **uråkelig med én hånd** på toppen av en høy iPhone.
WP-144 forener begge kravene: en TYDELIG KNAPP (ikke det gamle felt-metafor-feltet) i
den NÅBARE sonen — det sanksjonerte iOS 26 flytende Liquid Glass-mønsteret. Full
tilstandsspec i `design/specs/assistent-nyheter-v0.md`.

Rev. 21.07.2026 (WP-146, variant D — design-review, eier-beslutning): knappen flyttes
til bunn-TRAILING-hjørnet (rydder lesekolonnen, okkluderer aldri siste rad), copy i ro
er «✨ Assistent», og den KOLLAPSER til bare `sparkles`-glyfen mens tavla scrolles
(re-ekspanderer i toppen) — det fulle iOS 26 flytende-knapp-idiomet (jf. Foto/Musikk).
Glass-materiale, amber-tint, `sparkles`, button-rolle og id `assistant.button` er
UENDRET; det er en ren inngangs-/visnings-endring.

- **Bunn-knappen** (`AssistantButton`: `sparkles` + etikett «Assistent»,
  iOS 26 Apple-Intelligence-idiomet) flyter i bunn-TRAILING-hjørnet (≈16 pt innrykk,
  over home-indicator; `safeAreaInset(.bottom)`, trailing-justert — WP-146 variant D,
  eier-beslutning 21.07): en umiskjennelig HIG-knapp (button-rolle, ≥44 pt,
  a11y «Assistent», id `assistant.button`) som åpner samtalearket. **Nåbar sone +
  ærlig affordance + ryddig lesekolonne** — den bor der tommelen når, den okkluderer
  ALDRI siste agenda-/Nyheter-rad, OG den leser umiskjennelig som en KNAPP: en KOMPAKT
  glass-pille som HUGGER innholdet sitt (ikke full bredde, ikke en flate, ikke en FAB —
  fortsatt en glass-KAPSEL, aldri en fylt sirkel med skygge), med `sparkles` i amber
  + en aktiv etikett. **Kollaps ved scroll:** når tavla scrolles kollapser pilla til
  bare `sparkles`-glyfen (iOS 26 flytende-knapp-atferd, jf. Foto/Musikk) og re-
  ekspanderer i toppen / ved ro; overgangen respekterer Reduce Motion (ingen animasjon
  da). INGEN placeholder-grå «skriv her»-tekst (det var kapselens falske felt-
  affordance), INGEN `mic` inni (diktering bor i arket alene). Skriving OG diktering
  bor i arket.
  - **Guidingen skjer ved ENGASJEMENT** (arkets eksempelrader når du åpner),
    ALDRI som en stående chips-vegg på agendaen — calm er ufravikelig (én rolig,
    skannbar flate; ingen konkurrerende paneler). ÉN kompakt knapp, aldri chips.
    Agendaen/Nyheter scroller rolig UNDER knappen.
- **Samtalearket** (native sheet, grabber/dra-ned/tapp-utenfor): én setning
  («Skriv eller snakk — helt vanlig norsk.») + tre TRYKKBARE eksempelrader
  (følg-et-lag → Legg til-søket · spørsmål · kommando) + felt nederst.
  Feltet vokser til ~4 linjer (Meldinger-mønsteret); send = amber primærknapp;
  retur gir linjeskift. Diktering: bølge erstatter feltet, transkripsjonen
  lander i feltet — du sender selv.
- **Svar i tråden:** svaret lander i SAMME ark — din melding som boble,
  diff (`+` grønn / `±` amber / `−` rød) med Bekreft/Avvis eller rolig svar
  som kort under; «Følg opp …» er ett felt unna. Forstår BÅDE profil-endringer
  OG spørsmål.
- **Snarvei, aldri eneste vei:** alt arket kan (følg, endre, varsler) finnes
  også som vanlige lister/knapper (§ Deg: Det du følger + Legg til; Følg-knapp
  i event-detaljen).
- **Kontekstbevisst:** agenda → følg/spør om tavla; detaljark → forhåndsscopet
  til eventet («Følg <lag>», «Påminn meg», «Hvorfor vises denne?»); Deg →
  innstillinger i naturlig språk.
- **Tenke-tilstand:** dempet «tenker …» + Avbryt, aldri en spinner.
- **Umiddelbar konsekvens:** Bekreft ⇒ arket lukkes ⇒ agendaen re-kompileres.
- **Ærlighet:** Apple Intelligence av ⇒ si det rett ut, aldri falsk degradering.

## Nyheter (rotens andre side)

Tavla fra Claude Design-handoffen (2b «For deg») — bygget mot VISJON v3/WP-100.
**Radens DNA = agendaens:** type-tag (når kjent) · én faktalinje · entitet ·
kilder ut (↗) · relativ tid. ALDRI innbakt artikkeltekst, aldri AI-sammendrag
av én enkelt kilde (DSM art. 15) — pekerne sender trafikken ut.

- **Fire seksjoner, ferdig — tavla er endelig:** MORGENBRIEFEN / KVELDSBRIEFEN
  (den navngitte briefen — WP-181, se § Briefen som rituale; editorial-tverrsnitt
  over egne data, proveniens-ⓘ) · NYTT (linse-matchede pekere) · RESULTAT (alltid
  bak «Vis resultat» når spoilervern gjelder, `eye.slash`) · FREMOVER (forvarsler
  utover dagens horisont).
- Ingen uleste-tellere, ingen engasjements-mekanikk. Stille «Det du følger»-
  lenke øverst.

### Briefen som rituale (WP-181 — navngir WP-174-motoren)

«Min brief» (WP-174) komponerer 2–3 rolige norske setninger on-device («I din
verden i dag …»). WP-181 gir den et NAVN og et rituale — stemmen er aktivumet ingen
konkurrent har, men den rendret uten navn. Ingen endring i MOTOREN (`brief.js` ↔
`MinBrief.swift` + brief-vektorene er WP-174s frosne kontrakt); dette er drakten.

- **Navnet (bestemt form):** **«Morgenbriefen»** før tidsgrensa, **«Kveldsbriefen»**
  etter — en stille seksjonsoverskrift over briefteksten, i SAMME grå
  footnote-semibold uppercase som tavlas andre seksjonshoder (iOS: Nyheter-tavlas
  brief-slot; web: heroens brief-linje). Ingen ramme-pynt utover overskriften,
  ingen bilder, ingen kort-støy — fortsatt bare de 2–3 setningene. Vises kun når det
  FINNES en brief (personlig eller fersk editorial); aldri over den generiske
  fallback-linja (iOS skjuler da hele seksjonen, web dropper tittelen).
- **Tidsgrensa (Oslo, delt definisjon):** kl. **15:00 Oslo**. Før → Morgenbriefen,
  fra og med → Kveldsbriefen. ÉN kilde på tvers av flatene —
  `BriefRitual.eveningHour` (iOS) ↔ `SS_BRIEF_EVENING_HOUR` / `ssBriefRitualName`
  (web/`shared-constants.js`), tvilling-testet. «Før ~12» er trivielt morgen,
  «etter ~15» vipper til kveld; 12–15 løses til morgen (kvelds-editorialen ferskner
  uansett ikke før 17:00 Oslo).
- **Valgfri daglig varsel (opt-in, AV som default):** ett rolig lokalt varsel
  **«Morgenbriefen er klar»** (kropp: «Åpne når du vil.») ~**06:45 Oslo** — ETTER
  06:30-editorialen (WP-173) med margin. Teksten er ALLTID den samme og GENERISK:
  aldri et resultat, en stilling eller en spoiler i varselet (det er poenget med et
  varsel uten innhold). Bryteren bor i Deg › APP («Varsel om Morgenbriefen»); egen
  per-enhet-preferanse (`BriefAlertPreference`), aldri i synk-profilen, aldri rørt av
  en nullstilling. Repeterende lokal planlegging (`BriefNotificationPlanner`,
  UNCalendarNotificationTrigger); tillatelse spørres kun ved PÅ-slåing.
- **Widget-speiling (medium):** medium-widgetens ENE følgelinje under høydepunktet
  er briefen OM MORGENEN (Morgenbrief-vinduet, samme 15:00-grense), ellers «siste
  resultat» (WP-176). Briefen oppsummerer allerede resultater i sin egen tekst, så
  den tar plassen om morgenen. PRE-RENDRET av appen (`WidgetBriefSnapshot`, samme
  mønster som `widget-result.json`) — widget-targetet kjører ikke brief-motoren; og
  dag-gatet (en dag-relativ brief overlever aldri sin egen Oslo-dag på widgeten).
  INGEN ny widget-familie.

## Deg-skjermen

Pushet fra `gearshape`. Native inset-gruppert `List` (SF Symbols leading,
verdi + chevron trailing). Grupper:

- **PROFIL:** Det du følger (n — vanlig liste, rad → detalj med endringer og
  «Slutt å følge», + **Legg til**-søk mot entitets-indeksen med Følg-knapper)
  · Sett opp på nytt.
- **DATA OM MEG:** Hva jeg vet om deg (n) · Det jeg ikke forsto (n) · Del profil (QR).
- **APP:** Varsel før start (leadMinutes) · **Varsel om Morgenbriefen** (WP-181 —
  opt-in daglig brief-varsel, `sun.horizon`, AV som default; se § Briefen som
  rituale) · Utseende (tema) · Merker og kilder ·
  **Personvern** (WP-190 — én rolig rad som åpner `sportivista.com/personvern.html`
  i Safari; erklæringen bor på nett fordi den må være offentlig lesbar og finnes i
  ÉN versjon, aldri som modal ved oppstart) · Nullstill.
- **FOT:** «BYGG <sha> · dato · SISTE / NYERE FINNES» (dempet).
- **DEBUG (kun DEBUG-bygg):** Eval · Telemetri (MetricKit).

Destruktive rader → ett rolig bekreftelses-ark (aldri system-alert var påkrevd,
men native `confirmationDialog`/sheet er nå tillatt): eksakt konsekvens i én
setning + Nullstill/Avbryt.

## Tema

Følger systemet via semantiske farger. Manuell overstyring (system → mørk → lys)
er en enhets-preferanse under **Deg › Utseende** (ikke lenger en header-glyf),
persistert, appliseres på appens rot. Overlever enhver profil-nullstilling.

## HIG-samsvar (BINDENDE sjekkliste)

Fordi baselinen bruker Apples kontroller, arves mesteparten. Hver UI-endring
skal likevel bestå denne før merge; håndhev det som kan håndheves i CI:

- [ ] **Dynamic Type:** all tekst via tekststiler; ingen isolert `.system(size:)`.
      *CI-gate:* en test feiler på nye faste størrelser i `Zenji/`.
- [ ] **Kontroller:** `List`/`Button` med pressed-state + a11y-rolle; ingen
      naken `.onTapGesture`-rad.
- [ ] **Tastatur:** keyboard avoidance verifisert; clear-knapp; diktering; autocap av for egennavn.
- [ ] **VoiceOver:** hver kontroll har label; dekorasjon skjult; logisk rekkefølge.
- [ ] **Tapp-mål:** ≥44×44 pt.
- [ ] **Kontrast:** tekst mot flate ≥ WCAG AA (amber-verdiene er valgt for dette).
- [ ] **Reduce Motion + Dark/Light:** begge respektert.
- [ ] **Modalitet:** native `.sheet` (grabber/detents) for ark.
- [ ] **Verifisering:** skjermbilder i BEGGE temaer + minst ett ved forstørret Dynamic Type.

## Cross-surface & innhold

- **iOS-app + widget = baseline (nå).** Begge følger denne kontrakten fullt ut;
  widgeten er en miniatyr av samme språk (semantiske farger + Dynamic Type).
- **Web (docs/) = baseline (nå).** Unntaket er lukket: `docs/`-flaten følger de
  samme § Tokens-verdiene som appen — system-font-stacken (med display-fonten på
  de samme tre flatene som iOS, § Display-font), Apple-system-fargene
  (true-black `#000000`-side i mørk, `#F2F2F7` grouped-light) og amber som eneste
  aksent. Verdiene er tokenisert i `base.css` og skal stå verifiserbart mot
  denne tabellen. Web beholder sine egne layout-detaljer (én kolonne maks 640px,
  dag-gruppert agenda), men fargene og typografien er baseline. Det historiske
  Tekst-TV-uttrykket (mono type-stack, near-black `#0A0A0C`, varmt-papir) er
  dermed avviklet.
- **Klokke-paritet (WP-128):** den sekundtikkende amber-klokka i web-headeren er
  **FJERNET** — datoen består, tid bor i raden (samsvar med § Bevegelse og iOS).
- **Kolon-live-signal (WP-152 iOS + WP-180 web — NORMATIV på BEGGE flater):** kolon-som-
  LIVE-signatur (§ Bevegelse-noten) er eier-godkjent (21.07.2026) og lever nå på både
  **iOS** (`MastheadColon` i `ContentView.swift`) og **web** (`.wordmark-colon.is-live`
  i `docs/css/layout.css` + `Dashboard.renderMastheadLive` i `docs/js/chrome.js`).
  Samme semantikk begge steder: samme kilde (web leser det delte `ssLiveState` via
  `directLiveEvents` — nøyaktig den linja «Direkte nå» bygges av, så kolon og linje
  aldri kan være uenige), samme kadens (~1,6 s ease-in-out, autoreverserende opacity
  ~1,0 ↔ ~0,5 + myk amber-glød), samme minutt-tikk (iOS `TimelineView(.everyMinute)`,
  web den eksisterende 60s-live-lørkka), samme a11y-etikett («Sportivista — sender nå,
  N direkte») og samme bindende av-bryter: **Reduce Motion / `prefers-reduced-motion`
  ⇒ ingen bevegelse, statisk amber-glød bærer «på»-tilstanden**. Deterministisk
  reproduksjon: iOS `SPORTIVISTA_DEMO=masthead-live`, web `?demo=masthead-live`
  (`?demo=masthead-neutral` for kontrollen). **Ikke bygd (EIERBESLUTNING):** rad-kolonet
  — kolonet i agendaens tidskolonne som pulser på LIVE rader — krever først avklaring
  av «to amber-elementer i samme rad»-regelen (§ Forbudsliste).
- **Tema-glyf-unntak (WP-128):** web beholder tema-toggle-glyfen ◐ i headeren
  (system → mørk → lys) som et *bevisst* unntak fra § Tema. iOS flyttet temavalget
  til Deg › Utseende, men web har ingen Deg-skjerm, så header-glyfen er den eneste
  plassen det kan bo.
- **Sport-symbol (web-paritet, WP-154 — LUKKER WP-128-unntaket):** § Radens
  anatomis per-sport-glyf gjelder NÅ også web. SF Symbols finnes ikke på web, så
  `docs/` bruker et eget lite SVG-ikonsett (`js/sport-icons.js`) tastet på de SAMME
  kanoniske sport-taggene — stille (`tertiaryLabel`/`--fg-3`), ALDRI farget
  (amber-budsjettet urørt), dekorativt (tittel/meta bærer sporten for AT). Ikke
  emoji/logo (§ Forbudsliste holder — dette er rene SVG-glyfer). Bevisste web-avvik
  fra SF-tabellen: vintersportene (langrenn/alpint/hopp/kombinert) deler ett
  snøfnugg (en håndtegnet figur per gren er uleselig på 16px), skiskyting beholder
  blinken (`target`).
- **Entitets-avatar (WP-185 — begge flater fra dag én):** § Entitets-avatar
  gjelder web og iOS likt. Web tegner flagget som emoji og monogrammet med en
  `linear-gradient(135deg, …)` i en 24 px sirkel (`js/entity-avatar.js` +
  `.ev-avatar`/`.ev-mono` i `cards.css`); iOS bruker `EntityIdentity` +
  `EntityAvatarView`. Beslutnings-logikken (hvilket trinn i stigen, hvilke
  initialer, hvilket blekk) er TVILLING-implementert og testet case-for-case på
  begge sider — samme entitet skal alltid gi samme avatar.
- **Disclosure-chevron (web-paritet, WP-154):** ekspanderbare web-rader bærer nå en
  stille chevron (`--fg-3`, roteres 90° ved åpning under `prefers-reduced-motion`-
  respekt) — samme trykkbarhets-signal som iOS' native `List`-chevron, portert til
  web-SVG. (Erstatter den gamle «trykkbarhet kun via rytme»-web-regelen.)
- **Uka | Nyheter + Hjelperen (web-paritet, WP-154):** web har nå den samme
  segmenterte roten (§ Navigasjon — «Uka | Nyheter») og den flytende bunn-trailing
  «Assistent»-knappen + samtalearket (§ Hjelperen), kollaps-på-scroll inkludert.
  Nyhetstavla speiler § Nyheter (NYTT `news.json` · RESULTAT · FREMOVER; den
  redaksjonelle overskriften bor fortsatt som web-heroens rolige linje, så § Nyheters
  første seksjon gjentas ikke). Web-assistenten er den deterministiske gulvversjonen
  (`js/assistant.js`) — samme inngang/ark-mønster, mindre motor.
- **Stemme:** norsk, lavmælt, presis. «Kanal ukjent», ikke «Ingen streaming!».
  Aldri utropstegn i kromet. Feil forklarer hva og hvorfor.

## Forbudsliste

Faste punktstørrelser som ignorerer Dynamic Type · `.onTapGesture`-rader uten
pressed-state/a11y-rolle · trunkerte titler · fortid i agendaen · mer enn én
aksentfarge (amber) · to amber-elementer i samme rad · badges med tall ·
spinnere · haptikk-fest · egendefinerte overgangskurver der Apple har en native ·
egenlaget blur/glassmorfisme (system-Liquid Glass på kontroll-laget er native og
påkrevd; DIY-glass — særlig på innhold — er forbudt) ·
egne ikoner der en SF Symbol finnes · ekte klubblogoer/crester og spillerfotos ·
enhver ekstern bilde-request i en produktflate · «AI-slop»-estetikk.
Ved tvil: fjern.

**Presisering — entitets-avatar (WP-185):** «Symbol, aldri emoji» er en regel om
SPORT-glyfen (§ Radens anatomi) og står. Identitets-kolonnens FLAGG er et bevisst
unntak, og det er et smalt ett: et flagg er et LAND, ikke et ikon, og
emoji-varianten er den eneste formen som er rettighetsfri, assetløs og skalerer
med Dynamic Type gratis. Farge-monogrammet er tilsvarende ikke en ny aksentfarge,
men entitetens egen identitet — regelen «maks én amber-flate per rad» og «maks én
farget avatar-flate per rad» gjelder side om side.

**Presisering — primær-CTA (WP-149):** «ingen pills» gjelder pille-formede
SEKUNDÆR-/multi-knapper (Bekreft/Avvis, «mente du»-forslag, «Hopp over» — de
forblir flate/dempede: `.sportivistaTapTarget()` eller den hårlinje-flate
`SportivistaActionButtonStyle`). Men ÉN primær handling per skjerm KAN — og BØR —
være en tydelig, lesbar prominent native knapp: en amber-fylt kapsel
(`SportivistaPrimaryButtonStyle` / amber-tintet `.borderedProminent`). En umerket
amber KONTUR uten fyll leste knapt som knapp i lys modus (design-review 🔴, 21.07);
en fylt amber primærknapp per skjerm er derfor sanksjonert. Regelen «to amber-
elementer i samme rad» gjelder fortsatt: primærknappen er skjermens ene fylte
amber-flate, ikke to.

**Presisering — markedsflater vs. produktflater (WP-182):** dette dokumentet
regulerer PRODUKTFLATENE (appen, widgeten, weben). Et delekort og et
`og:image` er REKLAME: de rendres til et bilde som forlater enheten og vises
i iMessage/Slack, aldri i appens eget hierarki. Der er amber-på-svart tillatt
modigere enn kontrakten ellers tillater — konkret er den store tiden AMBER på
kortet, mens tidskolonnen i produktet er `label`. Friheten er innelukket ved
konstruksjon: markedsflatene bor i egne filer (`ios/Sportivista/Share/ShareCard.swift`,
`docs/js/share-card.js`, `design/brand/generate-og-image.swift`), de rendrer
off-screen/statisk, og ingen produktvisning importerer dem. Alt annet står:
merkelåsen (BRAND.md — ordmerket i `label`, kun kolonet amber), norsk stemme,
og ÆRLIGHET (ukjent kanal er «–», aldri en oppdiktet kanal eller gjettet tid).

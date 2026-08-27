# docs/logos — klubbmerkene

Innsjekkede assets: ett ~96 px PNG per entitet, navngitt etter entitetens
**stabile registry-id** (`afc-bournemouth.png`). `ATTRIBUTION.json` ved siden av
er manifestet flatene krediterer fra (web: «Merker og kilder» nederst på tavla,
iOS: Deg › Merker og kilder).

Alt her er generert av `npm run seed:logos`
(`scripts/seed-registry/logos.js`) — **rediger ikke filene for hånd.**

## Fire regler som ikke er til forhandling

1. **Ingen hotlinking.** Assetene hentes ved SEED-tid og sjekkes inn. Verken web
   eller app gjør noen gang et bilde-kall til Commons, ESPN eller et CDN
   (null-infra, personvern, ToS). Det er grep-bevisbart: den eneste `fetch` av et
   bilde i repoet står i seed-skriptet.
2. **Aldri modifisér et merke.** Ingen omfarging, beskjæring, maskering, tint,
   `template`-rendering eller bakgrunnsplate. Et fritt merke under CC BY-SA er
   share-alike — en derivat ville arvet vilkårene — og et klubbmerke som er
   tegnet om er uansett feil merke. Skalering til ~96 px er det eneste inngrepet.
3. **Proveniens per merke.** Hvert asset har en `logo`-oppføring i registeret med
   `source`, `basis` og `sourceUrl`. Uten fullstendig proveniens shippes det
   ikke — hverken server- eller klientside (`scripts/lib/logo-policy.js`).
4. **Policyen styrer hva som shippes**, ikke koden. Se
   `scripts/config/logo-policy.json`.

## De to grunnlagene (`basis`)

| `basis` | Kilde | Hva det betyr |
|---|---|---|
| `free-license` | Wikidata `P154` → Wikimedia Commons | Opphavsretten til tegningen er BEVIST fri: `imageinfo`-metadataen sier CC0, public domain (inkl. `PD-textlogo`, altså under verkshøyde), CC BY eller CC BY-SA. Maskinelt avgjort i `scripts/lib/logo-license.js`, fail-closed. CC BY/CC BY-SA krever kreditering — mangler opphavsperson, avvises merket. |
| `editorial-use` | ESPN (samme leverandør som kampdataene) | Merket vises for å IDENTIFISERE klubben. Ingen fri lisens påstås. Eierbeslutning 22.07 — se PLAN.md § WP-186 for den ærlige juridiske vurderingen. |
| `editorial-use` | `club-official` — klubbens eget publiserte merke | Samme grunnlag som ESPN-raden, men hentet FOR HÅND fra klubbens nettsted fordi verken Commons eller ESPN har et merke (FK Lyn Oslo). |

Frie merker har alltid forrang; ESPN-kilden fyller kun hullene.

**Et `club-official`-merke overlever et re-seed (WP-251).** Det er den ene kilden
seed-skriptet ikke kan utlede på nytt, så det slettes ikke når Commons mangler
`P154` for entiteten — det gjorde det før, og et re-seed slettet både
registeroppføringen og assetet uten å si fra. Regelen ligger i
`isSeedReplaceable` (`scripts/seed-registry/logos.js`) og svekker ikke bryteren:
merket hviler på `editorial-use`, så `free-only` fjerner det fortsatt.

## Slå det av igjen

Sett `"policy": "free-only"` i `scripts/config/logo-policy.json`:

- `npm run build:entities` fjerner umiddelbart alle `editorial-use`-merker fra
  `docs/data/entities.json` — og dermed fra web, app og widget, uten
  klientendring og uten app-oppdatering;
- `npm run seed:logos` rydder i tillegg bort assetene og
  registeroppføringene.

Det er hele reverseringen. Den er ment å være kjedelig.

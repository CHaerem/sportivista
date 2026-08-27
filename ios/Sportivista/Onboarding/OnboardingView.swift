//
//  OnboardingView.swift
//  Sportivista
//
//  WP-31 — the calm first-run experience (dossier P310's «definere»-løkke:
//  "onboarding er en samtale, ikke et skjema — ingen konkurrent lar deg SI hva
//  du bryr deg om"). Four quiet steps on the Apple-native baseline (system
//  type, one amber accent, the Kolonet wordmark), no hero art, no carousel, no emoji,
//  no exclamation marks. WP-129 — the copy speaks plainly to a non-technical
//  first-time user (say WHAT the app does before asking for anything) and points
//  at the assistant BUTTON, never the retired inline command line:
//
//    1. welcome    — one plain-language sentence about what Sportivista does
//                    (samler når · hvor du kan se sporten du bryr deg om)
//                    + the on-device privacy moment (P350/P360).
//    2. converse   — the say-what-you-follow path (Apple Intelligence only):
//                    free Norwegian text in an inline field → the EXISTING
//                    assistant (InterestAssistant.interpret) → a calm diff the
//                    user confirms, saying several things in a row while the
//                    "Følger nå" list grows. Reuses AssistantViewModel wholesale
//                    — NOT a parallel input.
//    3. quickPicks — the tap-to-follow path that works for EVERYONE: curated
//                    Norwegian starter packs as ≥44pt tap targets. This alone
//                    gives full value on a cold start with no Apple Intelligence,
//                    and needs no understanding of the assistant.
//    4. landing    — the quiet finish: it points at the assistant (WP-144/146: the
//                    floating bottom «Assistent» button — "du kan alltid si mer til
//                    Sportivista") and drops the user into an agenda that ALREADY
//                    reflects the choices, because every confirm/tap recompiled it
//                    live via onProfileChanged.
//
//  WP-149 — DRAKT-reskin to the Apple-native baseline (the retired Tekst-TV skin
//  is CLOSED, DESIGN § Cross-surface). This screen is the FIRST impression, and it
//  was the last surface still wearing the teletext look (sharp `Rectangle().stroke`
//  boxes, a `»_` prompt sigil + `▌` block cursor, amber-tracked VERSAL micro-labels,
//  and an unfilled amber-outline CTA that barely read as a button in light mode).
//  It now matches Deg/Nyheter EXACTLY: native rounded 12 pt `cell` cards
//  (`onboardingCell`), GREY section headers (`secondaryLabel`, not amber), a plain
//  native `TextField`, a native selection treatment (an amber `checkmark.circle.fill`,
//  never a VERSAL «VALGT» label), and ONE prominent filled amber primary button per
//  screen (`SportivistaPrimaryButtonStyle`) — secondary actions stay flat/muted.
//  Pure drakt: all copy, flow and the assistant/eval logic are untouched.
//
//  Presentation only. Every mutation goes through AssistantViewModel + the pure
//  pipeline (grounding, InterestProfile.applying, ProfileStore, EffectiveInterests).
//

import SwiftUI

/// WP-164 CI-vakt — the onboarding copy's promise, as data. The converse step
/// advertises concrete example utterances; every CONCRETE entity name they
/// name-drop must actually ground against the entity index, or the copy
/// promises something the assistant will reject. `converseStep` renders
/// `converseIntro` verbatim and OnboardingCopyGroundingTests replays every
/// `entityMentions` name against the checked-in entities fixture — copy and
/// guard can never drift apart.
enum OnboardingExamples {
    /// The converse step's intro line, rendered verbatim.
    static let converseIntro = "Skriv fritt på norsk — «Liverpool», «golf, mest de norske», «sjakk når Carlsen spiller». Jeg foreslår, du bekrefter. Si gjerne flere ting etter hverandre."
    /// The concrete entity names the examples above name-drop («golf, mest de
    /// norske» is a sport + lens, not an entity — deliberately not listed).
    static let entityMentions = ["Liverpool", "Carlsen"]
}

struct OnboardingView: View {
    /// The SAME assistant ContentView owns — so a follow made here is the same
    /// profile the agenda behind the overlay recompiles against.
    @Bindable var assistant: AssistantViewModel
    /// Finish: mark onboarding done and drop into the (already-filled) agenda.
    var onFinish: () -> Void
    /// Skip from the welcome: mark done, leave the profile empty. The agenda's
    /// own empty state then points back at the assistant.
    var onSkip: () -> Void
    /// WP-132 — «Prøv nå» / a tapped example from the assistant-intro step:
    /// finish onboarding AND open the assistant, optionally pre-filling the
    /// field with `prefill` (nil = open empty). The host owns the actual sheet.
    var onTryAssistant: (String?) -> Void
    /// DEBUG screenshot harness only: jump straight to a step so each state can
    /// be captured deterministically. Nil in the shipping flow (always `.welcome`).
    var initialStep: OnboardingStep? = nil
    /// WP-202 — the one system side-effect the ritual step performs, injectable
    /// so the flow is previewable/testable without UNUserNotificationCenter.
    /// The default is the real ask (the SAME scheduler the planners use, so the
    /// authorization state they later read is the one this primed).
    var requestNotifications: () async -> Bool = {
        await UNUserNotificationScheduler().requestAuthorizationIfNeeded()
    }

    @State private var step: OnboardingStep = .welcome
    @FocusState private var inputFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// WP-202 — the ritual step's notification decision: nil until the user
    /// chooses, then the calm status line `RitualPriming.apply` returned.
    @State private var ritualOutcome: String? = nil
    @State private var isRequestingNotifications = false

    private var trimmed: String {
        assistant.utterance.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ZStack {
            SportivistaTokens.background.ignoresSafeArea()
            VStack(spacing: 0) {
                brandHeader
                // WP-149: a GeometryReader so the sparse welcome step can fill the
                // viewport and drift its primary action into the thumb-reachable
                // lower third (better vertical balance than the old top-third +
                // dead void); content-heavy steps size to content and scroll normally.
                GeometryReader { proxy in
                    ScrollView {
                        Group {
                            switch step {
                            case .welcome: welcomeStep(minHeight: proxy.size.height)
                            case .quickPicks: quickPicksStep
                            case .converse: converseStep
                            case .ritual: ritualStep
                            case .assistantIntro: assistantIntroStep
                            }
                        }
                        .padding(.horizontal, 24)
                        .padding(.bottom, 40)
                        .frame(maxWidth: 640, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
        }
        .foregroundStyle(SportivistaTokens.label)
        .task { assistant.refreshAvailability() }
        .onAppear { if let initialStep { step = initialStep } }
    }

    // MARK: - Brand header (SPORTIVISTA + amber colon — Kolonet)

    private var brandHeader: some View {
        HStack(spacing: 0) {
            // Brand lock (designprofil rev 2): wordmark + amber colon.
            Text("SPORTIVISTA")
                // WP-183 — the display face (wordmark is one of its three surfaces).
                .font(.sportivistaDisplay(.title2, weight: .semibold))
                .foregroundStyle(SportivistaTokens.label)
                .tracking(2)
            Text(":")
                .font(.sportivistaDisplay(.title2, weight: .bold))
                .foregroundStyle(SportivistaTokens.accent)
            Spacer()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sportivista")
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 20)
    }

    // MARK: - Step 1 · Welcome

    private func welcomeStep(minHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            stepHeading("Velkommen")
            Text("Sportivista samler når og hvor du kan se sporten du bryr deg om — alt i én rolig liste.")
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)

            // The privacy moment — on-brand, true, trust-building (P350/P360). A
            // native rounded cell with a GREY header (matches Deg/Nyheter), not the
            // retired amber-tracked VERSAL micro-label in a sharp stroke box.
            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("PÅ TELEFONEN DIN")
                Text("Det du følger bor på telefonen din — aldri på en server.")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .onboardingCell()

            // WP-149: push the primary action into the reachable lower third so the
            // screen reads as a deliberate content → action flow, not a jammed top.
            Spacer(minLength: 32)

            VStack(alignment: .leading, spacing: 14) {
                // WP-132: quick-picks is the first build step for everyone.
                Button("Kom i gang") { go(to: .quickPicks) }
                    .buttonStyle(SportivistaPrimaryButtonStyle())

                Button("Hopp over") { onSkip() }
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                    .frame(maxWidth: .infinity)
                    .sportivistaTapTarget()
            }
        }
        // Fill the viewport (minus the 40 pt bottom padding) so the trailing Spacer
        // has room to expand; scrolls normally when large Dynamic Type overflows it.
        .frame(minHeight: max(0, minHeight - 40), alignment: .top)
    }

    // MARK: - Step · Converse (the secondary «fortell med egne ord» path)

    private var converseStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            stepHeading("Fortell meg hva du følger")
            Text(OnboardingExamples.converseIntro)
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

            if let message = assistant.availability.message { unavailableBanner(message) }

            promptLine

            if let error = assistant.errorMessage { errorRow(error) }
            if let tally = assistant.mutationTally { tallyBlock(tally) }
            if !assistant.pending.isEmpty { diffBlock }
            if !assistant.rejected.isEmpty { rejectionsBlock }
            if let explanation = assistant.explanation { explanationBlock(explanation) }

            followingNow

            stepFooter(
                alternative: ("Tilbake til startpakker", "onboarding.backToPacks", { go(to: .quickPicks) }),
                primary: ("Fortsett", "onboarding.continue", { go(to: .ritual) })
            )
        }
    }

    /// The onboarding's inline conversation field — the enthusiast, say-what-you-
    /// follow input. WP-149: a PLAIN native `TextField` in a rounded `cell` field
    /// (no `»_` prompt sigil, no `▌` block cursor), configured exactly like the
    /// assistant ark's field (autocap/autocorrect off for proper nouns). It feeds
    /// the SAME assistant the button opens, so onboarding feels like the app.
    private var promptLine: some View {
        HStack(alignment: .center, spacing: 10) {
            TextField("Skriv hva du følger …", text: $assistant.utterance, axis: .vertical)
                .font(.sportivista(.subheadline))
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .focused($inputFocused)
                .submitLabel(.send)
                // Proper nouns (Bodø/Glimt, Ruud) must not be auto-capitalised or
                // corrected out from under the user — parity with the assistant ark.
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .disabled(assistant.isThinking)
                .onSubmit(submit)
                // WP-70: stable handle for the onboarding converse-step flow.
                .accessibilityIdentifier("onboarding.field")

            if assistant.isThinking {
                HStack(spacing: 8) {
                    BlinkingCursor()
                    Text("tenker …")
                        .font(.sportivista(.footnote))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                    Button("Avbryt") { assistant.cancel() }
                        .font(.sportivista(.caption))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .sportivistaTapTarget()
                }
            } else if !trimmed.isEmpty {
                // Send = the amber primærknapp (matches the assistant ark's field).
                Button(action: submit) {
                    Text("Send")
                        .font(.sportivista(.subheadline, weight: .semibold))
                        .foregroundStyle(SportivistaTokens.accent)
                }
                .accessibilityLabel("Send")
                // WP-70: distinct id (the keyboard's `.send` return key shares the
                // "Send" label) so the onboarding converse flow can tap it.
                .accessibilityIdentifier("onboarding.send")
                .sportivistaTapTarget()
            } else {
                // Empty field: a quiet mic that focuses the field (bringing up the
                // keyboard, whose native dictation mic is the v1 diktering). Never
                // amber — parity with the assistant ark.
                Button { inputFocused = true } label: {
                    Image(systemName: "mic")
                        .font(.sportivista(.subheadline))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                }
                .accessibilityLabel("Diktér")
                .sportivistaTapTarget()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SportivistaTokens.cell, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func submit() {
        guard !trimmed.isEmpty, !assistant.isThinking else { return }
        inputFocused = false
        assistant.run()
    }

    /// WP-65 — the per-clause regnskap for a bulk utterance said during
    /// onboarding ("golf, Hovland, all vintersport …"): what landed and what
    /// wasn't found, in one calm line, so saying several things at once never
    /// hides a dropped clause. Same flow as the always-present assistant.
    private func tallyBlock(_ tally: MutationTally) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("REGNSKAP")
            Text(tally.summary)
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
        .onboardingCell(padding: 12)
    }

    /// The proposal diff — the same before/after language as the assistant ark,
    /// pared down for onboarding: `+`/`±`/`−` in the semantic colours, the entity
    /// + scope + lens subtitle, the reason, and a comfortable Bekreft / Avvis per
    /// row (never glyph-small). WP-149: a neutral rounded `cell` card (the colour
    /// is carried by the leading sign glyph, matching Deg's neutral cells), not a
    /// tinted sharp stroke box.
    private var diffBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("FORSLAG")
            ForEach(assistant.pending) { mutation in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(sign(mutation.kind))
                            .font(.sportivistaTabular(.callout, weight: .bold))
                            .foregroundStyle(color(mutation.kind))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(mutation.entity.name)
                                .font(.sportivista(.subheadline, weight: .bold))
                            Text(mutationSubtitle(mutation))
                                .font(.sportivista(.caption))
                                .foregroundStyle(SportivistaTokens.secondaryLabel)
                        }
                    }
                    HStack(spacing: 10) {
                        Button("Bekreft") { assistant.confirm(mutation) }
                            .font(.sportivista(.footnote, weight: .bold))
                            .foregroundStyle(SportivistaTokens.live)
                            .buttonStyle(SportivistaActionButtonStyle(tint: SportivistaTokens.live))
                        Button("Avvis") { assistant.reject(mutation) }
                            .font(.sportivista(.footnote))
                            .foregroundStyle(SportivistaTokens.secondaryLabel)
                            .buttonStyle(SportivistaActionButtonStyle(tint: SportivistaTokens.label))
                    }
                }
                .onboardingCell(padding: 12)
            }
        }
    }

    /// The honest "IKKE FUNNET" block with tappable «mente du …?» suggestions —
    /// the WP-16.1/16.2 always-explain contract, so the conversation never
    /// dead-ends. Falling back to quick-picks is one line away below.
    private var rejectionsBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("IKKE FUNNET")
            ForEach(assistant.rejected) { rejection in
                VStack(alignment: .leading, spacing: 8) {
                    Text(rejection.explanation)
                        .font(.sportivista(.footnote))
                        .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(rejection.suggestions, id: \.id) { suggestion in
                        Button { assistant.choose(suggestion, for: rejection) } label: {
                            Text("› \(suggestion.name)")
                                .font(.sportivista(.footnote, weight: .bold))
                                .foregroundStyle(SportivistaTokens.accent)
                        }
                        .buttonStyle(SportivistaActionButtonStyle(tint: SportivistaTokens.accent, fullWidth: true))
                    }
                    Button("OK") { assistant.dismissRejection(rejection) }
                        .font(.sportivista(.caption))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .sportivistaTapTarget()
                }
                .onboardingCell(padding: 12)
            }
        }
    }

    private func explanationBlock(_ explanation: AssistantExplanation) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("INGEN ENDRING")
            Text(explanation.understood)
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Text(explanation.reason)
                .font(.sportivista(.caption))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
            Button("Tilbake til startpakker") { go(to: .quickPicks) }
                .font(.sportivista(.caption, weight: .bold))
                .foregroundStyle(SportivistaTokens.accent)
                .sportivistaTapTarget()
        }
        .onboardingCell(padding: 12)
    }

    // MARK: - Step · Quick picks (the first build step, for everyone — WP-132)

    private var quickPicksStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            stepHeading("Velg det du bryr deg om")
            Text(quickPicksIntro)
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                ForEach(StarterPacks.all) { pack in packRow(pack) }
            }

            followingNow

            stepFooter(
                // The say-what-you-follow path is a clearly-secondary entry off
                // this step (Apple-Intelligence-gated), never the primary route.
                alternative: assistant.availability.isAvailable ? ("… eller fortell med egne ord", "onboarding.converseEntry", { go(to: .converse) }) : nil,
                primary: ("Fortsett", "onboarding.continue", { go(to: .ritual) })
            )
        }
    }

    // MARK: - Step · Ritual (WP-202 — brief + varsel-priming + widget)

    /// The ritual step — after the profile exists, before the depth finish. A
    /// follow-list without the ritual is a bookmark, not a habit, so this screen
    /// sells the three parts of the daily rhythm and makes exactly ONE decision:
    /// notifications. The copy primes BEFORE the one-shot iOS system prompt is
    /// spent (must-see reminders + the quiet «briefen er klar» ping — never
    /// results, never spoilers); the widget is an instruction, not a permission
    /// (iOS has no add-widget API). Layout follows the baseline: native cells,
    /// grey section headers, ONE amber primary per screen.
    private var ritualStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            stepHeading("Gjør det til et morgenrituale")
            Text("Hver morgen ligger dagens oversikt klar — når sporten du følger starter, og hvor du kan se den.")
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("VARSLER")
                Text("Et stille varsel før må-se-øyeblikkene dine, og beskjed når morgenbriefen er klar. Aldri resultater, aldri spoilere.")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
                if let ritualOutcome {
                    Text(ritualOutcome)
                        .font(.sportivista(.footnote))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("onboarding.ritual.outcome")
                }
            }
            .onboardingCell()

            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("WIDGET")
                Text("Neste sending rett på Hjem-skjermen: hold på Hjem-skjermen, trykk ⊕ og velg Sportivista.")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .onboardingCell()

            if ritualOutcome == nil {
                // The undecided state: ONE amber primary (the ask), a quiet skip.
                VStack(alignment: .leading, spacing: 12) {
                    Button(isRequestingNotifications ? "Spør …" : "Slå på varsler") { askForNotifications() }
                        .buttonStyle(SportivistaPrimaryButtonStyle())
                        .disabled(isRequestingNotifications)
                        .accessibilityIdentifier("onboarding.ritual.enable")
                    Button("Ikke nå") { go(to: .assistantIntro) }
                        .font(.sportivista(.footnote))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .frame(maxWidth: .infinity)
                        .sportivistaTapTarget()
                        .accessibilityIdentifier("onboarding.continue")
                }
                .padding(.top, 8)
            } else {
                // Decided (either way): the primary continues the flow.
                stepFooter(
                    alternative: nil,
                    primary: ("Fortsett", "onboarding.continue", { go(to: .assistantIntro) })
                )
            }
        }
    }

    /// Ask the system (via the injected shell), let RitualPriming decide what the
    /// answer MEANS, and render its calm status line. The flow never blocks: the
    /// user continues whenever they like, decided or not.
    private func askForNotifications() {
        guard !isRequestingNotifications else { return }
        isRequestingNotifications = true
        Task { @MainActor in
            let granted = await requestNotifications()
            ritualOutcome = RitualPriming.apply(granted: granted)
            isRequestingNotifications = false
        }
    }

    private var quickPicksIntro: String {
        if assistant.availability.isAvailable {
            return "Tapp det du vil følge — du kan velge flere. Du kan endre alt senere, eller fortelle Sportivista med egne ord."
        }
        // Honest degradation: Apple Intelligence is off / unsupported here.
        return "Tapp det du vil følge — du kan velge flere. Alt kan endres senere. (Å fortelle med egne ord krever Apple Intelligence, som ikke er på her — men startpakkene gir deg alt du trenger.)"
    }

    private func packRow(_ pack: StarterPack) -> some View {
        let applied = assistant.isApplied(pack)
        // WP-203: the season-honest line — computed against today, only when
        // EVERYTHING the pack follows is off-season (SeasonCalendar's rule), so
        // «Vintersport» tapped in August says when the board will fill instead
        // of silently promising nothing until November.
        let seasonNote = SeasonCalendar.offSeasonNote(
            sports: pack.rules.map(\.sport),
            month: SeasonCalendar.month(of: Date())
        )
        return Button { assistant.toggleStarterPack(pack) } label: {
            HStack(alignment: .top, spacing: 12) {
                // WP-149: a native selection treatment — an amber `checkmark.circle.fill`
                // when selected (DESIGN «valgt tilstand»), a grey `plus.circle` when not
                // (DESIGN § Ikoner «Følg»). The checkmark IS the whole selection signal
                // (one amber element per row), replacing the amber-tracked VERSAL «VALGT»
                // label. SF Symbols scale with Dynamic Type — no fixed marker frame needed.
                Image(systemName: applied ? "checkmark.circle.fill" : "plus.circle")
                    .font(.sportivista(.title3))
                    .foregroundStyle(applied ? SportivistaTokens.accent : SportivistaTokens.secondaryLabel)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pack.title)
                        .font(.sportivista(.subheadline, weight: .bold))
                        .foregroundStyle(SportivistaTokens.label)
                    Text(pack.subtitle)
                        .font(.sportivista(.caption))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                    if let seasonNote {
                        // Quiet, never a warning colour: honesty, not alarm (WP-203).
                        Text(seasonNote)
                            .font(.sportivista(.caption2))
                            .foregroundStyle(SportivistaTokens.secondaryLabel.opacity(0.8))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .onboardingCell(padding: 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(pack.title). \(pack.subtitle).\(seasonNote.map { " \($0)" } ?? "") \(applied ? "Valgt" : "Legg til")")
        // WP-70: a stable per-pack handle for the quick-picks + rapid-toggle
        // XCUITest flows (the a11y label carries the applied state, so the test
        // needs a state-independent id to tap repeatedly).
        .accessibilityIdentifier("starterpack.\(pack.id)")
    }

    // MARK: - Step · Assistant intro (the calm finish that SHOWS depth — WP-132)

    /// The three tappable examples of DEEP personalisation. Each is a real,
    /// currently-supported arm — a lens scope, an athlete follow, and a scoped
    /// spoiler policy (spoilervern must name a sport/entity; a blanket rule is
    /// ignored by `SpoilerShield`, so it is scoped to F1 here). The first two
    /// are pinned by eval-corpus cases (`intro-*`); all three are honest.
    private var assistantIntroExamples: [(id: String, utterance: String)] {
        [
            ("norske-tdf", "bare de norske i Tour de France"),
            ("alt-warholm", "følg alt Warholm gjør"),
            ("spoiler-f1", "ikke vis F1-resultater før jeg har sett løpet"),
        ]
    }

    private var assistantIntroStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            stepHeading("Gjør Sportivista til din")
            Text("Startpakkene er bare begynnelsen. Fortell Sportivista med egne ord, så skreddersyr den seg — helt ned på detaljnivå. Tapp et eksempel for å prøve.")
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                ForEach(assistantIntroExamples, id: \.id) { example in
                    exampleRow(example.id, example.utterance)
                }
            }

            if !assistant.availability.isAvailable, let message = assistant.availability.message {
                Text(message)
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.label.opacity(0.7))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if assistant.profile.isEmpty {
                Text("Du følger ingenting ennå — det er helt greit. Trykk Assistent når du vil legge til noe.")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                followingNow
            }

            VStack(alignment: .leading, spacing: 14) {
                // «Prøv nå»: finish AND open the assistant (empty) so the user can
                // say anything — the ONE prominent primary action.
                Button("Prøv nå") { onTryAssistant(nil) }
                    .buttonStyle(SportivistaPrimaryButtonStyle())
                    .accessibilityIdentifier("onboarding.tryAssistant")

                // The quiet skip: straight into the (already-filled) agenda.
                Button("Til agendaen") { onFinish() }
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                    .frame(maxWidth: .infinity)
                    .sportivistaTapTarget()
                    .accessibilityIdentifier("onboarding.toAgenda")
            }
            .padding(.top, 4)
        }
    }

    /// One tappable deep-personalisation example — the quoted utterance in a calm
    /// native rounded row (≥44pt) with a trailing chevron (WP-149: the leading `»`
    /// Tekst-TV sigil is gone). A tap finishes onboarding and opens the assistant
    /// with the phrase pre-filled, so the user sees exactly how it is said.
    private func exampleRow(_ id: String, _ utterance: String) -> some View {
        Button { onTryAssistant(utterance) } label: {
            HStack(alignment: .center, spacing: 10) {
                Text("«\(utterance)»")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.sportivista(.footnote, weight: .semibold))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .onboardingCell(padding: 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Prøv: \(utterance)")
        .accessibilityIdentifier("onboarding.example.\(id)")
    }

    // MARK: - Shared pieces

    /// The growing "Følger nå" list — the visible feedback that saying a thing
    /// (typed or tapped) landed, exactly the same profile the agenda compiles
    /// against. WP-149: a native rounded `cell` card with a grey header.
    @ViewBuilder
    private var followingNow: some View {
        if !assistant.profile.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionLabel("FØLGER NÅ (\(assistant.profile.rules.count))")
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(assistant.profile.rules) { rule in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•")
                                .font(.sportivista(.footnote, weight: .bold))
                                .foregroundStyle(SportivistaTokens.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(rule.entityName)
                                    .font(.sportivista(.subheadline, weight: .bold))
                                Text(ruleSubtitle(rule))
                                    .font(.sportivista(.caption2))
                                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                            }
                        }
                    }
                }
            }
            .onboardingCell(padding: 12)
        }
    }

    private func stepFooter(
        alternative: (label: String, id: String, action: () -> Void)?,
        primary: (label: String, id: String, action: () -> Void)
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let alternative {
                Button(alternative.label) { alternative.action() }
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                    .frame(maxWidth: .infinity)
                    .sportivistaTapTarget()
                    .accessibilityIdentifier(alternative.id)
            }
            Button(primary.label) { primary.action() }
                .buttonStyle(SportivistaPrimaryButtonStyle())
                .accessibilityIdentifier(primary.id)
        }
        .padding(.top, 8)
    }

    private func stepHeading(_ text: String) -> some View {
        Text(text)
            .font(.sportivista(.title3, weight: .bold))
            .foregroundStyle(SportivistaTokens.label)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A native section header — GREY (`secondaryLabel`), `.footnote` semibold, no
    /// letter-tracking. Matches Deg's `groupHeader` and Nyheter's `sectionHeader`
    /// exactly (WP-149: replaces the retired amber/`opacity(0.5)`-tracked VERSAL label).
    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.sportivista(.footnote, weight: .semibold))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
    }

    private func unavailableBanner(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("APPLE INTELLIGENCE")
            Text(message)
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.label.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)
            Button("Tilbake til startpakker") { go(to: .quickPicks) }
                .font(.sportivista(.caption, weight: .bold))
                .foregroundStyle(SportivistaTokens.accent)
                .sportivistaTapTarget()
        }
        .onboardingCell()
    }

    private func errorRow(_ error: String) -> some View {
        Text(error)
            .font(.sportivista(.footnote))
            .foregroundStyle(SportivistaTokens.destructive)
    }

    private func go(to next: OnboardingStep) {
        inputFocused = false
        if reduceMotion {
            step = next
        } else {
            withAnimation(.easeOut(duration: 0.15)) { step = next }
        }
    }

    // MARK: - Formatting

    private func sign(_ kind: MutationKind) -> String {
        switch kind {
        case .add: return "+"
        case .update: return "±"
        case .remove: return "−"
        }
    }

    private func color(_ kind: MutationKind) -> Color {
        switch kind {
        case .add: return SportivistaTokens.live
        case .update: return SportivistaTokens.accent
        case .remove: return SportivistaTokens.destructive
        }
    }

    private func mutationSubtitle(_ mutation: GroundedMutation) -> String {
        var parts = [SportVocabulary.display(for: mutation.entity.sport)]
        if let scope = mutation.scope, !scope.isEmpty { parts.append(scope) }
        if mutation.kind != .remove, !mutation.lens.isDefault { parts.append(mutation.lens.label) }
        return parts.joined(separator: " · ")
    }

    private func ruleSubtitle(_ rule: InterestRule) -> String {
        var parts = [SportVocabulary.display(for: rule.sport)]
        if let scope = rule.scope, !scope.isEmpty { parts.append(scope) }
        if !rule.lens.isDefault { parts.append(rule.lens.label) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Native rounded cell (the Deg/Nyheter surface)

private extension View {
    /// A native rounded 12 pt `cell` surface (the Deg/Nyheter cell expression) — the
    /// WP-149 replacement for the retired Tekst-TV hairline `Rectangle().stroke` box.
    /// Content is padded and laid on the `cell` token over the grouped `background`,
    /// exactly like an inset-grouped list row. No stroke: the fill-vs-background
    /// contrast IS the card, matching Deg.
    func onboardingCell(padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SportivistaTokens.cell, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

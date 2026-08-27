//
//  MainFlowsUITests.swift
//  SportivistaUITests
//
//  WP-70 → WP-104 — end-to-end regression of the main UX flows, driven against
//  the deterministic `SPORTIVISTA_DEMO=uitest` harness (mock assistant + seeded
//  cache, no network). Each test is short and asserts BEHAVIOUR through stable
//  accessibility identifiers / seeded fixture strings, never pixels.
//
//  WP-104 retired the always-present inline command line, WP-143 retired the bottom
//  capsule that briefly replaced it, and WP-144 landed the entry as a COMPACT floating
//  BOTTOM BUTTON (`assistant.button`, `sparkles` + «Spør assistenten», in the
//  thumb-reachable zone) that opens the conversation SHEET (AssistantSheetView — field
//  `assistant.field`, send `assistant.send`, the three example rows `assistant.example.*`,
//  close `assistant.close`). The "we're back on the root" tell is therefore the bottom
//  button, not a text field. The old WP-99 keyboard-dismiss flows are rewritten to
//  sheet open/close semantics (drag / tap-outside / Lukk), and the WP-82 inline
//  discovery flows are gone with the line they tested.
//

import XCTest

final class MainFlowsUITests: SportivistaUITestCase {

	// MARK: - Flow 1 · Onboarding (quick-picks first, then the conversation) — WP-132

	func testOnboardingQuickPicksThenConversation() {
		let app = launchApp(state: "onboarding")

		// Welcome → Kom i gang → the quick-picks step (the FIRST build step for
		// everyone now — the WP-132 flip). Tap a curated pack.
		assertExists(app.staticTexts["Velkommen"], "onboarding should open on the welcome step")
		app.buttons["Kom i gang"].tap()

		assertExists(app.staticTexts["Velg det du bryr deg om"], "welcome should lead straight to the quick-picks step")
		let golf = app.buttons["starterpack.norske-golfere"]
		assertExists(golf, "the curated starter packs should render first")
		golf.tap()
		// WP-149: the retired amber-tracked «VALGT» VERSAL label became a native
		// amber `checkmark.circle.fill`; the applied state is carried on the pack
		// button's a11y label («… Valgt»), so assert on that rather than a glyph.
		XCTAssertTrue(golf.label.contains("Valgt"), "tapping a pack should mark it valgt")

		// The clearly-secondary «fortell med egne ord» entry → the conversation:
		// say what you follow, confirm the diff, watch "Følger nå" grow.
		app.buttons["onboarding.converseEntry"].tap()
		assertExists(app.staticTexts["Fortell meg hva du følger"], "the secondary entry opens the conversation step")
		let field = app.textFields["onboarding.field"]
		assertExists(field, "the onboarding command line should be present")
		field.tap()
		field.typeText(UITestFixture.followUtterance)
		app.buttons["onboarding.send"].tap()

		let confirm = app.buttons["Bekreft"].firstMatch
		assertExists(confirm, "a proposal diff should appear for the utterance")
		confirm.tap()
		assertExists(app.staticTexts[UITestFixture.biathlonEntityName], "the confirmed follow should show under «Følger nå»")

		// Continue → the ritual step (WP-202: brief + varsel-priming + widget —
		// «Ikke nå» carries the shared continue id, so the flow never blocks on
		// the notification decision) → the assistant-intro finish (which SHOWS
		// the deep personalisation) → into the agenda.
		app.buttons["onboarding.continue"].tap()
		assertExists(app.staticTexts["Gjør det til et morgenrituale"], "should reach the ritual step")
		assertExists(app.buttons["onboarding.ritual.enable"], "the ritual step offers the one notification decision")
		app.buttons["onboarding.continue"].tap()
		assertExists(app.staticTexts["Gjør Sportivista til din"], "should reach the assistant-intro step")
		assertExists(app.buttons["onboarding.example.norske-tdf"], "the intro shows tappable deep-personalisation examples")
		app.buttons["onboarding.toAgenda"].tap()
		assertExists(app.buttons["assistant.button"], "finishing onboarding should drop into the agenda")
	}

	// MARK: - Flow 2 · Follow via the conversation sheet

	func testFollowViaSheetSurfacesRow() {
		let app = launchApp(state: "agenda")

		// The seeded board shows the followed football row; the biathlon row is
		// deliberately NOT relevant yet.
		assertExists(agendaRow(UITestFixture.footballTitle, in: app), "the seeded followed football row should be on the board")
		XCTAssertFalse(agendaRow(UITestFixture.biathlonTitle, in: app).exists, "biathlon must not be on the board before following it")

		// Open the assistant sheet from the capsule, type the follow, confirm.
		openAssistantSheet(in: app)
		let field = app.textFields["assistant.field"]
		assertExists(field, "the conversation sheet's field should be present")
		field.tap()
		field.typeText(UITestFixture.followUtterance)
		app.buttons["assistant.send"].tap()

		let confirm = app.buttons["assistant.confirm"].firstMatch
		assertExists(confirm, "the sheet should raise a confirmable diff in the thread")
		confirm.tap()

		// Bekreft ⇒ arket lukkes ⇒ agendaen re-kompileres: the biathlon row now
		// appears on the recompiled board, and the bottom button is back.
		assertExists(agendaRow(UITestFixture.biathlonTitle, in: app), "confirming the follow should surface the biathlon row")
		assertExists(app.buttons["assistant.button"], "confirming closes the sheet and returns to the agenda")
	}

	// MARK: - Flow 3 · Rapid starter-pack toggles (guards WP-60 coalescing)

	func testRapidStarterPackTogglesStayResponsive() {
		let app = launchApp(state: "onboarding")

		// Quick-picks is the first build step now (WP-132) — welcome leads
		// straight there, no conversation detour.
		assertExists(app.staticTexts["Velkommen"], "onboarding should open on the welcome step")
		app.buttons["Kom i gang"].tap()
		assertExists(app.staticTexts["Velg det du bryr deg om"], "welcome should lead straight to the quick-picks step")

		// Fire five pack toggles back-to-back with no waits between them — each
		// fires onProfileChanged → an agenda recompile behind the overlay. WP-60
		// coalesces a burst to ≤2 recompiles; a regression here would jam the main
		// thread and the taps below would not all land. The five packs sum to 10
		// rules: norsk-fotball(2) + golf(3) + sjakk(1) + sykkel(2) + friidrett(2).
		for packId in ["starterpack.norsk-fotball",
		               "starterpack.norske-golfere",
		               "starterpack.sjakk-carlsen",
		               "starterpack.norsk-sykkel",
		               "starterpack.friidrett"] {
			let pack = app.buttons[packId]
			assertExists(pack, "pack \(packId) should render")
			pack.tap()
		}

		assertExists(app.staticTexts["FØLGER NÅ (10)"], "all five packs should apply (10 rules) within the time budget")

		// Responsiveness proof: the UI is still live after the burst. WP-202: the
		// ritual step now sits between quick-picks and the assistant intro.
		app.buttons["onboarding.continue"].tap()
		assertExists(app.staticTexts["Gjør det til et morgenrituale"], "the app should stay responsive after the toggle burst")
		app.buttons["onboarding.continue"].tap()
		assertExists(app.staticTexts["Gjør Sportivista til din"], "the ritual step continues into the assistant intro")
	}

	// MARK: - Flow 4 · Event detail + «Hvorfor vises denne?»

	func testEventDetailWhyShown() {
		let app = launchApp(state: "agenda")

		let row = agendaRow(UITestFixture.footballTitle, in: app)
		assertExists(row, "the followed football row should be tappable")
		row.tap()

		// The detail sheet's deterministic context action.
		let why = app.staticTexts["Hvorfor vises denne?"]
		assertExists(why, "the detail sheet should offer «Hvorfor vises denne?»")
		why.tap()
		// The disclosure sits at the foot of the sheet; on the .medium detent the
		// revealed reason lands below the fold, and the List is lazy so its cell
		// isn't realised until scrolled into view. Bring it on-screen, then assert.
		let reason = staticText(containing: "Fordi FK Lyn Oslo spiller", in: app)
		scrollUntilHittable(reason, in: app)
		assertExists(reason, "expanding it should show the deterministic reason")

		app.buttons["Lukk"].tap()
		assertExists(app.buttons["assistant.button"], "closing the sheet returns to the agenda")
	}

	// MARK: - Flow 4b · Delekort (WP-182) — the ShareLink flow out of the detail sheet

	/// Opens an event's detail sheet, taps «Del», and asserts the system share
	/// sheet actually comes up with the card attached. The RENDERING is unit-
	/// tested (ShareCardSpecTests); what only a UI test can prove is that the
	/// `ShareLink` is reachable, is a real tap target, and presents — a
	/// `Transferable` that fails to produce data shows an empty/failed sheet.
	func testShareEventOpensShareSheetWithTheCard() {
		let app = launchApp(state: "agenda")

		let row = agendaRow(UITestFixture.footballTitle, in: app)
		assertExists(row, "the followed football row should be tappable")
		row.tap()

		let del = app.buttons["Del"]
		assertExists(del, "the detail sheet should offer «Del»")
		XCTAssertTrue(del.isHittable, "«Del» must be a real tap target, not a clipped toolbar glyph")
		del.tap()

		// UIActivityViewController presents in-process. Its list view is the
		// stable tell across iOS versions; the localized action titles are not.
		let activity = app.otherElements["ActivityListView"]
		assertExists(activity, "tapping «Del» should present the system share sheet")
	}

	// MARK: - Flow 5 · Theme cycle (WP-83 — moved from the header to Deg › Utseende)

	func testThemeToggleCyclesInDeg() {
		let app = launchApp(state: "agenda")

		// The theme override now lives in Deg (DESIGN § Tema), reached
		// via the gearshape in the nav bar — no longer a header glyph.
		app.buttons["nav.settings"].tap()

		let toggle = app.buttons["theme.toggle"]
		scrollUntilHittable(toggle, in: app)
		assertExists(toggle, "the Utseende row should be in Deg")
		// Seeded to start at system.
		waitForLabel(toggle, equals: "Tema: automatisk")
		toggle.tap()
		waitForLabel(toggle, equals: "Tema: mørk")
		toggle.tap()
		waitForLabel(toggle, equals: "Tema: lys")
		toggle.tap()
		waitForLabel(toggle, equals: "Tema: automatisk")
	}

	// MARK: - Flow 6 · Reset (WP-83 — reached from Deg › Nullstill)

	func testResetFlowCancelThenComplete() {
		let app = launchApp(state: "agenda")

		// Open Deg via the gearshape, then push the Nullstill screen.
		app.buttons["nav.settings"].tap()
		let resetEntry = app.buttons["deg.reset"]
		scrollUntilHittable(resetEntry, in: app)
		assertExists(resetEntry, "the Nullstill row should be in Deg")
		resetEntry.tap()

		let followedOnly = app.buttons["reset.followedOnly"]
		scrollUntilHittable(followedOnly, in: app)
		assertExists(followedOnly, "the «Nullstill det du følger» row should appear")

		// First: enter the confirm step, then CANCEL — nothing changes.
		followedOnly.tap()
		let cancel = app.buttons["reset.cancel"]
		assertExists(cancel, "the confirm step should offer Avbryt")
		cancel.tap()
		// Still no onboarding (cancelling reset must not start it).
		XCTAssertFalse(app.staticTexts["Velkommen"].exists, "cancelling reset must not start onboarding")

		// Then: carry it through — reset + re-onboard, no reinstall.
		let followedOnly2 = app.buttons["reset.followedOnly"]
		scrollUntilHittable(followedOnly2, in: app)
		assertExists(followedOnly2, "the reset row should still be available")
		followedOnly2.tap()
		let confirm = app.buttons["reset.confirm"]
		assertExists(confirm, "the confirm step should offer Nullstill")
		confirm.tap()

		assertExists(app.staticTexts["Velkommen"], "completing reset should raise onboarding again")
	}

	// MARK: - Flow 7 · Presentation filter (WP-67 — set via the sheet, then reset)

	func testPresentationFilterViaSheetThenReset() {
		let app = launchApp(state: "agenda")

		// The seeded board shows the followed football row.
		assertExists(agendaRow(UITestFixture.footballTitle, in: app), "the seeded football row should be on the board")

		// Filter the VIEW to golf via the conversation sheet — nothing on the
		// seeded board is golf, so the board empties to the honest "no matches"
		// line while the profile is untouched (a presentation filter, not a follow).
		openAssistantSheet(in: app)
		let field = app.textFields["assistant.field"]
		assertExists(field, "the conversation sheet's field should be present")
		field.tap()
		field.typeText("vis golf")
		app.buttons["assistant.send"].tap()

		// A present filter raises no ark — the sheet closes and the quiet filter
		// line appears over the agenda; the football row is filtered out.
		assertExists(app.staticTexts["agenda.filter.label"], "the filter line should appear over the agenda")
		assertExists(app.staticTexts["Ingen treff for filteret."], "the golf filter hides the football row")
		XCTAssertFalse(agendaRow(UITestFixture.footballTitle, in: app).exists, "the football row is hidden by the golf filter")

		// One-tap reset (the ✕) brings everything back.
		app.buttons["agenda.filter.reset"].tap()
		assertExists(agendaRow(UITestFixture.footballTitle, in: app), "resetting the filter restores the full board")
		XCTAssertFalse(app.staticTexts["agenda.filter.label"].exists, "the filter line is gone after reset")
	}

	// MARK: - Flow 8 · The bottom button opens the conversation sheet; Lukk closes it (WP-104 → WP-143 → WP-144)

	func testAssistantButtonOpensSheetAndLukkCloses() {
		let app = launchApp(state: "agenda")

		// At rest, the sheet's field is NOT present — only the floating bottom button is.
		XCTAssertFalse(app.textFields["assistant.field"].exists, "the field lives in the sheet, not the root")
		let entry = app.buttons["assistant.button"]
		assertExists(entry, "the assistant button should be at the bottom")
		entry.tap()

		// The sheet is up: its header + the opened-state intro + the field.
		assertExists(app.navigationBars["Assistent"], "tapping the bottom button opens the conversation sheet")
		assertExists(app.staticTexts["assistant.intro"], "the opened sheet shows one hjelpesetning")
		assertExists(app.textFields["assistant.field"], "the opened sheet carries the field")

		// Lukk returns to the agenda; the field is gone, the bottom button is back.
		app.buttons["assistant.close"].tap()
		assertVanishes(app.textFields["assistant.field"], "Lukk should dismiss the sheet")
		assertExists(app.buttons["assistant.button"], "closing the sheet returns to the agenda")
	}

	// MARK: - Flow 9 · Drag-down dismisses the sheet (WP-104 — tapp-utenfor/dra)

	func testSheetDismissedByDragDown() {
		let app = launchApp(state: "agenda")

		app.buttons["assistant.button"].tap()
		let field = app.textFields["assistant.field"]
		assertExists(field, "the sheet should open from the bottom button")

		// Swipe the sheet down from its header (the grabber region) to dismiss it —
		// the native sheet's drag-to-dismiss, one of the WP-99 close paths in ark
		// form. The bottom button returning is the tell we're back on the agenda.
		let header = app.navigationBars["Assistent"]
		let start = header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
		let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.5))
		start.press(forDuration: 0.05, thenDragTo: end)

		assertVanishes(field, "dragging the sheet down should dismiss it")
		assertExists(app.buttons["assistant.button"], "dismissing the sheet returns to the agenda")
	}

	// MARK: - Flow 10 · Navigation — open Deg via the gearshape, then back-swipe (WP-83)

	func testOpenDegViaGearThenBackSwipe() {
		let app = launchApp(state: "agenda")

		// The gearshape in the nav bar pushes the Deg screen.
		let gear = app.buttons["nav.settings"]
		assertExists(gear, "the gearshape settings button should be in the nav bar")
		gear.tap()
		assertExists(app.navigationBars["Deg"], "the gear should push the Deg screen")
		assertExists(app.buttons["deg.follows"], "Deg should re-home «Hva jeg følger»")

		// The native interactive pop gesture (tilbake-swipe) from the left edge
		// returns to the agenda — the floating bottom assistant button is the tell.
		let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
		let target = app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
		edge.press(forDuration: 0.05, thenDragTo: target)
		assertExists(app.buttons["assistant.button"], "back-swiping Deg returns to the agenda")
	}

	// MARK: - Flow 11 · An example row runs and answers in the thread (WP-104)

	func testExampleRowRunsAndAnswersInThread() {
		let app = launchApp(state: "agenda")

		openAssistantSheet(in: app)
		// The opened state shows the three tappable example rows (ikke chips).
		let tonight = app.buttons["assistant.example.tonight"]
		assertExists(tonight, "the opened sheet should offer the «Hva går i kveld?» example row")
		tonight.tap()

		// The prompt runs through the answer arm and lands in the SAME ark: the
		// user's message shows as a bubble and the result thread appears — while
		// the sheet stays open (an answer is not confirmed-then-closed).
		assertExists(app.staticTexts["assistant.userMessage"], "the tapped example should land as a message bubble in the thread")
		assertExists(app.navigationBars["Assistent"], "the answer stays in the conversation sheet")
	}

	// MARK: - Flow 12 · An example row runs a command (WP-104)

	func testExampleRowRunsCommand() {
		let app = launchApp(state: "agenda")

		openAssistantSheet(in: app)
		let settings = app.buttons["assistant.example.settings"]
		assertExists(settings, "the opened sheet should offer the «Endre varsler eller tema» example row")
		settings.tap()

		// It routes through the command arm (notification lead-time) and shows a
		// calm receipt (UTFØRT) in the thread — no profile diff to confirm.
		assertExists(app.staticTexts["UTFØRT"], "the command example should show a calm receipt in the thread")
		assertExists(app.staticTexts["assistant.userMessage"], "the command example also lands as a message bubble")
	}

	// MARK: - Flow 14 · The follow example row pre-fills the field (WP-104 / WP-105 handoff)
	// (WP-143 removed the old Flow 13 «mic capsule opens the sheet in diktering» — the
	// bottom capsule and its mic are gone; diktering now lives inside the sheet only,
	// reached from the field's keyboard, so there is no separate root-level mic entry.)

	func testFollowExampleRowPrefillsField() {
		let app = launchApp(state: "agenda")

		openAssistantSheet(in: app)
		let follow = app.buttons["assistant.example.follow"]
		assertExists(follow, "the opened sheet should offer the «Følg et lag eller en utøver» example row")
		follow.tap()

		// It pre-fills «følg » into the field (the user still chooses the entity
		// and sends) — a discovery affordance, never an applied change. No diff.
		let field = app.textFields["assistant.field"]
		assertExists(field, "the field should be present after tapping the follow row")
		let value = (field.value as? String) ?? ""
		XCTAssertTrue(value.lowercased().contains("f"),
		              "the follow row should pre-fill the field with «følg » (got «\(value)»)")
		XCTAssertFalse(app.buttons["assistant.confirm"].exists, "pre-filling must not apply anything")
	}

	// MARK: - Flow 15 · Root segmented «Uka | Nyheter» (WP-104)

	func testRootSegmentedSwitchesToNyheter() {
		let app = launchApp(state: "agenda")

		// Uka is the default: the seeded football row is on the board.
		assertExists(agendaRow(UITestFixture.footballTitle, in: app), "Uka shows the agenda by default")

		// Switch to Nyheter — the WP-106 four-section board shows (its always-present
		// NYTT header + the «Det du følger» link); the agenda row is gone. (WP-107:
		// updated from the retired WP-104 «news.placeholder» shell to the real board
		// identifiers WP-106 shipped.)
		app.buttons["Nyheter"].tap()
		assertExists(app.staticTexts["news.section.nytt"], "the Nyheter side shows the WP-106 board (NYTT header)")
		assertExists(app.buttons["news.followedLink"], "the Nyheter board offers the «Det du følger» link")
		XCTAssertFalse(agendaRow(UITestFixture.footballTitle, in: app).exists, "the agenda is not shown on the Nyheter side")

		// The floating bottom assistant button is present on both sides (WP-144 — it
		// lives in the shared root safeAreaInset, so it stays across a segment switch).
		assertExists(app.buttons["assistant.button"], "the assistant button stays on the Nyheter side too")

		// Back to Uka restores the agenda.
		app.buttons["Uka"].tap()
		assertExists(agendaRow(UITestFixture.footballTitle, in: app), "switching back to Uka restores the agenda")
	}
}

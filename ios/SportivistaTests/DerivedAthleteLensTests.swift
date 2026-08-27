//
//  DerivedAthleteLensTests.swift
//  SportivistaTests
//
//  WP-249 — «å følge en utøver betyr: vis meg når HAN spiller».
//
//  The owner's complaint (27.08.2026): "det er for vanskelig å se når
//  Hovland/Reitan slår ut". The data was never the problem — TOUR Championship
//  in docs/data/events.json carries both tee times — but an ordinary «Følg
//  Viktor Hovland» tap leaves the rule on the DEFAULT lens, so
//  `AgendaViewModel.applicableLensMode` returned `.sportAsSuch`, LensRenderer
//  declined, and the board showed the tournament's nominal 04:00-window row.
//
//  These tests pin the fix: the lens is now DERIVED from participation when the
//  rule carries no explicit one. The event below is the REAL TOUR Championship
//  record (times, tee times, ids copied verbatim from events.json on 27.08.2026)
//  so the acceptance criterion is encoded literally — but against a fixed clock,
//  so it keeps holding after the tournament is over.
//
//  They also pin the three guards that keep the derivation narrow: athletes
//  only, only when the data actually knows his time, and never over an explicit
//  lens — plus the standing degradation guarantee that an unrelated (or empty)
//  profile leaves the board byte-identical.
//

import XCTest

final class DerivedAthleteLensTests: XCTestCase {

	private let index = AssistantTestSupport.liveIndex()

	private func iso(_ s: String) -> Date {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime]
		return f.date(from: s)!
	}

	private func allEventRows(_ sections: [AgendaSection]) -> [AgendaEventRow] {
		sections.flatMap { $0.items }.compactMap { if case .event(let r) = $0 { return r } else { return nil } }
	}

	/// A profile following `id` exactly the way a «Følg»-tap builds it: the
	/// direct-follow path (AssistantViewModel.follow → InterestProfile.applying)
	/// with NO lens — i.e. `lens == .sportAsSuch`, the case that used to lose.
	private func follow(_ ids: String...) -> InterestProfile {
		ids.reduce(InterestProfile()) { profile, id in
			profile.applying(GroundedMutation(
				kind: .add, entity: index.entity(id: id)!, scope: nil,
				weight: InterestProfile.defaultWeight, reason: "Du valgte å følge dette.",
				previousRule: nil
			), now: iso("2026-08-01T00:00:00Z"))
		}
	}

	/// TOUR Championship as published on 27.08.2026 — a four-day window starting
	/// 04:00 UTC with Hovland teeing off 15:24 UTC (Oslo 17:24) and Reitan 16:06
	/// UTC (Oslo 18:06).
	private func tourChampionship(teeTimes: Bool = true) -> Event {
		var hovland: [String: Any] = ["name": "Viktor Hovland", "entityId": "viktor-hovland"]
		var reitan: [String: Any] = ["name": "Kristoffer Reitan", "entityId": "kristoffer-reitan"]
		if teeTimes {
			hovland["teeTimeUTC"] = "2026-08-27T15:24:00Z"
			reitan["teeTimeUTC"] = "2026-08-27T16:06:00Z"
		}
		return EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-27T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", tournament: "PGA Tour",
			streaming: [["platform": "HBO Max (Sport)"]], norwegian: true,
			norwegianPlayers: [hovland, reitan]
		)
	}

	private func football() -> Event {
		EventBuilder.make(
			sport: "football", title: "Lyn – Sogndal", time: "2026-08-27T18:00:00Z",
			homeTeam: "Lyn", awayTeam: "Sogndal", streaming: [["platform": "TV 2 Play"]]
		)
	}

	private let now = ISO8601DateFormatter().date(from: "2026-08-27T06:00:00Z")!

	/// The board a plain broad golf follow produces — the "before" every
	/// degradation test compares against. Same `index`/`followedIds` as the
	/// profile runs, so the PROFILE is the only difference.
	private func baseline(_ events: [Event], interests: Interests) -> [AgendaSection] {
		AgendaViewModel.buildSections(
			events: events, interests: interests, now: now,
			index: index, followedIds: [], profile: InterestProfile()
		)
	}

	// MARK: - The acceptance: following Hovland shows HIS time

	func testFollowingHovland_showsHisTeeTime_notTheTournamentWindow() {
		let event = tourChampionship()

		// Before: nothing but the tournament's own multi-day window.
		let before = allEventRows(baseline([event], interests: Interests(followBroadly: ["golf"])))
		XCTAssertEqual(before.count, 1)
		XCTAssertTrue(before[0].timeLabel.contains("–"), "the plain row is a 27.–30. window, not a clock")

		// After: a profile that follows Viktor Hovland — no lens set anywhere,
		// exactly what a «Følg»-tap produces — compiled the way the app does it
		// (the profile also speaks for `interests`, via EffectiveInterests).
		let profile = follow("viktor-hovland")
		let sections = AgendaViewModel.buildSections(
			events: [event],
			interests: EffectiveInterests.merge(profile: profile, into: Interests(), index: index),
			now: now, index: index, followedIds: ["viktor-hovland"], profile: profile
		)
		let rows = allEventRows(sections)
		XCTAssertEqual(rows.count, 1, "one row — his")
		XCTAssertEqual(rows[0].timeLabel, "17:24", "his own tee time owns the time column")
		XCTAssertTrue(rows[0].title.contains("Hovland teer av"), "got: \(rows[0].title)")
		XCTAssertEqual(rows[0].event.title, "TOUR Championship", "the detail sheet still sees the whole event")
		XCTAssertEqual(sections.first?.label, "I DAG")
	}

	func testFollowingBothNorwegians_givesOneRowPerTeeTime() {
		let profile = follow("viktor-hovland", "kristoffer-reitan")
		let sections = AgendaViewModel.buildSections(
			events: [tourChampionship()],
			interests: EffectiveInterests.merge(profile: profile, into: Interests(), index: index),
			now: now, index: index, followedIds: [], profile: profile
		)
		let rows = allEventRows(sections)
		XCTAssertEqual(rows.count, 2, "two followed golfers, two tee times, two rows")
		XCTAssertEqual(rows.map(\.timeLabel), ["17:24", "18:06"], "sorted by tee time")
		XCTAssertTrue(rows[0].title.contains("Hovland"))
		XCTAssertTrue(rows[1].title.contains("Reitan"))
	}

	func testFollowingOneOfTwo_leavesTheOtherOut() {
		let profile = follow("kristoffer-reitan")
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [tourChampionship()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [], profile: profile
		))
		XCTAssertEqual(rows.count, 1)
		XCTAssertEqual(rows[0].timeLabel, "18:06")
		XCTAssertFalse(rows.contains { $0.title.contains("Hovland") }, "an unfollowed golfer gets no row of his own")
	}

	func testTeeTimeOnALaterDay_reHomesTheRowToThatDay() {
		// Round 2: his tee time is tomorrow, the tournament started today.
		let event = EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-27T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", norwegian: true,
			norwegianPlayers: [["name": "Viktor Hovland", "entityId": "viktor-hovland",
			                    "teeTimeUTC": "2026-08-28T15:24:00Z"]]
		)
		let sections = AgendaViewModel.buildSections(
			events: [event], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [], profile: follow("viktor-hovland")
		)
		XCTAssertEqual(sections.count, 1)
		XCTAssertEqual(sections[0].id, "2026-08-28")
		XCTAssertEqual(sections[0].label, "I MORGEN")
		XCTAssertEqual(allEventRows(sections).first?.timeLabel, "17:24")
	}

	// MARK: - It works before the entity index has synced

	func testUnknownEntityIndex_theEventsOwnPlayerListIsProofEnough() {
		// A device whose entities.json hasn't landed yet: the index knows
		// nothing, but the event's `norwegianPlayers` carries the followed id —
		// an athlete list by construction, so the lens still fires.
		let profile = InterestProfile(rules: [InterestRule(
			entityId: "viktor-hovland", entityName: "Viktor Hovland", sport: "golf",
			weight: 0.5, reason: "Du valgte å følge dette.", addedAt: iso("2026-08-01T00:00:00Z")
		)])
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [tourChampionship()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: EntityIndex([]), followedIds: [], profile: profile
		))
		XCTAssertEqual(rows.count, 1)
		XCTAssertEqual(rows[0].timeLabel, "17:24")
	}

	// MARK: - Guard 1: athletes only

	func testBroadSportFollow_neverDerivesTheAthleteLens() {
		// «Følg golf» is a SPORT-level rule. It must keep producing the calm
		// multi-day window row — not two athlete rows.
		let events = [tourChampionship()]
		let interests = Interests(followBroadly: ["golf"])
		XCTAssertEqual(
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: [], profile: follow("sport-golf")),
			baseline(events, interests: interests),
			"a whole-sport follow renders exactly as before"
		)
	}

	func testTournamentFollow_neverDerivesTheAthleteLens() {
		let events = [tourChampionship()]
		let interests = Interests(followBroadly: ["golf"])
		XCTAssertEqual(
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: [], profile: follow("fedexcup-playoffs")),
			baseline(events, interests: interests),
			"a tournament follow renders exactly as before"
		)
	}

	func testTeamFollow_neverDerivesTheAthleteLens() {
		let events = [football()]
		let interests = Interests(followBroadly: ["football"])
		XCTAssertEqual(
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: [], profile: follow("fk-lyn-oslo")),
			baseline(events, interests: interests),
			"a club follow renders exactly as before"
		)
	}

	// MARK: - Guard 2: only when the data actually knows his time

	func testAthleteFollow_withoutTeeTimes_keepsTheOrdinaryRow() {
		// The common golf case (tee times are published only once a round is
		// imminent) and every sport with no per-athlete timing at all: there is
		// no «når spiller han» to answer, so the board is untouched. No
		// fabricated clock, no cosmetic rewrite.
		let events = [tourChampionship(teeTimes: false)]
		let interests = Interests(followBroadly: ["golf"])
		XCTAssertEqual(
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: [], profile: follow("viktor-hovland")),
			baseline(events, interests: interests),
			"no per-athlete time ⇒ the ordinary row stands"
		)
	}

	func testAthleteFollow_leavesEveryOtherEventAlone() {
		let events = [tourChampionship(), football()]
		let interests = Interests(followBroadly: ["golf", "football"])
		let lensed = AgendaViewModel.buildSections(
			events: events, interests: interests, now: now,
			index: index, followedIds: [], profile: follow("viktor-hovland")
		)
		let plainRows = allEventRows(baseline(events, interests: interests))
		let footballBefore = plainRows.first { $0.event.sport == "football" }
		let footballAfter = allEventRows(lensed).first { $0.event.sport == "football" }
		XCTAssertNotNil(footballAfter)
		XCTAssertEqual(footballAfter, footballBefore, "a golf follow never touches a football row")
	}

	// MARK: - Guard 3: an explicit lens still wins

	func testExplicitLensWinsOverTheDerivedOne() {
		// A `.throughNorwegians` rule on Reitan matches the event, so ALL the
		// Norwegians in it are the focus — the derived «only the athletes you
		// follow» narrowing must not override a lens the user chose.
		var profile = follow("kristoffer-reitan")
		profile.rules = profile.rules.map { rule in
			var r = rule
			r.lens = .throughNorwegians
			return r
		}
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [tourChampionship()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [], profile: profile
		))
		XCTAssertEqual(rows.count, 2, "the explicit lens shows every Norwegian, not just the followed one")
		XCTAssertTrue(rows.contains { $0.title.contains("Hovland") })
	}

	// MARK: - The time column may never show a clock from another day
	//
	// `place` refuses to re-home a row onto a day that has already passed («a
	// STALE, past tee time must never silently drop the whole event»). The time
	// LABEL used to be derived from the very same `effectiveTime` WITHOUT that
	// guard, so a frozen tournament put YESTERDAY's clock in today's time column
	// — the product's face (DESIGN.md § Display-font) telling a lie (Grunnlov 3).
	// This is production-reachable, not theoretical: `retainLastGood` re-serves a
	// frozen source file on an empty fetch (football.json once sat frozen for 137
	// runs), and `parseTeeTimeToUTC` anchors string tee times to the tournament's
	// START date for every round.

	/// A four-day tournament that started YESTERDAY, carrying yesterday's tee time
	/// — the shape a frozen source file serves on day two.
	private func frozenTournament() -> Event {
		EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-26T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", tournament: "PGA Tour",
			streaming: [["platform": "HBO Max (Sport)"]], norwegian: true,
			norwegianPlayers: [["name": "Viktor Hovland", "entityId": "viktor-hovland",
			                    "status": "R1 · −4 · T8",
			                    "teeTimeUTC": "2026-08-26T15:24:00Z"]]
		)
	}

	func testStaleTeeTime_neverReachesTheTimeColumn() {
		let sections = AgendaViewModel.buildSections(
			events: [frozenTournament()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [], profile: follow("viktor-hovland")
		)
		let rows = allEventRows(sections)
		XCTAssertEqual(rows.count, 1, "the event still stands — a stale tee time never drops it")
		XCTAssertEqual(sections[0].label, "I DAG", "a running multi-day event stays under I DAG")
		XCTAssertNotEqual(rows[0].timeLabel, "17:24", "yesterday's clock must never be printed as today's")
		XCTAssertEqual(rows[0].timeLabel, "26.–30. aug.", "the event's own honest window instead")
		// …and with the clock gone the row reads as the untimed degradation:
		// the event's own title, the athlete named in the meta. No dangling verb.
		XCTAssertEqual(rows[0].title, "TOUR Championship")
		XCTAssertEqual(rows[0].metaLabel, "Hovland", "he is still named — only the false clock is gone")
	}

	func testTeeTimeEarlierTODAY_stillOwnsTheTimeColumn() {
		// The guard is a DAY guard, not a "future only" guard: a round that teed
		// off two hours ago is exactly what you want on the board. (Same call the
		// web board makes in `dashboard.js golfTeeHint`, which falls back to the
		// LATEST Norwegian out once they have all started.)
		let event = EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-27T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", norwegian: true,
			norwegianPlayers: [["name": "Viktor Hovland", "entityId": "viktor-hovland",
			                    "teeTimeUTC": "2026-08-27T04:30:00Z"]]
		)
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [event], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [], profile: follow("viktor-hovland")
		))
		XCTAssertEqual(rows.count, 1)
		XCTAssertEqual(rows[0].timeLabel, "06:30", "already teed off today — still the honest answer to «når»")
		XCTAssertTrue(rows[0].title.contains("Hovland teer av"))
	}

	// MARK: - Guard 1, the unindexed half: a SOFT-follow is matched by NAME
	//
	// A WP-164 soft-follow's id is `soft-<slug>`, and `norwegianPlayers[].entityId`
	// is stamped from entities.json by build-events.js — it can never carry that
	// prefix. So an id-only fallback is structurally false for EVERY soft rule.
	// Name is the axis WP-164 designed a soft-follow to travel on, and the axis
	// `ruleMatches` already puts the same rule on the board with.

	private func softFollow(_ name: String, sport: String) -> InterestProfile {
		InterestProfile(rules: [InterestRule(
			entityId: InterestRule.softFollowId(for: name), entityName: name, sport: sport,
			weight: 0.5, reason: "Du valgte å følge dette.", addedAt: iso("2026-08-01T00:00:00Z")
		)])
	}

	func testSoftFollowId_isNeverAnEntityId() {
		// The premise, pinned so the guard below can never be quietly weakened
		// back to an id-only test on the grounds that "the id matches anyway".
		let softId = InterestRule.softFollowId(for: "Viktor Hovland")
		XCTAssertEqual(softId, "soft-viktor-hovland")
		XCTAssertNil(index.entity(id: softId), "no index knows a soft id")
		XCTAssertFalse(tourChampionship().norwegianPlayers.contains { $0.entityId == softId },
		               "and no player record can carry it either")
	}

	func testSoftFollowOfAnAthlete_getsHisTeeTime() {
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [tourChampionship()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [],
			profile: softFollow("Viktor Hovland", sport: "golf")
		))
		XCTAssertEqual(rows.count, 1)
		XCTAssertEqual(rows[0].timeLabel, "17:24", "a soft-follow answers «når spiller han» too")
		XCTAssertTrue(rows[0].title.contains("Hovland teer av"), "got: \(rows[0].title)")
	}

	func testSoftFollowOfATeam_stillNeverDerivesTheAthleteLens() {
		// The name fallback widens the athlete test, so pin its edge: a name that
		// is NOT in the event's player list gets nothing, even soft-followed.
		let events = [tourChampionship()]
		let interests = Interests(followBroadly: ["golf"])
		XCTAssertEqual(
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: [],
			                              profile: softFollow("FK Lyn Oslo", sport: "golf")),
			baseline(events, interests: interests),
			"a name that is in no player list is no athlete"
		)
	}

	// MARK: - One event, one day, one window row (the calm contract)
	//
	// A CLOCKED row earns its own row — it answers «når» with a time nothing else
	// carries, which is why WP-18 renders one per distinct tee time. A WINDOWED
	// row answers «når» with the tournament window: the exact row the lens set out
	// to replace. Both on one day is the same tournament twice.

	/// The shape that occurs on any ordinary tournament Saturday: one followed
	/// Norwegian plays on, the other missed the cut — `isOutOfTournament` in
	/// scripts/fetch/golf.js nulls the tee time of whoever is out.
	private func oneTeesOffOneIsCut() -> Event {
		EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-27T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", tournament: "PGA Tour",
			streaming: [["platform": "HBO Max (Sport)"]], norwegian: true,
			norwegianPlayers: [
				["name": "Viktor Hovland", "entityId": "viktor-hovland", "teeTimeUTC": "2026-08-27T15:24:00Z"],
				["name": "Kristoffer Reitan", "entityId": "kristoffer-reitan", "status": "CUT"],
			]
		)
	}

	func testTimedAndUntimedAthlete_giveOneRow_notTheTournamentTwice() {
		let profile = follow("viktor-hovland", "kristoffer-reitan")
		let sections = AgendaViewModel.buildSections(
			events: [oneTeesOffOneIsCut()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [], profile: profile
		)
		let rows = allEventRows(sections)
		XCTAssertEqual(rows.count, 1, "one event, one day, one row — not «17:24 Hovland» AND a bare tournament window")
		XCTAssertEqual(rows[0].timeLabel, "17:24", "the row that survives is the one that ANSWERS «når»")
		XCTAssertFalse(rows.contains { $0.timeLabel.contains("–") }, "no windowed twin alongside it")
	}

	func testUntimedAthleteOnADayOfHisOwn_keepsHisRow() {
		// Rows on DIFFERENT days never suppress each other: a tee time tomorrow is
		// tomorrow's answer, and today still owes the reader the tournament.
		let event = EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-27T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", norwegian: true,
			norwegianPlayers: [
				["name": "Viktor Hovland", "entityId": "viktor-hovland", "teeTimeUTC": "2026-08-28T15:24:00Z"],
				["name": "Kristoffer Reitan", "entityId": "kristoffer-reitan"],
			]
		)
		let sections = AgendaViewModel.buildSections(
			events: [event], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [],
			profile: follow("viktor-hovland", "kristoffer-reitan")
		)
		XCTAssertEqual(sections.map(\.id), ["2026-08-27", "2026-08-28"])
		XCTAssertEqual(allEventRows([sections[0]]).map(\.timeLabel), ["27.–30. aug."], "today: the window + Reitan")
		XCTAssertEqual(allEventRows([sections[1]]).map(\.timeLabel), ["17:24"], "tomorrow: Hovland's tee time")
	}

	func testTwoStaleTeeTimes_collapseToASingleWindowRow() {
		// Both followed athletes carry a stale tee time, so both lose their clock
		// (above) and would otherwise print the same tournament window twice.
		let event = EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: "2026-08-26T04:00:00Z",
			endTime: "2026-08-30T20:00:00Z", norwegian: true,
			norwegianPlayers: [
				["name": "Viktor Hovland", "entityId": "viktor-hovland", "teeTimeUTC": "2026-08-26T15:24:00Z"],
				["name": "Kristoffer Reitan", "entityId": "kristoffer-reitan", "teeTimeUTC": "2026-08-26T16:06:00Z"],
			]
		)
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [event], interests: Interests(followBroadly: ["golf"]), now: now,
			index: index, followedIds: [], profile: follow("viktor-hovland", "kristoffer-reitan")
		))
		XCTAssertEqual(rows.count, 1, "one window row, never two")
		XCTAssertEqual(rows[0].timeLabel, "26.–30. aug.")
	}

	func testBothAthletesTimed_stillGetARowEach() {
		// The suppression is windowed-rows-only: two real tee times remain two
		// rows, because each answers a «når» the other does not. (WP-18's rule.)
		let rows = allEventRows(AgendaViewModel.buildSections(
			events: [tourChampionship()], interests: Interests(followBroadly: ["golf"]),
			now: now, index: index, followedIds: [],
			profile: follow("viktor-hovland", "kristoffer-reitan")
		))
		XCTAssertEqual(rows.map(\.timeLabel), ["17:24", "18:06"])
	}

	// MARK: - The standing guarantee: no profile, no lens

	func testEmptyProfile_isByteIdentical() {
		let events = [tourChampionship(), football()]
		let interests = Interests(followBroadly: ["golf", "football"])
		XCTAssertEqual(
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: [], profile: InterestProfile()),
			AgendaViewModel.buildSections(events: events, interests: interests, now: now,
			                              index: index, followedIds: []),
			"an empty profile leaves the board exactly as it was"
		)
	}
}

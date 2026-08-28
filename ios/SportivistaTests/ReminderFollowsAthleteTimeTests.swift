//
//  ReminderFollowsAthleteTimeTests.swift
//  SportivistaTests
//
//  WP-255 — «tavla sier 17:24, varselet må si 17:24».
//
//  Since WP-249 an ordinary «Følg Viktor Hovland» tap derives an athlete lens,
//  so the agenda routinely draws «17:24 Hovland teer av — TOUR Championship»
//  for a tournament whose `event.time` is the nominal 04:00 window start. The
//  NotificationPlanner read `event.time` and nothing else, so the very same
//  event's reminder both FIRED on and SAID 04:00 — the contradiction
//  NotificationPlanner's own header calls «det dyreste tillitsbruddet appen kan
//  begå», on the surface DESIGN.md § Rad promises the bell is about.
//
//  Same real TOUR Championship record the WP-249 tests use (times, tee times
//  and ids copied verbatim from events.json on 27.08.2026), against a fixed
//  clock so it keeps holding after the tournament is over.
//

import XCTest

final class ReminderFollowsAthleteTimeTests: XCTestCase {

	private let index = AssistantTestSupport.liveIndex()

	private func iso(_ s: String) -> Date {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime]
		return f.date(from: s)!
	}

	/// Oslo 08:00 on the tournament's first day — before both tee times.
	private let now = ISO8601DateFormatter().date(from: "2026-08-27T06:00:00Z")!

	/// Oslo 22:00 the evening BEFORE — the only clock from which the
	/// tournament's own nominal 04:00 start is still ahead of us. The fallback
	/// tests need it: a reminder is never planned for a start that has passed,
	/// and `now` above is deliberately mid-tournament-day-one.
	private let beforeTheTournament = ISO8601DateFormatter().date(from: "2026-08-26T20:00:00Z")!

	/// A profile following `id` exactly the way a «Følg»-tap builds it: the
	/// direct-follow path with NO lens (`lens == .sportAsSuch`) — the case
	/// WP-249 taught the board to read and WP-255 teaches the reminder to read.
	private func follow(_ ids: String...) -> InterestProfile {
		ids.reduce(InterestProfile()) { profile, id in
			profile.applying(GroundedMutation(
				kind: .add, entity: index.entity(id: id)!, scope: nil,
				weight: InterestProfile.defaultWeight, reason: "Du valgte å følge dette.",
				previousRule: nil
			), now: iso("2026-08-01T00:00:00Z"))
		}
	}

	/// The interests the app actually plans against: the (empty, since WP-96)
	/// synced base with the local profile folded in — the SAME merge the board
	/// compiles from, and since WP-255 the same one `NotificationPlanner.Inputs`
	/// performs.
	private func effective(_ profile: InterestProfile) -> Interests {
		EffectiveInterests.merge(profile: profile, into: Interests(), index: index)
	}

	/// TOUR Championship: a four-day window starting 04:00 UTC, Hovland teeing
	/// off 15:24 UTC (Oslo 17:24) and Reitan 16:06 UTC (Oslo 18:06).
	private func tourChampionship(
		time: String = "2026-08-27T04:00:00Z",
		hovlandTee: String? = "2026-08-27T15:24:00Z",
		reitanTee: String? = "2026-08-27T16:06:00Z"
	) -> Event {
		var hovland: [String: Any] = ["name": "Viktor Hovland", "entityId": "viktor-hovland"]
		var reitan: [String: Any] = ["name": "Kristoffer Reitan", "entityId": "kristoffer-reitan"]
		if let hovlandTee { hovland["teeTimeUTC"] = hovlandTee }
		if let reitanTee { reitan["teeTimeUTC"] = reitanTee }
		return EventBuilder.make(
			sport: "golf", title: "TOUR Championship", time: time,
			endTime: "2026-08-30T20:00:00Z", tournament: "PGA Tour",
			streaming: [["platform": "HBO Max (Sport)"]], norwegian: true,
			norwegianPlayers: [hovland, reitan], id: "tour-championship"
		)
	}

	private func plan(
		_ events: [Event],
		profile: InterestProfile,
		interests: Interests? = nil,
		now: Date? = nil
	) -> [NotificationOperation] {
		NotificationPlanner.plan(
			previousEvents: [], newEvents: events,
			interests: interests ?? effective(profile),
			now: now ?? self.now, lastSync: now ?? self.now,
			profile: profile, index: index
		)
	}

	private func onlyRequest(_ plan: [NotificationOperation], file: StaticString = #filePath, line: UInt = #line) throws -> NotificationRequest {
		guard plan.count == 1, case .scheduleNew(let request) = plan[0] else {
			XCTFail("expected exactly one .scheduleNew, got \(plan)", file: file, line: line)
			throw XCTSkip("no request")
		}
		return request
	}

	// MARK: - The acceptance: the reminder is about HIS tee-off, not the window

	func testFollowingHovland_remindsOnHisTeeTime_notTheTournamentWindow() throws {
		let request = try onlyRequest(plan([tourChampionship()], profile: follow("viktor-hovland")))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T14:54:00Z"), "30 min before HIS 15:24 tee-off, not before the 04:00 window")
		XCTAssertEqual(request.body, "Kl. 17:24 · HBO Max (Sport)", "the body states the clock it fires on")
		XCTAssertTrue(request.title.contains("Hovland teer av"), "got: \(request.title)")
	}

	/// The point of routing both surfaces through `EventLens`: the row the bell
	/// sits on and the push that bell promises state the SAME clock.
	func testBoardAndReminderStateTheSameClock() throws {
		let profile = follow("viktor-hovland")
		let event = tourChampionship()

		let sections = AgendaViewModel.buildSections(
			events: [event], interests: effective(profile), now: now,
			index: index, followedIds: ["viktor-hovland"], profile: profile
		)
		let rows = sections.flatMap(\.items).compactMap { item -> AgendaEventRow? in
			if case .event(let row) = item { return row } else { return nil }
		}
		XCTAssertEqual(rows.count, 1)
		XCTAssertEqual(rows[0].timeLabel, "17:24")
		XCTAssertTrue(rows[0].mustWatch, "the bell is on this row — so it must be armed for this row's time")

		let request = try onlyRequest(plan([event], profile: profile))
		XCTAssertTrue(request.body.contains(rows[0].timeLabel), "board says \(rows[0].timeLabel), push says \(request.body)")
	}

	// MARK: - The staleness guard (the same one AgendaViewModel.place applies)

	/// A tee time whose Oslo day is already behind us — a `retainLastGood`
	/// re-serve, or a string tee time anchored to the tournament's START date —
	/// must never become the reminder. Left unguarded the fire date would clamp
	/// to `now` and buzz about a tee-off that already happened.
	func testStaleTeeTime_fallsBackToTheEventsOwnTime() throws {
		let event = tourChampionship(
			time: "2026-08-28T04:00:00Z",          // still ahead of us
			hovlandTee: "2026-08-26T15:24:00Z",    // yesterday — stale
			reitanTee: nil
		)

		let request = try onlyRequest(plan([event], profile: follow("viktor-hovland")))

		XCTAssertEqual(request.fireDate, iso("2026-08-28T03:30:00Z"), "the event's own start owns the reminder when the tee time is stale")
		XCTAssertEqual(request.body, "Kl. 06:00 · HBO Max (Sport)")
		XCTAssertEqual(request.title, "TOUR Championship", "no «teer av» verb behind a clock we refused to stand behind")
		XCTAssertNotEqual(request.fireDate, now, "a stale tee time must never clamp the reminder to «now»")
	}

	/// A tee time earlier TODAY is honest on the board (it happened, today) but
	/// meaningless in a push — a reminder is a promise about something ahead of
	/// us. The still-upcoming athlete owns it instead.
	func testPassedTeeTimeToday_yieldsToTheNextUpcomingOne() throws {
		let profile = follow("viktor-hovland", "kristoffer-reitan")
		let afterHovland = iso("2026-08-27T15:30:00Z") // 6 min past his tee-off

		let request = try onlyRequest(plan([tourChampionship()], profile: profile, now: afterHovland))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T15:36:00Z"), "30 min before Reitan's 16:06")
		XCTAssertEqual(request.body, "Kl. 18:06 · HBO Max (Sport)", "Reitan's tee time, not Hovland's passed one")
		XCTAssertTrue(request.title.contains("Reitan teer av"), "got: \(request.title)")
	}

	// MARK: - Which athlete, when several are followed

	func testTwoFollowedAthletes_theEarliestUpcomingTeeTimeOwnsTheReminder() throws {
		let request = try onlyRequest(plan([tourChampionship()], profile: follow("viktor-hovland", "kristoffer-reitan")))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T14:54:00Z"), "the next thing to happen is what one reminder is for")
		XCTAssertTrue(request.title.contains("Hovland teer av"), "got: \(request.title)")
	}

	/// Following only Reitan never borrows Hovland's earlier tee time.
	func testFollowingOnlyReitan_remindsOnReitansTeeTime() throws {
		let request = try onlyRequest(plan([tourChampionship()], profile: follow("kristoffer-reitan")))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T15:36:00Z"), "30 min before 16:06")
		XCTAssertEqual(request.body, "Kl. 18:06 · HBO Max (Sport)")
	}

	// MARK: - What the lens does NOT change

	/// The degradation contract, stated as a test: no profile ⇒ no lens ⇒ the
	/// event's own time, byte-for-byte the pre-WP-255 plan.
	func testEmptyProfile_keepsTheEventsOwnTime() throws {
		let serverInterests = Interests(
			alwaysTrack: Interests.AlwaysTrack(athletes: [Interests.Entity(name: "Viktor Hovland", sport: "golf")])
		)

		let request = try onlyRequest(plan([tourChampionship()], profile: InterestProfile(), interests: serverInterests, now: beforeTheTournament))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T03:30:00Z"), "30 min before the 04:00 window start")
		XCTAssertEqual(request.title, "TOUR Championship")
	}

	/// Guard 1 (athletes only): a followed TEAM never acquires the lens, so a
	/// football reminder is untouched.
	func testFollowedTeam_reminderIsUntouched() throws {
		let profile = follow("fk-lyn-oslo")
		let match = EventBuilder.make(
			sport: "football", title: "Lyn – Sogndal", time: "2026-08-27T18:00:00Z",
			homeTeam: "Lyn", awayTeam: "Sogndal",
			streaming: [["platform": "TV 2 Play"]], id: "lyn-sogndal"
		)

		let request = try onlyRequest(plan([match], profile: profile))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T17:30:00Z"))
		XCTAssertEqual(request.title, "Lyn – Sogndal")
	}

	/// Guard 2 (only when the data knows his time): a tournament with no tee
	/// times keeps the window — the lens never fabricates a clock (P320).
	func testNoTeeTimes_keepsTheEventsOwnTime() throws {
		let event = tourChampionship(hovlandTee: nil, reitanTee: nil)

		let request = try onlyRequest(plan([event], profile: follow("viktor-hovland"), now: beforeTheTournament))

		XCTAssertEqual(request.fireDate, iso("2026-08-27T03:30:00Z"))
		XCTAssertEqual(request.title, "TOUR Championship")
	}

	/// Reconciling must never re-touch a correctly scheduled reminder — the
	/// lens is a pure function of the same inputs, so an unchanged event under
	/// an unchanged profile still produces no operation.
	func testUnchangedLensedEvent_producesNoOperation() {
		let profile = follow("viktor-hovland")
		let event = tourChampionship()

		let plan = NotificationPlanner.plan(
			previousEvents: [event], newEvents: [event], interests: effective(profile),
			now: now, lastSync: now, profile: profile, index: index
		)

		XCTAssertEqual(plan, [])
	}

	/// A tee time that MOVES is a reschedule, on the new tee time.
	func testMovedTeeTime_reschedulesOnTheNewOne() {
		let profile = follow("viktor-hovland")
		let before = tourChampionship()
		let after = tourChampionship(hovlandTee: "2026-08-27T16:48:00Z")

		let plan = NotificationPlanner.plan(
			previousEvents: [before], newEvents: [after], interests: effective(profile),
			now: now, lastSync: now, profile: profile, index: index
		)

		XCTAssertEqual(plan, [
			.reschedule(NotificationRequest(
				id: "tour-championship",
				title: "Hovland teer av — TOUR Championship",
				body: "Kl. 18:48 · HBO Max (Sport)",
				fireDate: iso("2026-08-27T16:18:00Z")
			)),
		])
	}

	// MARK: - A round that starts after the tournament did

	/// The nominal start passes on day one; the tee times do not. Before WP-255
	/// gate (c) (`event.time > now`) silenced every later round — the very
	/// rounds the follow is about. Now the athlete's own upcoming time carries
	/// it.
	func testTournamentUnderway_stillRemindsForTodaysTeeOff() throws {
		let day3 = iso("2026-08-29T06:00:00Z")
		let event = tourChampionship(
			hovlandTee: "2026-08-29T15:24:00Z",
			reitanTee: nil
		)

		let request = try onlyRequest(plan([event], profile: follow("viktor-hovland"), now: day3))

		XCTAssertEqual(request.fireDate, iso("2026-08-29T14:54:00Z"))
		XCTAssertEqual(request.body, "Kl. 17:24 · HBO Max (Sport)")

		// … and the same event without tee times stays silent once underway.
		XCTAssertEqual(
			plan([tourChampionship(hovlandTee: nil, reitanTee: nil)], profile: follow("viktor-hovland"), now: day3),
			[],
			"an event already underway with nothing per-athlete to say is still never planned"
		)
	}

	// MARK: - The bell and the reminder are the same predicate

	/// WP-96 stopped publishing `interests.json` and WP-106 dropped it from the
	/// sync, so the synced base is EMPTY on a real device. Planning against that
	/// raw base means `mustWatch` is false for everything — the board draws the
	/// bell (it compiles against the merged interests) and no reminder exists
	/// behind it. `NotificationPlanner.Inputs` folds the profile in, which is
	/// what makes a profile-only follow ring at all.
	func testProfileOnlyFollow_ringsOnlyOnceTheProfileIsFoldedIn() throws {
		let profile = follow("viktor-hovland")
		let event = tourChampionship()

		XCTAssertEqual(
			plan([event], profile: profile, interests: Interests()),
			[],
			"the raw synced base is empty on device — this is the state the app was in"
		)

		let request = try onlyRequest(plan([event], profile: profile))
		XCTAssertEqual(request.id, "tour-championship")
	}
}

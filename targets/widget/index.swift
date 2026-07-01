// Widget extension entry point — hosts BOTH the home-screen widget
// (LumiMoodWidget) and the per-task Live Activity (LumiTaskLiveActivity)
// via a WidgetBundle. Widget Extensions on iOS 16.1+ can host
// ActivityConfiguration alongside StaticConfiguration in the same
// bundle, so no second target is needed.

import WidgetKit
import SwiftUI
import ActivityKit

// ═════════════════════════════════════════════════════════════════════
// BUNDLE — registers every widget + live activity this extension owns
// ═════════════════════════════════════════════════════════════════════

@main
struct LumiWidgetBundle: WidgetBundle {
    var body: some Widget {
        LumiMoodWidget()
        if #available(iOS 16.1, *) {
            LumiTaskLiveActivity()
        }
    }
}

// ═════════════════════════════════════════════════════════════════════
// 1 · HOME-SCREEN WIDGET — Lumi's mood + tasks done today
// ═════════════════════════════════════════════════════════════════════

private enum SharedKey {
    static let mood = "mood"               // "idle" | "happy" | "sad" | "sleep"
    static let petName = "petName"         // User-renameable cat name
    static let completed = "completedToday" // Int
    static let suite = "group.app.lumi.ios"
}

struct LumiMoodEntry: TimelineEntry {
    let date: Date
    let mood: String
    let petName: String
    let completedToday: Int
}

struct LumiMoodProvider: TimelineProvider {
    func placeholder(in context: Context) -> LumiMoodEntry {
        LumiMoodEntry(date: Date(), mood: "idle", petName: "Lumi", completedToday: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (LumiMoodEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LumiMoodEntry>) -> Void) {
        // Hourly safety-net refresh — the app calls
        // WidgetCenter.shared.reloadAllTimelines() on real mood
        // changes, so this background tick mostly catches drift
        // (sleep window roll, completion count reset at midnight).
        let entry = currentEntry()
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func currentEntry() -> LumiMoodEntry {
        let defaults = UserDefaults(suiteName: SharedKey.suite)
        let mood = defaults?.string(forKey: SharedKey.mood) ?? "idle"
        let petName = defaults?.string(forKey: SharedKey.petName) ?? "Lumi"
        let completed = defaults?.integer(forKey: SharedKey.completed) ?? 0
        return LumiMoodEntry(
            date: Date(),
            mood: mood,
            petName: petName,
            completedToday: completed
        )
    }
}

struct LumiMoodWidgetView: View {
    var entry: LumiMoodProvider.Entry

    var body: some View {
        VStack(spacing: 6) {
            Image("luna-\(entry.mood)")
                .resizable()
                .interpolation(.none) // pixel art — no smoothing
                .aspectRatio(contentMode: .fit)
                .frame(maxHeight: 78)
            Text("\(entry.petName) · \(entry.completedToday) done")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundColor(Color(red: 0.92, green: 0.88, blue: 0.79))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) {
            Color(red: 0.078, green: 0.055, blue: 0.047)
        }
    }
}

struct LumiMoodWidget: Widget {
    let kind = "LumiMoodWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LumiMoodProvider()) { entry in
            LumiMoodWidgetView(entry: entry)
        }
        .configurationDisplayName("Lumi")
        .description("Your cat's mood and how many tasks you've done today.")
        .supportedFamilies([.systemSmall])
    }
}

// ═════════════════════════════════════════════════════════════════════
// 2 · LIVE ACTIVITY — per-task focus session for the Dynamic Island
// ═════════════════════════════════════════════════════════════════════

// ── Animated Luna sprite (licking cycle) ─────────────────────────────
//
// The Focus session cat LICKS in the Dynamic Island — same body-double
// behavior the JS side uses on Home / Me / Focus. Since WidgetKit's
// Image can't render animated GIFs, we extracted 4 PNG frames from
// luna-lick.gif into the asset catalog (luna-lick-1..4) and cycle
// them here via `TimelineView(.periodic)` — the ONE timeline
// schedule iOS still respects inside a Live Activity. (`.animation`
// is blocked; `.repeatForever` on transforms is silently optimized
// away; `.periodic` still fires the closure on the interval we ask
// for, subject to iOS throttling.)
//
// Refresh interval is 0.35s → full 4-frame cycle every ~1.4s. If
// iOS throttles us further under load, the cat still cycles just
// more slowly — never fully static.
//
// The `mood` param is unused for the sprite name (we always show
// the licking cat during a focus session) but kept in the signature
// so callers don't need to know the widget's internal choice; if we
// later add per-mood behavior we won't have to touch every call site.
@available(iOS 16.1, *)
struct LunaSpriteView: View {
    let mood: String
    let size: CGFloat
    let elapsedSeconds: Int

    var body: some View {
        // All 20 frames from the source GIF, cycling at the GIF's
        // native ~10fps rhythm (0.1s interval). iOS may throttle
        // .periodic under load — worst case we degrade to fewer
        // effective updates per second and the animation just plays
        // slower, never fully static.
        //
        // 20 frames × 0.1s = 2s full cycle, matching what the JS
        // side plays for the licking beat everywhere else in the
        // app — the Dynamic Island cat is now visually synced with
        // Luna's licking on Home / Me / Focus tab.
        TimelineView(.periodic(from: Date(), by: 0.1)) { context in
            let bucket = Int(context.date.timeIntervalSince1970 * 10)
            let frame = (bucket % 20) + 1  // 1...20
            Image("luna-lick-\(frame)")
                .resizable()
                .interpolation(.none)
                .frame(width: size, height: size)
        }
    }
}

// Helper — builds a Date range for Text(timerInterval:) from the
// session's elapsed + duration. Reconstructs the original startedAt
// from now - elapsed so the timer counts down against real wall time.
@available(iOS 16.1, *)
private func sessionRange(elapsed: Int, duration: Int) -> ClosedRange<Date> {
    let start = Date().addingTimeInterval(-Double(elapsed))
    let end = start.addingTimeInterval(Double(duration))
    return start...end
}

@available(iOS 16.1, *)
struct LumiTaskLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LumiTaskAttributes.self) { context in
            // ── LOCK SCREEN / BANNER ──
            // Renders on the lock screen + as a banner on Android-
            // style notifications on older iPhones (iPhone < 14 Pro
            // that don't have a Dynamic Island).
            LockScreenView(
                state: context.state,
                attributes: context.attributes
            )
        } dynamicIsland: { context in
            DynamicIsland {
                // ── EXPANDED (long-pressed pill) ──
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        LunaSpriteView(
                            mood: context.state.mood,
                            size: 32,
                            elapsedSeconds: context.state.elapsedSeconds
                        )
                        VStack(alignment: .leading, spacing: 1) {
                            Text(context.attributes.petName)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundColor(Color(red: 0.92, green: 0.88, blue: 0.79))
                            Text(moodWord(for: context.state.mood))
                                .font(.system(size: 9))
                                .foregroundColor(Color(red: 0.69, green: 0.64, blue: 0.55))
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // Text(timerInterval:) is iOS's built-in
                    // self-updating countdown — refreshes every
                    // second natively without needing our JS-side
                    // updateTaskActivity ping. Reads smoothly
                    // instead of jumping 5 seconds at a time
                    // between our own ticks.
                    Text(
                        timerInterval: sessionRange(
                            elapsed: context.state.elapsedSeconds,
                            duration: context.attributes.durationSeconds
                        ),
                        countsDown: true
                    )
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.88, green: 0.48, blue: 0.31))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.attributes.taskTitle)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Color(red: 0.92, green: 0.88, blue: 0.79))
                            .lineLimit(1)
                        ProgressView(
                            value: progress(
                                context.state.elapsedSeconds,
                                context.attributes.durationSeconds
                            )
                        )
                        .tint(Color(red: 0.88, green: 0.48, blue: 0.31))
                    }
                }
            } compactLeading: {
                // ── COMPACT LEADING (left of camera) ──
                LunaSpriteView(
                    mood: context.state.mood,
                    size: 20,
                    elapsedSeconds: context.state.elapsedSeconds
                )
            } compactTrailing: {
                // ── COMPACT TRAILING (right of camera) ──
                // Native iOS timer interval — auto-refreshes every
                // second, no ContentState ping needed. Smooth
                // countdown instead of 5-second jumps.
                Text(
                    timerInterval: sessionRange(
                        elapsed: context.state.elapsedSeconds,
                        duration: context.attributes.durationSeconds
                    ),
                    countsDown: true
                )
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundColor(Color(red: 0.88, green: 0.48, blue: 0.31))
                .monospacedDigit()
            } minimal: {
                // ── MINIMAL (multiple activities competing) ──
                LunaSpriteView(
                    mood: context.state.mood,
                    size: 18,
                    elapsedSeconds: context.state.elapsedSeconds
                )
            }
        }
    }
}

@available(iOS 16.1, *)
struct LockScreenView: View {
    let state: LumiTaskAttributes.ContentState
    let attributes: LumiTaskAttributes

    var body: some View {
        HStack(spacing: 14) {
            LunaSpriteView(
                mood: state.mood,
                size: 52,
                elapsedSeconds: state.elapsedSeconds
            )
            VStack(alignment: .leading, spacing: 4) {
                Text(attributes.taskTitle)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Color(red: 0.92, green: 0.88, blue: 0.79))
                    .lineLimit(1)
                ProgressView(
                    value: progress(
                        state.elapsedSeconds,
                        attributes.durationSeconds
                    )
                )
                .tint(Color(red: 0.88, green: 0.48, blue: 0.31))
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text(
                    timerInterval: sessionRange(
                        elapsed: state.elapsedSeconds,
                        duration: attributes.durationSeconds
                    ),
                    countsDown: true
                )
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundColor(Color(red: 0.88, green: 0.48, blue: 0.31))
                .monospacedDigit()
                Text("left")
                    .font(.system(size: 10))
                    .foregroundColor(Color(red: 0.43, green: 0.40, blue: 0.35))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .activityBackgroundTint(Color(red: 0.078, green: 0.055, blue: 0.047))
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

@available(iOS 16.1, *)
private func formatRemaining(_ elapsed: Int, _ total: Int) -> String {
    let remaining = max(0, total - elapsed)
    let m = remaining / 60
    let s = remaining % 60
    if m >= 60 {
        let h = m / 60
        return String(format: "%d:%02d", h, m % 60)
    }
    return String(format: "%d:%02d", m, s)
}

@available(iOS 16.1, *)
private func progress(_ elapsed: Int, _ total: Int) -> Double {
    guard total > 0 else { return 0 }
    return min(1.0, Double(elapsed) / Double(total))
}

@available(iOS 16.1, *)
private func moodWord(for mood: String) -> String {
    switch mood {
    case "happy": return "happy"
    case "sad": return "watching"
    case "sleep": return "resting"
    default: return "with you"
    }
}

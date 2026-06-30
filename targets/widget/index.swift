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
                        Image("luna-\(context.state.mood)")
                            .resizable()
                            .interpolation(.none)
                            .frame(width: 32, height: 32)
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
                    Text(formatRemaining(
                        context.state.elapsedSeconds,
                        context.attributes.durationSeconds
                    ))
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.88, green: 0.48, blue: 0.31))
                    .monospacedDigit()
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
                Image("luna-\(context.state.mood)")
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                // ── COMPACT TRAILING (right of camera) ──
                Text(formatRemaining(
                    context.state.elapsedSeconds,
                    context.attributes.durationSeconds
                ))
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundColor(Color(red: 0.88, green: 0.48, blue: 0.31))
                .monospacedDigit()
            } minimal: {
                // ── MINIMAL (multiple activities competing) ──
                Image("luna-\(context.state.mood)")
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 18, height: 18)
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
            Image("luna-\(state.mood)")
                .resizable()
                .interpolation(.none)
                .frame(width: 52, height: 52)
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
                Text(formatRemaining(
                    state.elapsedSeconds,
                    attributes.durationSeconds
                ))
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

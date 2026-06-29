// LumiMoodWidget — a single small-size iOS home-screen widget that
// shows the user's cat's current mood + how many tasks they've done
// today. Reads from a shared App Group (group.app.lumi.ios) that
// the React Native side writes to via @bacons/apple-targets's
// ExtensionStorage. Refreshes hourly on its own and is reloaded
// explicitly by the app whenever the mood or completion count changes.

import WidgetKit
import SwiftUI

// ── Shared App Group keys ─────────────────────────────────────────
// Keep these in sync with lib/widget.ts on the JS side.
private enum SharedKey {
    static let mood = "mood"               // "idle" | "happy" | "sad" | "sleep"
    static let petName = "petName"         // User-renameable cat name
    static let completed = "completedToday" // Int
    static let suite = "group.app.lumi.ios"
}

// ── Timeline entry ────────────────────────────────────────────────

struct LumiMoodEntry: TimelineEntry {
    let date: Date
    let mood: String
    let petName: String
    let completedToday: Int
}

// ── Provider — reads the App Group on every snapshot ──────────────

struct LumiMoodProvider: TimelineProvider {
    func placeholder(in context: Context) -> LumiMoodEntry {
        LumiMoodEntry(date: Date(), mood: "idle", petName: "Lumi", completedToday: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (LumiMoodEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LumiMoodEntry>) -> Void) {
        // Hourly refresh as a safety net — the main app calls
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

// ── View ──────────────────────────────────────────────────────────

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

// ── Widget ────────────────────────────────────────────────────────

@main
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

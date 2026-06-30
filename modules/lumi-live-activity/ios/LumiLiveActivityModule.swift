// LumiLiveActivityModule — Expo Module bridging iOS ActivityKit so
// the JS side can start / update / end the Lumi per-task Live
// Activity. The activity itself is declared in the widget extension
// (targets/widget/index.swift → LumiTaskLiveActivity); this module
// just controls its lifecycle from the app process.
//
// JS API (from lib/liveActivity.ts):
//   - startTaskActivity(taskTitle, petName, durationSeconds, mood) → activityId
//   - updateTaskActivity(activityId, elapsedSeconds, mood) → bool
//   - endTaskActivity(activityId) → bool
//   - endAllTaskActivities() → bool
//   - isAvailable() → bool
//
// Safe to call on iOS < 16.1 — methods short-circuit and return
// false so the JS side never crashes when the user is on older iOS.

import ExpoModulesCore
import ActivityKit

public class LumiLiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LumiLiveActivity")

        // Whether ActivityKit is available + permitted on this device.
        // JS uses this to decide whether to even surface the
        // "Start focus" button.
        Function("isAvailable") { () -> Bool in
            if #available(iOS 16.1, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        // Start a new task activity. Returns the activity id as a
        // string so the JS side can track it for updates / end calls.
        // Returns null if ActivityKit isn't available or request fails.
        AsyncFunction("startTaskActivity") {
            (taskTitle: String, petName: String, durationSeconds: Int, mood: String) -> String? in
            guard #available(iOS 16.1, *) else { return nil }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

            let attributes = LumiTaskAttributes(
                taskTitle: taskTitle,
                petName: petName,
                durationSeconds: durationSeconds
            )
            let initialState = LumiTaskAttributes.ContentState(
                elapsedSeconds: 0,
                mood: mood
            )

            do {
                let activity: Activity<LumiTaskAttributes>
                if #available(iOS 16.2, *) {
                    activity = try Activity.request(
                        attributes: attributes,
                        content: ActivityContent(state: initialState, staleDate: nil),
                        pushType: nil
                    )
                } else {
                    activity = try Activity.request(
                        attributes: attributes,
                        contentState: initialState,
                        pushType: nil
                    )
                }
                return activity.id
            } catch {
                NSLog("[LumiLiveActivity] startTaskActivity failed: \(error.localizedDescription)")
                return nil
            }
        }

        // Update an in-flight activity with a new elapsed-seconds + mood.
        // JS calls this on a 1-second tick while the user has a focus
        // session running. Returns false if the activity id isn't found.
        AsyncFunction("updateTaskActivity") {
            (activityId: String, elapsedSeconds: Int, mood: String) -> Bool in
            guard #available(iOS 16.1, *) else { return false }
            guard let activity = Activity<LumiTaskAttributes>.activities.first(
                where: { $0.id == activityId }
            ) else { return false }

            let newState = LumiTaskAttributes.ContentState(
                elapsedSeconds: elapsedSeconds,
                mood: mood
            )
            if #available(iOS 16.2, *) {
                await activity.update(
                    ActivityContent(state: newState, staleDate: nil)
                )
            } else {
                await activity.update(using: newState)
            }
            return true
        }

        // End a specific activity. Pass dismissImmediately=true to
        // remove it from the Lock Screen / Island right away;
        // otherwise it lingers as a "completed" view for a few minutes.
        AsyncFunction("endTaskActivity") {
            (activityId: String, dismissImmediately: Bool) -> Bool in
            guard #available(iOS 16.1, *) else { return false }
            guard let activity = Activity<LumiTaskAttributes>.activities.first(
                where: { $0.id == activityId }
            ) else { return false }

            let dismissalPolicy: ActivityUIDismissalPolicy =
                dismissImmediately ? .immediate : .default
            if #available(iOS 16.2, *) {
                await activity.end(nil, dismissalPolicy: dismissalPolicy)
            } else {
                await activity.end(dismissalPolicy: dismissalPolicy)
            }
            return true
        }

        // Cleanup helper — ends every Lumi task activity. Useful when
        // the app launches and we want to clear stale activities from
        // a previous session, or when the user signs out.
        AsyncFunction("endAllTaskActivities") { () -> Bool in
            guard #available(iOS 16.1, *) else { return false }
            for activity in Activity<LumiTaskAttributes>.activities {
                if #available(iOS 16.2, *) {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else {
                    await activity.end(dismissalPolicy: .immediate)
                }
            }
            return true
        }
    }
}

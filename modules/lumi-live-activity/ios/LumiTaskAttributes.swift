// LumiTaskAttributes — the ActivityKit attributes for the per-task
// Live Activity.
//
// ⚠️  KEEP IN SYNC with the identical copy at
//     targets/widget/LumiTaskAttributes.swift
//
// See that file's comment for the why — both targets need this
// type declared with the exact same Codable shape.
//
// Static attributes: things that don't change for the lifetime of
// the activity (the task title, the user-renamed pet name).
// ContentState: the things that tick (elapsed seconds, mood). These
// are what we call .update() with to refresh the display.

import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct LumiTaskAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Seconds elapsed since the activity started.
        public var elapsedSeconds: Int
        /// Current cat mood — drives which face the Island shows.
        /// One of "idle" | "happy" | "sad" | "sleep".
        public var mood: String

        public init(elapsedSeconds: Int, mood: String) {
            self.elapsedSeconds = elapsedSeconds
            self.mood = mood
        }
    }

    /// The headline shown on the Live Activity ("Client meeting").
    public var taskTitle: String
    /// The user-renamed pet name (for the cat label).
    public var petName: String
    /// Total planned duration in seconds — drives the progress ring
    /// in the expanded view. Activity auto-ends when elapsedSeconds
    /// passes this number.
    public var durationSeconds: Int

    public init(taskTitle: String, petName: String, durationSeconds: Int) {
        self.taskTitle = taskTitle
        self.petName = petName
        self.durationSeconds = durationSeconds
    }
}

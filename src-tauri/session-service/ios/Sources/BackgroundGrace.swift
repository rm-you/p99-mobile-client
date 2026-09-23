import Foundation
import UIKit

/// One bounded extension per foreground departure, only while a session exists.
/// All calls and callbacks run on the main queue. Expiry releases the assertion;
/// it does not force a logout or repeatedly request time while still backgrounded.
final class BackgroundGrace {
    static let duration: TimeInterval = 25
    private let beginTask: (@escaping () -> Void) -> UIBackgroundTaskIdentifier
    private let endTask: (UIBackgroundTaskIdentifier) -> Void
    private let schedule: (TimeInterval, @escaping () -> Void) -> () -> Void
    private var sessionID: String?
    private var attempted = false
    private var task = UIBackgroundTaskIdentifier.invalid
    private var generation: UUID?
    private var cancelTimer: (() -> Void)?

    init(
        beginTask: @escaping (@escaping () -> Void) -> UIBackgroundTaskIdentifier = { expiration in
            UIApplication.shared.beginBackgroundTask(withName: "Finish chat activity", expirationHandler: expiration)
        },
        endTask: @escaping (UIBackgroundTaskIdentifier) -> Void = { UIApplication.shared.endBackgroundTask($0) },
        schedule: @escaping (TimeInterval, @escaping () -> Void) -> () -> Void = { delay, callback in
            let work = DispatchWorkItem(block: callback)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
            return { work.cancel() }
        }
    ) {
        self.beginTask = beginTask
        self.endTask = endTask
        self.schedule = schedule
    }

    func begin(sessionID: String, visible: Bool) {
        if self.sessionID != sessionID { finish() }
        self.sessionID = sessionID
        setVisible(visible)
    }

    func end(sessionID: String) {
        guard self.sessionID == sessionID else { return }
        self.sessionID = nil
        finish()
    }

    func setVisible(_ visible: Bool) {
        if visible {
            attempted = false
            finish()
            return
        }
        guard sessionID != nil, !attempted else { return }
        attempted = true
        let token = UUID()
        generation = token
        let identifier = beginTask { [weak self] in self?.finish(generation: token) }
        // Handle refusal or immediate expiry without leaking an assertion.
        guard identifier != .invalid, generation == token else {
            if identifier != .invalid { endTask(identifier) }
            generation = nil
            return
        }
        task = identifier
        cancelTimer = schedule(Self.duration) { [weak self] in self?.finish(generation: token) }
    }

    private func finish(generation expected: UUID? = nil) {
        if let expected = expected, generation != expected { return }
        generation = nil
        cancelTimer?()
        cancelTimer = nil
        let identifier = task
        task = .invalid
        if identifier != .invalid { endTask(identifier) }
    }

    deinit { finish() }
}

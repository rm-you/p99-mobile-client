import Foundation
import UIKit
import WebKit
import UserNotifications
import Tauri

private struct DocumentArgs: Decodable { let text: String; let format: String }
private struct SessionArgs: Decodable { let sessionId: String; let events: Channel }
private struct AlertArgs: Decodable { let title: String; let body: String }
private struct VisibilityEvent: Encodable { let type = "visibility"; let visible: Bool }

/// Native lifecycle and local alerts; no persistent background execution is requested.
class SessionServicePlugin: Plugin, UNUserNotificationCenterDelegate {
    private var events: Channel?
    private var observers: [NSObjectProtocol] = []

    override func load(webview: WKWebView) {
        UNUserNotificationCenter.current().delegate = self
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIApplication.willResignActiveNotification,
                object: nil, queue: .main) { [weak self] _ in self?.visibility(false) },
            center.addObserver(forName: UIApplication.didBecomeActiveNotification,
                object: nil, queue: .main) { [weak self] _ in self?.visibility(true) }
        ]
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    private func visibility(_ visible: Bool) {
        try? events?.send(VisibilityEvent(visible: visible))
    }

    /// Attach native visibility to Rust without starting any background task or requesting permission.
    @objc func begin(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SessionArgs.self)
        DispatchQueue.main.async {
            self.events = args.events
            self.visibility(UIApplication.shared.applicationState == .active)
            invoke.resolve(["supported": false, "active": false,
                "notifications_enabled": false, "battery_optimized": false])
        }
    }

    /// Ask only after an explicit alert setting or test action.
    private func authorize(_ invoke: Invoke, completion: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                completion()
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    if granted { completion() }
                    else { invoke.reject("Allow notifications in device settings to receive chat alerts.") }
                }
            default:
                invoke.reject("Allow notifications in device settings to receive chat alerts.")
            }
        }
    }

    @objc func requestAlertPermission(_ invoke: Invoke) {
        authorize(invoke) { invoke.resolve() }
    }

    /// Automatic alerts never request permission or start a connection.
    @objc func alertChat(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AlertArgs.self)
        post(args, test: false, invoke: invoke)
    }

    @objc func testAlert(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AlertArgs.self)
        authorize(invoke) { self.post(args, test: true, invoke: invoke) }
    }

    private func post(_ args: AlertArgs, test: Bool, invoke: Invoke) {
        guard args.title.utf8.count <= 1024, args.body.utf8.count <= 8192 else {
            invoke.reject("Notification is too large."); return
        }
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else {
                invoke.reject("Allow notifications in device settings to receive chat alerts."); return
            }
            let content = UNMutableNotificationContent()
            content.title = args.title
            content.body = args.body
            content.sound = .default
            content.threadIdentifier = "p99-chat"
            let identifier = test ? "p99-test" : "p99-chat"
            // Reuse IDs to bound notification-center accumulation; SQLite retains chat history.
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
            center.add(request) { error in
                if error == nil { invoke.resolve() }
                else { invoke.reject("Could not display the notification.") }
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler(notification.request.identifier == "p99-test" ? [.banner, .sound] : [])
    }

    @objc func copyText(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(DocumentArgs.self)
            guard args.text.utf8.count <= 100000 else { invoke.reject("Message is too large to copy."); return }
            DispatchQueue.main.async { UIPasteboard.general.string = args.text; invoke.resolve() }
        } catch { invoke.reject("Could not copy the message.") }
    }
    @objc func shareDocument(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(DocumentArgs.self)
            guard ["txt", "jsonl", "json"].contains(args.format), args.text.utf8.count <= 20000000 else { invoke.reject("Export is too large."); return }
            let manager = FileManager.default
            let directory = manager.temporaryDirectory.appendingPathComponent("shared-chat", isDirectory: true)
            try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
            let existing = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
            let files = existing.sorted { a, b in
                let left = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let right = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return left > right
            }
            for (index, old) in files.enumerated() {
                let modified = (try? old.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                if index >= 9 || modified < Date().addingTimeInterval(-86400) { try? manager.removeItem(at: old) }
            }
            let file = directory.appendingPathComponent("p99-chat-\(UUID().uuidString).\(args.format)")
            try args.text.write(to: file, atomically: true, encoding: .utf8)
            DispatchQueue.main.async {
                let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                guard let window = scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow }), var presenter = window.rootViewController else { invoke.reject("Sharing is unavailable."); return }
                while let next = presenter.presentedViewController { presenter = next }
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = presenter.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY-1, width: 1, height: 1)
                presenter.present(sheet, animated: true)
                invoke.resolve()
            }
        } catch { invoke.reject("Could not share the export.") }
    }
}
@_cdecl("init_plugin_session_service")
func initPlugin() -> Plugin { SessionServicePlugin() }

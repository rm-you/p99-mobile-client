import Foundation
import UIKit
import Tauri

private struct DocumentArgs: Decodable { let text: String; let format: String }
/// Sharing is available on iOS; this plugin does not request persistent background execution.
class SessionServicePlugin: Plugin {
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

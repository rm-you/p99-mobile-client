import Foundation
import LocalAuthentication
import Security
import Tauri

private struct Credentials: Codable {
    let user: String
    let pass: String
}

/// A device-only Keychain item whose access control requires user presence.
class SecureLoginPlugin: Plugin {
    private let queue = DispatchQueue(label: "p99.secure-login")
    private let service = "io.github.rmyou.p99mobile.login.v1"

    private func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "eq-login"]
    }

    private func context() -> LAContext {
        let context = LAContext()
        context.localizedReason = "Unlock your saved P99 login"
        context.localizedCancelTitle = "Cancel"
        context.touchIDAuthenticationAllowableReuseDuration = 0
        return context
    }

    @objc func status(_ invoke: Invoke) {
        queue.async {
            var probe = self.query()
            probe[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
            probe[kSecReturnAttributes as String] = true
            let status = SecItemCopyMatching(probe as CFDictionary, nil)
            guard [errSecSuccess, errSecInteractionNotAllowed, errSecAuthFailed, errSecItemNotFound].contains(status) else {
                invoke.reject("Could not inspect secure login.")
                return
            }
            var error: NSError?
            let available = self.context().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
            invoke.resolve(["available": available, "saved": status != errSecItemNotFound])
        }
    }

    /// Keep replacement atomic: a failed update leaves the old Keychain item intact.
    @objc func save(_ invoke: Invoke) throws {
        let credentials = try invoke.parseArgs(Credentials.self)
        queue.async {
            do {
                guard !credentials.user.isEmpty, !credentials.pass.isEmpty else { throw VaultError.invalid }
                let data = try JSONEncoder().encode(credentials)
                var error: Unmanaged<CFError>?
                guard let access = SecAccessControlCreateWithFlags(nil,
                    kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error) else {
                    throw VaultError.invalid
                }
                var add = self.query()
                add[kSecAttrAccessControl as String] = access
                add[kSecValueData as String] = data
                var status = SecItemAdd(add as CFDictionary, nil)
                if status == errSecDuplicateItem {
                    var update = self.query()
                    update[kSecUseAuthenticationContext as String] = self.context()
                    status = SecItemUpdate(update as CFDictionary, [kSecValueData as String: data] as CFDictionary)
                }
                guard status == errSecSuccess else { throw VaultError.invalid }
                invoke.resolve()
            } catch { invoke.reject("Login was not saved.") }
        }
    }

    /// Return decrypted credentials to the Rust caller, never to a webview command.
    @objc func unlock(_ invoke: Invoke) {
        queue.async {
            let context = self.context()
            defer { context.invalidate() }
            var query = self.query()
            query[kSecReturnData as String] = true
            query[kSecUseAuthenticationContext as String] = context
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess, let data = result as? Data,
                  let credentials = try? JSONDecoder().decode(Credentials.self, from: data) else {
                invoke.reject("Login was not unlocked. Try again or forget the saved login.")
                return
            }
            invoke.resolve(["user": credentials.user, "pass": credentials.pass])
        }
    }

    @objc func forget(_ invoke: Invoke) {
        queue.async {
            let status = SecItemDelete(self.query() as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                invoke.reject("Could not forget the saved login.")
                return
            }
            invoke.resolve()
        }
    }
}
private enum VaultError: Error { case invalid }

@_cdecl("init_plugin_secure_login")
func initPlugin() -> Plugin { SecureLoginPlugin() }

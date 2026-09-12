import Foundation
import LocalAuthentication
import Security
import Tauri

private struct Credentials: Codable {
    let user: String
    let pass: String
}
private struct ProfileKey: Decodable { let id: String }
private struct Profile: Codable, Equatable {
    let id: String
    let character: String
    let server: String
    var valid: Bool {
        UUID(uuidString: id)?.uuidString.lowercased() == id &&
        character.range(of: "^[A-Za-z]{1,63}$", options: .regularExpression) != nil &&
        ["green", "blue", "quarm"].contains(server)
    }
    var value: [String: String] { ["id": id, "character": character, "server": server] }
}
private struct ProfileLogin: Codable {
    let id: String
    let character: String
    let server: String
    let user: String
    let pass: String
    var profile: Profile { Profile(id: id, character: character, server: server) }
}

/// One device-only Keychain entry per character, requiring user presence to unlock.
class SecureLoginPlugin: Plugin {
    private let queue = DispatchQueue(label: "p99.secure-login")
    private let service = "io.github.rmyou.p99mobile.login.v2"
    private let legacyService = "io.github.rmyou.p99mobile.login.v1"

    private func query(id: String? = nil, legacy: Bool = false) -> [String: Any] {
        var value: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: legacy ? legacyService : service]
        if legacy { value[kSecAttrAccount as String] = "eq-login" }
        else if let id = id { value[kSecAttrAccount as String] = id }
        return value
    }

    private func context() -> LAContext {
        let context = LAContext()
        context.localizedReason = "Unlock your saved character"
        context.localizedCancelTitle = "Cancel"
        context.touchIDAuthenticationAllowableReuseDuration = 0
        return context
    }

    /// Read only nonsecret attributes. Never request password data when listing profiles.
    @objc func status(_ invoke: Invoke) {
        queue.async {
            do {
                var probe = self.query()
                probe[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
                probe[kSecReturnAttributes as String] = true
                probe[kSecMatchLimit as String] = kSecMatchLimitAll
                var result: CFTypeRef?
                let status = SecItemCopyMatching(probe as CFDictionary, &result)
                guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError.invalid }
                var profiles = [[String: String]]()
                if status == errSecSuccess {
                    guard let entries = result as? [[String: Any]] else { throw VaultError.invalid }
                    for entry in entries {
                        guard let data = entry[kSecAttrGeneric as String] as? Data else { throw VaultError.invalid }
                        let profile = try JSONDecoder().decode(Profile.self, from: data)
                        guard profile.valid, entry[kSecAttrAccount as String] as? String == profile.id else { throw VaultError.invalid }
                        profiles.append(profile.value)
                    }
                }
                var legacy = self.query(legacy: true)
                legacy[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
                legacy[kSecReturnAttributes as String] = true
                let oldStatus = SecItemCopyMatching(legacy as CFDictionary, nil)
                guard [errSecSuccess, errSecInteractionNotAllowed, errSecAuthFailed, errSecItemNotFound].contains(oldStatus) else { throw VaultError.invalid }
                let context = self.context()
                defer { context.invalidate() }
                var error: NSError?
                let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
                invoke.resolve(["available": available, "profiles": profiles, "legacySaved": oldStatus != errSecItemNotFound])
            } catch { invoke.reject("Could not inspect saved characters.") }
        }
    }

    /// Replace both the label and protected tuple atomically, preserving other entries.
    @objc func save(_ invoke: Invoke) throws {
        let login = try invoke.parseArgs(ProfileLogin.self)
        queue.async {
            let context = self.context()
            defer { context.invalidate() }
            do {
                guard login.profile.valid, !login.user.trimmingCharacters(in: .whitespaces).isEmpty,
                      !login.pass.isEmpty, login.user.utf8.count <= 1024, login.pass.utf8.count <= 1024,
                      !login.user.contains("\0"), !login.pass.contains("\0") else { throw VaultError.invalid }
                let data = try JSONEncoder().encode(login)
                let metadata = try JSONEncoder().encode(login.profile)
                var error: Unmanaged<CFError>?
                guard let access = SecAccessControlCreateWithFlags(nil,
                    kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error) else { throw VaultError.invalid }
                var add = self.query(id: login.id)
                add[kSecAttrAccessControl as String] = access
                add[kSecAttrGeneric as String] = metadata
                add[kSecValueData as String] = data
                var status = SecItemAdd(add as CFDictionary, nil)
                if status == errSecDuplicateItem {
                    var update = self.query(id: login.id)
                    update[kSecUseAuthenticationContext as String] = context
                    status = SecItemUpdate(update as CFDictionary,
                        [kSecValueData as String: data, kSecAttrGeneric as String: metadata] as CFDictionary)
                }
                guard status == errSecSuccess else { throw VaultError.invalid }
                invoke.resolve()
            } catch { invoke.reject("Character was not saved.") }
        }
    }

    @objc func unlock(_ invoke: Invoke) throws {
        let key = try invoke.parseArgs(ProfileKey.self)
        guard UUID(uuidString: key.id)?.uuidString.lowercased() == key.id else { throw VaultError.invalid }
        queue.async { self.unlockEntry(invoke, id: key.id, legacy: false) }
    }

    @objc func unlockLegacy(_ invoke: Invoke) {
        queue.async { self.unlockEntry(invoke, id: nil, legacy: true) }
    }

    /// Decrypted values return only to Rust; the plugin has no webview unlock command.
    private func unlockEntry(_ invoke: Invoke, id: String?, legacy: Bool) {
        let context = self.context()
        defer { context.invalidate() }
        do {
            var query = self.query(id: id, legacy: legacy)
            query[kSecReturnData as String] = true
            query[kSecUseAuthenticationContext as String] = context
            var result: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
                  let data = result as? Data else { throw VaultError.invalid }
            if legacy {
                let login = try JSONDecoder().decode(Credentials.self, from: data)
                invoke.resolve(["user": login.user, "pass": login.pass])
            } else {
                let login = try JSONDecoder().decode(ProfileLogin.self, from: data)
                guard login.profile.valid, login.id == id else { throw VaultError.invalid }
                var value = login.profile.value
                value["user"] = login.user
                value["pass"] = login.pass
                invoke.resolve(value)
            }
        } catch { invoke.reject("Character was not unlocked. Try again or edit its saved login.") }
    }

    @objc func forget(_ invoke: Invoke) throws {
        let key = try invoke.parseArgs(ProfileKey.self)
        guard UUID(uuidString: key.id)?.uuidString.lowercased() == key.id else { throw VaultError.invalid }
        queue.async { self.deleteEntry(invoke, id: key.id, legacy: false) }
    }

    @objc func forgetLegacy(_ invoke: Invoke) {
        queue.async { self.deleteEntry(invoke, id: nil, legacy: true) }
    }

    private func deleteEntry(_ invoke: Invoke, id: String?, legacy: Bool) {
        let status = SecItemDelete(query(id: id, legacy: legacy) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            invoke.reject("Could not delete the saved character.")
            return
        }
        invoke.resolve()
    }
}
private enum VaultError: Error { case invalid }

@_cdecl("init_plugin_secure_login")
func initPlugin() -> Plugin { SecureLoginPlugin() }

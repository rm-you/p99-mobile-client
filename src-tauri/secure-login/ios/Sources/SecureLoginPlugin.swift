import Foundation
import LocalAuthentication
import Security
import Tauri

private struct Credentials: Codable {
    let user: String
    let pass: String
}
private struct ProfileKey: Decodable { let id: String }
private struct ProfileEdit: Decodable { let expected: Profile; let profile: Profile }
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
    private let indexStore = ProfileIndexStore()

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

    private func index() throws -> ProfileIndex {
        try indexStore.load { try KeychainMetadata.exists(matching: self.query()) }
    }

    /// Read the separate nonsecret index without touching protected profile attributes.
    @objc func status(_ invoke: Invoke) {
        queue.async {
            do {
                let index = try self.index()
                let legacySaved = try KeychainMetadata.exists(matching: self.query(legacy: true))
                let context = self.context()
                defer { context.invalidate() }
                var error: NSError?
                let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
                invoke.resolve(["available": available, "profiles": index.profiles.map { $0.value },
                                "legacySaved": legacySaved, "recoveryAvailable": index.recoveryAvailable])
            } catch let error as KeychainMetadata.Failure {
                invoke.reject("Could not inspect saved characters.", code: error.code)
            } catch { invoke.reject("Could not inspect saved characters.") }
        }
    }

    /// Explicitly authorize legacy label recovery; passwords never leave their existing items.
    @objc func recoverProfiles(_ invoke: Invoke) {
        queue.async {
            let context = self.context()
            context.localizedReason = "Restore your saved character list"
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: context.localizedReason) { authorized, _ in
                self.queue.async {
                    defer { context.invalidate() }
                    guard authorized else {
                        invoke.reject("Saved characters were not restored. Unlock your device and try again.")
                        return
                    }
                    do {
                        let profiles = try KeychainMetadata.profiles(matching: self.query(), context: context)
                        try self.indexStore.store(ProfileIndex(profiles: profiles, recoveryAvailable: false))
                        invoke.resolve()
                    } catch let error as KeychainMetadata.Failure {
                        invoke.reject("Saved characters were not restored. Unlock your device and try again.", code: error.code)
                    } catch { invoke.reject("Saved characters were not restored. Unlock your device and try again.") }
                }
            }
        }
    }

    /// Persist both the visible label and protected tuple with the supplied authorization.
    private func write(_ login: ProfileLogin, context: LAContext) throws {
        guard login.profile.valid, !login.user.trimmingCharacters(in: .whitespaces).isEmpty,
              !login.pass.isEmpty, login.user.utf8.count <= 1024, login.pass.utf8.count <= 1024,
              !login.user.contains("\0"), !login.pass.contains("\0") else { throw VaultError.invalid }
        let index = try self.index()
        let profiles = index.profiles.filter { $0.id != login.id } + [login.profile]
        try indexStore.mutate(index, profiles: profiles) {
            try self.writeCredentials(login, context: context)
        }
    }

    private func writeCredentials(_ login: ProfileLogin, context: LAContext) throws {
        let data = try JSONEncoder().encode(login)
        let metadata = try JSONEncoder().encode(login.profile)
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error) else { throw VaultError.invalid }
        var add = query(id: login.id)
        add[kSecAttrAccessControl as String] = access
        add[kSecAttrGeneric as String] = metadata
        add[kSecValueData as String] = data
        var status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            var update = query(id: login.id)
            update[kSecUseAuthenticationContext as String] = context
            status = SecItemUpdate(update as CFDictionary,
                [kSecValueData as String: data, kSecAttrGeneric as String: metadata] as CFDictionary)
        }
        guard status == errSecSuccess else { throw VaultError.invalid }
    }

    /// New credentials replace only the selected profile.
    @objc func save(_ invoke: Invoke) throws {
        let login = try invoke.parseArgs(ProfileLogin.self)
        queue.async {
            let context = self.context()
            defer { context.invalidate() }
            do {
                try self.write(login, context: context)
                invoke.resolve()
            } catch { invoke.reject("Character was not saved.") }
        }
    }

    /// Keep credentials inside one native operation and invalidate authorization immediately afterward.
    @objc func updateProfile(_ invoke: Invoke) throws {
        let edit = try invoke.parseArgs(ProfileEdit.self)
        guard edit.expected.valid, edit.profile.valid,
              edit.expected.id == edit.profile.id else { throw VaultError.invalid }
        queue.async {
            let context = self.context()
            defer { context.invalidate() }
            do {
                let data = try self.read(id: edit.expected.id, legacy: false, context: context)
                let login = try JSONDecoder().decode(ProfileLogin.self, from: data)
                guard login.profile == edit.expected else { throw VaultError.invalid }
                let updated = ProfileLogin(id: edit.profile.id, character: edit.profile.character,
                    server: edit.profile.server, user: login.user, pass: login.pass)
                try self.write(updated, context: context)
                invoke.resolve()
            } catch { invoke.reject("Character was not saved.") }
        }
    }

    private func read(id: String?, legacy: Bool, context: LAContext) throws -> Data {
        var query = self.query(id: id, legacy: legacy)
        query[kSecReturnData as String] = true
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { throw VaultError.invalid }
        return data
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
            let data = try self.read(id: id, legacy: legacy, context: context)
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
        do {
            let remove = {
                let status = SecItemDelete(self.query(id: id, legacy: legacy) as CFDictionary)
                guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError.invalid }
            }
            if legacy { try remove() }
            else {
                let index = try self.index()
                try indexStore.mutate(index, profiles: index.profiles.filter { $0.id != id }, credentials: remove)
            }
            invoke.resolve()
        } catch {
            invoke.reject("Could not delete the saved character.")
        }
    }
}
private enum VaultError: Error { case invalid }

@_cdecl("init_plugin_secure_login")
func initPlugin() -> Plugin { SecureLoginPlugin() }

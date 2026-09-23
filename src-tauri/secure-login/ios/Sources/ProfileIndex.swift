import Foundation
import LocalAuthentication
import Security

/// Nonsecret labels have their own device-only item, without user-presence access control.
/// The protected login remains authoritative when a character is unlocked.
struct ProfileIndex: Codable, Equatable {
    var version = 1
    var profiles: [Profile] = []
    var recoveryAvailable: Bool

    var valid: Bool {
        version == 1 && profiles.allSatisfy { $0.valid } &&
        Set(profiles.map { $0.id }).count == profiles.count
    }
}

/// A recovery marker is persisted before changing credentials, so interrupted writes
/// can rebuild labels with an explicit unlock instead of silently losing an entry.
final class ProfileIndexStore {
    private let query: [String: Any]

    init(service: String = "io.github.rmyou.p99mobile.profile-index.v1") {
        query = [kSecClass as String: kSecClassGenericPassword,
                 kSecAttrService as String: service,
                 kSecAttrAccount as String: "labels"]
    }

    func load(protectedEntriesExist: () throws -> Bool) throws -> ProfileIndex {
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }
        var read = query
        read[kSecUseAuthenticationContext as String] = context
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(read as CFDictionary, &result)
        if status == errSecItemNotFound {
            return ProfileIndex(recoveryAvailable: try protectedEntriesExist())
        }
        guard status == errSecSuccess else { throw failure("index_read", status) }
        guard let data = result as? Data,
              let index = try? JSONDecoder().decode(ProfileIndex.self, from: data), index.valid else {
            throw failure("index_format", errSecDecode)
        }
        return index
    }

    func store(_ index: ProfileIndex) throws {
        guard index.valid else { throw failure("index_format", errSecDecode) }
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }
        let data = try JSONEncoder().encode(index)
        var add = query
        add[kSecUseAuthenticationContext as String] = context
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        add[kSecValueData as String] = data
        var status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            var update = query
            update[kSecUseAuthenticationContext as String] = context
            status = SecItemUpdate(update as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        }
        guard status == errSecSuccess else { throw failure("index_write", status) }
    }

    /// Keep the recovery marker if the protected mutation or final label write fails.
    func mutate(_ index: ProfileIndex, profiles: [Profile], credentials: () throws -> Void) throws {
        var pending = index
        pending.recoveryAvailable = true
        try store(pending)
        try credentials()
        var committed = index
        committed.profiles = profiles
        try store(committed)
    }

    private func failure(_ operation: String, _ status: OSStatus) -> Error {
        NSLog("Secure storage %@ failed: %d", operation, status)
        return KeychainMetadata.Failure(operation: operation, status: status)
    }
}

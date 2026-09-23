import Foundation
import LocalAuthentication
import Security

struct Profile: Codable, Equatable {
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

/// List public labels without reading or authorizing access to the protected login.
/// Keep this separate so native tests can exercise a populated Keychain without Tauri.
enum KeychainMetadata {
    static func profiles(matching query: [String: Any]) throws -> [Profile] {
        let (status, result) = copyAttributes(matching: query, all: true)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess else { throw failure("list", status) }
        guard let entries = result as? [[String: Any]] else {
            throw failure("list format", errSecDecode)
        }
        return try entries.map { entry in
            guard let data = entry[kSecAttrGeneric as String] as? Data,
                  let profile = try? JSONDecoder().decode(Profile.self, from: data),
                  profile.valid, entry[kSecAttrAccount as String] as? String == profile.id else {
                throw failure("profile metadata", errSecDecode)
            }
            return profile
        }
    }

    static func exists(matching query: [String: Any]) throws -> Bool {
        let (status, _) = copyAttributes(matching: query, all: false)
        switch status {
        case errSecSuccess, errSecInteractionNotAllowed, errSecAuthFailed: return true
        case errSecItemNotFound: return false
        default: throw failure("legacy lookup", status)
        }
    }

    private static func copyAttributes(matching query: [String: Any], all: Bool) -> (OSStatus, CFTypeRef?) {
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }
        var attributes = query
        // Use the current noninteractive API, not the deprecated authentication-UI flag.
        attributes[kSecUseAuthenticationContext as String] = context
        attributes[kSecReturnAttributes as String] = true
        attributes[kSecReturnData as String] = false
        attributes[kSecReturnRef as String] = false
        attributes[kSecMatchLimit as String] = all ? kSecMatchLimitAll : kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &result)
        return (status, result)
    }

    private static func failure(_ operation: String, _ status: OSStatus) -> Error {
        // Only a fixed operation name and numeric OS code; never labels or credentials.
        NSLog("Secure storage %@ failed: %d", operation, status)
        return NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
}

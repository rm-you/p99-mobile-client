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

/// Read old protected labels only during explicit recovery. On a physical iPhone,
/// even an attributes-only query can require user presence.
enum KeychainMetadata {
    struct Failure: Error {
        let operation: String
        let status: OSStatus
        var code: String { "keychain.\(operation).\(status)" }
    }
    static func profiles(matching query: [String: Any], context: LAContext) throws -> [Profile] {
        let (status, result) = copyAttributes(matching: query, all: true, context: context)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess else { throw failure("list", status) }
        guard let entries = result as? [[String: Any]] else {
            throw failure("list_format", errSecDecode)
        }
        return try entries.map { entry in
            guard let data = entry[kSecAttrGeneric as String] as? Data,
                  let profile = try? JSONDecoder().decode(Profile.self, from: data),
                  profile.valid, entry[kSecAttrAccount as String] as? String == profile.id else {
                throw failure("profile_metadata", errSecDecode)
            }
            return profile
        }
    }

    static func exists(matching query: [String: Any]) throws -> Bool {
        let (status, _) = copyAttributes(matching: query, all: false)
        switch status {
        case errSecSuccess, errSecInteractionNotAllowed, errSecAuthFailed: return true
        case errSecItemNotFound: return false
        default: throw failure("legacy_lookup", status)
        }
    }

    private static func copyAttributes(matching query: [String: Any], all: Bool,
                                       context suppliedContext: LAContext? = nil) -> (OSStatus, CFTypeRef?) {
        let context = suppliedContext ?? LAContext()
        if suppliedContext == nil { context.interactionNotAllowed = true }
        defer { if suppliedContext == nil { context.invalidate() } }
        var attributes = query
        // Only explicit recovery supplies an interactive authentication context.
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
        return Failure(operation: operation, status: status)
    }
}

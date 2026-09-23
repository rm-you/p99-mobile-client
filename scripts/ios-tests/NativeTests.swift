import XCTest
import LocalAuthentication
import Security
import UIKit

final class KeychainMetadataTests: XCTestCase {
    private var query: [String: Any]!
    private var context: LAContext!
    private var indexService: String!
    private var indexStore: ProfileIndexStore!

    override func setUp() {
        super.setUp()
        context = LAContext()
        context.interactionNotAllowed = true
        indexService = "io.github.rmyou.p99mobile.native-tests.index.\(UUID().uuidString)"
        indexStore = ProfileIndexStore(service: indexService)
        query = [kSecClass as String: kSecClassGenericPassword,
                 kSecAttrService as String: "io.github.rmyou.p99mobile.native-tests.\(UUID().uuidString)"]
    }

    override func tearDown() {
        context.invalidate()
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: indexService!] as CFDictionary)
        SecItemDelete(query as CFDictionary)
        super.tearDown()
    }

    private func insert(_ profile: Profile, access: SecAccessControl? = nil) throws -> OSStatus {
        // A headless test must fail/skip unsupported authentication, never wait for a prompt.
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }
        var entry = query!
        entry[kSecUseAuthenticationContext as String] = context
        entry[kSecAttrAccount as String] = profile.id
        entry[kSecAttrGeneric as String] = try JSONEncoder().encode(profile)
        // Deliberately not a valid login tuple: listing must never decode password data.
        entry[kSecValueData as String] = Data("SYNTHETIC_SECRET_DO_NOT_READ".utf8)
        if let access = access { entry[kSecAttrAccessControl as String] = access }
        else { entry[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly }
        return SecItemAdd(entry as CFDictionary, nil)
    }

    func testListsStoredLabelsAndReadsThemAgainWithoutAnyMemoryCache() throws {
        XCTAssertTrue(try KeychainMetadata.profiles(matching: query, context: context).isEmpty)
        XCTAssertFalse(try KeychainMetadata.exists(matching: query))
        let profiles = ["green", "blue", "quarm"].map {
            Profile(id: UUID().uuidString.lowercased(), character: "ExampleCharacter", server: $0)
        }
        for profile in profiles { XCTAssertEqual(try insert(profile), errSecSuccess) }
        for _ in 0..<2 {
            let stored = try KeychainMetadata.profiles(matching: query, context: context)
            XCTAssertEqual(stored.sorted { $0.id < $1.id }, profiles.sorted { $0.id < $1.id })
        }
        XCTAssertTrue(try KeychainMetadata.exists(matching: query))
        var selected = query!
        selected[kSecAttrAccount as String] = profiles[0].id
        XCTAssertEqual(SecItemDelete(selected as CFDictionary), errSecSuccess)
        XCTAssertEqual(try KeychainMetadata.profiles(matching: query, context: context).count, 2)
    }

    private func insertProtectedProfile() throws -> Profile {
        let access = try XCTUnwrap(SecAccessControlCreateWithFlags(nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil))
        let profile = Profile(id: UUID().uuidString.lowercased(), character: "ExampleCharacter", server: "green")
        let added = try insert(profile, access: access)
        if [errSecNotAvailable, errSecAuthFailed, errSecInteractionNotAllowed].contains(added) {
            throw XCTSkip("This test device cannot create passcode/user-presence protected items; verify on iPhone.")
        }
        XCTAssertEqual(added, errSecSuccess)
        return profile
    }

    func testListsSeparateLabelsWhileProtectedEntriesExist() throws {
        let profile = try insertProtectedProfile()
        try indexStore.store(ProfileIndex(profiles: [profile], recoveryAvailable: false))
        let reloaded = ProfileIndexStore(service: indexService)
        let index = try reloaded.load {
            XCTFail("A persisted index must not query protected entries")
            return true
        }
        XCTAssertEqual(index.profiles, [profile])
        XCTAssertFalse(index.recoveryAvailable)
    }

    func testMissingIndexOffersRecoveryWithoutListingProtectedMetadata() throws {
        let index = try indexStore.load { true }
        XCTAssertTrue(index.profiles.isEmpty)
        XCTAssertTrue(index.recoveryAvailable)
        XCTAssertFalse(try indexStore.load { false }.recoveryAvailable)
    }

    func testInterruptedCredentialMutationKeepsRecoverableLabels() throws {
        enum SyntheticFailure: Error { case interrupted }
        let original = Profile(id: UUID().uuidString.lowercased(), character: "OldCharacter", server: "blue")
        let replacement = Profile(id: original.id, character: "NewCharacter", server: "blue")
        let index = ProfileIndex(profiles: [original], recoveryAvailable: false)
        try indexStore.store(index)
        XCTAssertThrowsError(try indexStore.mutate(index, profiles: [replacement]) {
            throw SyntheticFailure.interrupted
        })
        let reloaded = ProfileIndexStore(service: indexService)
        let pending = try reloaded.load { false }
        XCTAssertEqual(pending.profiles, [original])
        XCTAssertTrue(pending.recoveryAvailable)
        // An explicit successful recovery clears the marker only after labels are durable.
        try reloaded.store(ProfileIndex(profiles: [replacement], recoveryAvailable: false))
        XCTAssertEqual(try reloaded.load { false }.profiles, [replacement])
        XCTAssertFalse(try reloaded.load { false }.recoveryAvailable)
    }

    func testSuccessfulMutationPersistsLabelsAndRejectsInvalidReplacement() throws {
        let profile = Profile(id: UUID().uuidString.lowercased(), character: "ExampleCharacter", server: "quarm")
        let empty = ProfileIndex(recoveryAvailable: false)
        var changed = false
        try indexStore.mutate(empty, profiles: [profile]) { changed = true }
        XCTAssertTrue(changed)
        let saved = try indexStore.load { false }
        XCTAssertEqual(saved.profiles, [profile])
        XCTAssertFalse(saved.recoveryAvailable)
        XCTAssertThrowsError(try indexStore.store(ProfileIndex(profiles: [profile, profile], recoveryAvailable: false)))
        XCTAssertEqual(try indexStore.load { false }, saved)
        let data = try JSONEncoder().encode(saved)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(fields.keys), ["version", "profiles", "recoveryAvailable"])
        let labels = try XCTUnwrap(fields["profiles"] as? [[String: Any]])
        XCTAssertEqual(Set(labels[0].keys), ["id", "character", "server"])
    }

    private func readSecretWithoutAuthentication(_ profile: Profile) -> (OSStatus, CFTypeRef?) {
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }
        var secret = query!
        secret[kSecAttrAccount as String] = profile.id
        secret[kSecUseAuthenticationContext as String] = context
        secret[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(secret as CFDictionary, &result)
        return (status, result)
    }

    func testIndexReadDoesNotAuthorizeProtectedSecretAccess() throws {
        let profile = try insertProtectedProfile()
        // Establish the OS protection before invoking the code under test.
        let before = readSecretWithoutAuthentication(profile)
        #if targetEnvironment(simulator)
        if before.0 == errSecSuccess {
            throw XCTSkip("This Simulator does not enforce user-presence protection; verify secret unlock on iPhone.")
        }
        #endif
        XCTAssertTrue([errSecInteractionNotAllowed, errSecAuthFailed].contains(before.0))
        XCTAssertNil(before.1)
        try indexStore.store(ProfileIndex(profiles: [profile], recoveryAvailable: false))
        XCTAssertEqual(try indexStore.load { false }.profiles, [profile])
        let after = readSecretWithoutAuthentication(profile)
        XCTAssertTrue([errSecInteractionNotAllowed, errSecAuthFailed].contains(after.0))
        XCTAssertNil(after.1)
    }

    func testRejectsMismatchedMetadataWithoutDeletingTheEntry() throws {
        let profile = Profile(id: UUID().uuidString.lowercased(), character: "ExampleCharacter", server: "blue")
        XCTAssertEqual(try insert(profile), errSecSuccess)
        let other = Profile(id: UUID().uuidString.lowercased(), character: "OtherCharacter", server: "blue")
        XCTAssertEqual(SecItemUpdate(query as CFDictionary,
            [kSecAttrGeneric as String: try JSONEncoder().encode(other)] as CFDictionary), errSecSuccess)
        XCTAssertThrowsError(try KeychainMetadata.profiles(matching: query, context: context))
        XCTAssertTrue(try KeychainMetadata.exists(matching: query))
    }
}

final class BackgroundGraceTests: XCTestCase {
    private var expirations: [() -> Void] = []
    private var deadlines: [() -> Void] = []
    private var ended: [UIBackgroundTaskIdentifier] = []
    private var cancelledTimers = 0
    private var refuse = false

    private func controller() -> BackgroundGrace {
        BackgroundGrace(beginTask: { [unowned self] expiration in
            expirations.append(expiration)
            return refuse ? .invalid : UIBackgroundTaskIdentifier(rawValue: expirations.count)
        }, endTask: { [unowned self] in ended.append($0) }, schedule: { [unowned self] duration, callback in
            XCTAssertEqual(duration, 25)
            deadlines.append(callback)
            return { [unowned self] in cancelledTimers += 1 }
        })
    }

    func testOnlyActiveSessionsReceiveOneBoundedGracePerDeparture() {
        let grace = controller()
        grace.setVisible(false)
        XCTAssertTrue(expirations.isEmpty)
        grace.begin(sessionID: "first", visible: true)
        XCTAssertTrue(expirations.isEmpty)
        grace.setVisible(false)
        grace.setVisible(false)
        XCTAssertEqual(expirations.count, 1)
        deadlines[0]()
        XCTAssertEqual(ended.count, 1)
        grace.setVisible(false)
        grace.begin(sessionID: "replacement", visible: false)
        XCTAssertEqual(expirations.count, 1)
        grace.setVisible(true)
        grace.setVisible(false)
        XCTAssertEqual(expirations.count, 2)
        grace.end(sessionID: "replacement")
        XCTAssertEqual(ended.count, 2)
        grace.setVisible(true)
        grace.setVisible(false)
        XCTAssertEqual(expirations.count, 2)
    }

    func testResumeExpiryAndDisconnectReleaseExactlyOnceAndIgnoreStaleCallbacks() {
        let grace = controller()
        grace.begin(sessionID: "first", visible: true)
        grace.setVisible(false)
        grace.setVisible(true)
        XCTAssertEqual(ended.count, 1)
        XCTAssertEqual(cancelledTimers, 1)
        grace.setVisible(false)
        expirations[0]()
        deadlines[0]()
        grace.end(sessionID: "old-session")
        XCTAssertEqual(ended.count, 1)
        expirations[1]()
        deadlines[1]()
        grace.end(sessionID: "first")
        XCTAssertEqual(ended.count, 2)
        XCTAssertEqual(cancelledTimers, 2)
    }

    func testDeniedBackgroundTimeIsNotRetriedUntilForegrounded() {
        refuse = true
        let grace = controller()
        grace.begin(sessionID: "first", visible: true)
        grace.setVisible(false)
        grace.setVisible(false)
        XCTAssertEqual(expirations.count, 1)
        XCTAssertTrue(deadlines.isEmpty)
        XCTAssertTrue(ended.isEmpty)
        grace.setVisible(true)
        refuse = false
        grace.setVisible(false)
        XCTAssertEqual(expirations.count, 2)
        grace.end(sessionID: "first")
        XCTAssertEqual(ended.count, 1)
    }
}

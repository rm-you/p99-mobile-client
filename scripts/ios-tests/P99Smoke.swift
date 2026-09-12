import XCTest

/// Exercise the installed release app through its native accessibility tree; never log in.
final class P99Smoke: XCTestCase {
    func testSettingsPersistAndAppResumes() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "io.github.rmyou.p99mobile")
        app.launch()
        XCTAssertTrue(app.buttons["Login"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["New connection"].exists)
        XCTAssertTrue(app.secureTextFields["Password"].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Saved login could not be checked")).firstMatch.exists)

        app.buttons["Settings"].tap()
        let history = app.switches["Save chat on this device"]
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        XCTAssertEqual(history.value as? String, "1")
        history.tap()
        XCTAssertEqual(history.value as? String, "0")
        // The shared UI debounces autosave by 250 ms; allow it to finish before a force quit.
        Thread.sleep(forTimeInterval: 1)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["Login"].waitForExistence(timeout: 30))
        app.buttons["Settings"].tap()
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        XCTAssertEqual(history.value as? String, "0")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        XCTAssertEqual(history.value as? String, "0")
        history.tap()
        XCTAssertEqual(history.value as? String, "1")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Settings after resume"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

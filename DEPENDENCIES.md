# Components and credits

P99 Mobile Chat uses these open-source components. The lockfiles identify the
exact source revisions and transitive dependencies used for each build; this
page is an entry point to their notices, not a replacement for upstream licenses.

The [MIT license](LICENSE) covers this repository's original application code and
native plugins. It does not relicense the item database, game content, or external
dependencies. Full available dependency license texts and source references are
bundled in [THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt).

| Component | Purpose | License / notices |
| --- | --- | --- |
| React / React DOM | Chat interface | [MIT](https://github.com/facebook/react/blob/main/LICENSE) |
| Tauri | Native application shell and IPC | [MIT or Apache-2.0](https://github.com/tauri-apps/tauri#license) |
| Tauri opener plugin | Explicit browser links | [MIT or Apache-2.0](https://github.com/tauri-apps/plugins-workspace#license) |
| rusqlite | Item queries and local chat history | [MIT](https://github.com/rusqlite/rusqlite/blob/master/LICENSE) |
| SQLite | Embedded database engine | [Public domain](https://sqlite.org/copyright.html) |
| Rust P99 client | Login, world/zone connections, and chat protocol | [Source and notices](https://github.com/rm-you/p99-logger-client) |
| AndroidX | Android UI, device authentication, and file sharing | [Source and notices](https://android.googlesource.com/platform/frameworks/support/) |

Rust dependencies are recorded in `src-tauri/Cargo.lock`; JavaScript dependencies
are recorded in `package-lock.json`. Android platform dependencies are declared
in the native plugins' Gradle files. Build and test tools are not part of the
runtime chat interface.

The offline item catalog comes from **P99 Gear Planner**, thanks to Wermhat,
Project 1999 Wiki contributors, and the EQEmu/PEQ community. Its original SQLite
schema is preserved. See [data provenance and limitations](src-tauri/data/README.md).
Zone-name and default channel-color references are documented in
[game data notes](src/game-data.md).

This project's maintainer has accepted redistribution of the bundled item
snapshot with attribution. Keep its provenance and source credits with copies.
Dependency license metadata in the bundled notices reflects the exact locked
package versions; the networking crate's declaration is maintained upstream.

The P99 speech-bubble artwork and its generation source are included in
[icon source notes](src-tauri/icons/source/README.md).
This is a community client and is not an official Project 1999 or EverQuest app.

// Play on melonDS (Cartridge Sync): runs the game card's town in melonDS and hands every save it writes back to the
// page, so the town can go back to the card afterwards.
//
// Everything lives in ~/Library/Application Support/Leaflet/Play, outside cloud-synced folders, so the ROM backup is
// never uploaded anywhere:
//   Animal Crossing - Wild World.nds   a copy of the person's own ROM backup (melonDS keeps the save next to it)
//   Animal Crossing - Wild World.sav   the save melonDS plays, written from the game card and read back first
//   session.json, start.sav            what the session started from, so a session survives Leaflet being closed
//   Earlier saves/                     any save that was already there, moved aside instead of overwritten
import AppKit
import UniformTypeIdentifiers

final class EmulatorSession {
    struct Failure: Error, CustomStringConvertible { let description: String }

    static let saveSize = 0x40000
    let defaults = UserDefaults.standard
    let fm = FileManager.default
    /// Progress for the page: {state: playing | saved | closed | error, ...}.
    var report: ([String: Any]) -> Void = { _ in }

    var playDir: URL {
        if let test = ProcessInfo.processInfo.environment["LEAFLET_PLAY_DIR"] { return URL(fileURLWithPath: test, isDirectory: true) }   // tests
        return fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Leaflet/Play", isDirectory: true)
    }
    var romCopy: URL { playDir.appendingPathComponent("Animal Crossing - Wild World.nds") }
    var saveFile: URL { playDir.appendingPathComponent("Animal Crossing - Wild World.sav") }
    var sessionFile: URL { playDir.appendingPathComponent("session.json") }
    var startFile: URL { playDir.appendingPathComponent("start.sav") }

    private var app: NSRunningApplication?
    private var timer: Timer?
    private var lastSeen: Data?
    private var observer: NSObjectProtocol?

    // MARK: the person's ROM backup and emulator

    var romURL: URL? {
        guard let p = defaults.string(forKey: "leaflet.romBackup"), fm.fileExists(atPath: p) else { return nil }
        return URL(fileURLWithPath: p)
    }
    /// The 4-letter game code in a DS ROM header (offset 0x0C), e.g. "ADME".
    static func gameCode(_ url: URL) -> String? {
        guard let h = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? h.close() }
        guard let d = try? h.read(upToCount: 0x10), d.count == 0x10 else { return nil }
        return String(bytes: d[0x0C..<0x10], encoding: .ascii)
    }
    var emulatorURL: URL? {
        if let p = defaults.string(forKey: "leaflet.emulator"), fm.fileExists(atPath: p) { return URL(fileURLWithPath: p) }
        for id in ["net.kuribo64.melonDS", "com.melonds.melonDS", "melonDS"] {
            if let u = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) { return u }
        }
        for p in ["/Applications/melonDS.app", "\(fm.homeDirectoryForCurrentUser.path)/Applications/melonDS.app"] where fm.fileExists(atPath: p) {
            return URL(fileURLWithPath: p)
        }
        return nil
    }
    var melonRunning: Bool {
        NSWorkspace.shared.runningApplications.contains { ($0.localizedName ?? "").lowercased().hasPrefix("melonds") || ($0.bundleIdentifier ?? "").lowercased().contains("melonds") }
    }

    /// melonDS's own clock setting (seconds added to the Mac's clock: "RTC.Offset" in melonDS.toml), so Leaflet knows
    /// what time the game sees there. 0 when melonDS hasn't been set up yet.
    var melonClockOffset: Int {
        let toml = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Preferences/melonDS/melonDS.toml")
        guard let text = try? String(contentsOf: toml, encoding: .utf8) else { return 0 }
        var section = ""
        for raw in text.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") { section = line.trimmingCharacters(in: CharacterSet(charactersIn: "[] ")); continue }
            let parts = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2 else { continue }
            let key = section.isEmpty ? parts[0] : "\(section).\(parts[0])"
            if key == "Instance0.RTC.Offset" { return Int(parts[1]) ?? 0 }
        }
        return 0
    }

    func status() -> [String: Any] {
        var s: [String: Any] = ["running": melonRunning, "playing": app != nil, "rtcOffset": melonClockOffset]
        if let r = romURL { s["rom"] = r.lastPathComponent; s["romCode"] = EmulatorSession.gameCode(r) ?? "" }
        if let e = emulatorURL { s["emulator"] = e.deletingPathExtension().lastPathComponent }
        if let pending = pendingSession() { s["pending"] = pending }
        return s
    }

    func chooseROM(in window: NSWindow, done: @escaping (String?) -> Void) {
        let panel = NSOpenPanel()
        panel.message = "Choose the backup (.nds) you made from your own Wild World game card"
        if let nds = UTType(filenameExtension: "nds") { panel.allowedContentTypes = [nds] }
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let url = panel.url else { return done(nil) }
            guard let code = EmulatorSession.gameCode(url), code.hasPrefix("ADM") else { return done("That file isn’t Animal Crossing: Wild World.") }
            self.defaults.set(url.path, forKey: "leaflet.romBackup")
            done(nil)
        }
    }
    func chooseEmulator(in window: NSWindow, done: @escaping (String?) -> Void) {
        let panel = NSOpenPanel()
        panel.message = "Choose melonDS"
        panel.allowedContentTypes = [.application]
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let url = panel.url else { return done(nil) }
            self.defaults.set(url.path, forKey: "leaflet.emulator")
            done(nil)
        }
    }

    // MARK: a session

    /// Writes the town where melonDS will play it and starts melonDS. `cardCode` is the game card's code: the ROM must
    /// be the same version, or the game wouldn't read the save.
    /// `save` is what melonDS plays (its game clock already moved to suit melonDS's clock); `start` is the game card's
    /// save as it was read, kept to tell later whether the card changed in the meantime.
    func play(save: Data, start: Data, cardCode: String, town: String) throws {
        guard app == nil else { throw Failure(description: "melonDS is already playing a town from Leaflet.") }
        guard save.count == EmulatorSession.saveSize else { throw Failure(description: "The save must be 256 KB.") }
        guard let rom = romURL else { throw Failure(description: "Choose your ROM backup first.") }
        guard let code = EmulatorSession.gameCode(rom), code.hasPrefix("ADM") else { throw Failure(description: "Your ROM backup isn’t Animal Crossing: Wild World any more. Choose it again.") }
        guard code == cardCode else { throw Failure(description: "Your ROM backup is the \(code) version, but the game card is \(cardCode). Saves only work with the same version.") }
        guard let emulator = emulatorURL else { throw Failure(description: "Leaflet couldn’t find melonDS. Choose where it is.") }
        guard !melonRunning else { throw Failure(description: "melonDS is already open. Quit it first, so it starts with your town.") }
        if pendingSession() != nil { throw Failure(description: "A town played earlier hasn’t been sent back or set aside yet.") }

        try fm.createDirectory(at: playDir, withIntermediateDirectories: true)
        // The ROM copy: refreshed when the backup differs (size and content), never read from the cloud.
        let src = try Data(contentsOf: rom, options: .mappedIfSafe)
        if (try? Data(contentsOf: romCopy, options: .mappedIfSafe)) != src { try src.write(to: romCopy, options: .atomic) }
        // A save already here (an earlier session) is moved aside, never overwritten.
        if fm.fileExists(atPath: saveFile.path) {
            let older = playDir.appendingPathComponent("Earlier saves", isDirectory: true)
            try fm.createDirectory(at: older, withIntermediateDirectories: true)
            try fm.moveItem(at: saveFile, to: older.appendingPathComponent("\(EmulatorSession.stamp()).sav"))
        }
        for (url, data) in [(saveFile, save), (startFile, start)] {
            try data.write(to: url, options: .atomic)
            guard (try? Data(contentsOf: url)) == data else { throw Failure(description: "The save didn’t read back the same from disk.") }
        }
        let info: [String: Any] = ["town": town, "cardCode": cardCode, "started": Date().timeIntervalSince1970]
        try JSONSerialization.data(withJSONObject: info).write(to: sessionFile, options: .atomic)

        lastSeen = save
        launch(emulator)
    }

    /// Plays the session's town again (after "Keep playing"), from the save melonDS last wrote.
    func resume() throws {
        guard app == nil else { throw Failure(description: "melonDS is already playing.") }
        guard pendingSession() != nil else { throw Failure(description: "There’s no town waiting in melonDS.") }
        guard let emulator = emulatorURL else { throw Failure(description: "Leaflet couldn’t find melonDS. Choose where it is.") }
        guard !melonRunning else { throw Failure(description: "melonDS is already open. Quit it first.") }
        guard fm.fileExists(atPath: romCopy.path) else { throw Failure(description: "The ROM copy is missing. Set this town aside and start again.") }
        lastSeen = try? Data(contentsOf: saveFile)
        launch(emulator)
    }

    private func launch(_ emulator: URL) {
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.arguments = [romCopy.path]
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: emulator, configuration: cfg) { running, error in
            DispatchQueue.main.async {
                guard let running = running, error == nil else {
                    // A downloaded app that macOS hasn't let open yet: it's waiting for "Open Anyway" in Privacy & Security.
                    let downloaded = (try? emulator.resourceValues(forKeys: [.quarantinePropertiesKey]))?.quarantineProperties != nil
                    self.report(["state": "error", "blocked": downloaded, "error": downloaded
                        ? "macOS didn’t let melonDS open yet, because Apple hasn’t checked it (melonDS isn’t notarized). Open Privacy & Security, click Open Anyway next to melonDS, then press Play again. Your town is safe; nothing changed."
                        : "melonDS didn’t start: \(error?.localizedDescription ?? "unknown error"). Your town is safe; nothing changed."])
                    return
                }
                self.watch(running)
            }
        }
    }

    private func watch(_ running: NSRunningApplication) {
        app = running
        report(["state": "playing", "emulator": running.localizedName ?? "melonDS"])
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.check() }
        observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, let gone = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, gone.processIdentifier == self.app?.processIdentifier else { return }
            self.check()
            if self.app != nil { self.finish() }
        }
    }

    /// Each time melonDS writes the save, the new version goes to the page (which keeps it in Backups). The session
    /// ends when melonDS's process is really gone (the system's quit notification also ends it, whichever is first).
    private func check() {
        if let d = try? Data(contentsOf: saveFile), d.count >= EmulatorSession.saveSize, d != lastSeen {
            lastSeen = d
            report(["state": "saved", "data": d.prefix(EmulatorSession.saveSize).base64EncodedString()])
        }
        if let a = app, a.processIdentifier > 0, kill(a.processIdentifier, 0) != 0, errno == ESRCH { finish() }
    }

    private func finish() {
        timer?.invalidate(); timer = nil
        if let o = observer { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        observer = nil; app = nil
        if let p = pendingSession() { var s = p; s["state"] = "closed"; report(s) }
    }

    /// A session whose town hasn't been sent back or set aside: what it started from and where it is now.
    func pendingSession() -> [String: Any]? {
        guard let j = try? Data(contentsOf: sessionFile), var info = (try? JSONSerialization.jsonObject(with: j)) as? [String: Any],
              let start = try? Data(contentsOf: startFile), let now = try? Data(contentsOf: saveFile), now.count >= EmulatorSession.saveSize else { return nil }
        info["start"] = start.base64EncodedString()
        info["data"] = now.prefix(EmulatorSession.saveSize).base64EncodedString()
        info["active"] = app != nil
        return info
    }
    /// Called once the town is back on the game card (or the person sets it aside): the session is closed, and its
    /// save moves to Earlier saves.
    func close() {
        guard app == nil else { return }
        let older = playDir.appendingPathComponent("Earlier saves", isDirectory: true)
        try? fm.createDirectory(at: older, withIntermediateDirectories: true)
        if fm.fileExists(atPath: saveFile.path) { try? fm.moveItem(at: saveFile, to: older.appendingPathComponent("\(EmulatorSession.stamp()).sav")) }
        try? fm.removeItem(at: sessionFile)
        try? fm.removeItem(at: startFile)
    }

    static func stamp() -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH.mm.ss"; return f.string(from: Date()) }
}

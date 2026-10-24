// Leaflet for macOS: a native window around the web editor.
// Build with mac/build.sh. Uses only AppKit + WebKit (no Xcode project needed).
import AppKit
import UniformTypeIdentifiers
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var pendingOpen: URL?
    // Automatic backups: the open save is watched for writes by the game or an emulator, and every backup the page
    // makes is also copied to ~/Documents/Leaflet Backups/<town>/.
    var watchedURL: URL?
    var watchedMod: Date?
    var watchTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "leaflet")
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { web.isInspectable = true }

        // Sidebar vibrancy shows through the page's translucent sidebar.
        let effect = NSVisualEffectView()
        effect.material = .sidebar
        effect.blendingMode = .behindWindow
        effect.state = .followsWindowActiveState
        web.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            web.topAnchor.constraint(equalTo: effect.topAnchor),
            web.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.title = "Leaflet"
        window.minSize = NSSize(width: 900, height: 620)
        window.contentView = effect
        window.delegate = self
        window.setFrameAutosaveName("LeafletMain")
        window.center()
        window.makeKeyAndOrderFront(nil)

        let web_dir = Bundle.main.resourceURL!.appendingPathComponent("web")
        web.loadFileURL(web_dir.appendingPathComponent("index.html"), allowingReadAccessTo: web_dir)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // Opening a .sav by dropping it on the Dock icon or with "Open With".
    func application(_ app: NSApplication, open urls: [URL]) {
        guard let url = urls.first else { return }
        if web == nil || web.isLoading { pendingOpen = url } else { load(url) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let url = pendingOpen { pendingOpen = nil; load(url) }
    }

    // MARK: unsaved changes

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        confirmDiscard { ok in NSApp.reply(toApplicationShouldTerminate: ok) }
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        confirmDiscard { ok in if ok { NSApp.terminate(nil) } }
        return false
    }

    func confirmDiscard(_ done: @escaping (Bool) -> Void) {
        web.evaluateJavaScript("window.APP && APP.isDirty ? APP.isDirty() : false") { result, _ in
            guard (result as? Bool) == true else { return done(true) }
            let alert = NSAlert()
            alert.messageText = "You have unsaved changes"
            alert.informativeText = "Save your town before leaving, or your edits will be lost."
            alert.addButton(withTitle: "Save…")
            alert.addButton(withTitle: "Cancel")
            alert.addButton(withTitle: "Don’t Save")
            alert.beginSheetModal(for: self.window) { resp in
                switch resp {
                case .alertFirstButtonReturn: self.web.evaluateJavaScript("APP.saveFile()"); done(false)
                case .alertThirdButtonReturn: done(true)
                default: done(false)
                }
            }
        }
    }

    // MARK: bridge

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "open": openPanel()
        case "watch": setWatching(body["on"] as? Bool ?? false)
        case "backupFile":
            guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return }
            writeBackup(data: data, town: body["town"] as? String ?? "Town", name: body["name"] as? String ?? "backup.sav")
        case "revealBackups":
            let dir = backupsDir()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            NSWorkspace.shared.open(dir)
        case "save":
            guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return }
            savePanel(data: data, name: body["name"] as? String ?? "Animal Crossing - Wild World.sav")
        default: break
        }
    }

    @objc func openPanel() {
        let panel = NSOpenPanel()
        panel.message = "Choose an Animal Crossing: Wild World save"
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { resp in
            if resp == .OK, let url = panel.url { self.load(url) }
        }
    }

    func load(_ url: URL) {
        guard let data = try? Data(contentsOf: url) else { return }
        watchedURL = url.standardizedFileURL
        watchedMod = modDate(url)
        let name = url.lastPathComponent.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: "\\'")
        web.evaluateJavaScript("APP.nativeOpened('\(data.base64EncodedString())', '\(name)')")
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
    }

    func savePanel(data: Data, name: String) {
        let panel = NSSavePanel()
        panel.message = "Save a copy of your town. Keep your original as a backup!"
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url, options: .atomic)
                let same = url.standardizedFileURL == self.watchedURL
                if same { self.watchedMod = self.modDate(url) }
                let n = url.lastPathComponent.replacingOccurrences(of: "'", with: "\\'")
                self.web.evaluateJavaScript("APP.nativeSaved(true, '\(n)', \(same))")
            } catch {
                NSAlert(error: error).beginSheetModal(for: self.window)
            }
        }
    }

    // MARK: backups

    func modDate(_ url: URL) -> Date? { (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate }

    func setWatching(_ on: Bool) {
        watchTimer?.invalidate(); watchTimer = nil
        guard on else { return }
        watchTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.checkWatched() }
    }

    func checkWatched() {
        guard let url = watchedURL, let mod = modDate(url), mod != watchedMod else { return }
        watchedMod = mod
        guard let data = try? Data(contentsOf: url) else { return }
        let n = url.lastPathComponent.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: "\\'")
        web.evaluateJavaScript("APP.nativeFileChanged('\(data.base64EncodedString())', '\(n)')")
    }

    func backupsDir() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Leaflet Backups", isDirectory: true)
    }

    func writeBackup(data: Data, town: String, name: String) {
        let clean = { (s: String) in s.components(separatedBy: CharacterSet(charactersIn: "/:\\")).joined(separator: "-").trimmingCharacters(in: .whitespaces) }
        let dir = backupsDir().appendingPathComponent(clean(town).isEmpty ? "Town" : clean(town), isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: dir.appendingPathComponent(clean(name)), options: .atomic)
        } catch { NSLog("Leaflet backup failed: \(error)") }
    }

    // <input type=file> inside the page.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { resp in completionHandler(resp == .OK ? panel.urls : nil) }
    }

    // Downloads (pattern PNG/.acww export, backups) go through a save panel.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if action.shouldPerformDownload || action.request.url?.scheme == "blob" {
            decisionHandler(.download, preferences)
        } else if let url = action.request.url, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url); decisionHandler(.cancel, preferences)
        } else {
            decisionHandler(.allow, preferences)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

    // MARK: menus

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem(); let menu = NSMenu(title: title)
            items.forEach(menu.addItem); item.submenu = menu; main.addItem(item)
        }
        func mi(_ t: String, _ a: Selector?, _ k: String = "", _ m: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = m; return i
        }
        add("Leaflet", [mi("About Leaflet", #selector(about)), .separator(), mi("Hide Leaflet", #selector(NSApplication.hide(_:)), "h"),
                        mi("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
                        mi("Quit Leaflet", #selector(NSApplication.terminate(_:)), "q")])
        add("File", [mi("Open Save…", #selector(openPanel), "o"), mi("Save a Copy…", #selector(saveCopy), "s"), .separator(),
                     mi("Close Window", #selector(NSWindow.performClose(_:)), "w")])
        add("Edit", [mi("Undo", Selector(("undo:")), "z"), mi("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
                     mi("Cut", #selector(NSText.cut(_:)), "x"), mi("Copy", #selector(NSText.copy(_:)), "c"),
                     mi("Paste", #selector(NSText.paste(_:)), "v"), mi("Select All", #selector(NSText.selectAll(_:)), "a"), .separator(),
                     mi("Find Option…", #selector(findOption), "f")])
        add("View", [mi("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
                     mi("Reload", #selector(reload), "r", [.command, .option])])
        add("Window", [mi("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"), mi("Zoom", #selector(NSWindow.performZoom(_:)))])
        NSApp.mainMenu = main
    }

    @objc func saveCopy() { web.evaluateJavaScript("APP.saveFile()") }
    @objc func findOption() { web.evaluateJavaScript("document.getElementById('globalSearch').focus()") }
    @objc func reload() { web.reload() }
    @objc func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Leaflet",
            .credits: NSAttributedString(string: "A cozy save editor for Animal Crossing: Wild World.\nBuilt on research from ACSE, WildEdit, LeafEdit, WildStorage and the ACWW decompilation.\nNot affiliated with Nintendo.",
                                         attributes: [.font: NSFont.systemFont(ofSize: 11)]),
        ])
    }
}

extension AppDelegate: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { resp in completionHandler(resp == .OK ? panel.url : nil) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

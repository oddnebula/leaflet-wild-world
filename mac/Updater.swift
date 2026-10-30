// Updates Leaflet itself: the newest release on Leaflet's GitHub page, checked against the SHA-256 GitHub publishes,
// unpacked, its bundle id and code signature checked, swapped in place of this copy, and started again. The page's
// storage (settings, backups) belongs to the bundle id, so the new copy opens with everything the old one had.
import AppKit
import CryptoKit

final class Updater: NSObject, URLSessionDownloadDelegate {
    struct Failure: Error, CustomStringConvertible { let description: String }

    /// Progress for the page: {state: downloading (pct) | installing | done (version) | error}.
    var report: ([String: Any]) -> Void = { _ in }
    private var session: URLSession?
    private var expected = "", version = "", busy = false

    var apiURL: URL { URL(string: ProcessInfo.processInfo.environment["LEAFLET_UPDATE_API"] ?? "https://api.github.com/repos/oddnebula/leaflet-wild-world/releases/latest")! }

    func run() {
        guard !busy else { return }
        // A copy macOS is running from a temporary read-only place (opened straight from Downloads) can't be replaced.
        let target = Bundle.main.bundleURL
        if target.path.contains("/AppTranslocation/") { report(["state": "error", "error": "Move Leaflet to your Applications folder, open it from there, then update."]); return }
        guard FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
            report(["state": "error", "error": "Leaflet can’t write to the folder it’s in (\(target.deletingLastPathComponent().path)). Move it to your Applications folder, or download the update from GitHub."]); return
        }
        busy = true
        report(["state": "downloading", "pct": 0])
        var req = URLRequest(url: apiURL)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { data, _, error in
            do {
                guard let data = data, error == nil else { throw Failure(description: "Leaflet couldn’t reach GitHub. Check the internet connection.") }
                guard let release = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let assets = release["assets"] as? [[String: Any]],
                      let asset = assets.first(where: { ($0["name"] as? String) == "Leaflet-macOS.zip" }),
                      let urlString = asset["browser_download_url"] as? String, let url = URL(string: urlString)
                else { throw Failure(description: "The newest release has no Mac download.") }
                guard let digest = asset["digest"] as? String, digest.hasPrefix("sha256:") else { throw Failure(description: "GitHub didn’t give a checksum for the download, so Leaflet won’t install it. Download it from GitHub instead.") }
                self.expected = String(digest.dropFirst(7)).lowercased()
                self.version = (release["tag_name"] as? String ?? "").replacingOccurrences(of: "v", with: "")
                self.session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
                self.session?.downloadTask(with: url).resume()
            } catch { self.fail(error) }
        }.resume()
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten done: Int64, totalBytesExpectedToWrite total: Int64) {
        if total > 0 { report(["state": "downloading", "pct": Int(100 * done / total)]) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 { throw Failure(description: "GitHub answered \(http.statusCode) for the download.") }
            let zip = try Data(contentsOf: location)
            guard SHA256.hash(data: zip).map({ String(format: "%02x", $0) }).joined() == expected else { throw Failure(description: "The download didn’t match the checksum GitHub published, so it wasn’t installed. Try again later.") }
            report(["state": "installing"])
            try install(zip)
            report(["state": "done", "version": version])
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.relaunch() }
        } catch { fail(error) }
        s.finishTasksAndInvalidate()
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { fail(Failure(description: "The download stopped: \(error.localizedDescription)")) }
    }

    private func install(_ zip: Data) throws {
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent("leaflet-update-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: work) }
        let zipFile = work.appendingPathComponent("Leaflet.zip")
        try zip.write(to: zipFile)
        let unzip = Process()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        unzip.arguments = ["-x", "-k", zipFile.path, work.appendingPathComponent("out").path]
        try unzip.run(); unzip.waitUntilExit()
        guard unzip.terminationStatus == 0 else { throw Failure(description: "The download couldn’t be unpacked.") }
        let app = work.appendingPathComponent("out/Leaflet.app")
        // The same app (so it keeps this one's storage), whole and with an intact signature.
        guard let b = Bundle(url: app), b.bundleIdentifier == Bundle.main.bundleIdentifier, b.executableURL.map({ fm.fileExists(atPath: $0.path) }) == true
        else { throw Failure(description: "The download didn’t contain Leaflet.") }
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let c = code,
              SecStaticCodeCheckValidity(c, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode), nil) == errSecSuccess
        else { throw Failure(description: "The download’s code signature didn’t check out, so it wasn’t installed.") }
        // Swapped in one step; the running copy keeps working until it quits.
        _ = try fm.replaceItemAt(Bundle.main.bundleURL, withItemAt: app)
    }

    /// Opens the new copy once this one has quit.
    private func relaunch() {
        let sh = Process()
        sh.executableURL = URL(fileURLWithPath: "/bin/sh")
        sh.arguments = ["-c", "while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.3; done; open \"$0\"", Bundle.main.bundleURL.path]
        try? sh.run()
        NSApp.terminate(nil)
    }

    private func fail(_ error: Error) {
        busy = false
        report(["state": "error", "error": "\(error)"])
    }
}

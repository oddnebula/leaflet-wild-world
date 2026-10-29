// Installs melonDS for Play on melonDS: the latest macOS build from melonDS's official GitHub releases, checked
// against the SHA-256 GitHub publishes for it, unpacked, its code signature checked, and put in ~/Applications (no
// admin password). An older copy goes to the Trash. The app is marked as downloaded from the internet, exactly as a
// browser download would be, so macOS's own first-launch check still applies.
import AppKit
import CryptoKit

final class MelonInstaller: NSObject, URLSessionDownloadDelegate {
    struct Failure: Error, CustomStringConvertible { let description: String }

    /// Progress for the page: {state: checking | downloading (progress) | installing | done (version, path) | error}.
    var report: ([String: Any]) -> Void = { _ in }
    private var session: URLSession?

    // Overridable for tests (a local stand-in for GitHub and a scratch Applications folder).
    var apiURL: URL { URL(string: ProcessInfo.processInfo.environment["LEAFLET_MELON_API"] ?? "https://api.github.com/repos/melonDS-emu/melonDS/releases/latest")! }
    var appsDir: URL {
        if let t = ProcessInfo.processInfo.environment["LEAFLET_APPS_DIR"] { return URL(fileURLWithPath: t, isDirectory: true) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
    }

    func install(completion: @escaping (URL?) -> Void) {
        report(["state": "checking"])
        var req = URLRequest(url: apiURL)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { data, _, error in
            do {
                guard let data = data, error == nil else { throw Failure(description: "Couldn’t reach GitHub to find melonDS. Check your internet connection.") }
                guard let release = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let assets = release["assets"] as? [[String: Any]],
                      let asset = assets.first(where: { ($0["name"] as? String ?? "").range(of: #"macOS.*\.zip$"#, options: [.regularExpression, .caseInsensitive]) != nil }),
                      let urlString = asset["browser_download_url"] as? String, let url = URL(string: urlString)
                else { throw Failure(description: "The latest melonDS release has no macOS download.") }
                // GitHub publishes each file's SHA-256; without it the download couldn't be checked, so it isn't installed.
                guard let digest = asset["digest"] as? String, digest.hasPrefix("sha256:") else { throw Failure(description: "GitHub didn’t give a checksum for melonDS’s download, so Leaflet won’t install it. Download it from melonDS’s site instead.") }
                let version = release["tag_name"] as? String ?? ""
                self.download(url, sha256: String(digest.dropFirst(7)).lowercased(), version: version, completion: completion)
            } catch {
                self.fail(error, completion)
            }
        }.resume()
    }

    private var expected = "", version = "", completionBlock: ((URL?) -> Void)?
    private func download(_ url: URL, sha256: String, version: String, completion: @escaping (URL?) -> Void) {
        expected = sha256; self.version = version; completionBlock = completion
        report(["state": "downloading", "progress": 0, "version": version])
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        session?.downloadTask(with: url).resume()
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten done: Int64, totalBytesExpectedToWrite total: Int64) {
        if total > 0 { report(["state": "downloading", "progress": Double(done) / Double(total), "version": version]) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let completion = completionBlock ?? { _ in }
        do {
            if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 { throw Failure(description: "GitHub answered \(http.statusCode) for the download.") }
            let zip = try Data(contentsOf: location)
            let hash = SHA256.hash(data: zip).map { String(format: "%02x", $0) }.joined()
            guard hash == expected else { throw Failure(description: "The download didn’t match the checksum GitHub published, so it wasn’t installed. Try again later.") }
            report(["state": "installing", "version": version])
            let app = try unpackAndInstall(zip)
            report(["state": "done", "version": version, "path": app.path])
            DispatchQueue.main.async { completion(app) }
        } catch {
            fail(error, completion)
        }
        s.finishTasksAndInvalidate()
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { fail(Failure(description: "The download stopped: \(error.localizedDescription)"), completionBlock ?? { _ in }) }
    }

    private func unpackAndInstall(_ zip: Data) throws -> URL {
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent("leaflet-melonds-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: work) }
        let zipFile = work.appendingPathComponent("melonDS.zip")
        try zip.write(to: zipFile)
        let unzip = Process()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        unzip.arguments = ["-x", "-k", zipFile.path, work.appendingPathComponent("out").path]
        try unzip.run(); unzip.waitUntilExit()
        guard unzip.terminationStatus == 0 else { throw Failure(description: "The download couldn’t be unpacked.") }
        // The app may sit at the top of the zip or one folder down.
        let out = work.appendingPathComponent("out")
        let found = (fm.enumerator(at: out, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles, .skipsPackageDescendants])?.allObjects as? [URL] ?? [])
            .first { $0.pathExtension == "app" && $0.lastPathComponent.lowercased().hasPrefix("melonds") }
        guard let app = found, Bundle(url: app)?.executableURL.map({ fm.fileExists(atPath: $0.path) }) == true else { throw Failure(description: "The download didn’t contain melonDS.app.") }
        // The bundle's code signature must be intact (nothing altered after it was signed).
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let c = code,
              SecStaticCodeCheckValidity(c, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), nil) == errSecSuccess
        else { throw Failure(description: "melonDS’s code signature didn’t check out, so it wasn’t installed.") }

        try fm.createDirectory(at: appsDir, withIntermediateDirectories: true)
        let dest = appsDir.appendingPathComponent("melonDS.app")
        if fm.fileExists(atPath: dest.path) {
            // An older copy goes to the Trash, so it can be recovered (tests use a scratch folder and just replace it).
            if ProcessInfo.processInfo.environment["LEAFLET_APPS_DIR"] != nil { try fm.removeItem(at: dest) } else { try fm.trashItem(at: dest, resultingItemURL: nil) }
        }
        try fm.copyItem(at: app, to: dest)
        // Marked as downloaded, like a browser download, so macOS checks it the first time it opens.
        var values = URLResourceValues()
        values.quarantineProperties = [kLSQuarantineAgentNameKey as String: "Leaflet", kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String]
        var marked = dest
        try? marked.setResourceValues(values)
        return dest
    }

    private func fail(_ error: Error, _ completion: @escaping (URL?) -> Void) {
        report(["state": "error", "error": "\(error)"])
        DispatchQueue.main.async { completion(nil) }
    }
}

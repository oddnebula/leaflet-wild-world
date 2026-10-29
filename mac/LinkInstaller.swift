// Sends Leaflet Link to a 3DS over Wi-Fi, the way devkitPro's 3dslink does: the Homebrew Launcher, after Y is
// pressed, answers a "3dsboot" broadcast on UDP 17491, then takes the app over TCP 17491, saves it to
// sdmc:/3ds/<name> and starts it.
//   Transfer: int32 name length, name, int32 size -> int32 status (0 ok, -1 can't create, -2 no space, -3 no memory),
//   zlib data as (int32 length, at most 16 KB) chunks -> int32 status, then int32 length + the launch arguments.
import Foundation

enum LinkInstaller {
    static let port: UInt16 = 17491

    struct Failure: Error, CustomStringConvertible { let description: String }

    /// Looks for a Homebrew Launcher waiting with Y pressed. Returns its IPv4 address, or nil after `seconds`.
    static func discover(seconds: Double) -> String? {
        let s = socket(AF_INET, SOCK_DGRAM, 0)
        guard s >= 0 else { return nil }
        defer { close(s) }
        var on: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_BROADCAST, &on, 4)
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &on, 4)
        setsockopt(s, SOL_SOCKET, SO_REUSEPORT, &on, 4)
        var me = sockaddr_in(); me.sin_family = sa_family_t(AF_INET); me.sin_port = port.bigEndian; me.sin_addr.s_addr = INADDR_ANY
        let bound = withUnsafePointer(to: &me) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard bound == 0 else { return nil }
        _ = fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK)

        let targets = broadcastAddresses()
        let end = Date().addingTimeInterval(seconds)
        var nextPing = Date.distantPast
        var buf = [UInt8](repeating: 0, count: 256)
        while Date() < end {
            if Date() >= nextPing {
                for t in targets {
                    var to = sockaddr_in(); to.sin_family = sa_family_t(AF_INET); to.sin_port = port.bigEndian; to.sin_addr = t
                    _ = "3dsboot".withCString { p in withUnsafePointer(to: &to) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(s, p, 7, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } }
                }
                nextPing = Date().addingTimeInterval(0.3)
            }
            var from = sockaddr_in(); var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &from) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(s, &buf, buf.count, 0, $0, &len) } }
            if n >= 7, String(decoding: buf[0..<7], as: UTF8.self) == "boot3ds" { return String(cString: inet_ntoa(from.sin_addr)) }
            usleep(20_000)
        }
        return nil
    }

    /// Finds Leaflet Link on the local network: it answers a "leaflet-link?" broadcast on UDP 8226 with
    /// "leaflet-link <version> <card code>". Listens for `seconds`, or a moment after the first answer.
    static func findLeafletLink(seconds: Double) -> [[String: String]] {
        let s = socket(AF_INET, SOCK_DGRAM, 0)
        guard s >= 0 else { return [] }
        defer { close(s) }
        var on: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_BROADCAST, &on, 4)
        _ = fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK)
        var targets = broadcastAddresses()
        // Tests: this Mac doesn't hear its own broadcasts, so a simulator on it is asked directly.
        if let extra = ProcessInfo.processInfo.environment["LEAFLET_DISCOVERY_EXTRA"] { var a = in_addr(); if inet_pton(AF_INET, extra, &a) == 1 { targets.append(a) } }
        var end = Date().addingTimeInterval(seconds), nextPing = Date.distantPast
        var found: [[String: String]] = []
        var buf = [UInt8](repeating: 0, count: 128)
        while Date() < end {
            if Date() >= nextPing {
                for t in targets {
                    var to = sockaddr_in(); to.sin_family = sa_family_t(AF_INET); to.sin_port = UInt16(8226).bigEndian; to.sin_addr = t
                    _ = "leaflet-link?".withCString { p in withUnsafePointer(to: &to) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(s, p, 13, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } }
                }
                nextPing = Date().addingTimeInterval(0.4)
            }
            var from = sockaddr_in(); var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &from) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(s, &buf, buf.count, 0, $0, &len) } }
            if n > 0 {
                let parts = String(decoding: buf[0..<n], as: UTF8.self).split(separator: " ").map(String.init)
                let address = String(cString: inet_ntoa(from.sin_addr))
                if parts.count >= 3, parts[0] == "leaflet-link", !found.contains(where: { $0["address"] == address }) {
                    found.append(["address": address, "version": parts[1], "card": parts[2] == "-" ? "" : parts[2]])
                    end = min(end, Date().addingTimeInterval(0.8))   // others on the network answer at about the same time
                }
            } else { usleep(20_000) }
        }
        return found
    }

    /// 255.255.255.255 plus each network interface's own broadcast address (more reliable on Macs with several).
    static func broadcastAddresses() -> [in_addr] {
        var out = [in_addr(s_addr: INADDR_BROADCAST)]
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return out }
        defer { freeifaddrs(list) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard i.ifa_flags & UInt32(IFF_BROADCAST) != 0, i.ifa_flags & UInt32(IFF_UP) != 0, let b = i.ifa_dstaddr, b.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let a = b.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
            if !out.contains(where: { $0.s_addr == a.s_addr }) { out.append(a) }
        }
        return out
    }

    /// Sends the app. `progress` gets 0...1 as the data goes out.
    static func send(_ app: Data, name: String, to address: String, progress: (Double) -> Void) throws {
        var addr = in_addr()
        guard inet_pton(AF_INET, address, &addr) == 1 else { throw Failure(description: "“\(address)” isn’t an address like 192.168.1.23.") }
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { throw Failure(description: "Couldn’t open a network connection.") }
        defer { close(s) }
        var on: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &on, 4)
        var tv = timeval(tv_sec: 20, tv_usec: 0)
        setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        try connect(s, addr, seconds: 5)

        func put(_ d: Data) throws {
            var sent = 0
            while sent < d.count {
                let n = d.withUnsafeBytes { Darwin.send(s, $0.baseAddress! + sent, d.count - sent, 0) }
                if n <= 0 { throw Failure(description: "The 3DS stopped receiving.") }
                sent += n
            }
        }
        func int32(_ v: Int) -> Data { withUnsafeBytes(of: Int32(v).littleEndian) { Data($0) } }
        func status() throws -> Int32 {
            var v: Int32 = 0, got = 0
            while got < 4 {
                let n = withUnsafeMutableBytes(of: &v) { recv(s, $0.baseAddress! + got, 4 - got, 0) }
                if n <= 0 { throw Failure(description: "The 3DS stopped answering.") }
                got += n
            }
            return Int32(littleEndian: v)
        }

        try put(int32(name.utf8.count) + Data(name.utf8) + int32(app.count))
        switch try status() {
        case 0: break
        case -1: throw Failure(description: "The 3DS couldn’t create the file on its SD card. Is the card locked?")
        case -2: throw Failure(description: "The 3DS’s SD card is full.")
        case -3: throw Failure(description: "The 3DS ran out of memory. Restart the Homebrew Launcher and try again.")
        case let r: throw Failure(description: "The 3DS refused the app (code \(r)).")
        }
        let packed = try zlib(app)
        var at = 0
        while at < packed.count {
            let chunk = packed.subdata(in: at..<min(at + 16 * 1024, packed.count))   // the launcher's buffer is 16 KB
            try put(int32(chunk.count) + chunk)
            at += chunk.count
            progress(Double(at) / Double(packed.count))
        }
        guard try status() == 0 else { throw Failure(description: "The 3DS couldn’t save the app.") }
        let arg = Data("sdmc:/3ds/\(name)".utf8) + Data([0])
        try put(int32(arg.count) + arg)
    }

    static func connect(_ s: Int32, _ addr: in_addr, seconds: Int32) throws {
        var to = sockaddr_in(); to.sin_family = sa_family_t(AF_INET); to.sin_port = port.bigEndian; to.sin_addr = addr
        let flags = fcntl(s, F_GETFL, 0)
        _ = fcntl(s, F_SETFL, flags | O_NONBLOCK)
        let r = withUnsafePointer(to: &to) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        if r != 0 {
            guard errno == EINPROGRESS else { throw Failure(description: "Couldn’t reach the 3DS. Is the Homebrew Launcher waiting (press Y)?") }
            var p = pollfd(fd: s, events: Int16(POLLOUT), revents: 0)
            var err: Int32 = 0; var len = socklen_t(4)
            if poll(&p, 1, seconds * 1000) != 1 || getsockopt(s, SOL_SOCKET, SO_ERROR, &err, &len) != 0 || err != 0 {
                throw Failure(description: "Couldn’t reach the 3DS. Is the Homebrew Launcher waiting (press Y)?")
            }
        }
        _ = fcntl(s, F_SETFL, flags)
    }

    /// zlib format (RFC 1950): a header, raw DEFLATE from Foundation, then the Adler-32 of the original.
    static func zlib(_ d: Data) throws -> Data {
        guard let raw = try? (d as NSData).compressed(using: .zlib) as Data else { throw Failure(description: "Couldn’t compress the app.") }
        var a: UInt32 = 1, b: UInt32 = 0
        for byte in d { a = (a + UInt32(byte)) % 65521; b = (b + a) % 65521 }
        let adler = (b << 16) | a
        return Data([0x78, 0x9C]) + raw + withUnsafeBytes(of: adler.bigEndian) { Data($0) }
    }
}

// Finds Wild World saves on SD cards and other folders: flashcarts such as the R4 keep each game's save next to it
// on the microSD card (the same name ending in .sav, sometimes padded to 512 KB); TWiLight Menu++ on a 3DS's SD card
// keeps it in a "saves" folder beside the game.
import Foundation

enum SaveFinder {
    /// Inserted SD cards and other removable or ejectable drives (not the Mac's own disks).
    static func removableVolumes() -> [URL] {
        let keys: [URLResourceKey] = [.volumeIsRemovableKey, .volumeIsEjectableKey, .volumeIsInternalKey]
        return (FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: keys, options: [.skipHiddenVolumes]) ?? []).filter {
            let v = try? $0.resourceValues(forKeys: Set(keys))
            return (v?.volumeIsRemovable == true || v?.volumeIsEjectable == true) && v?.volumeIsInternal != true
        }
    }

    /// Searches a few folders deep for files that start like a Wild World save (its region byte, 0x8A USA, 0xC5
    /// Europe or 0x32 Japan/Korea, at the start of either copy of the town). At most 60 results.
    static func find(in roots: [URL]) -> [[String: Any]] {
        var results: [[String: Any]] = [], looked = 0
        let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
        for root in roots {
            guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { continue }
            for case let url as URL in walk {
                if walk.level > 6 { walk.skipDescendants(); continue }
                looked += 1
                if looked > 20000 || results.count >= 60 { break }
                let ext = url.pathExtension.lowercased()   // .sav1 to .sav9: nds-bootstrap's extra save slots (TWiLight Menu++)
                guard ["sav", "dsv", "bin"].contains(ext) || ext.range(of: #"^sav[1-9]$"#, options: .regularExpression) != nil,
                      let v = try? url.resourceValues(forKeys: keys), v.isRegularFile == true,
                      let size = v.fileSize, size >= 0x40000, size <= 0x100000,
                      let data = try? Data(contentsOf: url),
                      [data[0], data[0x15FE0]].contains(where: { [0x8A, 0xC5, 0x32].contains($0) }) else { continue }
                results.append(["path": url.path, "name": url.lastPathComponent, "where": root.lastPathComponent,
                                "modified": (v.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000, "data": data.base64EncodedString()])
            }
        }
        return results
    }
}

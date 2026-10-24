// Draws the Leaflet app icon into an .iconset folder: swift icon.swift <out.iconset>
import AppKit

let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let inset = s * 0.1, rect = NSRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let tile = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)

    // Soft drop shadow, then a sky-to-grass tile.
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowBlurRadius = s * 0.03; shadow.shadowOffset = NSSize(width: 0, height: -s * 0.012)
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.3); shadow.set()
    NSColor.white.setFill(); tile.fill()
    NSGraphicsContext.restoreGraphicsState()
    tile.addClip()
    NSGradient(colors: [NSColor(calibratedRed: 0.55, green: 0.84, blue: 0.96, alpha: 1), NSColor(calibratedRed: 0.42, green: 0.76, blue: 0.93, alpha: 1)])!
        .draw(in: rect, angle: -90)
    let hill = NSBezierPath()
    hill.move(to: NSPoint(x: rect.minX, y: rect.minY + rect.height * 0.42))
    hill.curve(to: NSPoint(x: rect.maxX, y: rect.minY + rect.height * 0.36),
               controlPoint1: NSPoint(x: rect.minX + rect.width * 0.35, y: rect.minY + rect.height * 0.56),
               controlPoint2: NSPoint(x: rect.minX + rect.width * 0.7, y: rect.minY + rect.height * 0.30))
    hill.line(to: NSPoint(x: rect.maxX, y: rect.minY)); hill.line(to: NSPoint(x: rect.minX, y: rect.minY)); hill.close()
    NSGradient(colors: [NSColor(calibratedRed: 0.40, green: 0.78, blue: 0.47, alpha: 1), NSColor(calibratedRed: 0.24, green: 0.60, blue: 0.36, alpha: 1)])!
        .draw(in: hill, angle: -90)

    // The leaf, tilted, with a vein.
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.saveGState()
    ctx.translateBy(x: s * 0.5, y: s * 0.53); ctx.rotate(by: -0.45)
    let w = s * 0.25, hgt = s * 0.36
    let leaf = NSBezierPath()
    leaf.move(to: NSPoint(x: 0, y: -hgt))
    leaf.curve(to: NSPoint(x: 0, y: hgt), controlPoint1: NSPoint(x: w * 1.5, y: -hgt * 0.4), controlPoint2: NSPoint(x: w * 1.1, y: hgt * 0.7))
    leaf.curve(to: NSPoint(x: 0, y: -hgt), controlPoint1: NSPoint(x: -w * 1.1, y: hgt * 0.7), controlPoint2: NSPoint(x: -w * 1.5, y: -hgt * 0.4))
    NSGraphicsContext.saveGraphicsState()
    let ls = NSShadow(); ls.shadowBlurRadius = s * 0.02; ls.shadowOffset = NSSize(width: 0, height: -s * 0.01); ls.shadowColor = NSColor.black.withAlphaComponent(0.25); ls.set()
    NSColor(calibratedRed: 0.36, green: 0.80, blue: 0.47, alpha: 1).setFill(); leaf.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(colors: [NSColor.white.withAlphaComponent(0.35), NSColor.clear])!.draw(in: leaf, angle: 0)
    let vein = NSBezierPath(); vein.move(to: NSPoint(x: 0, y: -hgt * 1.15)); vein.curve(to: NSPoint(x: 0, y: hgt * 0.8), controlPoint1: NSPoint(x: w * 0.12, y: -hgt * 0.2), controlPoint2: NSPoint(x: -w * 0.05, y: hgt * 0.4))
    vein.lineWidth = s * 0.022; vein.lineCapStyle = .round
    NSColor(calibratedRed: 0.86, green: 0.98, blue: 0.88, alpha: 1).setStroke(); vein.stroke()
    ctx.restoreGState()

    // A little bell for whimsy.
    let b = s * 0.11, bx = rect.maxX - b * 1.55, by = rect.maxY - b * 1.6
    let bell = NSBezierPath(ovalIn: NSRect(x: bx, y: by, width: b, height: b))
    NSColor(calibratedRed: 0.97, green: 0.78, blue: 0.24, alpha: 1).setFill(); bell.fill()
    NSColor(calibratedRed: 0.78, green: 0.58, blue: 0.10, alpha: 1).setStroke(); bell.lineWidth = s * 0.008; bell.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256),
                   ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    try! render(px).write(to: URL(fileURLWithPath: "\(out)/icon_\(name).png"))
}

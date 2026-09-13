import AVFoundation
import CoreMedia
import ExpoModulesCore
import QuartzCore
import UIKit

/// Post-run share video composer.
///
/// Executes a `CompositionPlan` (built in pure TypeScript, see
/// `src/lib/compositionPlan.ts`) against two local files — the camera clip
/// the pose module recorded and the level's composite game asset — and
/// exports a 720×1280 H.264 MP4 (fast-start) with the HUD and end card drawn
/// by Core Animation. All timing decisions (which game range lands where,
/// where the frame freezes, when each HUD element shows) come from the plan;
/// this file only translates them into AVFoundation calls.
///
/// Everything runs on a private serial queue. Progress is reported through
/// `onComposeProgress` `{ jobId, progress }`.
public final class CardioSurfComposerModule: Module {
  static let progressEvent = "onComposeProgress"
  private let queue = DispatchQueue(label: "app.cardiosurf.composer", qos: .userInitiated)
  private var activeExport: AVAssetExportSession?
  private var progressTimer: DispatchSourceTimer?

  public func definition() -> ModuleDefinition {
    Name("CardioSurfComposer")

    Events(Self.progressEvent)

    Function("isAvailable") { () -> Bool in true }

    // Duration / dimensions of a local video (the plan needs the game asset's
    // length; JS has no cheap way to read it).
    AsyncFunction("probe") { (path: String, promise: Promise) in
      self.queue.async {
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        guard Self.loadSync(asset), let video = asset.tracks(withMediaType: .video).first else {
          promise.reject("E_ASSETS", "Could not read the video at \(path)")
          return
        }
        let size = video.naturalSize.applying(video.preferredTransform)
        promise.resolve([
          "durationSec": CMTimeGetSeconds(asset.duration),
          "width": abs(size.width),
          "height": abs(size.height),
          "hasAudio": !asset.tracks(withMediaType: .audio).isEmpty,
        ])
      }
    }

    AsyncFunction("compose") { (options: ComposeOptions, promise: Promise) in
      self.queue.async { self.compose(options, promise: promise) }
    }

    Function("cancel") {
      self.queue.async { self.activeExport?.cancelExport() }
    }

    OnDestroy {
      self.queue.async {
        self.activeExport?.cancelExport()
        self.stopProgressTimer()
      }
    }
  }

  // MARK: - Compose

  private func compose(_ options: ComposeOptions, promise: Promise) {
    let startedAt = CACurrentMediaTime()
    if activeExport != nil {
      promise.reject("E_BUSY", "A composition is already running")
      return
    }
    let plan: CompositionPlan
    do {
      plan = try JSONDecoder().decode(CompositionPlan.self, from: Data(options.planJson.utf8))
    } catch {
      promise.reject("E_PLAN", "Invalid composition plan: \(error.localizedDescription)")
      return
    }
    guard plan.version == 1 else {
      promise.reject("E_PLAN", "Unsupported plan version \(plan.version)")
      return
    }

    let cameraAsset = AVURLAsset(url: URL(fileURLWithPath: options.cameraPath))
    let gameAsset = AVURLAsset(url: URL(fileURLWithPath: options.gamePath))
    guard Self.loadSync(cameraAsset), Self.loadSync(gameAsset) else {
      promise.reject("E_ASSETS", "Could not load the camera or game asset")
      return
    }
    guard let gameVideo = gameAsset.tracks(withMediaType: .video).first else {
      promise.reject("E_ASSETS", "The game asset has no video track")
      return
    }
    guard let cameraVideo = cameraAsset.tracks(withMediaType: .video).first else {
      promise.reject("E_ASSETS", "The camera clip has no video track")
      return
    }

    let composition = AVMutableComposition()
    guard
      let gameTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let cameraTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else {
      promise.reject("E_COMPOSITION", "Could not create composition tracks")
      return
    }
    let gameAudio = plan.audio.includeGameAudio ? gameAsset.tracks(withMediaType: .audio).first : nil
    let gameAudioTrack = gameAudio == nil
      ? nil
      : composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)

    do {
      try Self.applyInserts(
        plan.inserts,
        gameVideo: gameVideo,
        gameAudio: gameAudio,
        gameDuration: gameAsset.duration,
        onto: gameTrack,
        audioTrack: gameAudioTrack
      )
      // Camera runs straight through on wall time: the clip IS the timeline.
      let runDuration = Self.time(plan.runDurationSec)
      let cameraDuration = CMTimeMinimum(cameraAsset.duration, runDuration)
      if cameraDuration > .zero {
        try cameraTrack.insertTimeRange(
          CMTimeRange(start: .zero, duration: cameraDuration),
          of: cameraVideo,
          at: .zero
        )
      }
    } catch {
      promise.reject("E_COMPOSITION", "Could not build the edit: \(error.localizedDescription)")
      return
    }

    let videoComposition = Self.makeVideoComposition(
      plan: plan,
      gameTrack: gameTrack,
      cameraTrack: cameraTrack,
      cameraNaturalSize: cameraVideo.naturalSize,
      gameNaturalSize: gameVideo.naturalSize,
      totalDuration: composition.duration
    )
    let layers = HudRenderer.buildLayers(plan: plan)
    videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
      postProcessingAsVideoLayer: layers.video,
      in: layers.parent
    )

    let outputURL = URL(fileURLWithPath: options.outputPath)
    try? FileManager.default.removeItem(at: outputURL)
    try? FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    // 1280x720 fits a 720×1280 portrait render exactly (the preset bounds the
    // long side at 1280), so the export is 1:1 with the plan's canvas.
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1280x720) else {
      promise.reject("E_EXPORT", "Could not create the export session")
      return
    }
    export.outputURL = outputURL
    export.outputFileType = .mp4
    export.videoComposition = videoComposition
    export.shouldOptimizeForNetworkUse = true
    activeExport = export
    startProgressTimer(jobId: options.jobId, export: export)

    export.exportAsynchronously { [weak self] in
      guard let self else { return }
      self.queue.async {
        self.stopProgressTimer()
        self.activeExport = nil
        switch export.status {
        case .completed:
          self.sendEvent(Self.progressEvent, ["jobId": options.jobId, "progress": 1.0])
          let bytes = (try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber)?.int64Value ?? 0
          var thumbnailPath: String? = nil
          if let thumb = options.thumbnailPath {
            thumbnailPath = Self.writeThumbnail(for: outputURL, at: min(1.0, plan.runDurationSec / 2), to: thumb)
          }
          let result: [String: Any?] = [
            "path": outputURL.path,
            "thumbnailPath": thumbnailPath,
            "durationMs": plan.durationSec * 1000,
            "fileBytes": bytes,
            "composeMs": (CACurrentMediaTime() - startedAt) * 1000,
          ]
          promise.resolve(result)
        case .cancelled:
          try? FileManager.default.removeItem(at: outputURL)
          promise.reject("E_CANCELLED", "Composition cancelled")
        default:
          try? FileManager.default.removeItem(at: outputURL)
          promise.reject("E_EXPORT", export.error?.localizedDescription ?? "Export failed")
        }
      }
    }
  }

  // MARK: - Edits

  private static func time(_ seconds: Double) -> CMTime {
    CMTime(seconds: max(0, seconds), preferredTimescale: 600)
  }

  /// Play inserts land the game range at the canvas range and are scaled onto
  /// it (0.85/1.0/1.2× fall out of the ratio). Freezes insert one frame and
  /// stretch it across the gap. The plan guarantees the inserts are
  /// contiguous from 0, so every `at:` equals the track's current end.
  private static func applyInserts(
    _ inserts: [PlanInsert],
    gameVideo: AVAssetTrack,
    gameAudio: AVAssetTrack?,
    gameDuration: CMTime,
    onto track: AVMutableCompositionTrack,
    audioTrack: AVMutableCompositionTrack?
  ) throws {
    let frame = CMTime(value: 1, timescale: 30)
    for insert in inserts {
      let canvasStart = time(insert.canvasStart)
      let canvasDuration = time(insert.canvasEnd - insert.canvasStart)
      guard canvasDuration > .zero else { continue }
      switch insert.kind {
      case "play":
        let start = time(insert.gameStart ?? 0)
        let end = CMTimeMinimum(time(insert.gameEnd ?? 0), gameDuration)
        guard end > start else { continue }
        let source = CMTimeRange(start: start, end: end)
        try track.insertTimeRange(source, of: gameVideo, at: canvasStart)
        track.scaleTimeRange(CMTimeRange(start: canvasStart, duration: source.duration), toDuration: canvasDuration)
        if let audioTrack, let gameAudio {
          try audioTrack.insertTimeRange(source, of: gameAudio, at: canvasStart)
          audioTrack.scaleTimeRange(CMTimeRange(start: canvasStart, duration: source.duration), toDuration: canvasDuration)
        }
      default: // "freeze"
        let atMax = CMTimeSubtract(gameDuration, frame)
        let at = CMTimeMaximum(.zero, CMTimeMinimum(time(insert.gameAt ?? 0), atMax))
        let source = CMTimeRange(start: at, duration: frame)
        try track.insertTimeRange(source, of: gameVideo, at: canvasStart)
        track.scaleTimeRange(CMTimeRange(start: canvasStart, duration: frame), toDuration: canvasDuration)
        audioTrack?.insertEmptyTimeRange(CMTimeRange(start: canvasStart, duration: canvasDuration))
      }
    }
  }

  /// Two instructions: run footage (game region + camera region) and the end
  /// card tail (frozen game only; the opaque end-card layer covers it).
  private static func makeVideoComposition(
    plan: CompositionPlan,
    gameTrack: AVMutableCompositionTrack,
    cameraTrack: AVMutableCompositionTrack,
    cameraNaturalSize: CGSize,
    gameNaturalSize: CGSize,
    totalDuration: CMTime
  ) -> AVMutableVideoComposition {
    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: plan.canvas.width, height: plan.canvas.height)
    composition.frameDuration = CMTime(value: 1, timescale: 30)

    // Game: 720×576 source drawn 1:1 into the top region; scale if the asset
    // was cut at another size.
    let gameLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: gameTrack)
    let gsx = gameNaturalSize.width > 0 ? plan.gameRegion.width / gameNaturalSize.width : 1
    let gsy = gameNaturalSize.height > 0 ? plan.gameRegion.height / gameNaturalSize.height : 1
    gameLayer.setTransform(
      CGAffineTransform(scaleX: gsx, y: gsy)
        .concatenating(CGAffineTransform(translationX: plan.gameRegion.x, y: plan.gameRegion.y)),
      at: .zero
    )

    // Camera: the writer stores an upright, mirrored 720×1280 frame with an
    // identity transform (the capture connection did the rotation), so the
    // crop rect is in plain pixel space: crop, scale to the region width,
    // translate so the crop's top lands on the region's top.
    let cameraLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: cameraTrack)
    let crop = plan.camera.cropRect
    let cropRect = CGRect(x: crop.x, y: crop.y, width: crop.width, height: crop.height)
    cameraLayer.setCropRectangle(cropRect, at: .zero)
    let scale = crop.width > 0 ? plan.cameraRegion.width / crop.width : 1
    cameraLayer.setTransform(
      CGAffineTransform(scaleX: scale, y: scale)
        .concatenating(
          CGAffineTransform(
            translationX: plan.cameraRegion.x - crop.x * scale,
            y: plan.cameraRegion.y - crop.y * scale
          )
        ),
      at: .zero
    )

    let runEnd = CMTimeMinimum(time(plan.runDurationSec), totalDuration)
    var instructions: [AVMutableVideoCompositionInstruction] = []
    if runEnd > .zero {
      let run = AVMutableVideoCompositionInstruction()
      run.timeRange = CMTimeRange(start: .zero, end: runEnd)
      run.backgroundColor = UIColor(red: 8 / 255, green: 9 / 255, blue: 10 / 255, alpha: 1).cgColor
      run.layerInstructions = [gameLayer, cameraLayer]
      instructions.append(run)
    }
    if totalDuration > runEnd {
      let tail = AVMutableVideoCompositionInstruction()
      tail.timeRange = CMTimeRange(start: runEnd, end: totalDuration)
      tail.backgroundColor = UIColor(red: 8 / 255, green: 9 / 255, blue: 10 / 255, alpha: 1).cgColor
      tail.layerInstructions = [gameLayer]
      instructions.append(tail)
    }
    composition.instructions = instructions
    return composition
  }

  // MARK: - Progress / thumbnail / loading

  private func startProgressTimer(jobId: String, export: AVAssetExportSession) {
    stopProgressTimer()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
    timer.setEventHandler { [weak self, weak export] in
      guard let self, let export else { return }
      self.sendEvent(Self.progressEvent, ["jobId": jobId, "progress": Double(export.progress)])
    }
    timer.resume()
    progressTimer = timer
  }

  private func stopProgressTimer() {
    progressTimer?.cancel()
    progressTimer = nil
  }

  private static func writeThumbnail(for url: URL, at seconds: Double, to path: String) -> String? {
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 360, height: 640)
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
    guard
      let image = try? generator.copyCGImage(at: time(seconds), actualTime: nil),
      let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.82)
    else { return nil }
    let target = URL(fileURLWithPath: path)
    try? FileManager.default.removeItem(at: target)
    do {
      try data.write(to: target)
      return target.path
    } catch {
      return nil
    }
  }

  /// Synchronous property load, safe here because we are on our own queue.
  private static func loadSync(_ asset: AVAsset) -> Bool {
    let keys = ["tracks", "duration"]
    let semaphore = DispatchSemaphore(value: 0)
    asset.loadValuesAsynchronously(forKeys: keys) { semaphore.signal() }
    _ = semaphore.wait(timeout: .now() + 20)
    return keys.allSatisfy { asset.statusOfValue(forKey: $0, error: nil) == .loaded }
  }
}

// MARK: - Options

struct ComposeOptions: Record {
  @Field var jobId: String = ""
  @Field var cameraPath: String = ""
  @Field var gamePath: String = ""
  /// `CompositionPlan` from `src/lib/compositionPlan.ts`, JSON-encoded.
  @Field var planJson: String = ""
  @Field var outputPath: String = ""
  @Field var thumbnailPath: String? = nil
}

// MARK: - Plan (mirrors compositionPlan.ts)

struct PlanSize: Decodable { let width: Double; let height: Double }
struct PlanRect: Decodable { let x: Double; let y: Double; let width: Double; let height: Double }
struct PlanPoint: Decodable { let x: Double; let y: Double }

struct PlanInsert: Decodable {
  let kind: String
  let gameStart: Double?
  let gameEnd: Double?
  let gameAt: Double?
  let canvasStart: Double
  let canvasEnd: Double
}

struct PlanPop: Decodable { let at: Double; let grade: String; let text: String }
struct PlanInterval: Decodable { let start: Double; let end: Double; let text: String }
struct PlanChevron: Decodable { let start: Double; let end: Double; let move: String }
struct PlanAnchor: Decodable { let right: Double; let top: Double }
struct PlanWatermark: Decodable { let text: String; let x: Double; let y: Double }

struct PlanHud: Decodable {
  let pops: [PlanPop]
  let popCenter: PlanPoint
  let score: [PlanInterval]
  let combo: [PlanInterval]
  let scoreAnchor: PlanAnchor
  let chevrons: [PlanChevron]
  let chevronCenter: PlanPoint
  let watermark: PlanWatermark
}

struct PlanEndCard: Decodable {
  let start: Double
  let durationSec: Double
  let levelName: String
  let score: Double
  let accuracyPct: Double
  let maxCombo: Double
  let personalBest: Bool
  let cta: String
  let wordmark: String
}

struct PlanTheme: Decodable { let accent: String; let perfect: String; let good: String; let miss: String }
struct PlanCamera: Decodable { let durationSec: Double; let source: PlanSize; let cropRect: PlanRect; let focusY: Double }
struct PlanAudio: Decodable { let includeGameAudio: Bool }
struct PlanSafeZone: Decodable { let minX: Double; let maxX: Double; let minY: Double; let maxY: Double }

struct CompositionPlan: Decodable {
  let version: Int
  let canvas: PlanSize
  let gameRegion: PlanRect
  let cameraRegion: PlanRect
  let safeZone: PlanSafeZone
  let durationSec: Double
  let runDurationSec: Double
  let camera: PlanCamera
  let inserts: [PlanInsert]
  let hud: PlanHud
  let endCard: PlanEndCard
  let theme: PlanTheme
  let audio: PlanAudio
}

// MARK: - HUD (Core Animation)

/// Builds the Core Animation layer tree the export renders over the video.
/// Every element is keyframed in absolute output time: intervals use a
/// discrete opacity keyframe animation spanning the whole timeline, so an
/// element is exactly 1 inside its `[start, end)` and 0 elsewhere; pops use a
/// short forward-filled animation that starts at their timestamp. Layer
/// geometry is flipped so coordinates match the plan (origin top-left).
enum HudRenderer {
  private static let background = UIColor(red: 8 / 255, green: 9 / 255, blue: 10 / 255, alpha: 1)

  /// The video layer (where the composed frames render) inside the parent
  /// that also carries every HUD layer.
  static func buildLayers(plan: CompositionPlan) -> (parent: CALayer, video: CALayer) {
    let canvas = CGRect(x: 0, y: 0, width: plan.canvas.width, height: plan.canvas.height)
    let video = CALayer()
    video.frame = canvas
    let parent = CALayer()
    parent.frame = canvas
    parent.isGeometryFlipped = true
    parent.backgroundColor = background.cgColor
    parent.addSublayer(video)

    let total = max(plan.durationSec, 0.001)
    let theme = plan.theme

    // Persistent watermark, inside the safe zone.
    let watermark = textLayer(
      plan.hud.watermark.text,
      size: 18,
      weight: .heavy,
      color: UIColor.white.withAlphaComponent(0.85),
      alignment: .left,
      frame: CGRect(x: plan.hud.watermark.x, y: plan.hud.watermark.y, width: 260, height: 26)
    )
    watermark.opacity = 1
    parent.addSublayer(watermark)

    // Score + combo, top-right of the safe zone. One layer per state.
    let scoreWidth: CGFloat = 300
    for interval in plan.hud.score {
      let layer = textLayer(
        interval.text,
        size: 34,
        weight: .heavy,
        color: .white,
        alignment: .right,
        frame: CGRect(x: plan.hud.scoreAnchor.right - scoreWidth, y: plan.hud.scoreAnchor.top, width: scoreWidth, height: 42)
      )
      show(layer, from: interval.start, to: interval.end, total: total)
      parent.addSublayer(layer)
    }
    for interval in plan.hud.combo {
      let layer = textLayer(
        interval.text + " combo",
        size: 16,
        weight: .bold,
        color: color(theme.accent),
        alignment: .right,
        frame: CGRect(x: plan.hud.scoreAnchor.right - scoreWidth, y: plan.hud.scoreAnchor.top + 44, width: scoreWidth, height: 22)
      )
      show(layer, from: interval.start, to: interval.end, total: total)
      parent.addSublayer(layer)
    }

    // Upcoming-cue chevrons, low in the game half.
    for chevron in plan.hud.chevrons {
      let layer = textLayer(
        glyph(for: chevron.move),
        size: 44,
        weight: .heavy,
        color: color(theme.accent),
        alignment: .center,
        frame: CGRect(x: plan.hud.chevronCenter.x - 60, y: plan.hud.chevronCenter.y - 30, width: 120, height: 60)
      )
      show(layer, from: chevron.start, to: chevron.end, total: total)
      parent.addSublayer(layer)
    }

    // PERFECT / GOOD / MISS pops (game half only).
    for pop in plan.hud.pops {
      let popColor: UIColor
      switch pop.grade {
      case "perfect": popColor = color(theme.perfect)
      case "good": popColor = color(theme.good)
      default: popColor = color(theme.miss)
      }
      let layer = textLayer(
        pop.text,
        size: 54,
        weight: .black,
        color: popColor,
        alignment: .center,
        frame: CGRect(x: plan.hud.popCenter.x - 240, y: plan.hud.popCenter.y - 36, width: 480, height: 72)
      )
      layer.shadowColor = UIColor.black.cgColor
      layer.shadowOpacity = 0.6
      layer.shadowRadius = 6
      layer.shadowOffset = CGSize(width: 0, height: 2)
      pop_(layer, at: pop.at, duration: 0.6)
      parent.addSublayer(layer)
    }

    // End card: opaque over the whole canvas for its interval.
    parent.addSublayer(endCard(plan: plan, total: total))
    return (parent, video)
  }

  // MARK: Layers

  private static func textLayer(
    _ text: String,
    size: CGFloat,
    weight: UIFont.Weight,
    color: UIColor,
    alignment: CATextLayerAlignmentMode,
    frame: CGRect
  ) -> CATextLayer {
    let layer = CATextLayer()
    layer.frame = frame
    layer.string = text
    layer.font = UIFont.systemFont(ofSize: size, weight: weight)
    layer.fontSize = size
    layer.foregroundColor = color.cgColor
    layer.alignmentMode = alignment
    layer.truncationMode = .end
    layer.isWrapped = false
    layer.contentsScale = 2
    layer.opacity = 0
    return layer
  }

  private static func endCard(plan: CompositionPlan, total: Double) -> CALayer {
    let card = CALayer()
    card.frame = CGRect(x: 0, y: 0, width: plan.canvas.width, height: plan.canvas.height)
    card.backgroundColor = background.cgColor
    card.opacity = 0
    let zone = plan.safeZone
    let width = zone.maxX - zone.minX
    var y = zone.minY + 40
    func add(_ text: String, size: CGFloat, weight: UIFont.Weight, color: UIColor, height: CGFloat, gap: CGFloat = 12) {
      let layer = textLayer(text, size: size, weight: weight, color: color, alignment: .center, frame: CGRect(x: zone.minX, y: y, width: width, height: height))
      layer.opacity = 1
      card.addSublayer(layer)
      y += height + gap
    }
    let accent = color(plan.theme.accent)
    add(plan.endCard.wordmark, size: 22, weight: .heavy, color: UIColor.white.withAlphaComponent(0.85), height: 30, gap: 60)
    add(plan.endCard.levelName, size: 30, weight: .bold, color: .white, height: 40, gap: 30)
    add(formatScore(plan.endCard.score), size: 104, weight: .black, color: .white, height: 118, gap: 4)
    add("SCORE", size: 16, weight: .heavy, color: UIColor.white.withAlphaComponent(0.6), height: 22, gap: 36)
    add("\(Int(plan.endCard.accuracyPct))% accuracy  ·  \(Int(plan.endCard.maxCombo))x combo", size: 24, weight: .semibold, color: UIColor.white.withAlphaComponent(0.85), height: 32, gap: 28)
    if plan.endCard.personalBest {
      let badge = CALayer()
      badge.frame = CGRect(x: zone.minX + (width - 280) / 2, y: y, width: 280, height: 44)
      badge.cornerRadius = 22
      badge.backgroundColor = accent.cgColor
      let label = textLayer("PERSONAL BEST", size: 17, weight: .black, color: .black, alignment: .center, frame: CGRect(x: 0, y: 10, width: 280, height: 24))
      label.opacity = 1
      badge.addSublayer(label)
      card.addSublayer(badge)
      y += 44 + 40
    } else {
      y += 24
    }
    add(plan.endCard.cta, size: 34, weight: .heavy, color: accent, height: 44, gap: 8)
    add("Play CardioSurf", size: 18, weight: .medium, color: UIColor.white.withAlphaComponent(0.6), height: 26)
    // Runs past the end so the last rendered frame is still the card.
    show(card, from: plan.endCard.start, to: total + 1, total: total + 1)
    return card
  }

  // MARK: Keyframes

  /// Opacity 1 on `[from, to)`, 0 elsewhere, over the whole timeline.
  private static func show(_ layer: CALayer, from: Double, to: Double, total: Double) {
    guard to > from, total > 0 else { return }
    let animation = CAKeyframeAnimation(keyPath: "opacity")
    animation.calculationMode = .discrete
    animation.values = [0, 1, 0]
    animation.keyTimes = [
      0,
      NSNumber(value: min(1, max(0, from / total))),
      NSNumber(value: min(1, max(0, to / total))),
      1,
    ]
    animation.beginTime = AVCoreAnimationBeginTimeAtZero
    animation.duration = total
    animation.isRemovedOnCompletion = false
    animation.fillMode = .forwards
    layer.add(animation, forKey: "show")
  }

  /// Fade/scale pop starting at `at`; invisible before and after.
  private static func pop_(_ layer: CALayer, at: Double, duration: Double) {
    let opacity = CAKeyframeAnimation(keyPath: "opacity")
    opacity.values = [0, 1, 1, 0]
    opacity.keyTimes = [0, 0.12, 0.7, 1]
    opacity.beginTime = AVCoreAnimationBeginTimeAtZero + at
    opacity.duration = duration
    opacity.isRemovedOnCompletion = false
    opacity.fillMode = .forwards
    layer.add(opacity, forKey: "pop-opacity")

    let scale = CAKeyframeAnimation(keyPath: "transform.scale")
    scale.values = [0.6, 1.12, 1.0, 1.0]
    scale.keyTimes = [0, 0.18, 0.4, 1]
    scale.beginTime = AVCoreAnimationBeginTimeAtZero + at
    scale.duration = duration
    scale.isRemovedOnCompletion = false
    scale.fillMode = .forwards
    layer.add(scale, forKey: "pop-scale")
  }

  // MARK: Helpers

  private static func glyph(for move: String) -> String {
    switch move {
    case "jump": return "▲"
    case "duck": return "▼"
    case "left": return "◀"
    case "right": return "▶"
    default: return "●"
    }
  }

  private static func formatScore(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 0
    return formatter.string(from: NSNumber(value: value)) ?? String(Int(value))
  }

  /// `#RRGGBB` / `#RRGGBBAA` / `rgba(r,g,b,a)`; falls back to white.
  private static func color(_ value: String) -> UIColor {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("#") {
      var hex = String(trimmed.dropFirst())
      if hex.count == 6 { hex += "FF" }
      guard hex.count == 8, let raw = UInt32(hex, radix: 16) else { return .white }
      return UIColor(
        red: CGFloat((raw >> 24) & 0xFF) / 255,
        green: CGFloat((raw >> 16) & 0xFF) / 255,
        blue: CGFloat((raw >> 8) & 0xFF) / 255,
        alpha: CGFloat(raw & 0xFF) / 255
      )
    }
    if trimmed.lowercased().hasPrefix("rgb") {
      let numbers = trimmed
        .components(separatedBy: CharacterSet(charactersIn: "(),"))
        .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
      if numbers.count >= 3 {
        return UIColor(
          red: CGFloat(numbers[0] / 255),
          green: CGFloat(numbers[1] / 255),
          blue: CGFloat(numbers[2] / 255),
          alpha: CGFloat(numbers.count > 3 ? numbers[3] : 1)
        )
      }
    }
    return .white
  }
}

import AVFoundation
import ExpoModulesCore
import UIKit
import Vision

public final class CardioSurfPoseModule: Module {
  static let recordingStateEvent = "onRecordingState"

  public func definition() -> ModuleDefinition {
    Name("CardioSurfPose")

    Events(Self.recordingStateEvent)

    OnCreate {
      // The view owns the capture session (and therefore the writer); the
      // module only relays its recording state to JS.
      CardioSurfPoseView.recordingStateSink = { [weak self] payload in
        self?.sendEvent(Self.recordingStateEvent, payload)
      }
    }

    OnDestroy {
      CardioSurfPoseView.recordingStateSink = nil
    }

    // Recording is driven from the active camera view because there is exactly
    // one capture session per app and it lives there. Every function below
    // rejects when no camera view is mounted and active.
    AsyncFunction("startRecording") { (promise: Promise) in
      guard let view = CardioSurfPoseView.active else {
        promise.reject("E_NO_CAMERA", "The pose camera is not active")
        return
      }
      view.startRecording(promise)
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      guard let view = CardioSurfPoseView.active else {
        promise.reject("E_NO_CAMERA", "The pose camera is not active")
        return
      }
      view.stopRecording(promise)
    }

    Function("cancelRecording") {
      CardioSurfPoseView.active?.cancelRecording()
    }

    Function("isRecording") { () -> Bool in
      CardioSurfPoseView.active?.isRecording ?? false
    }

    View(CardioSurfPoseView.self) {
      Events("onPose", "onStatus")

      Prop("active") { (view: CardioSurfPoseView, active: Bool) in
        view.setActive(active)
      }

      // When the run may be recorded the session runs at 1280x720 from its
      // first frame (see `preferredPreset`), so the writer never has to
      // change the preset — and therefore the delivered frame size — mid-run.
      Prop("recordingEnabled") { (view: CardioSurfPoseView, enabled: Bool) in
        view.setRecordingEnabled(enabled)
      }
    }
  }
}

private struct JointSpec {
  let name: String
  let visionName: VNHumanBodyPoseObservation.JointName
}

private let jointSpecs: [JointSpec] = [
  JointSpec(name: "nose", visionName: .nose),
  JointSpec(name: "neck", visionName: .neck),
  JointSpec(name: "leftShoulder", visionName: .leftShoulder),
  JointSpec(name: "rightShoulder", visionName: .rightShoulder),
  JointSpec(name: "leftElbow", visionName: .leftElbow),
  JointSpec(name: "rightElbow", visionName: .rightElbow),
  JointSpec(name: "leftWrist", visionName: .leftWrist),
  JointSpec(name: "rightWrist", visionName: .rightWrist),
  JointSpec(name: "root", visionName: .root),
  JointSpec(name: "leftHip", visionName: .leftHip),
  JointSpec(name: "rightHip", visionName: .rightHip),
  JointSpec(name: "leftKnee", visionName: .leftKnee),
  JointSpec(name: "rightKnee", visionName: .rightKnee),
  JointSpec(name: "leftAnkle", visionName: .leftAnkle),
  JointSpec(name: "rightAnkle", visionName: .rightAnkle),
]

/// Minimum spacing between two Vision passes: the 10 Hz detector cadence.
private let inferenceIntervalS = 0.1

/// If the writer has not seen a frame this long after `startRecording`, the
/// start promise rejects (camera interrupted, session not running, …).
private let firstFrameTimeoutS = 3.0

// MARK: - Recorder

/// One camera recording: an `AVAssetWriter` fed zero-copy from the data
/// output's sample buffers. All methods run on the view's `captureQueue`
/// except the writer's own completion handlers.
///
/// `AVCaptureMovieFileOutput` is deliberately not used: adding it alongside
/// the `AVCaptureVideoDataOutput` starves the data output of frames on most
/// devices, which would kill pose tracking while recording.
private final class RunRecorder {
  enum State { case waitingForFirstFrame, writing, finishing, finished, cancelled, failed }

  let url: URL
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private(set) var state: State = .waitingForFirstFrame
  private(set) var startedAtEpochMs: Double = 0
  private var firstPTS = CMTime.invalid
  private var lastPTS = CMTime.invalid
  private var lastDuration = CMTime.invalid
  private(set) var appended = 0
  private(set) var dropped = 0
  /// Pending `startRecording` promise; resolved on the first appended frame.
  var startPromise: Promise?
  var startTimeout: DispatchWorkItem?

  init(width: Int, height: Int) throws {
    let name = "cardiosurf-run-\(UUID().uuidString.lowercased()).mp4"
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    url = caches.appendingPathComponent(name)
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    // H.264 rather than HEVC: every share target and the composer's export
    // preset accept it without a transcode, and the size difference at 720p
    // over a 5–15 minute run is a few tens of MB in Caches.
    let settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 4_500_000,
        AVVideoExpectedSourceFrameRateKey: 30,
        AVVideoMaxKeyFrameIntervalKey: 60,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: false,
      ],
    ]
    input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = true
    // The capture connection already rotates to portrait and mirrors the
    // pixel buffers (see `configureSession`), so the file is upright and
    // selfie-mirrored with no transform: what the preview shows is what the
    // file contains.
    input.transform = .identity
    guard writer.canAdd(input) else {
      throw NSError(domain: "CardioSurfPose", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add writer input"])
    }
    writer.add(input)
  }

  var durationMs: Double {
    guard firstPTS.isValid, lastPTS.isValid else { return 0 }
    var end = lastPTS
    if lastDuration.isValid && lastDuration.isNumeric { end = CMTimeAdd(lastPTS, lastDuration) }
    return max(0, CMTimeGetSeconds(CMTimeSubtract(end, firstPTS)) * 1000)
  }

  /// Append one camera frame. `epochOffsetMs` maps the host-clock PTS into
  /// the epoch-ms domain JS uses (same conversion as the pose stamps).
  func append(_ sampleBuffer: CMSampleBuffer, epochOffsetMs: Double) {
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard pts.isValid, pts.isNumeric else { return }
    switch state {
    case .waitingForFirstFrame:
      guard writer.startWriting() else {
        fail()
        return
      }
      writer.startSession(atSourceTime: pts)
      firstPTS = pts
      startedAtEpochMs = CMTimeGetSeconds(pts) * 1000 + epochOffsetMs
      state = .writing
      startTimeout?.cancel()
      startTimeout = nil
      startPromise?.resolve(["path": url.path, "startedAtEpochMs": startedAtEpochMs])
      startPromise = nil
      appendFrame(sampleBuffer, pts: pts)
    case .writing:
      appendFrame(sampleBuffer, pts: pts)
    default:
      return
    }
  }

  private func appendFrame(_ sampleBuffer: CMSampleBuffer, pts: CMTime) {
    guard writer.status == .writing else {
      if writer.status == .failed { fail() }
      return
    }
    // Zero-copy: the encoder consumes the capture pixel buffer directly. If
    // the encoder is behind, drop rather than block the capture queue.
    guard input.isReadyForMoreMediaData, input.append(sampleBuffer) else {
      dropped += 1
      if writer.status == .failed { fail() }
      return
    }
    appended += 1
    lastPTS = pts
    lastDuration = CMSampleBufferGetDuration(sampleBuffer)
  }

  private func fail() {
    guard state != .failed && state != .cancelled else { return }
    state = .failed
    startTimeout?.cancel()
    startTimeout = nil
    startPromise?.reject("E_WRITER_FAILED", writer.error?.localizedDescription ?? "Video writer failed")
    startPromise = nil
  }

  var isTerminal: Bool {
    switch state {
    case .finished, .cancelled, .failed: return true
    default: return false
    }
  }

  /// Finalize the file. `completion` runs on an arbitrary queue.
  func finish(_ completion: @escaping (Result<[String: Any], Error>) -> Void) {
    switch state {
    case .waitingForFirstFrame:
      // Nothing was ever written; the writer never started.
      state = .cancelled
      startTimeout?.cancel()
      startPromise?.reject("E_NO_FRAMES", "No camera frames were recorded")
      startPromise = nil
      if writer.status == .writing { writer.cancelWriting() }
      try? FileManager.default.removeItem(at: url)
      completion(.failure(NSError(domain: "CardioSurfPose", code: 2, userInfo: [NSLocalizedDescriptionKey: "No camera frames were recorded"])))
    case .writing:
      state = .finishing
      input.markAsFinished()
      let payload: [String: Any] = [
        "path": url.path,
        "durationMs": durationMs,
        "startedAtEpochMs": startedAtEpochMs,
        "frames": appended,
        "dropped": dropped,
      ]
      writer.finishWriting { [weak self] in
        guard let self else { return }
        if self.writer.status == .completed {
          self.state = .finished
          completion(.success(payload))
        } else {
          self.state = .failed
          try? FileManager.default.removeItem(at: self.url)
          completion(.failure(self.writer.error ?? NSError(domain: "CardioSurfPose", code: 3, userInfo: [NSLocalizedDescriptionKey: "Video writer did not complete"])))
        }
      }
    case .finishing:
      completion(.failure(NSError(domain: "CardioSurfPose", code: 4, userInfo: [NSLocalizedDescriptionKey: "Recording is already finishing"])))
    case .finished, .cancelled, .failed:
      completion(.failure(NSError(domain: "CardioSurfPose", code: 5, userInfo: [NSLocalizedDescriptionKey: "Recording already ended"])))
    }
  }

  /// Abort and delete the file. A recording that is already finalizing (or
  /// done) is left alone: `stopRecording` and the view's teardown race when
  /// the run ends and the screen navigates away, and the finished file must
  /// survive that.
  func cancel() {
    startTimeout?.cancel()
    startTimeout = nil
    startPromise?.reject("E_CANCELLED", "Recording cancelled")
    startPromise = nil
    guard state == .writing || state == .waitingForFirstFrame else { return }
    if writer.status == .writing { writer.cancelWriting() }
    state = .cancelled
    try? FileManager.default.removeItem(at: url)
  }
}

// MARK: - View

public final class CardioSurfPoseView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onPose = EventDispatcher()
  let onStatus = EventDispatcher()

  /// The mounted, active camera view (one capture session per app).
  static weak var active: CardioSurfPoseView?
  /// Set by the module to forward `onRecordingState` events.
  static var recordingStateSink: (([String: Any]) -> Void)?

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "app.cardiosurf.pose.session")
  /// Sample-buffer delegate queue. Work here must stay cheap: a writer
  /// append and, at most every 100 ms, a hand-off to `inferenceQueue`.
  private let captureQueue = DispatchQueue(label: "app.cardiosurf.pose.capture")
  /// Vision runs here, off the capture queue, one frame at a time.
  private let inferenceQueue = DispatchQueue(label: "app.cardiosurf.pose.inference")
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private let request = VNDetectHumanBodyPoseRequest()
  private var configured = false
  private var requestedActive = false
  private var recordingEnabled = false
  private var appliedPreset: AVCaptureSession.Preset?
  private var interruptionObservers: [NSObjectProtocol] = []

  // captureQueue-only state.
  private var lastProcessedTime = 0.0
  private var inferenceInFlight = false
  private var recorder: RunRecorder?
  private var frameWidth = 0
  private var frameHeight = 0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    previewLayer.session = session
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    observeInterruptions()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
    configurePreviewConnection()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { Self.active = self }
    updateSession()
  }

  deinit {
    interruptionObservers.forEach { NotificationCenter.default.removeObserver($0) }
    // An unmount mid-recording (early exit, PiP hidden, AirPlay remount) must
    // never leave a half-written file behind. JS learns about it through the
    // terminal state so the summary does not wait for a clip that is gone.
    let recorder = self.recorder
    let sink = Self.recordingStateSink
    captureQueue.async {
      guard let recorder, !recorder.isTerminal, recorder.state != .finishing else { return }
      recorder.cancel()
      DispatchQueue.main.async { sink?(["state": "cancelled", "message": "Camera view was released"]) }
    }
    sessionQueue.async { [session] in
      if session.isRunning { session.stopRunning() }
    }
  }

  func setActive(_ active: Bool) {
    requestedActive = active
    if active { Self.active = self }
    updateSession()
  }

  func setRecordingEnabled(_ enabled: Bool) {
    recordingEnabled = enabled
    sessionQueue.async { [weak self] in self?.applyPresetIfNeeded() }
  }

  var isRecording: Bool {
    captureQueue.sync { recorder?.state == .writing || recorder?.state == .waitingForFirstFrame }
  }

  /// `.hd1280x720` whenever recording is possible for this run: the writer
  /// encodes at 720p, and keeping one preset for the whole run means the
  /// delivered frame size never changes (a >15% change resets the analyzer's
  /// calibration). Detection quality is unaffected — Vision's body-pose model
  /// downsamples its input far below 720p, so 1080p buys nothing for
  /// keypoints while costing ISP bandwidth and encoder work. `.high` stays
  /// the default otherwise so existing latency measurements keep their baseline.
  private var preferredPreset: AVCaptureSession.Preset {
    recordingEnabled ? .hd1280x720 : .high
  }

  private func updateSession() {
    let shouldRun = requestedActive && window != nil
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if shouldRun {
        if !self.configured && !self.configureSession() { return }
        self.applyPresetIfNeeded()
        if !self.session.isRunning {
          self.session.startRunning()
          self.emitStatus("tracking")
        }
      } else if self.session.isRunning {
        self.session.stopRunning()
        self.emitStatus("paused")
      }
    }
  }

  /// sessionQueue. Switch preset when the recording intent changed after the
  /// session was configured (never while a recording is in progress).
  private func applyPresetIfNeeded() {
    guard configured else { return }
    let wanted = preferredPreset
    guard appliedPreset != wanted, session.canSetSessionPreset(wanted) else { return }
    if isRecording { return }
    session.beginConfiguration()
    session.sessionPreset = wanted
    session.commitConfiguration()
    appliedPreset = wanted
  }

  @discardableResult
  private func configureSession() -> Bool {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    let preset = preferredPreset
    session.sessionPreset = session.canSetSessionPreset(preset) ? preset : .high
    appliedPreset = session.sessionPreset

    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      emitStatus("unavailable")
      return false
    }

    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    ]
    output.setSampleBufferDelegate(self, queue: captureQueue)
    guard session.canAddOutput(output) else {
      emitStatus("unavailable")
      return false
    }
    session.addOutput(output)
    if let connection = output.connection(with: .video) {
      // The app is portrait-only. Rotate and mirror the delivered pixel buffer
      // itself so Vision, the selfie preview AND the recording all see the
      // identical upright, mirrored image.
      if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = true
      }
    }

    configured = true
    DispatchQueue.main.async { [weak self] in self?.configurePreviewConnection() }
    return true
  }

  private func configurePreviewConnection() {
    guard let connection = previewLayer.connection else { return }
    if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = true
    }
  }

  // MARK: Recording control

  func startRecording(_ promise: Promise) {
    captureQueue.async { [weak self] in
      guard let self else {
        promise.reject("E_NO_CAMERA", "The pose camera was released")
        return
      }
      if let current = self.recorder, !current.isTerminal {
        promise.reject("E_ALREADY_RECORDING", "A recording is already in progress")
        return
      }
      // Frame size is only known once a frame has arrived. With the portrait
      // connection and the 720p preset that is 720×1280; fall back to it if
      // the session has not delivered anything yet.
      let width = self.frameWidth > 0 ? self.frameWidth : 720
      let height = self.frameHeight > 0 ? self.frameHeight : 1280
      do {
        let recorder = try RunRecorder(width: width, height: height)
        recorder.startPromise = promise
        let timeout = DispatchWorkItem { [weak self, weak recorder] in
          guard let self, let recorder, recorder.state == .waitingForFirstFrame else { return }
          recorder.cancel()
          if self.recorder === recorder { self.recorder = nil }
          self.emitRecordingState(["state": "error", "message": "No camera frames arrived"])
        }
        recorder.startTimeout = timeout
        self.captureQueue.asyncAfter(deadline: .now() + firstFrameTimeoutS, execute: timeout)
        self.recorder = recorder
      } catch {
        promise.reject("E_WRITER_INIT", error.localizedDescription)
      }
    }
  }

  func stopRecording(_ promise: Promise) {
    captureQueue.async { [weak self] in
      guard let self, let recorder = self.recorder else {
        promise.reject("E_NOT_RECORDING", "No recording in progress")
        return
      }
      self.finishRecorder(recorder, reason: "finished") { result in
        switch result {
        case .success(let payload): promise.resolve(payload)
        case .failure(let error): promise.reject("E_STOP_FAILED", error.localizedDescription)
        }
      }
    }
  }

  func cancelRecording() {
    captureQueue.async { [weak self] in
      guard let self, let recorder = self.recorder else { return }
      recorder.cancel()
      self.recorder = nil
      self.emitRecordingState(["state": "cancelled"])
    }
  }

  /// captureQueue. Finalize `recorder`, emit the terminal state and restore
  /// the preset policy.
  private func finishRecorder(
    _ recorder: RunRecorder,
    reason: String,
    completion: ((Result<[String: Any], Error>) -> Void)? = nil
  ) {
    recorder.finish { [weak self] result in
      guard let self else { return }
      self.captureQueue.async {
        if self.recorder === recorder { self.recorder = nil }
        switch result {
        case .success(let payload):
          var event = payload
          event["state"] = reason
          self.emitRecordingState(event)
        case .failure(let error):
          self.emitRecordingState(["state": "error", "message": error.localizedDescription])
        }
        completion?(result)
        self.sessionQueue.async { self.applyPresetIfNeeded() }
      }
    }
  }

  /// Backgrounding: iOS stops delivering camera frames the moment the app
  /// leaves the foreground and interrupts the session. Finalizing the file at
  /// that point keeps everything recorded so far valid; JS receives an
  /// `interrupted` state carrying the duration and marks the gap in the run
  /// log. A later `stopRecording` then rejects with E_NOT_RECORDING, which JS
  /// treats as "already ended".
  private func observeInterruptions() {
    let center = NotificationCenter.default
    let handler: (Notification) -> Void = { [weak self] _ in
      self?.captureQueue.async {
        guard let self, let recorder = self.recorder, !recorder.isTerminal else { return }
        if recorder.state == .waitingForFirstFrame {
          recorder.cancel()
          self.recorder = nil
          self.emitRecordingState(["state": "cancelled"])
          return
        }
        self.finishRecorder(recorder, reason: "interrupted")
      }
    }
    interruptionObservers = [
      center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil, using: handler),
      center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil, using: handler),
    ]
  }

  private func emitRecordingState(_ payload: [String: Any]) {
    DispatchQueue.main.async {
      Self.recordingStateSink?(payload)
    }
  }

  // MARK: Frames

  /// captureQueue. Two jobs, in this order: (a) hand the frame to the writer
  /// if recording; (b) if the 10 Hz throttle allows and no inference is in
  /// flight, retain the pixel buffer and dispatch Vision to `inferenceQueue`.
  /// The capture queue never blocks on Vision, so the writer sees every frame
  /// the camera delivers.
  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    let now = CACurrentMediaTime()
    // Latency stamps. The sample buffer's presentation timestamp is on the host
    // clock (mach_absolute_time), the same domain as CACurrentMediaTime(). One
    // offset per frame maps every stamp into the epoch-ms domain JS `Date.now()`
    // uses. The offset is recomputed per frame rather than cached: it costs two
    // clock reads, and caching would let the stamps drift from Date.now() after
    // any wall-clock adjustment (NTP step, time-zone-independent) mid-run.
    let epochOffsetMs = Date().timeIntervalSince1970 * 1000 - now * 1000

    if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
      frameWidth = CVPixelBufferGetWidth(pixelBuffer)
      frameHeight = CVPixelBufferGetHeight(pixelBuffer)
    }

    if let recorder, !recorder.isTerminal {
      recorder.append(sampleBuffer, epochOffsetMs: epochOffsetMs)
      if recorder.state == .failed {
        self.recorder = nil
        emitRecordingState(["state": "error", "message": "Video writer failed"])
      }
    }

    guard now - lastProcessedTime >= inferenceIntervalS, !inferenceInFlight else { return }
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    lastProcessedTime = now
    inferenceInFlight = true

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let captureMediaTime = pts.isValid && !pts.isIndefinite ? CMTimeGetSeconds(pts) : now
    let captureTs = captureMediaTime * 1000 + epochOffsetMs
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)

    // Retaining `pixelBuffer` (not the sample buffer) keeps exactly one
    // pool buffer alive for the duration of one inference.
    inferenceQueue.async { [weak self] in
      guard let self else { return }
      self.runInference(
        pixelBuffer: pixelBuffer,
        captureTs: captureTs,
        epochOffsetMs: epochOffsetMs,
        width: width,
        height: height
      )
      self.captureQueue.async { self.inferenceInFlight = false }
    }
  }

  /// inferenceQueue. Vision + keypoint extraction, then the event on main.
  private func runInference(
    pixelBuffer: CVPixelBuffer,
    captureTs: Double,
    epochOffsetMs: Double,
    width: Int,
    height: Int
  ) {
    do {
      // The output connection already rotates and mirrors the pixel buffer.
      // Vision therefore receives an upright image with the same horizontal
      // orientation as the preview.
      let handler = VNImageRequestHandler(
        cvPixelBuffer: pixelBuffer,
        orientation: .up,
        options: [:]
      )
      try handler.perform([request])
      guard let observation = request.results?.first else {
        emitStatus("searching")
        return
      }

      let recognized = try observation.recognizedPoints(.all)
      let points: [[String: Any]] = jointSpecs.compactMap { spec in
        guard let point = recognized[spec.visionName], point.confidence >= 0.3 else { return nil }
        return [
          "name": spec.name,
          "x": Double(point.location.x),
          "y": Double(1 - point.location.y),
          "confidence": Double(point.confidence),
        ]
      }

      // After Vision inference + keypoint extraction, still on inferenceQueue.
      let extractedTs = CACurrentMediaTime() * 1000 + epochOffsetMs
      DispatchQueue.main.async { [weak self] in
        // Immediately before the event crosses to JS, on main.
        let dispatchTs = CACurrentMediaTime() * 1000 + epochOffsetMs
        self?.onPose([
          "keypoints": points,
          // `timestamp` keeps its historical meaning — epoch ms at dispatch on
          // main (previously `Date()` read here). The analyzer's cooldown,
          // frame-gap and velocity math run on this field, so it is deliberately
          // NOT moved to captureTs; use the dedicated stamps for latency.
          "timestamp": dispatchTs,
          "captureTs": captureTs,
          "extractedTs": extractedTs,
          "dispatchTs": dispatchTs,
          "sourceWidth": width,
          "sourceHeight": height,
        ])
      }
    } catch {
      emitStatus("error")
    }
  }

  private func emitStatus(_ status: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onStatus(["status": status])
    }
  }
}

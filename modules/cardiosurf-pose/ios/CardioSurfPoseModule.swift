import AVFoundation
import ExpoModulesCore
import Vision

public final class CardioSurfPoseModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardioSurfPose")

    View(CardioSurfPoseView.self) {
      Events("onPose", "onStatus")

      Prop("active") { (view: CardioSurfPoseView, active: Bool) in
        view.setActive(active)
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

public final class CardioSurfPoseView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onPose = EventDispatcher()
  let onStatus = EventDispatcher()

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "app.cardiosurf.pose.session")
  private let visionQueue = DispatchQueue(label: "app.cardiosurf.pose.vision")
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private let request = VNDetectHumanBodyPoseRequest()
  private var configured = false
  private var requestedActive = false
  private var lastProcessedTime = 0.0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    previewLayer.session = session
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
    configurePreviewConnection()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    updateSession()
  }

  deinit {
    sessionQueue.async { [session] in
      if session.isRunning { session.stopRunning() }
    }
  }

  func setActive(_ active: Bool) {
    requestedActive = active
    updateSession()
  }

  private func updateSession() {
    let shouldRun = requestedActive && window != nil
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if shouldRun {
        if !self.configured && !self.configureSession() { return }
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

  @discardableResult
  private func configureSession() -> Bool {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .high

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
    output.setSampleBufferDelegate(self, queue: visionQueue)
    guard session.canAddOutput(output) else {
      emitStatus("unavailable")
      return false
    }
    session.addOutput(output)
    if let connection = output.connection(with: .video) {
      // The app is portrait-only. Rotate and mirror the delivered pixel buffer
      // itself so Vision and the selfie preview analyze the identical image.
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

  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    let now = CACurrentMediaTime()
    guard now - lastProcessedTime >= 0.1 else { return }
    lastProcessedTime = now
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

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

      let width = CVPixelBufferGetWidth(pixelBuffer)
      let height = CVPixelBufferGetHeight(pixelBuffer)
      DispatchQueue.main.async { [weak self] in
        self?.onPose([
          "keypoints": points,
          "timestamp": Date().timeIntervalSince1970 * 1000,
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

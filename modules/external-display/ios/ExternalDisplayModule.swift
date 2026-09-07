import AVFoundation
import ExpoModulesCore
import UIKit

/// Reports whether the phone is driving a TV, by either of the two paths iOS
/// offers:
///
/// 1. **Second screen.** AirPlay *screen mirroring*, Lightning/USB-C HDMI
///    adapters and CarPlay-style externals all add an entry to
///    `UIScreen.screens` and post `didConnectNotification` /
///    `didDisconnectNotification`.
/// 2. **AirPlay route.** The native AirPlay route picker (`AVRoutePickerView`,
///    what expo-video's `VideoAirPlayButton` wraps) does NOT create a screen.
///    It changes the app's `AVAudioSession` output route to an `.airPlay`
///    port; video then plays on the receiver through external playback while
///    the phone keeps its own UI. That shows up as
///    `AVAudioSession.routeChangeNotification`.
///
/// `connected` is true for either path. `UIScreen.screens` is soft-deprecated
/// since iOS 16 in favour of scenes, but it is still the only API that reports
/// mirroring destinations and it keeps working through iOS 18. It must be read
/// on the main thread.
public final class ExternalDisplayModule: Module {
  private static let changeEvent = "onExternalDisplayChange"
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("ExternalDisplay")

    Events(Self.changeEvent)

    Function("isExternalDisplayConnected") { () -> Bool in
      Self.onMain { Self.snapshot().connected }
    }

    Function("isMirrored") { () -> Bool in
      Self.onMain { Self.snapshot().mirrored }
    }

    Function("getState") { () -> [String: Any?] in
      Self.onMain { Self.snapshot().payload }
    }

    OnStartObserving(Self.changeEvent) {
      self.startObserving()
    }

    OnStopObserving(Self.changeEvent) {
      self.stopObserving()
    }

    OnDestroy {
      self.stopObserving()
    }
  }

  // MARK: - Observation

  private func startObserving() {
    guard observers.isEmpty else { return }
    Self.prepareAudioSessionForRouteReporting()
    let center = NotificationCenter.default
    let handler: (Notification) -> Void = { [weak self] _ in
      guard let self else { return }
      // Screen notifications arrive on the main thread and route changes are
      // re-queued onto it below, so the snapshot can read `UIScreen.screens`
      // directly. Both are already up to date by the time they are delivered.
      self.sendEvent(Self.changeEvent, Self.snapshot().payload)
    }
    observers = [
      center.addObserver(forName: UIScreen.didConnectNotification, object: nil, queue: .main, using: handler),
      center.addObserver(forName: UIScreen.didDisconnectNotification, object: nil, queue: .main, using: handler),
      center.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: AVAudioSession.sharedInstance(),
        queue: .main,
        using: handler
      ),
    ]
  }

  private func stopObserving() {
    let center = NotificationCenter.default
    observers.forEach { center.removeObserver($0) }
    observers.removeAll()
  }

  /// Route changes are reported against the app's own audio session. expo-video
  /// configures the session (`.playback` / `.moviePlayback`) once a player
  /// exists and activates it when one is audibly playing; on the setup screens
  /// there is no player yet, so make sure the session is at least configured
  /// and active enough for the picker's selection to register as our route.
  ///
  /// Only the untouched system default (`.soloAmbient`) is replaced, and only
  /// with a mixing category so nothing else on the phone is interrupted.
  /// Anything expo-video or expo-audio has already set is left alone, and every
  /// call is best-effort.
  private static func prepareAudioSessionForRouteReporting() {
    let session = AVAudioSession.sharedInstance()
    if session.category == .soloAmbient {
      try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }
    // Activating a non-mixing session would silence whatever else is playing;
    // in that case leave activation to the video player, which needs it anyway.
    let mixes = session.categoryOptions.contains(.mixWithOthers)
    if mixes || !session.isOtherAudioPlaying {
      try? session.setActive(true)
    }
  }

  // MARK: - State

  private struct Snapshot {
    let connected: Bool
    let mirrored: Bool
    let screenCount: Int
    let airPlayActive: Bool
    let airPlayDeviceName: String?

    var payload: [String: Any?] {
      [
        "connected": connected,
        "mirrored": mirrored,
        "screenCount": screenCount,
        "airPlayActive": airPlayActive,
        "airPlayDeviceName": airPlayDeviceName,
      ]
    }
  }

  private static func snapshot() -> Snapshot {
    let screens = UIScreen.screens
    let external = screens.count > 1
    // A mirroring destination reports the screen it is mirroring; a screen
    // the app has taken over (its own UIWindow) reports nil.
    let mirrored = screens.contains { $0.mirrored != nil }

    let airPlayOutputs = AVAudioSession.sharedInstance().currentRoute.outputs.filter {
      $0.portType == .airPlay
    }
    let airPlayActive = !airPlayOutputs.isEmpty
    let names = airPlayOutputs
      .map { $0.portName.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    let airPlayDeviceName = names.isEmpty ? nil : names.joined(separator: ", ")

    return Snapshot(
      connected: external || airPlayActive,
      mirrored: mirrored,
      screenCount: screens.count,
      airPlayActive: airPlayActive,
      airPlayDeviceName: airPlayDeviceName
    )
  }

  private static func onMain<T>(_ work: () -> T) -> T {
    if Thread.isMainThread {
      return work()
    }
    return DispatchQueue.main.sync(execute: work)
  }
}

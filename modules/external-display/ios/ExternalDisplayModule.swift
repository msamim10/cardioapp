import ExpoModulesCore
import UIKit

/// Reports whether the phone is driving a second display.
///
/// iOS exposes every attached display as a `UIScreen`: AirPlay *screen
/// mirroring*, Lightning/USB-C HDMI adapters and CarPlay-style externals all
/// add an entry to `UIScreen.screens` and post `didConnectNotification` /
/// `didDisconnectNotification`. AirPlay *video-only* routing (the AirPlay
/// button inside a video player) does NOT create a screen; that case is
/// already observable through expo-video's external playback flag.
///
/// `UIScreen.screens` is soft-deprecated since iOS 16 in favour of scenes, but
/// it is still the only API that reports mirroring destinations and it keeps
/// working through iOS 18. It must be read on the main thread.
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

    Function("getState") { () -> [String: Any] in
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
    let center = NotificationCenter.default
    let handler: (Notification) -> Void = { [weak self] _ in
      guard let self else { return }
      // The notification is delivered on the main thread, but re-reading
      // `UIScreen.screens` right after disconnect is already up to date.
      self.sendEvent(Self.changeEvent, Self.snapshot().payload)
    }
    observers = [
      center.addObserver(forName: UIScreen.didConnectNotification, object: nil, queue: .main, using: handler),
      center.addObserver(forName: UIScreen.didDisconnectNotification, object: nil, queue: .main, using: handler),
    ]
  }

  private func stopObserving() {
    let center = NotificationCenter.default
    observers.forEach { center.removeObserver($0) }
    observers.removeAll()
  }

  // MARK: - State

  private struct Snapshot {
    let connected: Bool
    let mirrored: Bool
    let screenCount: Int

    var payload: [String: Any] {
      ["connected": connected, "mirrored": mirrored, "screenCount": screenCount]
    }
  }

  private static func snapshot() -> Snapshot {
    let screens = UIScreen.screens
    let external = screens.count > 1
    // A mirroring destination reports the screen it is mirroring; a screen
    // the app has taken over (its own UIWindow) reports nil.
    let mirrored = screens.contains { $0.mirrored != nil }
    return Snapshot(connected: external, mirrored: mirrored, screenCount: screens.count)
  }

  private static func onMain<T>(_ work: () -> T) -> T {
    if Thread.isMainThread {
      return work()
    }
    return DispatchQueue.main.sync(execute: work)
  }
}

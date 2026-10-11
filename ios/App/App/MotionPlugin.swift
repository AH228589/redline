import Foundation
import Capacitor
import CoreMotion

/// Phone sensors for recording: running cadence and steps from the motion
/// coprocessor, and relative altitude from the barometer. Updates are sent to
/// the web layer as "motion" events.
@objc(MotionPlugin)
public class MotionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MotionPlugin"
    public let jsName = "Motion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let pedometer = CMPedometer()
    private let altimeter = CMAltimeter()
    private var running = false

    private func now() -> Double { Date().timeIntervalSince1970 * 1000 }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve([
            "steps": CMPedometer.isStepCountingAvailable(),
            "cadence": CMPedometer.isCadenceAvailable(),
            "barometer": CMAltimeter.isRelativeAltitudeAvailable(),
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.running { return call.resolve() }
            self.running = true
            if CMPedometer.isStepCountingAvailable() {
                self.pedometer.startUpdates(from: Date()) { [weak self] data, error in
                    guard let self = self, let data = data, error == nil else { return }
                    var out: [String: Any] = ["type": "steps", "steps": data.numberOfSteps.intValue, "t": self.now()]
                    // currentCadence is steps per second.
                    if let c = data.currentCadence { out["cadence"] = c.doubleValue * 60 }
                    self.notifyListeners("motion", data: out)
                }
            }
            if CMAltimeter.isRelativeAltitudeAvailable() {
                self.altimeter.startRelativeAltitudeUpdates(to: OperationQueue.main) { [weak self] data, error in
                    guard let self = self, let data = data, error == nil else { return }
                    self.notifyListeners("motion", data: [
                        "type": "altitude",
                        "relativeAltitude": data.relativeAltitude.doubleValue,
                        "pressure": data.pressure.doubleValue * 10, // kPa to hPa
                        "t": self.now(),
                    ])
                }
            }
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pedometer.stopUpdates()
            self.altimeter.stopRelativeAltitudeUpdates()
            self.running = false
            call.resolve()
        }
    }
}

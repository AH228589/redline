import UIKit
import Capacitor

/// Registers the app's own plugins with the Capacitor bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MotionPlugin())
    }
}

import Network
import Foundation

final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()
    @Published private(set) var path: NWPath?
    private let monitor = NWPathMonitor(); private let queue = DispatchQueue(label: "PhotoBackup.Network")
    private init() { monitor.pathUpdateHandler = { [weak self] value in DispatchQueue.main.async { self?.path = value } }; monitor.start(queue: queue) }
    var uploadAllowed: Bool {
        guard let path, path.status == .satisfied else { return false }
        if path.usesInterfaceType(.cellular) { return AppSettings.shared.allowCellular }
        if path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet) { return AppSettings.shared.allowWiFi }
        return false
    }
}

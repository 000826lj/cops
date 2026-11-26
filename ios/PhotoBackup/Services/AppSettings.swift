import Foundation

final class AppSettings: ObservableObject {
    static let shared = AppSettings()
    // These values are replaced by the GitHub build workflow for the current FRP endpoint.
    static let builtInServerURL = "https://FRP_HOST:FRP_PORT"
    static let builtInDeviceAccessKey = "DEVICE_ACCESS_KEY"

    private enum Keys {
        static let serverURL = "serverURL"
        static let allowWiFi = "allowWiFi"
        static let allowCellular = "allowCellular"
        static let concurrentUploads = "concurrentUploads"
    }

    private let defaults = UserDefaults.standard

    @Published var serverURL: String { didSet { defaults.set(serverURL, forKey: Keys.serverURL) } }
    @Published var allowWiFi: Bool { didSet { defaults.set(allowWiFi, forKey: Keys.allowWiFi) } }
    @Published var allowCellular: Bool { didSet { defaults.set(allowCellular, forKey: Keys.allowCellular) } }
    @Published var concurrentUploads: Int { didSet { defaults.set(concurrentUploads, forKey: Keys.concurrentUploads) } }

    private init() {
        serverURL = Self.builtInServerURL
        allowWiFi = defaults.object(forKey: Keys.allowWiFi) as? Bool ?? true
        allowCellular = defaults.object(forKey: Keys.allowCellular) as? Bool ?? true
        concurrentUploads = max(1, defaults.object(forKey: Keys.concurrentUploads) as? Int ?? 2)
    }

    var normalizedServerURL: URL? {
        guard let url = URL(string: serverURL), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http", url.host != nil else { return nil }
        return url
    }
}

import BackgroundTasks
import SwiftUI

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: BackupCoordinator.backgroundTaskIdentifier, using: nil) { task in
            Task { @MainActor in BackupCoordinator.shared.handleBackground(task as! BGProcessingTask) }
        }
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        Task { @MainActor in BackupCoordinator.shared.scheduleBackground() }
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        if identifier == BackgroundUploadSession.identifier {
            BackgroundUploadSession.shared.backgroundCompletionHandler = completionHandler
        } else {
            completionHandler()
        }
    }
}

@main
struct PhotoBackupApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup { RootView() }
            .onChange(of: scenePhase) { phase in
                if phase == .active && KeychainStore.shared.get("authToken") != nil {
                    Task { await BackupCoordinator.shared.runBackup() }
                }
            }
    }
}

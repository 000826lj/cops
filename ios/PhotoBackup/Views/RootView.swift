import SwiftUI

struct RootView: View {
    @State private var ready = false
    @State private var connecting = false
    @State private var connectionError = ""

    var body: some View {
        Group {
            if ready {
                DashboardView()
            } else {
                NavigationStack {
                    VStack(spacing: 18) {
                        ProgressView()
                        Text(connectionError.isEmpty ? "正在连接家庭照片服务器" : connectionError)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(connectionError.isEmpty ? .primary : .red)
                        if !connectionError.isEmpty {
                            Button("重新连接") { connectAndStart() }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(24)
                    .navigationTitle("家庭相册备份")
                }
            }
        }
        .task { connectAndStart() }
    }

    private func connectAndStart() {
        guard !connecting else { return }
        connecting = true
        connectionError = ""
        Task {
            do {
                let result = try await APIClient.shared.connectDevice()
                try KeychainStore.shared.set(result.token, for: "authToken")
                await MainActor.run {
                    ready = true
                    connecting = false
                    BackupCoordinator.shared.requestPermissionAndBackup()
                }
            } catch {
                await MainActor.run {
                    connectionError = "无法连接照片服务器：\(error.localizedDescription)"
                    connecting = false
                }
            }
        }
    }
}

import SwiftUI

struct RootView: View {
    @State private var loggedIn = KeychainStore.shared.get("authToken") != nil
    var body: some View {
        Group { if loggedIn { DashboardView(loggedIn: $loggedIn) } else { LoginView(loggedIn: $loggedIn) } }
    }
}

struct LoginView: View {
    @Binding var loggedIn: Bool
    @State private var username = ""; @State private var password = ""; @State private var invite = ""
    @State private var registering = false; @State private var loading = false; @State private var error = ""
    @StateObject private var settings = AppSettings.shared
    var body: some View {
        NavigationStack {
            Form {
                Section("服务器") { TextField("https://photos.example.com", text: $settings.serverURL).textInputAutocapitalization(.never).keyboardType(.URL) }
                Section(registering ? "注册家庭成员" : "登录") {
                    TextField("用户名", text: $username).textInputAutocapitalization(.never)
                    SecureField("密码（至少 8 位）", text: $password)
                    if registering { TextField("邀请码（首个管理员无需填写）", text: $invite).textInputAutocapitalization(.never) }
                    if !error.isEmpty { Text(error).foregroundStyle(.red) }
                    Button(loading ? "处理中…" : (registering ? "注册并登录" : "登录")) { submit() }.disabled(loading || username.isEmpty || password.count < 8)
                    Button(registering ? "已有账号，返回登录" : "首次使用或有邀请码？注册") { registering.toggle(); error = "" }
                }
                Section { Text("首位注册用户会成为管理员，可在服务器接口创建家人邀请码。照片仅上传到你填写的自有服务器。") }.font(.footnote)
            }.navigationTitle("家庭相册备份")
        }
    }
    private func submit() {
        loading = true; error = ""
        Task { do {
            let result = try await APIClient.shared.authenticate(username: username, password: password, inviteCode: invite.isEmpty ? nil : invite, register: registering)
            try KeychainStore.shared.set(result.token, for: "authToken"); await MainActor.run { loggedIn = true; loading = false; BackupCoordinator.shared.requestPermissionAndBackup() }
        } catch { await MainActor.run { self.error = error.localizedDescription; loading = false } } }
    }
}

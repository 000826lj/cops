import SwiftUI

struct DashboardView: View {
    @StateObject private var coordinator = BackupCoordinator.shared
    @StateObject private var settings = AppSettings.shared
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        ProgressView(value: coordinator.statistics.progress)
                        Text(coordinator.statusText).font(.headline)
                        HStack { Stat(title: "相册资源", value: coordinator.statistics.total); Stat(title: "已备份", value: coordinator.statistics.completed) }
                        HStack { Stat(title: "待上传", value: coordinator.statistics.pending); Stat(title: "失败", value: coordinator.statistics.failed) }
                    }.padding(.vertical, 8)
                    Button(coordinator.isRunning ? "正在备份…" : "立即扫描并备份") { coordinator.requestPermissionAndBackup() }.disabled(coordinator.isRunning)
                }
                Section("网络设置") {
                    Toggle("允许 Wi-Fi 上传", isOn: $settings.allowWiFi)
                    Toggle("允许蜂窝网络上传", isOn: $settings.allowCellular)
                    Text("视频可能消耗大量蜂窝流量。关闭蜂窝上传后，任务会等待 Wi-Fi。") .font(.footnote).foregroundStyle(.secondary)
                }
                Section("连接状态") { Text("已自动连接：\(settings.serverURL)").font(.footnote) }
                Section("后台说明") { Text("iOS 会根据电量、网络与使用习惯调度后台任务，无法保证永久实时运行。每次打开 App 会立即扫描并补传；系统允许时也会在后台继续。") .font(.footnote) }
            }.navigationTitle("照片备份").onAppear { coordinator.refreshStatistics(); coordinator.requestPermissionAndBackup() }
        }
    }
}

private struct Stat: View { let title: String; let value: Int; var body: some View { VStack(alignment: .leading) { Text("\(value)").font(.title2.bold()); Text(title).font(.caption).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading) } }

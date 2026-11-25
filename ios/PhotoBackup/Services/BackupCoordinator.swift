import BackgroundTasks
import CoreData
import Foundation
import Photos

@MainActor
final class BackupCoordinator: ObservableObject {
    static let shared = BackupCoordinator()
    static let backgroundTaskIdentifier = "com.selfhosted.PhotoBackup.processing"
    @Published private(set) var statistics = BackupStatistics()
    @Published private(set) var isRunning = false
    @Published var statusText = "等待开始"
    private let store = BackupStore.shared
    private let library = PhotoLibraryService()
    private var currentTask: Task<Void, Never>?

    private init() { refreshStatistics() }

    func requestPermissionAndBackup() {
        currentTask?.cancel()
        currentTask = Task {
            let permission = await library.requestAccess()
            guard permission == .authorized else { statusText = "请在设置中允许访问所有照片"; return }
            await runBackup()
        }
    }

    func runBackup() async {
        guard !isRunning else { return }
        guard KeychainStore.shared.get("authToken") != nil else { statusText = "请先登录"; return }
        guard NetworkMonitor.shared.uploadAllowed else { statusText = "等待允许的网络"; scheduleBackground(); return }
        isRunning = true; defer { isRunning = false; refreshStatistics(); scheduleBackground() }
        do {
            statusText = "正在扫描系统相册"
            for descriptor in try library.scan() { try store.upsert(descriptor) }
            refreshStatistics()
            let pending = try store.pending(limit: 100)
            for record in pending {
                if Task.isCancelled { break }
                try await upload(record)
                refreshStatistics()
            }
            statusText = pending.isEmpty ? "所有照片和视频均已备份" : "本轮备份完成"
        } catch { statusText = error.localizedDescription }
    }

    private func upload(_ record: NSManagedObject) async throws {
        guard NetworkMonitor.shared.uploadAllowed else { throw BackupError.networkDisallowed }
        guard let token = KeychainStore.shared.get("authToken") else { throw BackupError.unauthorized }
        let assetID = record.value(forKey: "assetIdentifier") as! String
        let resourceType = record.value(forKey: "resourceType") as! Int16
        let fileName = record.value(forKey: "fileName") as! String
        let recordID = record.value(forKey: "recordID") as! String
        let capturedAt = record.value(forKey: "capturedAt") as? Date ?? Date()
        do {
            try store.set(record, status: .exporting)
            statusText = "正在读取 \(fileName)"
            let fileURL = try await library.export(assetIdentifier: assetID, resourceType: resourceType, fileName: fileName)
            defer { try? FileManager.default.removeItem(at: fileURL) }
            let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            let hash = try SHA256Hasher.file(fileURL)
            let mime = PhotoLibraryService.mimeType(for: record.value(forKey: "uti") as? String ?? "", fileName: fileName)
            let chunkSize: Int64 = 20 * 1024 * 1024
            let chunks = ChunkPlan.chunks(fileSize: size, chunkSize: chunkSize)
            let mediaType = mime.hasPrefix("video/") ? "video" : "photo"
            let session = try await APIClient.shared.createUpload(CreateUploadRequest(assetId: recordID, fileName: fileName, capturedAt: capturedAt, mediaType: mediaType, mimeType: mime, size: size, sha256: hash, width: nil, height: nil, duration: nil, totalChunks: chunks.count), token: token)
            if session.duplicate == true || session.completed == true { try store.set(record, status: .completed, size: size, uploaded: size); return }
            guard let uploadID = session.uploadID else { throw BackupError.invalidResponse }
            try store.set(record, status: .uploading, uploadID: uploadID, size: size, uploaded: 0)
            let missing: [Int]
            if let sessionMissing = session.missingChunks {
                missing = sessionMissing
            } else {
                missing = try await APIClient.shared.missingChunks(uploadID: uploadID, token: token).missingChunks
            }
            var uploaded = size - chunks.filter { missing.contains($0.index) }.reduce(0) { $0 + $1.length }
            for index in ChunkPlan.normalizedMissing(missing, chunkCount: chunks.count) {
                guard NetworkMonitor.shared.uploadAllowed else { throw BackupError.networkDisallowed }
                statusText = "上传 \(fileName)（\(index + 1)/\(chunks.count)）"
                try await APIClient.shared.uploadChunk(fileURL: fileURL, descriptor: chunks[index], uploadID: uploadID, token: token)
                uploaded += chunks[index].length
                try store.set(record, status: .uploading, uploadID: uploadID, size: size, uploaded: uploaded)
            }
            try await APIClient.shared.complete(uploadID: uploadID, token: token)
            try store.set(record, status: .completed, uploadID: uploadID, size: size, uploaded: size)
        } catch {
            try? store.set(record, status: .failed, error: error.localizedDescription)
            throw error
        }
    }

    func refreshStatistics() { statistics = (try? store.statistics()) ?? BackupStatistics() }
    func scheduleBackground() {
        let request = BGProcessingTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.requiresNetworkConnectivity = true; request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    func handleBackground(_ task: BGProcessingTask) {
        scheduleBackground()
        let work = Task { await runBackup(); task.setTaskCompleted(success: true) }
        task.expirationHandler = { work.cancel(); task.setTaskCompleted(success: false) }
    }
}

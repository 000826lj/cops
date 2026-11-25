import Foundation

enum BackupStatus: String, CaseIterable, Codable {
    case pending
    case exporting
    case uploading
    case completed
    case failed

    var displayName: String {
        switch self {
        case .pending: return "待上传"
        case .exporting: return "正在导出"
        case .uploading: return "正在上传"
        case .completed: return "已备份"
        case .failed: return "失败"
        }
    }
}

struct BackupStatistics: Equatable {
    var total = 0
    var completed = 0
    var pending = 0
    var failed = 0
    var uploadedBytes: Int64 = 0
    var totalBytes: Int64 = 0

    var progress: Double {
        guard totalBytes > 0 else { return completed == total && total > 0 ? 1 : 0 }
        return min(1, Double(uploadedBytes) / Double(totalBytes))
    }
}

struct PhotoResourceDescriptor: Hashable {
    let recordID: String
    let assetLocalIdentifier: String
    let resourceType: Int16
    let filename: String
    let uniformTypeIdentifier: String
    let creationDate: Date?
    let modificationDate: Date?
}

struct UploadSession: Codable {
    let uploadID: String?
    let chunkSize: Int64?
    let missingChunks: [Int]?
    let duplicate: Bool?
    let completed: Bool?
}

struct MissingChunksResponse: Codable {
    let uploadID: String
    let status: String
    let missingChunks: [Int]
}

struct AuthResponse: Codable {
    let token: String
    let userID: String
}

struct APIErrorResponse: Codable {
    let message: String
}

enum BackupError: LocalizedError {
    case invalidServerURL
    case unauthorized
    case photoAccessDenied
    case resourceUnavailable
    case networkDisallowed
    case invalidResponse
    case server(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: return "服务器地址无效"
        case .unauthorized: return "登录状态已失效"
        case .photoAccessDenied: return "需要“所有照片”访问权限"
        case .resourceUnavailable: return "原始资源不可用，可能尚未从 iCloud 下载"
        case .networkDisallowed: return "当前网络不符合上传设置"
        case .invalidResponse: return "服务器返回格式无效"
        case let .server(status, message): return "服务器错误（\(status)）：\(message)"
        }
    }
}

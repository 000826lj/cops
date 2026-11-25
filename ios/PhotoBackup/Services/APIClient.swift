import Foundation

struct CreateUploadRequest: Codable {
    let assetId: String
    let fileName: String
    let capturedAt: Date
    let mediaType: String
    let mimeType: String
    let size: Int64
    let sha256: String
    let width: Int?
    let height: Int?
    let duration: Double?
    let totalChunks: Int
}

struct CompletionResponse: Codable { let completed: Bool }

final class APIClient {
    static let shared = APIClient()
    private let decoder: JSONDecoder = { let value = JSONDecoder(); value.dateDecodingStrategy = .iso8601; return value }()
    private let encoder: JSONEncoder = { let value = JSONEncoder(); value.dateEncodingStrategy = .iso8601; return value }()
    private init() {}

    private func request(path: String, method: String = "GET", body: Data? = nil, contentType: String = "application/json", token: String? = nil) throws -> URLRequest {
        guard let base = AppSettings.shared.normalizedServerURL,
              let url = URL(string: path, relativeTo: base)?.absoluteURL else { throw BackupError.invalidServerURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.timeoutInterval = 120
        request.allowsCellularAccess = AppSettings.shared.allowCellular
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BackupError.invalidResponse }
        if http.statusCode == 401 { throw BackupError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(APIErrorEnvelope.self, from: data).error.message) ?? String(data: data, encoding: .utf8) ?? "未知错误"
            throw BackupError.server(status: http.statusCode, message: message)
        }
        return try decoder.decode(type, from: data)
    }

    func authenticate(username: String, password: String, inviteCode: String?, register: Bool) async throws -> AuthResponse {
        struct Payload: Codable { let username: String; let password: String; let inviteCode: String? }
        var request = try request(path: register ? "/api/auth/register" : "/api/auth/login", method: "POST", body: try encoder.encode(Payload(username: username, password: password, inviteCode: inviteCode)))
        request.timeoutInterval = 30
        return try await perform(request, as: AuthResponse.self)
    }

    func createUpload(_ payload: CreateUploadRequest, token: String) async throws -> UploadSession {
        try await perform(request(path: "/api/uploads", method: "POST", body: try encoder.encode(payload), token: token), as: UploadSession.self)
    }

    func missingChunks(uploadID: String, token: String) async throws -> MissingChunksResponse {
        try await perform(request(path: "/api/uploads/\(uploadID)", token: token), as: MissingChunksResponse.self)
    }

    func uploadChunk(fileURL: URL, descriptor: ChunkDescriptor, uploadID: String, token: String) async throws {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(descriptor.offset))
        let data = try handle.read(upToCount: Int(descriptor.length)) ?? Data()
        let chunkURL = FileManager.default.temporaryDirectory.appendingPathComponent("photobackup-\(uploadID)-\(descriptor.index).part")
        try data.write(to: chunkURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: chunkURL) }
        var chunkRequest = try request(path: "/api/uploads/\(uploadID)/chunks/\(descriptor.index)", method: "PUT", contentType: "application/octet-stream", token: token)
        chunkRequest.setValue(data.sha256Hex, forHTTPHeaderField: "X-Chunk-Sha256")
        let (responseData, response) = try await BackgroundUploadSession.shared.upload(request: chunkRequest, fileURL: chunkURL)
        if response.statusCode == 401 { throw BackupError.unauthorized }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? decoder.decode(APIErrorEnvelope.self, from: responseData).error.message) ?? "分块上传失败"
            throw BackupError.server(status: response.statusCode, message: message)
        }
    }

    func complete(uploadID: String, token: String) async throws {
        let _: CompletionResponse = try await perform(request(path: "/api/uploads/\(uploadID)/complete", method: "POST", body: Data("{}".utf8), token: token), as: CompletionResponse.self)
    }
}

private struct APIErrorEnvelope: Codable { struct Detail: Codable { let message: String }; let error: Detail }
private struct ChunkAccepted: Codable { let accepted: Bool }

extension Data {
    var sha256Hex: String {
        SHA256Hasher.hex(self)
    }
}

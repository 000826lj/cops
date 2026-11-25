import Foundation

final class BackgroundUploadSession: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate {
    static let shared = BackgroundUploadSession()
    static let identifier = "com.selfhosted.PhotoBackup.upload"
    private var continuations: [Int: CheckedContinuation<(Data, HTTPURLResponse), Error>] = [:]
    private var responseData: [Int: Data] = [:]
    var backgroundCompletionHandler: (() -> Void)?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.allowsCellularAccess = true
        configuration.waitsForConnectivity = true
        configuration.httpMaximumConnectionsPerHost = 2
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private override init() { super.init() }

    func upload(request: URLRequest, fileURL: URL) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.uploadTask(with: request, fromFile: fileURL)
            continuations[task.taskIdentifier] = continuation
            responseData[task.taskIdentifier] = Data()
            task.resume()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseData[dataTask.taskIdentifier, default: Data()].append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let continuation = continuations.removeValue(forKey: task.taskIdentifier) else { return }
        let data = responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
        if let error { continuation.resume(throwing: error); return }
        guard let response = task.response as? HTTPURLResponse else { continuation.resume(throwing: BackupError.invalidResponse); return }
        continuation.resume(returning: (data, response))
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { self.backgroundCompletionHandler?(); self.backgroundCompletionHandler = nil }
    }
}

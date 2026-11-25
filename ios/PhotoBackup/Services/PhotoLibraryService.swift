import Photos
import UniformTypeIdentifiers
import Foundation

final class PhotoLibraryService {
    func requestAccess() async -> PHAuthorizationStatus {
        await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    func scan() throws -> [PhotoResourceDescriptor] {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized else { throw BackupError.photoAccessDenied }
        let options = PHFetchOptions(); options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let assets = PHAsset.fetchAssets(with: options)
        var result: [PhotoResourceDescriptor] = []
        assets.enumerateObjects { asset, _, _ in
            for resource in PHAssetResource.assetResources(for: asset) where Self.shouldBackup(resource.type) {
                let resourceID = "\(asset.localIdentifier)|\(resource.type.rawValue)|\(resource.originalFilename)"
                result.append(PhotoResourceDescriptor(recordID: resourceID, assetLocalIdentifier: asset.localIdentifier, resourceType: Int16(resource.type.rawValue), filename: resource.originalFilename, uniformTypeIdentifier: resource.uniformTypeIdentifier, creationDate: asset.creationDate, modificationDate: asset.modificationDate))
            }
        }
        return result
    }

    func export(assetIdentifier: String, resourceType: Int16, fileName: String) async throws -> URL {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [assetIdentifier], options: nil)
        guard let asset = result.firstObject,
              let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type.rawValue == Int(resourceType) && $0.originalFilename == fileName }) else { throw BackupError.resourceUnavailable }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PhotoBackupExports", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(UUID().uuidString + "-" + fileName)
        try? FileManager.default.removeItem(at: url)
        let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: ()) }
            }
        }
        return url
    }

    static func shouldBackup(_ type: PHAssetResourceType) -> Bool {
        [.photo, .video, .fullSizePhoto, .fullSizeVideo, .pairedVideo, .alternatePhoto].contains(type)
    }

    static func mimeType(for uti: String, fileName: String) -> String {
        if let value = UTType(uti)?.preferredMIMEType { return value }
        let ext = (fileName as NSString).pathExtension
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
}

import Foundation

struct ChunkDescriptor: Equatable {
    let index: Int
    let offset: Int64
    let length: Int64
}

enum ChunkPlan {
    static func chunks(fileSize: Int64, chunkSize: Int64) -> [ChunkDescriptor] {
        guard fileSize > 0, chunkSize > 0 else { return [] }
        let count = Int((fileSize + chunkSize - 1) / chunkSize)
        return (0..<count).map { index in
            let offset = Int64(index) * chunkSize
            return ChunkDescriptor(
                index: index,
                offset: offset,
                length: min(chunkSize, fileSize - offset)
            )
        }
    }

    static func normalizedMissing(_ indices: [Int], chunkCount: Int) -> [Int] {
        Array(Set(indices.filter { $0 >= 0 && $0 < chunkCount })).sorted()
    }
}

enum BackupStateLogic {
    static func nextStatus(current: BackupStatus, missingChunkCount: Int, retryCount: Int, retryLimit: Int) -> BackupStatus {
        if missingChunkCount == 0 { return .completed }
        if retryCount >= retryLimit { return .failed }
        if current == .exporting { return .exporting }
        return .uploading
    }
}

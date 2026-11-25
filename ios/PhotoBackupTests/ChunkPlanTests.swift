import XCTest
@testable import PhotoBackup

final class ChunkPlanTests: XCTestCase {
    func testChunkPlanCoversWholeFile() {
        let chunks = ChunkPlan.chunks(fileSize: 11, chunkSize: 4)
        XCTAssertEqual(chunks, [ChunkDescriptor(index: 0, offset: 0, length: 4), ChunkDescriptor(index: 1, offset: 4, length: 4), ChunkDescriptor(index: 2, offset: 8, length: 3)])
    }
    func testMissingChunksAreUniqueAndBounded() {
        XCTAssertEqual(ChunkPlan.normalizedMissing([2, 1, 2, -1, 9], chunkCount: 3), [1, 2])
    }
    func testStateLogic() {
        XCTAssertEqual(BackupStateLogic.nextStatus(current: .pending, missingChunkCount: 0, retryCount: 0, retryLimit: 3), .completed)
        XCTAssertEqual(BackupStateLogic.nextStatus(current: .uploading, missingChunkCount: 1, retryCount: 3, retryLimit: 3), .failed)
    }
}

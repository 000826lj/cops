import CoreData
import Foundation

final class BackupStore {
    static let shared = BackupStore()
    let container: NSPersistentContainer

    private init(inMemory: Bool = false) {
        let model = NSManagedObjectModel()
        let entity = NSEntityDescription(); entity.name = "BackupRecord"; entity.managedObjectClassName = "NSManagedObject"
        func attribute(_ name: String, _ type: NSAttributeType, optional: Bool = false) -> NSAttributeDescription {
            let value = NSAttributeDescription(); value.name = name; value.attributeType = type; value.isOptional = optional
            switch type {
            case .integer16AttributeType, .integer32AttributeType, .integer64AttributeType, .doubleAttributeType, .floatAttributeType:
                value.defaultValue = 0
            case .booleanAttributeType:
                value.defaultValue = false
            default:
                break
            }
            return value
        }
        entity.properties = [
            attribute("recordID", .stringAttributeType), attribute("assetIdentifier", .stringAttributeType),
            attribute("resourceType", .integer16AttributeType), attribute("fileName", .stringAttributeType),
            attribute("uti", .stringAttributeType), attribute("status", .stringAttributeType),
            attribute("uploadID", .stringAttributeType, optional: true), attribute("errorMessage", .stringAttributeType, optional: true),
            attribute("fileSize", .integer64AttributeType), attribute("uploadedBytes", .integer64AttributeType),
            attribute("retryCount", .integer16AttributeType), attribute("capturedAt", .dateAttributeType, optional: true),
            attribute("updatedAt", .dateAttributeType)
        ]
        entity.uniquenessConstraints = [["recordID"]]; model.entities = [entity]
        container = NSPersistentContainer(name: "PhotoBackup", managedObjectModel: model)
        if inMemory { container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null") }
        container.loadPersistentStores { _, error in if let error { assertionFailure("数据库加载失败：\(error)") } }
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        container.viewContext.automaticallyMergesChangesFromParent = true
    }

    func upsert(_ descriptor: PhotoResourceDescriptor) throws {
        let context = container.viewContext
        let request = NSFetchRequest<NSManagedObject>(entityName: "BackupRecord")
        request.predicate = NSPredicate(format: "recordID == %@", descriptor.recordID)
        let existing = try context.fetch(request).first
        let object = existing ?? NSEntityDescription.insertNewObject(forEntityName: "BackupRecord", into: context)
        if existing == nil {
            object.setValue(0, forKey: "fileSize")
            object.setValue(0, forKey: "uploadedBytes")
            object.setValue(0, forKey: "retryCount")
            object.setValue(BackupStatus.pending.rawValue, forKey: "status")
        }
        object.setValue(descriptor.recordID, forKey: "recordID"); object.setValue(descriptor.assetLocalIdentifier, forKey: "assetIdentifier")
        object.setValue(Int(descriptor.resourceType), forKey: "resourceType"); object.setValue(descriptor.filename, forKey: "fileName")
        object.setValue(descriptor.uniformTypeIdentifier, forKey: "uti"); object.setValue(descriptor.creationDate, forKey: "capturedAt")
        if object.value(forKey: "status") == nil { object.setValue(BackupStatus.pending.rawValue, forKey: "status") }
        object.setValue(Date(), forKey: "updatedAt"); try context.save()
    }

    func pending(limit: Int = 50) throws -> [NSManagedObject] {
        let request = NSFetchRequest<NSManagedObject>(entityName: "BackupRecord")
        request.predicate = NSPredicate(format: "status IN %@", [BackupStatus.pending.rawValue, BackupStatus.failed.rawValue, BackupStatus.uploading.rawValue, BackupStatus.exporting.rawValue])
        request.sortDescriptors = [NSSortDescriptor(key: "capturedAt", ascending: true)]; request.fetchLimit = limit
        return try container.viewContext.fetch(request)
    }

    func set(_ record: NSManagedObject, status: BackupStatus, uploadID: String? = nil, error: String? = nil, size: Int64? = nil, uploaded: Int64? = nil) throws {
        record.setValue(status.rawValue, forKey: "status"); if let uploadID { record.setValue(uploadID, forKey: "uploadID") }
        record.setValue(error, forKey: "errorMessage"); if let size { record.setValue(size, forKey: "fileSize") }; if let uploaded { record.setValue(uploaded, forKey: "uploadedBytes") }
        record.setValue(Date(), forKey: "updatedAt"); try container.viewContext.save()
    }

    func statistics() throws -> BackupStatistics {
        let request = NSFetchRequest<NSManagedObject>(entityName: "BackupRecord"); let records = try container.viewContext.fetch(request)
        var stats = BackupStatistics(); stats.total = records.count
        for item in records {
            let status = BackupStatus(rawValue: item.value(forKey: "status") as? String ?? "pending") ?? .pending
            if status == .completed { stats.completed += 1 } else if status == .failed { stats.failed += 1 } else { stats.pending += 1 }
            stats.totalBytes += item.value(forKey: "fileSize") as? Int64 ?? 0; stats.uploadedBytes += item.value(forKey: "uploadedBytes") as? Int64 ?? 0
        }
        return stats
    }
}

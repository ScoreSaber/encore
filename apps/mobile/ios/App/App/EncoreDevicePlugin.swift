import Capacitor
import Security
import UIKit
import UniformTypeIdentifiers

class EncoreBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(EncoreDevicePlugin())
    }
}

@objc(EncoreDevicePlugin)
class EncoreDevicePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "EncoreDevicePlugin"
    let jsName = "EncoreDevice"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSecretKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chooseFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openLink", returnType: CAPPluginReturnPromise)
    ]
    private var pickerCall: CAPPluginCall?
    private var pickerExtensions: [String] = []
    private let maxImportBytes = 128 * 1024 * 1024

    @objc func getSecretKey(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.scoresaber.encore",
            kSecAttrAccount as String: "daemon-master",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var existing: CFTypeRef?
        let read = SecItemCopyMatching(query as CFDictionary, &existing)
        if read == errSecSuccess, let key = existing as? Data, key.count == 32 {
            call.resolve(["key": key.base64EncodedString(), "backend": "keychain"])
            return
        }
        guard read == errSecItemNotFound else {
            call.reject("Encore could not open iOS secure storage", "mobile.secure-storage")
            return
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            call.reject("Encore could not create its secure storage key", "mobile.secure-storage")
            return
        }
        let key = Data(bytes)
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.scoresaber.encore",
            kSecAttrAccount as String: "daemon-master",
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: key
        ]
        let written = SecItemAdd(item as CFDictionary, nil)
        guard written == errSecSuccess else {
            call.reject("Encore could not save its secure storage key", "mobile.secure-storage")
            return
        }
        call.resolve(["key": key.base64EncodedString(), "backend": "keychain"])
    }

    @objc func chooseFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else {
                call.reject("Finish choosing the current file first", "mobile.file-picker")
                return
            }
            self.pickerCall = call
            self.pickerExtensions = call.getArray("extensions", String.self) ?? []
            let types = self.pickerExtensions.compactMap { UTType(filenameExtension: $0) }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.isEmpty ? [.data] : types, asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerCall?.resolve(["status": "cancelled"])
        pickerCall = nil
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall else { return }
        pickerCall = nil
        guard let source = urls.first else {
            call.resolve(["status": "cancelled"])
            return
        }
        let extensions = pickerExtensions
        let accessed = source.startAccessingSecurityScopedResource()
        defer { if accessed { source.stopAccessingSecurityScopedResource() } }
        var directory: URL?
        do {
            guard extensions.isEmpty || extensions.contains(source.pathExtension.lowercased()) else {
                call.reject("Choose a supported file", "mobile.file-picker")
                return
            }
            let cache = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let imports = cache.appendingPathComponent("encore-imports").appendingPathComponent(UUID().uuidString)
            directory = imports
            try FileManager.default.createDirectory(at: imports, withIntermediateDirectories: true)
            let destination = imports.appendingPathComponent(source.lastPathComponent)
            guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
                call.reject("Encore could not create the import file", "mobile.file-picker")
                try FileManager.default.removeItem(at: imports)
                return
            }
            let input = try FileHandle(forReadingFrom: source)
            defer { try? input.close() }
            let output = try FileHandle(forWritingTo: destination)
            defer { try? output.close() }
            var size = 0
            while let bytes = try input.read(upToCount: 64 * 1024), !bytes.isEmpty {
                size += bytes.count
                guard size <= maxImportBytes else {
                    call.reject("Choose a file smaller than 128 MiB", "mobile.file-picker")
                    try FileManager.default.removeItem(at: imports)
                    return
                }
                try output.write(contentsOf: bytes)
            }
            call.resolve(["status": "selected", "path": destination.path, "fileName": source.lastPathComponent])
        } catch {
            if let directory { try? FileManager.default.removeItem(at: directory) }
            call.reject("Encore could not read the selected file", "mobile.file-picker", error)
        }
    }

    @objc func copyText(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("Text is required")
            return
        }
        DispatchQueue.main.async {
            UIPasteboard.general.string = text
            call.resolve()
        }
    }

    @objc func openLink(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address),
              let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "steam", "beatsaver", "modelsaber", "scoresaber"].contains(scheme) else {
            call.resolve(["status": "blocked"])
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { opened in
                call.resolve(["status": opened ? "opened" : "blocked"])
            }
        }
    }
}

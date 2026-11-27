// 本地 OCR 后端（macOS Vision 框架，离线可用）；通常由 scripts/ocr.mjs 调用。
// 用法: swift ocr.swift <图片1> [图片2 ...] [--langs zh-Hans,en-US] [--list-langs]
// 输出: 按阅读顺序（自上而下、自左而右）逐行打印识别文本；多图时打印 "--- 文件名 ---" 分隔。

import AppKit
import Foundation
import Vision

func supportedVisionLanguages() -> [String]? {
    if #available(macOS 11.0, *) {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        return try? VNRecognizeTextRequest.supportedRecognitionLanguages(for: .accurate, revision: request.revision)
    }
    return nil
}

var paths: [String] = []
var langs: [String] = ["zh-Hans", "en-US"]
var failed = false
var listLangs = false
var i = 1
while i < CommandLine.arguments.count {
    let arg = CommandLine.arguments[i]
    if arg == "--langs", i + 1 < CommandLine.arguments.count {
        langs = CommandLine.arguments[i + 1].split(separator: ",").map(String.init)
        i += 2
    } else if arg == "--list-langs" {
        listLangs = true
        i += 1
    } else {
        paths.append(arg)
        i += 1
    }
}

if listLangs {
    guard let supported = supportedVisionLanguages() else {
        FileHandle.standardError.write("当前系统不支持查询 Vision 语言列表\n".data(using: .utf8)!)
        exit(2)
    }
    supported.forEach { print($0) }
    exit(0)
}

// 语言不在系统支持列表时直接失败；Vision 对未知语言可能静默降级并输出乱码。
if let supported = supportedVisionLanguages() {
    let unsupported = langs.filter { !supported.contains($0) }
    if !unsupported.isEmpty {
        FileHandle.standardError.write(
            "不支持的识别语言: \(unsupported.joined(separator: ", "))；支持: \(supported.joined(separator: ", "))\n"
                .data(using: .utf8)!
        )
        exit(2)
    }
}

guard !paths.isEmpty else {
    FileHandle.standardError.write("用法: swift ocr.swift <图片1> [图片2 ...] [--langs zh-Hans,en-US]\n".data(using: .utf8)!)
    exit(2)
}

func recognize(_ path: String) -> [String] {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("无法读取图片: \(path)\n".data(using: .utf8)!)
        failed = true
        return []
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = langs
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        FileHandle.standardError.write("OCR 失败 \(path): \(error)\n".data(using: .utf8)!)
        failed = true
        return []
    }
    let observations = (request.results ?? []).sorted { a, b in
        if abs(a.boundingBox.maxY - b.boundingBox.maxY) > 0.01 {
            return a.boundingBox.maxY > b.boundingBox.maxY
        }
        return a.boundingBox.minX < b.boundingBox.minX
    }
    return observations.compactMap { $0.topCandidates(1).first?.string }
}

for (index, path) in paths.enumerated() {
    if paths.count > 1 { print("--- \(path) ---") }
    let lines = recognize(path)
    if lines.isEmpty { FileHandle.standardError.write("未识别到文字: \(path)\n".data(using: .utf8)!) }
    lines.forEach { print($0) }
    if index < paths.count - 1 { print("") }
}

if failed { exit(1) }

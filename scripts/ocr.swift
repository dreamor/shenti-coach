// 本地 OCR（macOS Vision 框架，离线可用）
// 用法: swift ocr.swift <图片1> [图片2 ...] [--langs zh-Hans,en-US]
// 输出: 按阅读顺序（自上而下、自左而右）逐行打印识别文本；多图时打印 "--- 文件名 ---" 分隔。

import AppKit
import Foundation
import Vision

var paths: [String] = []
var langs: [String] = ["zh-Hans", "en-US"]
var i = 1
while i < CommandLine.arguments.count {
    let arg = CommandLine.arguments[i]
    if arg == "--langs", i + 1 < CommandLine.arguments.count {
        langs = CommandLine.arguments[i + 1].split(separator: ",").map(String.init)
        i += 2
    } else {
        paths.append(arg)
        i += 1
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

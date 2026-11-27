// Local delivery negotiation only: never uploads or claims an attachment.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const MODES = new Set(['media', 'markdown', 'file']);
const STATUSES = new Set(['local-only', 'reference-ready', 'unavailable']);
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !/[\r\n\0]/.test(value);

const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(data, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// Bounded structural decoding of Chrome's non-interlaced 8-bit grayscale/RGB/RGBA PNGs.
// Every legal scanline filter is reversible; validate its byte and exact decoded row sizes.
function validatePng(file) {
  const fail = detail => { throw new Error(`PNG ${detail}`); };
  if (!absolute(file) || !/\.png$/i.test(file)) fail('path 必须为本地 PNG 绝对路径');
  let fd;
  try {
    fd = openSync(file, 'r');
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size < 45 || stats.size > MAX_PNG_BYTES) fail('文件大小无效或超过 32 MiB');
    const data = Buffer.alloc(stats.size);
    for (let read = 0; read < data.length;) {
      const count = readSync(fd, data, read, data.length - read, read);
      if (!count) fail('读取期间文件截断');
      read += count;
    }
    if (!data.subarray(0, 8).equals(PNG_MAGIC)) fail('magic 无效');
    let offset = 8;
    let chunks = 0;
    let rowBytes = 0;
    let height = 0;
    let expected = 0;
    let color = null;
    let palette = false;
    let closedIdat = false;
    let ended = false;
    const idats = [];
    while (offset < data.length) {
      if (++chunks > 10000 || offset + 12 > data.length) fail('chunk 数量/边界无效');
      const length = data.readUInt32BE(offset);
      const end = offset + length + 12;
      if (end > data.length) fail('chunk 长度越界');
      const type = data.toString('latin1', offset + 4, offset + 8);
      if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) fail('chunk 类型无效');
      if (crc32(data, offset + 4, end - 4) !== data.readUInt32BE(end - 4)) fail(`${type} CRC 无效`);
      const payload = data.subarray(offset + 8, end - 4);
      if (type === 'IHDR') {
        if (offset !== 8 || length !== 13) fail('IHDR 必须唯一且位于首块');
        const width = payload.readUInt32BE(0);
        height = payload.readUInt32BE(4);
        color = payload[9];
        if (payload[8] !== 8 || !Object.hasOwn(CHANNELS, color) || payload[12] !== 0) {
          throw new Error('Unsupported PNG：仅支持非交错 8-bit 灰度/RGB/灰度-alpha/RGBA，不支持索引色、16-bit 或 Adam7');
        }
        if (payload[10] !== 0 || payload[11] !== 0) fail('压缩/滤波方法无效');
        if (!width || !height || width > 32768 || height > 32768) fail('尺寸无效或超过 32768');
        rowBytes = width * CHANNELS[color] + 1;
        expected = rowBytes * height;
        if (expected > MAX_DECODED_BYTES) fail('解压尺寸超过 64 MiB');
      } else {
        if (!expected) fail('缺少首块 IHDR');
        if (type === 'IDAT') {
          if (closedIdat) fail('IDAT 必须连续');
          idats.push(payload);
        } else if (type === 'IEND') {
          if (length !== 0 || !idats.length || end !== data.length) fail('IEND/IDAT 无效或含尾随数据');
          ended = true;
          break;
        } else {
          if (idats.length) closedIdat = true;
          if (type === 'PLTE') {
            if (palette || idats.length || color === 0 || color === 4 || !length || length % 3 || length > 768) fail('PLTE 无效');
            palette = true;
          } else if (/^[A-Z]/.test(type)) throw new Error(`Unsupported PNG critical chunk：${type}`);
        }
      }
      offset = end;
    }
    if (!ended) fail('缺少完整 IEND');
    const compressed = Buffer.concat(idats);
    if (!compressed.length) fail('缺少非空 IDAT');
    let decoded;
    try { decoded = inflateSync(compressed, { maxOutputLength: expected, info: true }); }
    catch { fail('IDAT/zlib 无法解码或解压超过声明尺寸'); }
    if (decoded.engine.bytesWritten !== compressed.length || decoded.buffer.length !== expected) fail('IDAT 解码尺寸不一致或含尾随 zlib 数据');
    for (let row = 0; row < height; row++) {
      if (decoded.buffer[row * rowBytes] > 4) fail('IDAT scanline filter 无效');
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function referenceFor(mode, file) {
  if (mode === 'media') return `MEDIA:${file}`;
  if (mode === 'markdown') return `![审题大爆炸图](${pathToFileURL(file).href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  return file;
}

/** Resolve explicit client capabilities, renderer evidence and the caller's expected PNG.
 * reference-ready means a local reference can be emitted, NOT remotely accessible/attached.
 */
export function resolveDelivery({ requested = 'auto', capabilities = {}, renderResult = null, expectedPath = null } = {}) {
  if (requested !== 'auto' && !MODES.has(requested)) throw new Error('delivery 模式只能是 auto/media/markdown/file');
  if (!object(capabilities)) throw new Error('capabilities 必须是明确的能力对象，不是授权或 attached 声明');
  const mode = requested === 'auto'
    ? capabilities.media === true ? 'media' : capabilities.localMarkdown === true ? 'markdown' : 'file'
    : requested;
  const unavailable = { version: 1, mode, status: 'unavailable', path: null, reference: '' };
  const supported = mode === 'file' || (mode === 'media' ? capabilities.media === true : capabilities.localMarkdown === true);
  if (!supported || !object(renderResult) || renderResult.ok !== true || renderResult.status !== 'ok'
    || !absolute(expectedPath) || !absolute(renderResult.output)
    || path.resolve(renderResult.output) !== path.resolve(expectedPath)) return unavailable;
  try { validatePng(expectedPath); }
  catch (error) {
    if (error.message.startsWith('Unsupported PNG')) throw error;
    return unavailable;
  }
  const file = path.resolve(expectedPath);
  // Legacy MEDIA uses a single non-whitespace path; use file/markdown for spaced paths.
  if (mode === 'media' && /\s/.test(file)) return unavailable;
  return validateDeliveryManifest({
    version: 1, mode, status: mode === 'file' ? 'local-only' : 'reference-ready',
    path: file, reference: referenceFor(mode, file),
  });
}

/** Validate facts and exact local reference syntax. Metadata never authorizes a client. */
export function validateDeliveryManifest(manifest) {
  const invalid = detail => { throw new Error(`非法 delivery manifest：${detail}`); };
  if (!object(manifest)) invalid('必须是对象');
  const keys = new Set(['version', 'mode', 'status', 'path', 'reference']);
  if (Object.keys(manifest).some(key => !keys.has(key))) invalid('不接受 attached、上传或 capabilities 等授权 metadata');
  if (manifest.version !== 1 || !MODES.has(manifest.mode) || !STATUSES.has(manifest.status)) invalid('version/mode/status 无效');
  if (typeof manifest.reference !== 'string') invalid('reference 必须是 string');
  if (manifest.status === 'unavailable') {
    if (manifest.path !== null || manifest.reference !== '') invalid('unavailable 不能伪造路径或引用');
    return manifest;
  }
  const expectedStatus = manifest.mode === 'file' ? 'local-only' : 'reference-ready';
  if (manifest.status !== expectedStatus) invalid('交付模式与状态不一致；本地文件不能声称已送达');
  try { validatePng(manifest.path); }
  catch (error) { invalid(`PNG path 不可验证：${error.message}`); }
  if (manifest.mode === 'media' && /\s/.test(manifest.path)) invalid('MEDIA 路径不能含空白；改用 file/markdown');
  if (manifest.reference !== referenceFor(manifest.mode, manifest.path)) invalid('reference 必须精确匹配本地 path；不接受远程 URL');
  return manifest;
}

import { inflateSync } from 'node:zlib';

import { VisualDirectorError } from './types.js';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;

export interface ImageMetadata {
  mime_type: string;
  extension: string;
  width: number;
  height: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

export function inspectImage(
  bytes: Uint8Array,
  options: { declaredMimeType?: string; fileName?: string; requireFileNameExtension?: boolean } = {},
): ImageMetadata {
  if (bytes.byteLength === 0) {
    throw new VisualDirectorError('INVALID_IMAGE', 'The image input is empty.');
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new VisualDirectorError('IMAGE_TOO_LARGE', 'The image input exceeds the 25 MiB limit.', {
      max_bytes: MAX_IMAGE_BYTES,
    });
  }

  const buffer = Buffer.from(bytes);
  const detected = detectImage(buffer);
  if (!detected) {
    throw new VisualDirectorError('INVALID_IMAGE', 'The input is not a supported, decodable image.');
  }

  const declaredMimeType = normalizeMimeType(options.declaredMimeType);
  if (declaredMimeType && declaredMimeType !== detected.mime_type) {
    throw new VisualDirectorError('IMAGE_MIME_MISMATCH', 'The declared MIME type does not match the image bytes.', {
      declared_mime_type: declaredMimeType,
      detected_mime_type: detected.mime_type,
    });
  }

  const fileExtension = fileExtensionOf(options.fileName);
  if (options.requireFileNameExtension && !fileExtension) {
    throw new VisualDirectorError('UNSUPPORTED_IMAGE_EXTENSION', 'The image file must have an allowed extension.');
  }
  if (fileExtension && !MIME_BY_EXTENSION[fileExtension]) {
    throw new VisualDirectorError('UNSUPPORTED_IMAGE_EXTENSION', 'The file extension is not allowed.', {
      extension: fileExtension,
    });
  }
  if (fileExtension && MIME_BY_EXTENSION[fileExtension] !== detected.mime_type) {
    throw new VisualDirectorError('IMAGE_EXTENSION_MISMATCH', 'The file extension does not match the image bytes.', {
      extension: fileExtension,
      detected_mime_type: detected.mime_type,
    });
  }

  if (!Number.isSafeInteger(detected.width) || !Number.isSafeInteger(detected.height)
    || detected.width < 1 || detected.height < 1
    || detected.width * detected.height > MAX_IMAGE_PIXELS) {
    throw new VisualDirectorError('INVALID_IMAGE_DIMENSIONS', 'The image dimensions are invalid or too large.');
  }

  return {
    ...detected,
    extension: EXTENSION_BY_MIME[detected.mime_type] as string,
  };
}

function detectImage(buffer: Buffer): Omit<ImageMetadata, 'extension'> | undefined {
  if (isPng(buffer)) return readPng(buffer);
  if (isJpeg(buffer)) return readJpeg(buffer);
  if (isWebp(buffer)) return readWebp(buffer);
  if (isGif(buffer)) return readGif(buffer);
  if (isAvif(buffer)) return readAvif(buffer);
  if (isSvg(buffer)) return readSvg(buffer);
  return undefined;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function readPng(buffer: Buffer): Omit<ImageMetadata, 'extension'> {
  let offset = 8;
  let width = 0;
  let height = 0;
  let idatBytes = Buffer.alloc(0);
  let sawIend = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) throw invalidImage('PNG chunk is truncated.');
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) {
      throw invalidImage('PNG chunk checksum is invalid.');
    }
    if (type === 'IHDR') {
      if (length !== 13) throw invalidImage('PNG IHDR is invalid.');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idatBytes = Buffer.concat([idatBytes, data]);
    } else if (type === 'IEND') {
      if (length !== 0) throw invalidImage('PNG IEND is invalid.');
      sawIend = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!width || !height || !sawIend || idatBytes.length === 0) throw invalidImage('PNG image data is incomplete.');
  try {
    inflateSync(idatBytes);
  } catch {
    throw invalidImage('PNG image data cannot be decoded.');
  }
  return { mime_type: 'image/png', width, height };
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function readJpeg(buffer: Buffer): Omit<ImageMetadata, 'extension'> {
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) throw invalidImage('JPEG marker is invalid.');
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset] as number;
    offset += 1;
    if (marker === 0xd9) {
      sawEnd = true;
      break;
    }
    if (marker === 0xda) {
      if (offset + 2 > buffer.length) throw invalidImage('JPEG scan header is truncated.');
      const scanLength = buffer.readUInt16BE(offset);
      if (scanLength < 2 || offset + scanLength > buffer.length) throw invalidImage('JPEG scan header is invalid.');
      offset += scanLength;
      for (; offset + 1 < buffer.length; offset += 1) {
        if (buffer[offset] === 0xff && buffer[offset + 1] === 0xd9) {
          sawEnd = true;
          break;
        }
        if (buffer[offset] === 0xff && buffer[offset + 1] === 0x00) offset += 1;
      }
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw invalidImage('JPEG segment is truncated.');
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) throw invalidImage('JPEG segment is invalid.');
    if (isJpegFrameMarker(marker)) {
      if (segmentLength < 7) throw invalidImage('JPEG frame header is invalid.');
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    }
    offset += segmentLength;
  }
  if (!width || !height || !sawEnd) throw invalidImage('JPEG image data is incomplete.');
  return { mime_type: 'image/jpeg', width, height };
}

function isJpegFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function readWebp(buffer: Buffer): Omit<ImageMetadata, 'extension'> {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) throw invalidImage('WebP chunk is truncated.');
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'VP8X' && data.length >= 10) {
      return {
        mime_type: 'image/webp',
        width: 1 + (data[4] as number) + ((data[5] as number) << 8) + ((data[6] as number) << 16),
        height: 1 + (data[7] as number) + ((data[8] as number) << 8) + ((data[9] as number) << 16),
      };
    }
    if (type === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
      const bits = data.readUInt32LE(1);
      return { mime_type: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (type === 'VP8 ' && data.length >= 18 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
      return { mime_type: 'image/webp', width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff };
    }
    offset = dataEnd + (length % 2);
  }
  throw invalidImage('WebP dimensions cannot be decoded.');
}

function isGif(buffer: Buffer): boolean {
  return buffer.length >= 6 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a');
}

function readGif(buffer: Buffer): Omit<ImageMetadata, 'extension'> {
  if (buffer.length < 13 || buffer[buffer.length - 1] !== 0x3b) throw invalidImage('GIF image data is incomplete.');
  return { mime_type: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function isAvif(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    && ['avif', 'avis'].includes(buffer.subarray(8, 12).toString('ascii'));
}

function readAvif(buffer: Buffer): Omit<ImageMetadata, 'extension'> {
  const type = Buffer.from('ispe');
  const typeOffset = buffer.indexOf(type);
  if (typeOffset < 0 || typeOffset + 16 > buffer.length) throw invalidImage('AVIF dimensions cannot be decoded.');
  return { mime_type: 'image/avif', width: buffer.readUInt32BE(typeOffset + 8), height: buffer.readUInt32BE(typeOffset + 12) };
}

function isSvg(buffer: Buffer): boolean {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return /^<svg(?:\s|>)/i.test(text);
}

function readSvg(buffer: Buffer): Omit<ImageMetadata, 'extension'> {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/<script\b|javascript:|<iframe\b|<object\b/i.test(text)) throw invalidImage('SVG contains executable content.');
  const openingTag = text.match(/^<svg\b[^>]*>/i)?.[0];
  if (!openingTag) throw invalidImage('SVG root element is invalid.');
  const viewBox = openingTag.match(/\bviewBox\s*=\s*["']\s*[-+]?\d+(?:\.\d+)?\s+[-+]?\d+(?:\.\d+)?\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  const width = openingTag.match(/\bwidth\s*=\s*["']\s*([\d.]+)/i)?.[1];
  const height = openingTag.match(/\bheight\s*=\s*["']\s*([\d.]+)/i)?.[1];
  const dimensions = viewBox ? [Number(viewBox[1]), Number(viewBox[2])] : [Number(width), Number(height)];
  if (!dimensions[0] || !dimensions[1]) throw invalidImage('SVG dimensions are missing.');
  return { mime_type: 'image/svg+xml', width: Math.ceil(dimensions[0]), height: Math.ceil(dimensions[1]) };
}

function fileExtensionOf(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const baseName = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = baseName.lastIndexOf('.');
  return dot >= 0 ? baseName.slice(dot + 1).toLowerCase() : undefined;
}

function normalizeMimeType(value: string | undefined): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || undefined;
}

function invalidImage(message: string): VisualDirectorError {
  return new VisualDirectorError('INVALID_IMAGE', message);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

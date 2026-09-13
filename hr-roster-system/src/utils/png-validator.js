const crypto = require('crypto');
const zlib = require('zlib');
const { createError } = require('./response');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function invalidPng(message = '签名PNG文件无效，请重新签写') {
  return createError(message);
}

function positiveLimit(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function bitsPerPixel(bitDepth, colorType) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const allowedDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  }[colorType] || [];
  if (!channels || !allowedDepths.includes(bitDepth)) throw invalidPng();
  return channels * bitDepth;
}

function validatePng(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  const maxBytes = positiveLimit(options.maxBytes, 1024 * 1024);
  const maxWidth = positiveLimit(options.maxWidth, 2048);
  const maxHeight = positiveLimit(options.maxHeight, 2048);
  const maxPixels = positiveLimit(options.maxPixels, 2_000_000);
  if (!buffer.length || buffer.length > maxBytes) throw invalidPng('签名PNG大小不能超过1MB');
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalidPng();

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawEnd = false;
  const compressedParts = [];
  const allowedCriticalChunks = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw invalidPng();
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (length > maxBytes || chunkEnd > buffer.length) throw invalidPng();
    const type = buffer.subarray(typeStart, dataStart).toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) throw invalidPng();
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    if (crc32(buffer.subarray(typeStart, dataEnd)) !== expectedCrc) throw invalidPng();
    const isCritical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
    if (isCritical && !allowedCriticalChunks.has(type)) throw invalidPng();

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw invalidPng();
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      if (buffer[dataStart + 10] !== 0 || buffer[dataStart + 11] !== 0 || buffer[dataStart + 12] !== 0) {
        throw invalidPng();
      }
      if (!width || !height || width > maxWidth || height > maxHeight || width * height > maxPixels) {
        throw invalidPng('签名PNG尺寸不符合要求');
      }
      bitsPerPixel(bitDepth, colorType);
      sawHeader = true;
    } else if (type === 'IHDR') {
      throw invalidPng();
    }

    if (type === 'IDAT') compressedParts.push(buffer.subarray(dataStart, dataEnd));
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== buffer.length) throw invalidPng();
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawHeader || !sawEnd || !compressedParts.length || offset !== buffer.length) throw invalidPng();
  const rowBytes = Math.ceil((width * bitsPerPixel(bitDepth, colorType)) / 8) + 1;
  const expectedInflatedBytes = rowBytes * height;
  if (expectedInflatedBytes > 8 * 1024 * 1024) throw invalidPng('签名PNG尺寸不符合要求');
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(compressedParts), { maxOutputLength: expectedInflatedBytes });
  } catch (_error) {
    throw invalidPng();
  }
  if (inflated.length !== expectedInflatedBytes) throw invalidPng();

  return {
    width,
    height,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

module.exports = { validatePng };

// Reads a Windows program's file version out of its own file, as "Properties > Details" shows it.
// No PowerShell, no process started, and only the headers and the resource table are read.
import { open } from 'node:fs/promises';

const RT_VERSION = 16;
const FIXED_SIGNATURE = 0xfeef04bd;

async function bytesAt(handle, offset, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return buffer.subarray(0, bytesRead);
}

/** Returns "7.1.0.0", or null if this is not a program or carries no version. Never throws for that. */
export async function fileVersion(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const dos = await bytesAt(handle, 0, 64);
    if (dos.length < 64 || dos.toString('ascii', 0, 2) !== 'MZ') return null;
    const peAt = dos.readUInt32LE(0x3c);
    const pe = await bytesAt(handle, peAt, 24);
    if (pe.length < 24 || pe.toString('ascii', 0, 4) !== 'PE\0\0') return null;
    const sectionCount = pe.readUInt16LE(6);
    const optionalSize = pe.readUInt16LE(20);
    const optional = await bytesAt(handle, peAt + 24, optionalSize);
    const magic = optional.readUInt16LE(0);
    const dirAt = magic === 0x20b ? 112 : 96;
    const resourceRva = optional.readUInt32LE(dirAt + 2 * 8);
    if (!resourceRva) return null;
    const sections = await bytesAt(handle, peAt + 24 + optionalSize, sectionCount * 40);
    const fileOffset = (rva) => {
      for (let i = 0; i < sectionCount; i++) {
        const at = i * 40;
        const virtual = sections.readUInt32LE(at + 12);
        const size = Math.max(sections.readUInt32LE(at + 8), sections.readUInt32LE(at + 16));
        if (rva >= virtual && rva < virtual + size)
          return rva - virtual + sections.readUInt32LE(at + 20);
      }
      return null;
    };
    const root = fileOffset(resourceRva);
    if (root === null) return null;
    // The resource tree has three levels: type, name, language. Take the first of each for versions.
    const entries = async (at) => {
      const head = await bytesAt(handle, at, 16);
      const count = head.readUInt16LE(12) + head.readUInt16LE(14);
      const body = await bytesAt(handle, at + 16, Math.min(count, 4096) * 8);
      return Array.from({ length: Math.floor(body.length / 8) }, (_, i) => ({
        id: body.readUInt32LE(i * 8),
        target: body.readUInt32LE(i * 8 + 4),
      }));
    };
    const type = (await entries(root)).find((entry) => entry.id === RT_VERSION);
    if (!type || !(type.target & 0x80000000)) return null;
    const names = await entries(root + (type.target & 0x7fffffff));
    if (!names[0] || !(names[0].target & 0x80000000)) return null;
    const languages = await entries(root + (names[0].target & 0x7fffffff));
    if (!languages[0] || languages[0].target & 0x80000000) return null;
    const leaf = await bytesAt(handle, root + languages[0].target, 16);
    const dataAt = fileOffset(leaf.readUInt32LE(0));
    if (dataAt === null) return null;
    const info = await bytesAt(handle, dataAt, Math.min(leaf.readUInt32LE(4), 256));
    // VS_VERSIONINFO: a header, the wide text VS_VERSION_INFO, padding, then the fixed block.
    const signature = Buffer.alloc(4);
    signature.writeUInt32LE(FIXED_SIGNATURE);
    const fixed = info.indexOf(signature);
    if (fixed < 0 || fixed + 16 > info.length) return null;
    const high = info.readUInt32LE(fixed + 8);
    const low = info.readUInt32LE(fixed + 12);
    return `${high >>> 16}.${high & 0xffff}.${low >>> 16}.${low & 0xffff}`;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

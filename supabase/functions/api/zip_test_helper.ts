import { assertEquals } from "jsr:@std/assert@1";
import { crc32 } from "./zip.ts";

/** Читаем свой же архив обратно: имя → текст. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const packed = bytes.slice(at + 30 + nameLen, at + 30 + nameLen + size);
    const raw = new Uint8Array(await new Response(
      new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    ).arrayBuffer());
    assertEquals(crc32(raw), v.getUint32(at + 14, true), name);
    out.set(name, new TextDecoder().decode(raw));
    at += 30 + nameLen + size;
  }
  assertEquals(v.getUint32(at, true), 0x02014b50, "дальше идёт центральный каталог");
  return out;
}

export const SHORT_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const DEFAULT_SHORT_ID_LENGTH = 12;

export type RandomByteSource = (bytes: Uint8Array) => Uint8Array;

export function generateShortId(
  length = DEFAULT_SHORT_ID_LENGTH,
  randomBytes: RandomByteSource = (bytes) => crypto.getRandomValues(bytes)
): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("Short ID length must be a positive integer.");
  }

  const alphabetLength = SHORT_ID_ALPHABET.length;
  const maxUnbiasedByte = Math.floor(256 / alphabetLength) * alphabetLength - 1;
  let id = "";

  while (id.length < length) {
    const bytes = randomBytes(new Uint8Array(length - id.length));

    for (const byte of bytes) {
      if (byte > maxUnbiasedByte) {
        continue;
      }

      id += SHORT_ID_ALPHABET[byte % alphabetLength];

      if (id.length === length) {
        break;
      }
    }
  }

  return id;
}

export function sanitizeObjectName(filename: string): string {
  const normalized = filename.trim().replace(/[/\\\0]/g, "-").replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, 160) : "file";
}


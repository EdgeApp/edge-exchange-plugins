import { blake2b } from '@noble/hashes/blake2b'
import { sha256 } from '@noble/hashes/sha256'
import { bech32m, createBase58check } from '@scure/base'

// ZIP-316 unified address decoding, limited to what a payout needs: the
// transparent receiver, re-encoded as the t1 (P2PKH) or t3 (P2SH) address it
// stands for. Mainnet only.

const UNIFIED_HRP = 'u'
const PADDING_LENGTH = 16
const MIN_JUMBLE_LENGTH = 48

const P2PKH_TYPECODE = 0x00
const P2SH_TYPECODE = 0x01
const TRANSPARENT_RECEIVER_LENGTH = 20

// Mainnet Base58Check version prefixes for t1 and t3 addresses:
const P2PKH_PREFIX = [0x1c, 0xb8]
const P2SH_PREFIX = [0x1c, 0xbd]

const base58check = createBase58check(sha256)

const xorInto = (target: Uint8Array, mask: Uint8Array): Uint8Array =>
  target.map((byte, i) => byte ^ mask[i])

const personalization = (prefix: string, suffix: number[]): Uint8Array =>
  Uint8Array.from([...Array.from(prefix, c => c.charCodeAt(0)), ...suffix])

// F4Jumble's H_i: BLAKE2b with an output length of `length` bytes.
const jumbleH = (
  round: number,
  input: Uint8Array,
  length: number
): Uint8Array =>
  blake2b(input, {
    dkLen: length,
    personalization: personalization('UA_F4Jumble_H', [round, 0, 0])
  })

// F4Jumble's G_i: 64-byte BLAKE2b blocks, counted by a little-endian u16,
// joined and cut to `length` bytes.
const jumbleG = (
  round: number,
  input: Uint8Array,
  length: number
): Uint8Array => {
  const out = new Uint8Array(Math.ceil(length / 64) * 64)
  for (let block = 0; block * 64 < length; block++) {
    const hash = blake2b(input, {
      dkLen: 64,
      personalization: personalization('UA_F4Jumble_G', [
        round,
        block & 0xff,
        block >> 8
      ])
    })
    out.set(hash, block * 64)
  }
  return out.subarray(0, length)
}

// Variable names follow the ZIP-316 F4Jumble definition.
const f4JumbleInverse = (message: Uint8Array): Uint8Array => {
  const leftLength = Math.min(64, Math.floor(message.length / 2))
  const c = message.subarray(0, leftLength)
  const d = message.subarray(leftLength)
  const y = xorInto(c, jumbleH(1, d, leftLength))
  const x = xorInto(d, jumbleG(1, y, d.length))
  const a = xorInto(y, jumbleH(0, x, leftLength))
  const b = xorInto(x, jumbleG(0, a, x.length))
  const out = new Uint8Array(message.length)
  out.set(a)
  out.set(b, leftLength)
  return out
}

// Bitcoin compactSize, which is how ZIP-316 encodes typecodes and lengths.
const readCompactSize = (
  bytes: Uint8Array,
  offset: number
): { value: number; offset: number } => {
  const first = bytes[offset]
  if (first == null) throw new Error('Truncated unified address')
  if (first < 0xfd) return { value: first, offset: offset + 1 }
  if (first === 0xfd && offset + 3 <= bytes.length) {
    const value = bytes[offset + 1] | (bytes[offset + 2] << 8)
    if (value < 0xfd) throw new Error('Non-canonical unified address')
    return { value, offset: offset + 3 }
  }
  throw new Error('Unsupported unified address item size')
}

/**
 * Returns the transparent receiver of a mainnet unified address as a t1
 * (P2PKH) or t3 (P2SH) address, or undefined when the address has none.
 * Throws when the input is not a valid mainnet unified address.
 */
export const getUnifiedTransparentAddress = (
  address: string
): string | undefined => {
  // The type wants a separator up front; `decode` checks for it anyway:
  const { prefix, words } = bech32m.decode(
    address as `${string}1${string}`,
    false
  )
  if (prefix !== UNIFIED_HRP) {
    throw new Error(`Not a mainnet unified address: ${prefix}`)
  }
  const jumbled = bech32m.fromWords(words)
  if (jumbled.length < MIN_JUMBLE_LENGTH) {
    throw new Error('Unified address is too short')
  }
  const decoded = f4JumbleInverse(jumbled)

  const padding = decoded.subarray(decoded.length - PADDING_LENGTH)
  const expectedPadding = new Uint8Array(PADDING_LENGTH)
  expectedPadding[0] = UNIFIED_HRP.charCodeAt(0)
  if (padding.some((byte, i) => byte !== expectedPadding[i])) {
    throw new Error('Invalid unified address padding')
  }

  const items = decoded.subarray(0, decoded.length - PADDING_LENGTH)
  let transparent: string | undefined
  let offset = 0
  while (offset < items.length) {
    const typecode = readCompactSize(items, offset)
    const length = readCompactSize(items, typecode.offset)
    const end = length.offset + length.value
    if (end > items.length) throw new Error('Truncated unified address')
    const value = items.subarray(length.offset, end)
    offset = end

    if (typecode.value !== P2PKH_TYPECODE && typecode.value !== P2SH_TYPECODE) {
      continue
    }
    if (value.length !== TRANSPARENT_RECEIVER_LENGTH) {
      throw new Error('Invalid transparent receiver length')
    }
    const versionPrefix =
      typecode.value === P2PKH_TYPECODE ? P2PKH_PREFIX : P2SH_PREFIX
    transparent = base58check.encode(
      Uint8Array.from([...versionPrefix, ...value])
    )
  }
  return transparent
}

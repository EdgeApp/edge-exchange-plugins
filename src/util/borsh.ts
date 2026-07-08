import { div, mul, sub } from 'biggystring'

// Borsh-encode a string: little-endian u32 length prefix + utf-8 bytes.
export const borshString = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(bytes.length)
  return Buffer.concat([length, bytes])
}

// Borsh-encode a decimal string as a little-endian u64. Uses biggystring rather
// than BigInt/writeBigUInt64LE for React Native runtime compatibility.
export const borshU64 = (value: string): Buffer => {
  const buf = Buffer.alloc(8)
  let remaining = value
  for (let i = 0; i < 8; i++) {
    const quotient = div(remaining, '256', 0)
    buf[i] = parseInt(sub(remaining, mul(quotient, '256')))
    remaining = quotient
  }
  return buf
}

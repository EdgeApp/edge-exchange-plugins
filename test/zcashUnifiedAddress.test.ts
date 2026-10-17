import { createBase58check } from '@scure/base'
import { assert } from 'chai'
import { createHash } from 'crypto'
import { describe, it } from 'mocha'

import { getUnifiedTransparentAddress } from '../src/util/zcashUnifiedAddress'
import vectors from './zcashUnifiedAddressVectors.json'

// Encodes the expected t-address with node's sha256, independently of the
// hash the decoder uses:
const base58check = createBase58check(
  bytes => new Uint8Array(createHash('sha256').update(bytes).digest())
)
const encodeTransparent = (prefix: number[], hashHex: string): string =>
  base58check.encode(
    Uint8Array.from([...prefix, ...Buffer.from(hashHex, 'hex')])
  )

// The first two rows are the source and the column names:
const rows = vectors.slice(2).map(row => ({
  p2pkh: row[0] as string | null,
  p2sh: row[1] as string | null,
  unifiedAddress: row[6] as string
}))

// Built with an independent ZIP-316 encoder, since the official vectors carry
// no P2SH receivers:
const P2SH_HASH = 'c29d25977ce2adb2db2ccaf74d3a4ff771bfa6e8'
const P2SH_WITH_SHIELDED =
  'u1dkpfgzm6fsxchtwc4uu2qcpk604za5rw3j0kg3ehpfmqz0lwqccsspkpg2dlpyd90pllpp0vye3vcpv7uax0638xwdxzk5pz62qqq8stxk3sj7vkjw2j8jaju72cmdatldhldeyc4yff5ss4sjdnatyc5xvus6ggm00fs27xta8xl2r6xef0xwvvuyapj9d8j4x075lsjrfl6c0cx2m'
const P2SH_WITH_ORCHARD =
  'u1pcx39dfudzx9uaas89vu34vgna22q0nz3hgcvx46y87uev2e0f74cr3vd2ukgj0u9fsng2j68hfdyzu0s76k4gdwj6u9mh3fla6kum859dt8z7dgsw5n747lwaxaf0n982yxw56zlxj'
const TESTNET_P2PKH =
  'utest156qsmjjlnpmj6zn76pmku9ncf55utajtnugvaufgzq65xw4fvc2kpejm5gepdg45w7w6e5hfhtz70fpcayyumn2u0gk9jhwlr5t5dy7zx5p8mehsncf9dsqxqxxpklkgrzujs2wa8um'

describe('getUnifiedTransparentAddress', function () {
  it('decodes the P2PKH receiver of every ZIP-316 vector', function () {
    const withP2pkh = rows.filter(row => row.p2pkh != null)
    assert.isAbove(withP2pkh.length, 0)
    for (const { p2pkh, unifiedAddress } of withP2pkh) {
      const expected = encodeTransparent([0x1c, 0xb8], p2pkh as string)
      assert.match(expected, /^t1/)
      assert.strictEqual(getUnifiedTransparentAddress(unifiedAddress), expected)
    }
  })

  it('returns nothing for vectors without a transparent receiver', function () {
    const shielded = rows.filter(row => row.p2pkh == null && row.p2sh == null)
    assert.isAbove(shielded.length, 0)
    for (const { unifiedAddress } of shielded) {
      assert.isUndefined(getUnifiedTransparentAddress(unifiedAddress))
    }
  })

  it('decodes a P2SH receiver to a t3 address', function () {
    const expected = encodeTransparent([0x1c, 0xbd], P2SH_HASH)
    assert.strictEqual(expected, 't3cJeGr7pSNt3HZPoXWvrNkKkXrccmdu6w2')
    assert.strictEqual(
      getUnifiedTransparentAddress(P2SH_WITH_SHIELDED),
      expected
    )
    assert.strictEqual(
      getUnifiedTransparentAddress(P2SH_WITH_ORCHARD),
      expected
    )
  })

  it('rejects a testnet unified address', function () {
    assert.throws(() => getUnifiedTransparentAddress(TESTNET_P2PKH), /mainnet/)
  })

  it('rejects a corrupted unified address', function () {
    const { unifiedAddress } = rows[0]
    const last = unifiedAddress[unifiedAddress.length - 1]
    const corrupted = unifiedAddress.slice(0, -1) + (last === 'q' ? 'p' : 'q')
    assert.throws(() => getUnifiedTransparentAddress(corrupted))
    assert.throws(() => getUnifiedTransparentAddress('u1' + 'q'.repeat(211)))
  })
})

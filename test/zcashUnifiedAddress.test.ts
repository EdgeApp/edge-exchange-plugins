import { bech32m, createBase58check } from '@scure/base'
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
// A 21-byte P2PKH receiver:
const LONG_RECEIVER =
  'u136h92qke4tpmvaxqfanc29t29hjlrr5e3x7aavarmrlynmy6dluttpmr2aknxzvwc47ttntpgfyz8smur35qlk5gcekdxuh34nzym0gvwsmec9dafvuwy76kyl57nd6dmef0eqqv86jgr'
// A last item that claims 64 bytes with 10 left:
const TRUNCATED_ITEM =
  'u172zf33cv6k8yw0t46xkf03vv73d52sypluue0zuurzkq6hnj3l0sqaew7w0crx8wcpr50wn8nenepfj0zgdknehc6zydl4r4knw78k8re3m5yr2xllrx9h2ugvrz884ucguxn7nevf08lw32e5su3s7w9uzyz3'
// A vector's P2PKH and Orchard receivers, plus the P2SH_HASH receiver, in
// item orders ZIP-316 forbids:
const P2SH_THEN_P2PKH =
  'u1scun8mtty285ydxcy78pr98gxeqyhpd7gznz90hfyxszme85t6fatrhpkc7gvr33rzk02ytrxdt0uly4u3kmk44ztvw5r4x0c0eqqvhhxr9q9s3y6467np98x8ulrqkdyfaqun3dq4mjdy6q7zz6nlmg0leg3q0620kfpr2653092m'
const REPEATED_P2PKH =
  'u1q9w6sy8gd6te5l2tzqqesu7ccpk3zn2mn2qm3nd7wrrw90mzkz9z8arx5ax58getfpe7sv9jslp93k0aa64x3te5lpm92ad2p80j6qua79av32lxqs3dzjyaxlaggvhpq2q0vx5kxp0namefeyg7kx29820yytnzdfhezjc7auhp23'
const P2PKH_AND_P2SH =
  'u16u8pazf4yk9fkx35jp084ly4gdgdj0hg3qqlhjc49td0nacg0z08vfd7ag6twvep6tp45sqnrjmn059q7h9yr4n3rpd4nu5tq53awjaj2u53sds59c47ngs0x8y58ld2ejdc2mqa7q5s8v066vma6hnzj24gc2tvrf4ls8ngt9d4wk'

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

  it('rejects a payload padded for another HRP', function () {
    // The testnet payload, re-encoded with the mainnet HRP:
    const { words } = bech32m.decode(TESTNET_P2PKH, false)
    const relabeled = bech32m.encode('u', words, false)
    assert.throws(() => getUnifiedTransparentAddress(relabeled), /padding/)
  })

  it('rejects a 21-byte transparent receiver', function () {
    assert.throws(
      () => getUnifiedTransparentAddress(LONG_RECEIVER),
      /receiver length/
    )
  })

  it('rejects an item that runs past the end', function () {
    assert.throws(
      () => getUnifiedTransparentAddress(TRUNCATED_ITEM),
      /Truncated/
    )
  })

  it('rejects items out of typecode order', function () {
    assert.throws(
      () => getUnifiedTransparentAddress(P2SH_THEN_P2PKH),
      /out of order/
    )
    assert.throws(
      () => getUnifiedTransparentAddress(REPEATED_P2PKH),
      /out of order/
    )
  })

  it('rejects both a P2PKH and a P2SH receiver', function () {
    assert.throws(
      () => getUnifiedTransparentAddress(P2PKH_AND_P2SH),
      /two transparent/
    )
  })
})

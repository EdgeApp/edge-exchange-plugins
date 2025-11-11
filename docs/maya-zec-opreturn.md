### ZEC ↔ Maya swap findings and required changes

#### What we attempted
- Integrate ZEC swaps with Maya using the existing Thorchain/Maya flow in `edge-exchange-plugins`.
- From-ZEC: fetch Maya quote (`inbound_address`, `memo`) and send from ZEC wallet with memo.
- Into-ZEC: use ZEC transparent address for payouts (already supported by the ZEC plugin).

#### What actually happens (from-ZEC)
- Maya returns both:
  - **inbound_address**: currently a transparent ZEC address (t-address)
  - **memo**: a string that must accompany the inbound transaction per their swap flow
- We pass their memo through as the UTXO memo.
- Zcash rules: memos are only valid on shielded recipients (z-/u-address). For transparent recipients, metadata must be carried via an OP_RETURN output, not a shielded memo.
- Our Zcash RN bridge (`react-native-zcash`) only supports shielded memos in `proposeTransfer` and does not expose a way to add an OP_RETURN with a transparent payment output. Therefore, `proposeTransfer` fails with a generic “Failed to propose transfer”.

#### Why this is expected
- According to Maya docs, swaps use an on-chain memo provided in the quote and inbound addresses should not be cached. The quote we receive includes a memo that must be sent with the inbound transaction.
- For ZEC specifically, the Maya team is adding inbound shielded+transparent support: users can spend shielded funds to the Maya transparent vault address with the corresponding OP_RETURN memo. This aligns with our observations and explains why a shielded memo to a transparent address fails.

References:
- Maya Quickstart (memo + quote behavior): `https://docs.mayaprotocol.com/mayachain-dev-docs/introduction/swapping-guide/quickstart-guide`
- Maya MR (ZEC inbound shielded+transparent, OP_RETURN): `https://gitlab.com/mayachain/mayanode/-/merge_requests/493`

#### Current code behavior (relevant pieces)
- `edge-exchange-plugins` passes through the quote’s `memo` and `inbound_address` when building spends for UTXO chains (ZEC included).
- `edge-currency-accountbased` ZEC engine calls `synchronizer.proposeTransfer({ toAddress, zatoshi, memo })`.
- `react-native-zcash` iOS bridge (`RNZcash.swift`) constructs a transfer with an optional shielded memo only; no OP_RETURN path is exposed for transparent recipients.

Result: When Maya’s inbound is a transparent ZEC address and a memo is provided, proposing the transaction fails because the SDK cannot attach that memo to a transparent recipient.

#### What works today
- Into-ZEC via Maya (receiving ZEC) using a transparent address is fine; no memo required on receive.

#### What’s required for from-ZEC to work
1) Implement OP_RETURN for transparent recipients in our ZEC bridge:
   - Extend `react-native-zcash` types to allow an `opReturnHex` (or similar) alongside the transparent payment output.
   - iOS (`RNZcash.swift`): add a path to build an OP_RETURN output and the transparent payment output in the same proposal; return the usual proposal payload.
   - Android: mirror the iOS changes via zcash-android-sdk.
   - Engine wiring (`ZcashEngine`): when the destination is transparent and a memo is present, pass it as OP_RETURN (and mark the memo hidden in UI via `EdgeMemo.hidden = true`).

2) Short-term guard (better UX until OP_RETURN is added):
   - If `fromWallet` is ZEC, the quote’s `inbound_address` is transparent, and the quote `memo` is non-empty, surface a clear error like: “ZEC route requires OP_RETURN memo to transparent address; not supported yet”.

3) Alternative (if/when Maya returns shielded inbound):
   - If Maya starts providing a shielded inbound address for ZEC, we can send a shielded memo (no OP_RETURN needed) and our current flow will work.

#### Debug breadcrumbs we used
- Verified the quote returns `inbound_address` (transparent) and a non-empty `memo`.
- Confirmed UTXO flow passes `memo` into `memos[0].value` and calls ZEC `proposeTransfer`.
- Observed `RNZcash` maps only shielded memos into the proposal; transparent recipients with memos fail with a generic `proposeTransferError`.

#### Summary
- The integration is correct from the Maya API perspective (we use their inbound address + memo).
- The failure is a capability gap: we need OP_RETURN support for ZEC transparent sends to carry the Maya memo.
- Implementing OP_RETURN in the native ZEC bridge (Swift/Kotlin) unblocks ZEC→Maya swaps. Alternatively, if Maya provides a shielded inbound address for ZEC, shielded memos would work without OP_RETURN.



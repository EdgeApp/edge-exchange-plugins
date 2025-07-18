### Zcash troubleshooting notes (Edge + Maya integration)

This document captures what’s going wrong with Zcash in our current integration and how we validated the issues.

#### 1) “Insufficient funds” during early attempts
- Cause: `availableZatoshi` isn’t populated until the ZEC synchronizer reaches a usable state. Very early spends can see insufficient balance even though the wallet is funded.
- Mitigation: Wait for sync ratio (or confirmed shielded balances), or reattempt once `availableZatoshi` updates.

#### 2) Resync left the synchronizer undefined
- Symptom: After calling `resyncBlockchain`, `this.synchronizer` may be undefined when we immediately call `rescan()`.
- Cause: `resyncBlockchain` killed the engine and restarted but did not guarantee the synchronizer was recreated before rescan.
- Fix we applied: In Zcash engine `resyncBlockchain` call `syncNetwork({ privateKeys: walletInfo.keys })` to ensure the synchronizer is recreated, then `await this.synchronizerPromise` and `rescan()`.

#### 3) “Failed to propose transfer” when swapping from ZEC via Maya
- Symptom: Proposing the ZEC spend fails with a generic `proposeTransferError`.
- Inputs:
  - Maya quote returns a transparent inbound address (t-address) and a non-empty `memo`.
  - Our swap path passes the memo unmodified into the Zcash spend (UTXO memo field).
- Root cause:
  - Zcash memos are only valid on shielded recipients (z-/u-address).
  - For transparent recipients, metadata must be carried by a separate OP_RETURN output.
  - Our RN Zcash bridge only supports shielded note memos in `proposeTransfer`; it does not expose OP_RETURN on transparent outputs.
  - Result: `proposeTransfer` fails when a memo is provided to a transparent address.

References:
- Maya Quickstart (quotes include `memo`; send with inbound): `https://docs.mayaprotocol.com/mayachain-dev-docs/introduction/swapping-guide/quickstart-guide`
- Maya ZEC inbound MR (shielded+transparent with OP_RETURN to transparent vault): `https://gitlab.com/mayachain/mayanode/-/merge_requests/493`

#### 4) What works today
- Into-ZEC via Maya (receiving ZEC) using a transparent address is fine; no memo needs to be sent on receive.
export default [
  {
    inputs: [{ internalType: 'address', name: '_ttp', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'constructor'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'fee', type: 'uint256' },
      {
        indexed: false,
        internalType: 'address',
        name: 'feeRecipient',
        type: 'address'
      }
    ],
    name: 'FeeSet',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'owner',
        type: 'address'
      },
      { indexed: false, internalType: 'bool', name: 'active', type: 'bool' }
    ],
    name: 'OwnerSet',
    type: 'event'
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'feeRecipient',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'owners',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'uint256', name: '_fee', type: 'uint256' },
      { internalType: 'address', name: '_feeRecipient', type: 'address' }
    ],
    name: 'setFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'bool', name: 'active', type: 'bool' }
    ],
    name: 'setOwner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'tcRouter', type: 'address' },
      { internalType: 'address', name: 'tcVault', type: 'address' },
      { internalType: 'string', name: 'tcMemo', type: 'string' },
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'address', name: 'router', type: 'address' },
      { internalType: 'bytes', name: 'data', type: 'bytes' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' }
    ],
    name: 'swapIn',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'tokenTransferProxy',
    outputs: [
      {
        internalType: 'contract TSAggregatorTokenTransferProxy',
        name: '',
        type: 'address'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  { stateMutability: 'payable', type: 'receive' }
]

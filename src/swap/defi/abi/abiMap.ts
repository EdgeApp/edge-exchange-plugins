import { ContractInterface } from 'ethers'

import TC_AVAX_GENERIC from './TC_AVAX_GENERIC'
import TC_AVAX_PANGOLIN from './TC_AVAX_PANGOLIN'
import TC_AVAX_TOKEN_PROXY from './TC_AVAX_TOKEN_PROXY'
import TC_AVAX_TRADER_JOE from './TC_AVAX_TRADER_JOE'
import TC_ETH_GENERIC from './TC_ETH_GENERIC'
import TC_ETH_LEG_UNISWAP_V2 from './TC_ETH_LEG_UNISWAP_V2'
import TC_ETH_SHORT_SUSHISWAP from './TC_ETH_SHORT_SUSHISWAP'
import TC_ETH_SHORT_UNISWAP_V2 from './TC_ETH_SHORT_UNISWAP_V2'
import TC_ETH_SHORT_UNISWAP_V3_001 from './TC_ETH_SHORT_UNISWAP_V3_001'
import TC_ETH_SHORT_UNISWAP_V3_1 from './TC_ETH_SHORT_UNISWAP_V3_1'
import TC_ETH_SHORT_UNISWAP_V3_03 from './TC_ETH_SHORT_UNISWAP_V3_03'
import TC_ETH_SHORT_UNISWAP_V3_005 from './TC_ETH_SHORT_UNISWAP_V3_005'
import TC_ETH_SUSHISWAP from './TC_ETH_SUSHISWAP'
import TC_ETH_TOKEN_PROXY from './TC_ETH_TOKEN_PROXY'
import TC_ETH_UNISWAP_V2 from './TC_ETH_UNISWAP_V2'
import TC_ETH_UNISWAP_V3_1 from './TC_ETH_UNISWAP_V3_1'
import TC_ETH_UNISWAP_V3_03 from './TC_ETH_UNISWAP_V3_03'
import TC_ETH_UNISWAP_V3_005 from './TC_ETH_UNISWAP_V3_005'

interface AbiMap {
  [pluginId: string]: {
    [contractAddress: string]: { name: string; data: ContractInterface }
  }
}
export const abiMap: AbiMap = {
  ethereum: {
    '0x7c38b8b2eff28511ecc14a621e263857fb5771d3': {
      name: 'Thorchain Aggregator Ethereum Uniswap V2',
      data: TC_ETH_UNISWAP_V2
    },
    '0x0f2cd5df82959e00be7afeef8245900fc4414199': {
      name: 'Thorchain Aggregator Ethereum Sushiswap',
      data: TC_ETH_SUSHISWAP
    },
    '0x0747c681e5ada7936ad915ccff6cd3bd71dbf121': {
      name: 'Thorchain Aggregator Ethereum Uniswap V3 0.05%',
      data: TC_ETH_UNISWAP_V3_005
    },
    '0xd1ea5f7ce9da98d0bd7b1f4e3e05985e88b1ef10': {
      name: 'Thorchain Aggregator Ethereum Uniswap V3 0.3%',
      data: TC_ETH_UNISWAP_V3_03
    },
    '0x94a852f0a21e473078846cf88382dd8d15bd1dfb': {
      name: 'Thorchain Aggregator Ethereum Uniswap V3 1.0%',
      data: TC_ETH_UNISWAP_V3_1
    },
    '0x3660de6c56cfd31998397652941ece42118375da': {
      name: 'Thorchain Aggregator Leg Ethereum Uniswap V2',
      data: TC_ETH_LEG_UNISWAP_V2
    },
    '0xd31f7e39afecec4855fecc51b693f9a0cec49fd2': {
      name: 'Thorchain Aggregator Ethereum Generic',
      data: TC_ETH_GENERIC
    },
    '0xf892fef9da200d9e84c9b0647ecff0f34633abe8': {
      name: 'Thorchain Aggregator Ethereum Token Proxy',
      data: TC_ETH_TOKEN_PROXY
    },
    '0x86904eb2b3c743400d03f929f2246efa80b91215': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V2',
      data: TC_ETH_SHORT_UNISWAP_V2
    },
    '0xbf365e79aa44a2164da135100c57fdb6635ae870': {
      name: 'Thorchain Aggregator Ethereum Short Notation Sushiswap',
      data: TC_ETH_SHORT_SUSHISWAP
    },
    '0xbd68cbe6c247e2c3a0e36b8f0e24964914f26ee8': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 0.01%',
      data: TC_ETH_SHORT_UNISWAP_V3_001
    },
    '0xe4ddca21881bac219af7f217703db0475d2a9f02': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 0.005',
      data: TC_ETH_SHORT_UNISWAP_V3_005
    },
    '0x11733abf0cdb43298f7e949c930188451a9a9ef2': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 0.3%',
      data: TC_ETH_SHORT_UNISWAP_V3_03
    },
    '0xb33874810e5395eb49d8bd7e912631db115d5a03': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 1%',
      data: TC_ETH_SHORT_UNISWAP_V3_1
    }
  },
  avalanche: {
    '0x942c6da485fd6cef255853ef83a149d43a73f18a': {
      name: 'Thorchain Aggregator Avalanche Pangolin',
      data: TC_AVAX_PANGOLIN
    },
    '0x3b7dbdd635b99cea39d3d95dbd0217f05e55b212': {
      name: 'Thorchain Aggregator Avalanche Trader Joe',
      data: TC_AVAX_TRADER_JOE
    },
    '0x7c38b8b2eff28511ecc14a621e263857fb5771d3': {
      name: 'Thorchain Aggregator Avalanche Generic',
      data: TC_AVAX_GENERIC
    },
    '0x69ba883af416ff5501d54d5e27a1f497fbd97156': {
      name: 'Thorchain Aggregator Avalanche Token Proxy',
      data: TC_AVAX_TOKEN_PROXY
    }
  }
}

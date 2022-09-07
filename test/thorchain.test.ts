import { assert } from 'chai'
import { before, describe, it } from 'mocha'

import {
  asPool,
  calcDoubleSwapInput,
  calcDoubleSwapOutput,
  THOR_LIMIT_UNITS
} from '../src/swap/defi/thorchain'

const THOR_UNITS_NUM = Number(THOR_LIMIT_UNITS)

describe(`calcDoubleSwapOutput`, function () {
  before('', function (done) {
    done()
  })

  it('BTC to ETH', async function () {
    const btcPool = samplePools.find(p => p.asset === 'BTC.BTC')
    const ethPool = samplePools.find(p => p.asset === 'ETH.ETH')
    const startAmount = 1
    const result = calcDoubleSwapOutput(
      startAmount * THOR_UNITS_NUM,
      asPool(btcPool),
      asPool(ethPool)
    )
    const endAmount = result / THOR_UNITS_NUM

    assert.equal(endAmount, '13.1382759382696')
  })
})

describe(`calcDoubleSwapInput`, function () {
  before('', function (done) {
    done()
  })

  it('BTC to ETH', async function () {
    const btcPool = samplePools.find(p => p.asset === 'BTC.BTC')
    const ethPool = samplePools.find(p => p.asset === 'ETH.ETH')
    const endAmount = 13.1382759382696
    const result = calcDoubleSwapInput(
      endAmount * THOR_UNITS_NUM,
      asPool(btcPool),
      asPool(ethPool)
    )
    const startAmount = result / THOR_UNITS_NUM

    assert.equal(startAmount, '1')
  })
})

const samplePools = [
  {
    annualPercentageRate: '0.15395655873814743',
    asset: 'BCH.BCH',
    assetDepth: '595652301742',
    assetPrice: '62.742178523126874',
    assetPriceUSD: '131.8055553633399',
    liquidityUnits: '21376149610381',
    poolAPY: '0.15395655873814743',
    runeDepth: '37372523053608',
    status: 'available',
    synthSupply: '56445797622',
    synthUnits: '1063210514482',
    units: '22439360124863',
    volume24h: '12078489952660'
  },
  {
    annualPercentageRate: '-0.23141336793020098',
    asset: 'BNB.ADA-9F4',
    assetDepth: '1242298191551',
    assetPrice: '0.20540556992070957',
    assetPriceUSD: '0.43150550164819507',
    liquidityUnits: '215692690560',
    poolAPY: '0',
    runeDepth: '255174968047',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '215692690560',
    volume24h: '0'
  },
  {
    annualPercentageRate: '0.4791841395754804',
    asset: 'BNB.AVA-645',
    assetDepth: '24428679991908',
    assetPrice: '0.3502289598412625',
    assetPriceUSD: '0.7357430622079377',
    liquidityUnits: '4558346986281',
    poolAPY: '0.4791841395754804',
    runeDepth: '8555631183861',
    status: 'available',
    synthSupply: '287048909',
    synthUnits: '26781557',
    units: '4558373767838',
    volume24h: '711989232934'
  },
  {
    annualPercentageRate: '0.10437580512723517',
    asset: 'BNB.BNB',
    assetDepth: '1729715635937',
    assetPrice: '141.63801377287555',
    assetPriceUSD: '297.5458854845619',
    liquidityUnits: '95974694014296',
    poolAPY: '0.10437580512723517',
    runeDepth: '244993487066003',
    status: 'available',
    synthSupply: '19243363371',
    synthUnits: '536853206992',
    units: '96511547221288',
    volume24h: '43958349465243'
  },
  {
    annualPercentageRate: '0.12531665854085008',
    asset: 'BNB.BTCB-1DE',
    assetDepth: '14083723254',
    assetPrice: '10130.213917746229',
    assetPriceUSD: '21281.03458960726',
    liquidityUnits: '62608057241956',
    poolAPY: '0.12531665854085008',
    runeDepth: '142671129321357',
    status: 'available',
    synthSupply: '1167733786',
    synthUnits: '2707789689098',
    units: '65315846931054',
    volume24h: '40929398761725'
  },
  {
    annualPercentageRate: '0.08303338071471773',
    asset: 'BNB.BUSD-BD1',
    assetDepth: '978161342280011',
    assetPrice: '0.4760207439676541',
    assetPriceUSD: '1',
    liquidityUnits: '115743256601289',
    poolAPY: '0.08303338071471773',
    runeDepth: '465625089872530',
    status: 'available',
    synthSupply: '211102135932315',
    synthUnits: '14000321453644',
    units: '129743578054933',
    volume24h: '432167872371533'
  },
  {
    annualPercentageRate: '0.10004280106499486',
    asset: 'BNB.ETH-1C9',
    assetDepth: '166759964267',
    assetPrice: '768.9380634638811',
    assetPriceUSD: '1615.3457033295401',
    liquidityUnits: '37932411660195',
    poolAPY: '0.10004280106499486',
    runeDepth: '128228083986773',
    status: 'available',
    synthSupply: '5675398025',
    synthUnits: '656657391494',
    units: '38589069051689',
    volume24h: '29082189255793'
  },
  {
    annualPercentageRate: '-9.532827939518443',
    asset: 'BNB.FRM-DE7',
    assetDepth: '3704490265678',
    assetPrice: '0.0001179466959457733',
    assetPriceUSD: '0.0002477763783205798',
    liquidityUnits: '139660690904',
    poolAPY: '0',
    runeDepth: '436932387',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '139660690904',
    volume24h: '0'
  },
  {
    annualPercentageRate: '0.22990788723915026',
    asset: 'BNB.TWT-8C2',
    assetDepth: '89665654814185',
    assetPrice: '0.48987715898514905',
    assetPriceUSD: '1.0291088470262897',
    liquidityUnits: '8621121125348',
    poolAPY: '0.22990788723915026',
    runeDepth: '43925156238916',
    status: 'available',
    synthSupply: '10716378871384',
    synthUnits: '547918264773',
    units: '9169039390121',
    volume24h: '16688847906615'
  },
  {
    annualPercentageRate: '0.03758112953062146',
    asset: 'BTC.BTC',
    assetDepth: '82920006364',
    assetPrice: '10149.851643482347',
    assetPriceUSD: '21322.28851810718',
    liquidityUnits: '485545478936867',
    poolAPY: '0.03758112953062146',
    runeDepth: '841625762871212',
    status: 'available',
    synthSupply: '1809061575',
    synthUnits: '5354975159781',
    units: '490900454096648',
    volume24h: '231851556113788'
  },
  {
    annualPercentageRate: '0.1618986692313893',
    asset: 'DOGE.DOGE',
    assetDepth: '1629200989242435',
    assetPrice: '0.032026837572388424',
    assetPriceUSD: '0.0672803401495559',
    liquidityUnits: '29585792907678',
    poolAPY: '0.1618986692313893',
    runeDepth: '52178155455242',
    status: 'available',
    synthSupply: '15898647255119',
    synthUnits: '145065104689',
    units: '29730858012367',
    volume24h: '3376629400635'
  },
  {
    annualPercentageRate: '0.08597638508932577',
    asset: 'ETH.AAVE-0X7FC66500C84A76AD7E9C93437BFC5AC33E2DDAE9',
    assetDepth: '109499051509',
    assetPrice: '40.45826140060104',
    assetPriceUSD: '84.99264352090968',
    liquidityUnits: '2809723832942',
    poolAPY: '0.08597638508932577',
    runeDepth: '4430141249069',
    status: 'available',
    synthSupply: '67626647',
    synthUnits: '867911151',
    units: '2810591744093',
    volume24h: '9353692870'
  },
  {
    annualPercentageRate: '-0.5222401019883771',
    asset: 'ETH.ALCX-0XDBDB4D16EDA451D0503B854CF79D55697F90C8DF',
    assetDepth: '13408099051',
    assetPrice: '8.129316325185611',
    assetPriceUSD: '17.077651401128865',
    liquidityUnits: '276017850928',
    poolAPY: '0',
    runeDepth: '108998678505',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '276017850928',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.5378955639853171',
    asset: 'ETH.ALPHA-0XA1FAA113CBE53436DF28FF0AEE54275C13B40975',
    assetDepth: '3856184049768',
    assetPrice: '0.0273979600787873',
    assetPriceUSD: '0.05755623137433903',
    liquidityUnits: '172163514280',
    poolAPY: '0',
    runeDepth: '105651576652',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '172163514280',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.1835559926613134',
    asset: 'ETH.CREAM-0X2BA592F78DB6436527729929AAF6C908497CB200',
    assetDepth: '55156539980',
    assetPrice: '5.846708680782626',
    assetPriceUSD: '12.282466163239127',
    liquidityUnits: '110324072646',
    poolAPY: '0',
    runeDepth: '322484221103',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '110324072646',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.07605839005630517',
    asset: 'ETH.DAI-0X6B175474E89094C44DA98B954EEDEAC495271D0F',
    assetDepth: '41665739603605',
    assetPrice: '0.4774208853120634',
    assetPriceUSD: '1.0029413452294937',
    liquidityUnits: '10224908661212',
    poolAPY: '0',
    runeDepth: '19892094288735',
    status: 'available',
    synthSupply: '11815018104903',
    synthUnits: '1689226215771',
    units: '11914134876983',
    volume24h: '3750938581501'
  },
  {
    annualPercentageRate: '0.013707053309199635',
    asset: 'ETH.ETH',
    assetDepth: '771230187462',
    assetPrice: '768.0526039339883',
    assetPriceUSD: '1613.4855752970673',
    liquidityUnits: '228089790414533',
    poolAPY: '0.013707053309199635',
    runeDepth: '592345353712687',
    status: 'available',
    synthSupply: '96846476921',
    synthUnits: '15280492705425',
    units: '243370283119958',
    volume24h: '159395225870219'
  },
  {
    annualPercentageRate: '0.08597378980872379',
    asset: 'ETH.FOX-0XC770EEFAD204B5180DF6A14EE197D99D808EE52D',
    assetDepth: '211112350100978',
    assetPrice: '0.032126155158298246',
    assetPriceUSD: '0.06748898144758422',
    liquidityUnits: '9911766183814',
    poolAPY: '0.08597378980872379',
    runeDepth: '6782228115177',
    status: 'available',
    synthSupply: '6682595666436',
    synthUnits: '159397387229',
    units: '10071163571043',
    volume24h: '66688297317'
  },
  {
    annualPercentageRate: '-6.3171292747394245',
    asset: 'ETH.HEGIC-0X584BC13C7D411C00C01A62E8019472DE68768430',
    assetDepth: '11332736700155',
    assetPrice: '0.00026529263147522696',
    assetPriceUSD: '0.0005573131735058458',
    liquidityUnits: '50627754650',
    poolAPY: '0',
    runeDepth: '3006491541',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '50627754650',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.09019839578350776',
    asset: 'ETH.HOT-0X6C6EE5E31D828DE241282B9606C8E98EA48526E2',
    assetDepth: '750402624708388',
    assetPrice: '0.0008886191740535716',
    assetPriceUSD: '0.0018667656511077463',
    liquidityUnits: '525668287704',
    poolAPY: '0',
    runeDepth: '666822160576',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '525668287704',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.0892102181447032',
    asset: 'ETH.KYL-0X67B6D479C7BB412C54E03DCA8E1BC6740CE6B99C',
    assetDepth: '97913862006367',
    assetPrice: '0.006887881983555555',
    assetPriceUSD: '0.014469709715053071',
    liquidityUnits: '1193108642240',
    poolAPY: '0',
    runeDepth: '674419126054',
    status: 'staged',
    synthSupply: '673795060',
    synthUnits: '4105207',
    units: '1193112747447',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.1612269559164598',
    asset: 'ETH.PERP-0XBC396689893D065F41BC2C6ECBEE5E0085233447',
    assetDepth: '861561362578',
    assetPrice: '0.4292573861661745',
    assetPriceUSD: '0.9017619328693433',
    liquidityUnits: '221006473137',
    poolAPY: '0',
    runeDepth: '369831578522',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '221006473137',
    volume24h: '0'
  },
  {
    annualPercentageRate: '-0.08275333094177909',
    asset: 'ETH.RAZE-0X5EAA69B29F99C84FE5DE8200340B4E9B4AB38EAC',
    assetDepth: '229984228862564',
    assetPrice: '0.003163803736132796',
    assetPriceUSD: '0.006646356857817479',
    liquidityUnits: '1853608790179',
    poolAPY: '0',
    runeDepth: '727624962527',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '1853608790179',
    volume24h: '0'
  },
  {
    annualPercentageRate: '0.08627845170654624',
    asset: 'ETH.SNX-0XC011A73EE8576FB46F5E1C5751CA3B9FE0AF2A6F',
    assetDepth: '2679841470417',
    assetPrice: '1.4118260267710048',
    assetPriceUSD: '2.965891811779823',
    liquidityUnits: '2874013140033',
    poolAPY: '0.08627845170654624',
    runeDepth: '3783469935555',
    status: 'available',
    synthSupply: '137183428499',
    synthUnits: '75493923009',
    units: '2949507063042',
    volume24h: '46756253960'
  },
  {
    annualPercentageRate: '-0.30903020191807856',
    asset: 'ETH.SUSHI-0X6B3595068778DD592E39A122F4F5A5CF09C90FE2',
    assetDepth: '491673352250',
    assetPrice: '0.38229297020438635',
    assetPriceUSD: '0.8031014930525032',
    liquidityUnits: '322325916036',
    poolAPY: '0',
    runeDepth: '187963266202',
    status: 'staged',
    synthSupply: '0',
    synthUnits: '0',
    units: '322325916036',
    volume24h: '0'
  },
  {
    annualPercentageRate: '0.18760402568604598',
    asset: 'ETH.TGT-0X108A850856DB3F85D0269A2693D896B394C80325',
    assetDepth: '3243081736934697',
    assetPrice: '0.0034160417196574277',
    assetPriceUSD: '0.007176245495489479',
    liquidityUnits: '19799610581564',
    poolAPY: '0.18760402568604598',
    runeDepth: '11078502513628',
    status: 'available',
    synthSupply: '209746609993060',
    synthUnits: '661667522845',
    units: '20461278104409',
    volume24h: '364772824444'
  },
  {
    annualPercentageRate: '0.08264535253346764',
    asset: 'ETH.THOR-0XA5F2211B9B8170F694421F2046281775E8468044',
    assetDepth: '1187431810370299',
    assetPrice: '0.11650640432364769',
    assetPriceUSD: '0.24475068744391607',
    liquidityUnits: '8407420881482',
    poolAPY: '0.08264535253346764',
    runeDepth: '138343410605763',
    status: 'available',
    synthSupply: '53095378342061',
    synthUnits: '192265181524',
    units: '8599686063006',
    volume24h: '12385796586938'
  },
  {
    annualPercentageRate: '0.11299667484256515',
    asset: 'ETH.UOS-0XD13C7342E1EF687C5AD21B27C2B65D772CAB5C8C',
    assetDepth: '112076289618820',
    assetPrice: '0.15175476608612654',
    assetPriceUSD: '0.3187986406248682',
    liquidityUnits: '81771645752453',
    poolAPY: '0.11299667484256515',
    runeDepth: '17008111114905',
    status: 'available',
    synthSupply: '199204271900',
    synthUnits: '72735055484',
    units: '81844380807937',
    volume24h: '317812188747'
  },
  {
    annualPercentageRate: '0.03127471742090522',
    asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    assetDepth: '385152941367691',
    assetPrice: '0.47669686012390555',
    assetPriceUSD: '1.0014203501944392',
    liquidityUnits: '38744373865147',
    poolAPY: '0.03127471742090522',
    runeDepth: '183601197817465',
    status: 'available',
    synthSupply: '84422542095931',
    synthUnits: '4768884648169',
    units: '43513258513316',
    volume24h: '129929290355335'
  },
  {
    annualPercentageRate: '0.2243992484285711',
    asset: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
    assetDepth: '138317203569888',
    assetPrice: '0.4766699440921786',
    assetPriceUSD: '1.001363806373465',
    liquidityUnits: '26149560750076',
    poolAPY: '0.2243992484285711',
    runeDepth: '65931653692645',
    status: 'available',
    synthSupply: '23284889332764',
    synthUnits: '2403358148996',
    units: '28552918899072',
    volume24h: '35000057801632'
  },
  {
    annualPercentageRate: '0.04710041227060831',
    asset: 'ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599',
    assetDepth: '5539612479',
    assetPrice: '10094.990742521577',
    assetPriceUSD: '21207.039547015076',
    liquidityUnits: '50057895704548',
    poolAPY: '0.04710041227060831',
    runeDepth: '55922336692662',
    status: 'available',
    synthSupply: '903619773',
    synthUnits: '4445269203258',
    units: '54503164907806',
    volume24h: '8711719368728'
  },
  {
    annualPercentageRate: '0.09472301851302785',
    asset: 'ETH.XDEFI-0X72B886D09C117654AB7DA13A14D603001DE0B777',
    assetDepth: '222660188755741',
    assetPrice: '0.07290961629221841',
    assetPriceUSD: '0.153164787913471',
    liquidityUnits: '26207735465934',
    poolAPY: '0.09472301851302785',
    runeDepth: '16234068925734',
    status: 'available',
    synthSupply: '1084160213684',
    synthUnits: '63960080192',
    units: '26271695546126',
    volume24h: '165206832502'
  },
  {
    annualPercentageRate: '0.17286405007122432',
    asset: 'ETH.XRUNE-0X69FA0FEE221AD11012BAB0FDB45D444D3D2CE71C',
    assetDepth: '6301158776868453',
    assetPrice: '0.00814994032871616',
    assetPriceUSD: '0.017120977251508084',
    liquidityUnits: '11396765838225',
    poolAPY: '0.17286405007122432',
    runeDepth: '51354068033244',
    status: 'available',
    synthSupply: '18545252189199',
    synthUnits: '16795909171',
    units: '11413561747396',
    volume24h: '401060954494'
  },
  {
    annualPercentageRate: '0.1553794503399123',
    asset: 'ETH.YFI-0X0BC529C00C6401AEF6D220BE8C6EA1667F6AD93E',
    assetDepth: '2183192935',
    assetPrice: '4293.798564444786',
    assetPriceUSD: '9020.192121578115',
    liquidityUnits: '5531869099724',
    poolAPY: '0.1553794503399123',
    runeDepth: '9374190690209',
    status: 'available',
    synthSupply: '309871090',
    synthUnits: '422571197353',
    units: '5954440297077',
    volume24h: '613408266149'
  },
  {
    annualPercentageRate: '0.23364021204129576',
    asset: 'GAIA.ATOM',
    assetDepth: '13908636225630',
    assetPrice: '5.581190837102208',
    assetPriceUSD: '11.724679875466633',
    liquidityUnits: '57447840256209',
    poolAPY: '0.23364021204129576',
    runeDepth: '77626753059074',
    status: 'available',
    synthSupply: '204988079070',
    synthUnits: '426481281378',
    units: '57874321537587',
    volume24h: '48442821928387'
  },
  {
    annualPercentageRate: '0.1847022869897757',
    asset: 'LTC.LTC',
    assetDepth: '1739385626510',
    assetPrice: '26.66565619613009',
    assetPriceUSD: '56.01784488186515',
    liquidityUnits: '28009682422025',
    poolAPY: '0.1847022869897757',
    runeDepth: '46381859109006',
    status: 'available',
    synthSupply: '41323504210',
    synthUnits: '336720239569',
    units: '28346402661594',
    volume24h: '10605597135981'
  }
]

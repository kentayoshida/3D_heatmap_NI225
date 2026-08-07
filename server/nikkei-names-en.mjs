// Official English company names for Nikkei 225 constituents (code → English name).
//
// Source: the official constituent list (English company names, grouped by TSE
// sector). Redundant corporate-form suffixes (CO., LTD. / CORP. / INC. / LTD. /
// K.K.) are stripped for a compact label; meaningful tokens (HOLDINGS, GROUP,
// FINANCIAL GROUP, "& CO.", …) are kept. Consumed by:
//   - build-params.mjs   → bakes `nameEn` into index-params.json (live Worker)
//   - scripts/gen_sample.mjs → bakes `nameEn` into the offline sample
// The frontend (main.js `nameFor`) shows `nameEn` in the English view, falling
// back to the stock code for any code not listed here.

// Raw "official" names, keyed by code. Cleaned by clean() below at load time so
// the raw list stays verifiable against the source.
const RAW = {
  // Pharmaceuticals
  '4151': 'KYOWA KIRIN CO., LTD.',
  '4502': 'TAKEDA PHARMACEUTICAL CO., LTD.',
  '4503': 'ASTELLAS PHARMA INC.',
  '4506': 'SUMITOMO PHARMA CO., LTD.',
  '4507': 'SHIONOGI & CO., LTD.',
  '4519': 'CHUGAI PHARMACEUTICAL CO., LTD.',
  '4523': 'EISAI CO., LTD.',
  '4568': 'DAIICHI SANKYO CO., LTD.',
  '4578': 'OTSUKA HOLDINGS CO., LTD.',
  // Electric Machinery
  '285A': 'KIOXIA HOLDINGS CORP.',
  '4062': 'IBIDEN CO., LTD.',
  '6479': 'MINEBEA MITSUMI INC.',
  '6501': 'HITACHI, LTD.',
  '6503': 'MITSUBISHI ELECTRIC CORP.',
  '6504': 'FUJI ELECTRIC CO., LTD.',
  '6506': 'YASKAWA ELECTRIC CORP.',
  '6526': 'SOCIONEXT INC.',
  '6645': 'OMRON CORP.',
  '6701': 'NEC CORP.',
  '6702': 'FUJITSU LTD.',
  '6723': 'RENESAS ELECTRONICS CORP.',
  '6724': 'SEIKO EPSON CORP.',
  '6752': 'PANASONIC HOLDINGS CORP.',
  '6753': 'SHARP CORP.',
  '6758': 'SONY GROUP CORP.',
  '6762': 'TDK CORP.',
  '6770': 'ALPS ALPINE CO., LTD.',
  '6841': 'YOKOGAWA ELECTRIC CORP.',
  '6857': 'ADVANTEST CORP.',
  '6861': 'KEYENCE CORP.',
  '6902': 'DENSO CORP.',
  '6920': 'LASERTEC CORP.',
  '6954': 'FANUC CORP.',
  '6963': 'ROHM CO., LTD.',
  '6971': 'KYOCERA CORP.',
  '6976': 'TAIYO YUDEN CO., LTD.',
  '6981': 'MURATA MANUFACTURING CO., LTD.',
  '7735': 'SCREEN HOLDINGS CO., LTD.',
  '7751': 'CANON INC.',
  '7752': 'RICOH CO., LTD.',
  '8035': 'TOKYO ELECTRON LTD.',
  // Automobiles & Auto parts
  '543A': 'ARCHION CORP.',
  '7201': 'NISSAN MOTOR CO., LTD.',
  '7202': 'ISUZU MOTORS LTD.',
  '7203': 'TOYOTA MOTOR CORP.',
  '7211': 'MITSUBISHI MOTORS CORP.',
  '7261': 'MAZDA MOTOR CORP.',
  '7267': 'HONDA MOTOR CO., LTD.',
  '7269': 'SUZUKI MOTOR CORP.',
  '7270': 'SUBARU CORP.',
  '7272': 'YAMAHA MOTOR CO., LTD.',
  // Precision Instruments
  '4543': 'TERUMO CORP.',
  '4902': 'KONICA MINOLTA, INC.',
  '6146': 'DISCO CORP.',
  '7731': 'NIKON CORP.',
  '7733': 'OLYMPUS CORP.',
  '7741': 'HOYA CORP.',
  // Communications
  '9432': 'NTT, INC.',
  '9433': 'KDDI CORP.',
  '9434': 'SOFTBANK CORP.',
  '9984': 'SOFTBANK GROUP CORP.',
  // Banking
  '5831': 'SHIZUOKA FINANCIAL GROUP, INC.',
  '7186': 'YOKOHAMA FINANCIAL GROUP, INC.',
  '8304': 'AOZORA BANK, LTD.',
  '8306': 'MITSUBISHI UFJ FINANCIAL GROUP, INC.',
  '8308': 'RESONA HOLDINGS, INC.',
  '8309': 'SUMITOMO MITSUI TRUST GROUP, INC.',
  '8316': 'SUMITOMO MITSUI FINANCIAL GROUP, INC.',
  '8331': 'THE CHIBA BANK, LTD.',
  '8354': 'FUKUOKA FINANCIAL GROUP, INC.',
  '8411': 'MIZUHO FINANCIAL GROUP, INC.',
  // Other Financial Services
  '8253': 'CREDIT SAISON CO., LTD.',
  '8591': 'ORIX CORP.',
  '8697': 'JAPAN EXCHANGE GROUP, INC.',
  // Securities
  '8601': 'DAIWA SECURITIES GROUP INC.',
  '8604': 'NOMURA HOLDINGS, INC.',
  // Insurance
  '8630': 'SOMPO HOLDINGS, INC.',
  '8725': 'MS&AD INSURANCE GROUP HOLDINGS, INC.',
  '8750': 'DAIICHI LIFE GROUP, INC.',
  '8766': 'TOKIO MARINE HOLDINGS, INC.',
  '8795': 'T&D HOLDINGS, INC.',
  // Fishery
  '1332': 'NISSUI CORP.',
  // Foods
  '2002': 'NISSHIN SEIFUN GROUP INC.',
  '2269': 'MEIJI HOLDINGS CO., LTD.',
  '2282': 'NH FOODS LTD.',
  '2501': 'SAPPORO BREWERIES LTD.',
  '2502': 'ASAHI GROUP HOLDINGS, LTD.',
  '2503': 'KIRIN HOLDINGS CO., LTD.',
  '2801': 'KIKKOMAN CORP.',
  '2802': 'AJINOMOTO CO., INC.',
  '2871': 'NICHIREI CORP.',
  '2914': 'JAPAN TOBACCO INC.',
  // Retail
  '3086': 'J.FRONT RETAILING CO., LTD.',
  '3092': 'ZOZO, INC.',
  '3099': 'ISETAN MITSUKOSHI HOLDINGS LTD.',
  '3382': 'SEVEN & I HOLDINGS CO., LTD.',
  '7453': 'RYOHIN KEIKAKU CO., LTD.',
  '7532': 'PAN PACIFIC INTERNATIONAL HOLDINGS CORP.',
  '8233': 'TAKASHIMAYA CO., LTD.',
  '8252': 'MARUI GROUP CO., LTD.',
  '8267': 'AEON CO., LTD.',
  '9843': 'NITORI HOLDINGS CO., LTD.',
  '9983': 'FAST RETAILING CO., LTD.',
  // Services
  '2413': 'M3, INC.',
  '2432': 'DENA CO., LTD.',
  '3659': 'NEXON CO., LTD.',
  '3697': 'SHIFT INC.',
  '4307': 'NOMURA RESEARCH INSTITUTE, LTD.',
  '4324': 'DENTSU GROUP INC.',
  '4385': 'MERCARI, INC.',
  '4661': 'ORIENTAL LAND CO., LTD.',
  '4689': 'LY CORP.',
  '4704': 'TREND MICRO INC.',
  '4751': 'CYBERAGENT, INC.',
  '4755': 'RAKUTEN GROUP, INC.',
  '6098': 'RECRUIT HOLDINGS CO., LTD.',
  '6178': 'JAPAN POST HOLDINGS CO., LTD.',
  '6532': 'BAYCURRENT, INC.',
  '7974': 'NINTENDO CO., LTD.',
  '9602': 'TOHO CO., LTD',
  '9735': 'SECOM CO., LTD.',
  '9766': 'KONAMI GROUP CORP.',
  // Mining
  '1605': 'INPEX CORP.',
  // Textiles & Apparel
  '3401': 'TEIJIN LTD.',
  '3402': 'TORAY INDUSTRIES, INC.',
  // Pulp & Paper
  '3861': 'OJI HOLDINGS CORP.',
  // Chemicals
  '3405': 'KURARAY CO., LTD.',
  '3407': 'ASAHI KASEI CORP.',
  '4004': 'RESONAC HOLDINGS CORP.',
  '4005': 'SUMITOMO CHEMICAL CO., LTD.',
  '4021': 'NISSAN CHEMICAL CORP.',
  '4042': 'TOSOH CORP.',
  '4043': 'TOKUYAMA CORP.',
  '4061': 'DENKA CO., LTD.',
  '4063': 'SHIN-ETSU CHEMICAL CO., LTD.',
  '4183': 'MITSUI CHEMICALS, INC.',
  '4188': 'MITSUBISHI CHEMICAL GROUP CORP.',
  '4208': 'UBE CORP.',
  '4452': 'KAO CORP.',
  '4901': 'FUJIFILM HOLDINGS CORP.',
  '4911': 'SHISEIDO CO., LTD.',
  '6988': 'NITTO DENKO CORP.',
  // Petroleum
  '5019': 'IDEMITSU KOSAN CO., LTD.',
  '5020': 'ENEOS HOLDINGS, INC.',
  // Rubber
  '5101': 'THE YOKOHAMA RUBBER CO., LTD.',
  '5108': 'BRIDGESTONE CORP.',
  // Glass & Ceramics
  '5201': 'AGC INC.',
  '5214': 'NIPPON ELECTRIC GLASS CO., LTD.',
  '5233': 'TAIHEIYO CEMENT CORP.',
  '5301': 'TOKAI CARBON CO., LTD.',
  '5332': 'TOTO LTD.',
  '5333': 'NGK CORP.',
  // Steel
  '5401': 'NIPPON STEEL CORP.',
  '5406': 'KOBE STEEL, LTD.',
  '5411': 'JFE HOLDINGS, INC.',
  // Nonferrous Metals
  '3436': 'SUMCO CORP.',
  '5706': 'MITSUI KINZOKU CO., LTD.',
  '5711': 'MITSUBISHI MATERIALS CORP.',
  '5713': 'SUMITOMO METAL MINING CO., LTD.',
  '5714': 'DOWA HOLDINGS CO., LTD.',
  '5801': 'FURUKAWA ELECTRIC CO., LTD.',
  '5802': 'SUMITOMO ELECTRIC IND., LTD.',
  '5803': 'FUJIKURA LTD.',
  // Trading Companies
  '2768': 'SOJITZ CORP.',
  '8001': 'ITOCHU CORP.',
  '8002': 'MARUBENI CORP.',
  '8015': 'TOYOTA TSUSHO CORP.',
  '8031': 'MITSUI & CO., LTD.',
  '8053': 'SUMITOMO CORP.',
  '8058': 'MITSUBISHI CORP.',
  // Construction
  '1721': 'COMSYS HOLDINGS CORP.',
  '1801': 'TAISEI CORP.',
  '1802': 'OBAYASHI CORP.',
  '1803': 'SHIMIZU CORP.',
  '1808': 'HASEKO CORP.',
  '1812': 'KAJIMA CORP.',
  '1925': 'DAIWA HOUSE IND. CO., LTD.',
  '1928': 'SEKISUI HOUSE, LTD.',
  '1963': 'JGC HOLDINGS CORP.',
  // Machinery
  '5631': 'THE JAPAN STEEL WORKS, LTD.',
  '6103': 'OKUMA CORP.',
  '6113': 'AMADA CO., LTD.',
  '6273': 'SMC CORP.',
  '6301': 'KOMATSU LTD.',
  '6302': 'SUMITOMO HEAVY IND., LTD.',
  '6305': 'HITACHI CONST. MACH. CO., LTD.',
  '6326': 'KUBOTA CORP.',
  '6361': 'EBARA CORP.',
  '6367': 'DAIKIN INDUSTRIES, LTD.',
  '6471': 'NSK LTD.',
  '6472': 'NTN CORP.',
  '6473': 'JTEKT CORP.',
  '7004': 'KANADEVIA CORP.',
  '7011': 'MITSUBISHI HEAVY IND., LTD.',
  '7013': 'IHI CORP.',
  // Shipbuilding
  '7012': 'KAWASAKI HEAVY IND., LTD.',
  // Other Manufacturing
  '7832': 'BANDAI NAMCO HOLDINGS INC.',
  '7911': 'TOPPAN HOLDINGS INC.',
  '7912': 'DAI NIPPON PRINTING CO., LTD.',
  '7951': 'YAMAHA CORP.',
  // Real Estate
  '3289': 'TOKYU FUDOSAN HOLDINGS CORP.',
  '8801': 'MITSUI FUDOSAN CO., LTD.',
  '8802': 'MITSUBISHI ESTATE CO., LTD.',
  '8804': 'TOKYO TATEMONO CO., LTD.',
  '8830': 'SUMITOMO REALTY & DEVELOPMENT CO., LTD.',
  // Railway & Bus
  '9001': 'TOBU RAILWAY CO., LTD.',
  '9005': 'TOKYU CORP.',
  '9007': 'ODAKYU ELECTRIC RAILWAY CO., LTD.',
  '9008': 'KEIO CORP.',
  '9009': 'KEISEI ELECTRIC RAILWAY CO., LTD.',
  '9020': 'EAST JAPAN RAILWAY CO.',
  '9021': 'WEST JAPAN RAILWAY CO.',
  '9022': 'CENTRAL JAPAN RAILWAY CO., LTD.',
  // Land Transport
  '9064': 'YAMATO HOLDINGS CO., LTD.',
  '9147': 'NIPPON EXPRESS HOLDINGS, INC.',
  // Marine Transport
  '9101': 'NIPPON YUSEN K.K.',
  '9104': 'MITSUI O.S.K.LINES, LTD.',
  '9107': 'KAWASAKI KISEN KAISHA, LTD.',
  // Air Transport
  '9201': 'JAPAN AIRLINES CO., LTD.',
  '9202': 'ANA HOLDINGS INC.',
  // Electric Power
  '9501': 'TOKYO ELECTRIC POWER COMPANY HOLDINGS, INC.',
  '9502': 'CHUBU ELECTRIC POWER CO., INC.',
  '9503': 'THE KANSAI ELECTRIC POWER CO., INC.',
  // Gas
  '9531': 'TOKYO GAS CO., LTD.',
  '9532': 'OSAKA GAS CO., LTD.',
};

// Strip trailing corporate-form suffixes (CO., LTD. / CORP. / INC. / LTD. / K.K.),
// repeatedly, but keep a meaningful "& CO." (e.g. MITSUI & CO., SHIONOGI & CO.).
export function clean(raw) {
  let s = String(raw).trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*,?\s*(?:K\.K\.|CORP\.|INC\.|LTD\.?)\s*$/i, '').trim();
    if (!/&\s*CO\.\s*$/i.test(s)) {
      s = s.replace(/\s*,?\s*CO\.\s*$/i, '').trim();
    }
  } while (s !== prev);
  return s;
}

// code → cleaned English name.
export const NAME_EN = Object.fromEntries(
  Object.entries(RAW).map(([code, name]) => [code, clean(name)]),
);

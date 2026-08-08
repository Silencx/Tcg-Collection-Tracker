// =============================================================================
// config.js — all static configuration: storage keys, language tables,
// era tables, and the Pokémon catalogue. Pure data only (no DOM, no fetch).
//
// Data blocks below are ported VERBATIM from the old single-file tool so the
// new site behaves identically. URL-builder helpers that used to sit next to
// these tables (limitlessIntlUrl, ptcgioToTcgdexSetId/LocalId, LIMITLESS_LANG_CODE)
// live in js/api/images.js instead, since they belong to the image layer.
// =============================================================================

// Bump on any breaking change to a persisted blob's shape. Stamped into state
// blobs and the export envelope so the import screen can validate/migrate.
export const SCHEMA_VERSION = 1;

// ── APP MODES ─────────────────────────────────────────────────────────────────
// The single source of truth for "how many modes are there".
//
// There used to be TWO independent whitelists — state.js's boot read of MODESTORE and
// io.js's applySession — and both silently coerced anything unrecognised to 'master'.
// A third mode therefore could not survive a reload, and was quietly dropped from every
// shared #s= link, with no error anywhere. Adding one here is now the whole change.
export const APP_MODES = ['dash', 'master', 'tms', 'set'];

// Where boot lands, always. Deliberate: the dashboard needs no network and no card
// render, so it is the one mode that is free to show. See the comment on state.appMode
// for why the persisted mode is NOT a landing preference.
export const DEFAULT_MODE = 'dash';

/** @returns {boolean} whether `m` is a mode this build knows how to render. */
export function isValidMode(m) {
  return APP_MODES.includes(m);
}

// ── SERIES ────────────────────────────────────────────────────────────────────
// TCGdex groups sets into series ("sv" = Scarlet & Violet, "swsh" = Sword & Shield).
// The map from set id → series id is shipped in data/sets.json as `setSeries`, derived
// at build time from TCGdex's own /series endpoints — NOT guessed from the id, which is
// wrong for a large minority of sets (see tcgdexSerieSegment in js/api/images.js).
//
// Series that are DIGITAL-ONLY products rather than physical expansions you can own.
// `tcgp` is Pokémon TCG Pocket, the mobile game (A1 Genetic Apex, A1a Mythical Island,
// B1 Mega Rising, … 15 sets). They are excluded from the single-set picker, which is a
// tool for completing a physical set. A Set so the predicate is O(1) and adding another
// digital line later is a one-word change.
export const DIGITAL_SERIES = new Set(['tcgp']);
// Bucket for any set whose series cannot be resolved. Should be empty in practice —
// coverage measured 100% in all 9 languages — but a set added to /sets between two
// build sweeps would otherwise vanish from the picker entirely.
export const OTHER_SERIES_ID = 'other';
export const OTHER_SERIES_NAME = 'Other sets';

// ── STORAGE KEYS ──────────────────────────────────────────────────────────────
export const CHKSTORE   = 'tcgChk_v1';
export const POKESTORE  = 'tcgPokemon_v1';
export const FILTERSTORE= 'tcgFilter_v1';
export const BANNERSTORE= 'tcgBannerDismissed_v1';
export const CACHESTORE = 'tcgData_v21';   // v21: real set dates (#6) + variants baked in
export const SORTSTORE  = 'tcgSort_v1';
export const MODESTORE  = 'tcgMode_v1';
export const TMSSTORE   = 'tcgTMS_v1';
export const TMSFILTERSTORE = 'tcgTMSFilter_v1';
export const TMSCACHESTORE  = 'tcgTMSPokes_v1';
// Single-set mode. The tcg prefix is functional — storage.keys('tcg') drives
// export/backup — so correctly named keys need no export wiring of their own.
export const SETTARGETSTORE = 'tcgSetTarget_v1';  // the chosen set id
export const SETCHKSTORE    = 'tcgSetChk_v1';     // its checklist, SEPARATE from CHKSTORE
// (No SETFILTERSTORE: single-set mode has no language filter — the language is chosen in
// the picker, before the set. tcgSetFilter_v1 may still exist in an older profile; it is
// simply unread, and storage.keys('tcg') will carry it through an export harmlessly.)
export const SETPICKERSTORE = 'tcgSetPicker_v1';  // picker chrome: {lang, asc}
export const PALETTE_KEY = 'tcgPalette_v1';
export const SESSIONSTORE = 'tcgSession_v1'; // base64url settings hash (Phase 5)
export const IMGFAILSTORE = 'tcgImgFail_v1'; // negative cache of image URLs that 404/403
// Set-navigation sidebar open/closed. Device-local CHROME, deliberately NOT part
// of the shareable session hash (io.js encodeSession) — a link shared from a
// desktop shouldn't force the panel open on the recipient's phone.
export const SETNAVSTORE = 'tcgSetNav_v1';
export const DEFAULT_POKEMON = ['Seedot', 'Nuzleaf', 'Shiftry']; // default list + pre-build target
export const CACHE_TTL  = 24*60*60*1000; // 24h EN card-data cache TTL

// Image-availability negative cache (js/api/img-cache.js).
//
// TTL is long because the thing being remembered barely moves: TCGdex has no card
// images AT ALL for zh-Hant/th/id (verified across bw4→sv05, every era), and the
// per-card gaps in the Latin languages are individual missing scans. A week keeps
// the console quiet and the requests down while still letting newly-added artwork
// appear on its own — nothing here is ever a permanent verdict.
export const IMG_FAIL_TTL = 7*24*60*60*1000;
// Cap so a big Pokémon list can't grow this blob without bound (65 cards × 9
// languages is ~585 entries for the default list). Oldest entries are evicted.
export const IMG_FAIL_MAX = 4000;

// ── LANGUAGES (data languages with TCGdex coverage) ───────────────────────────
export const LANGUAGES = [
  // code = TCGdex image CDN prefix  apiCode = TCGdex REST API language code
  { code:'en',      apiCode:'en',    badge:'EN', color:'#1565c0', label:'English',                     hasSetsApi:true  },
  { code:'de',      apiCode:'de',    badge:'DE', color:'#5b4000', label:'German',                      hasSetsApi:true  },
  { code:'fr',      apiCode:'fr',    badge:'FR', color:'#1a237e', label:'French',                      hasSetsApi:true  },
  { code:'es',      apiCode:'es',    badge:'ES', color:'#b71c1c', label:'Spanish',                     hasSetsApi:true  },
  { code:'it',      apiCode:'it',    badge:'IT', color:'#1b5e20', label:'Italian',                     hasSetsApi:true  },
  { code:'pt',      apiCode:'pt',    badge:'PT', color:'#880e4f', label:'Portuguese',                  hasSetsApi:true  },
  // JP handled as dedicated column via Limitless TPC CDN (see renderBySet JP block)
  // NOT in LANGUAGES — EN set IDs don't map to JP CDN paths
  { code:'zh-Hant', apiCode:'zh-tw', badge:'TW', color:'#c62828', label:'Traditional Chinese (TW/HK)', hasSetsApi:true  },
  { code:'th',      apiCode:'th',    badge:'TH', color:'#283593', label:'Thai',                        hasSetsApi:true  },
  { code:'id',      apiCode:'id',    badge:'ID', color:'#e65100', label:'Indonesian',                  hasSetsApi:true  },
];

// ── PLACEHOLDER-ONLY LANGUAGES (no public image source) ───────────────────────
export const PLACEHOLDER_LANGS = [
  { badge:'KR', color:'#00695c', label:'Korean',
    note:'Korean cards exist but no public image database yet.',
    sources:[{name:'KrystalKollectz',url:'https://krystalkollectz.com/pages/card-lists'}] },
  { badge:'SC', color:'#4a148c', label:'Simplified Chinese (CN)',
    note:'Simplified Chinese launched 2022. TCGdex support coming soon.',
    sources:[{name:'KrystalKollectz',url:'https://krystalkollectz.com/pages/card-lists'},{name:'PokiPair',url:'https://pokipair.com/simplified-chinese-pokemon-set-list/'}] },
];

// ── NATIVE POKéMON NAMES (for missing-image placeholder cards) ────────────────
// Native Pokémon names for known languages (used on missing-image placeholder cards)
// TH: TCGdex returns 0 results for TH card names — left empty
//     never errors if the fetch hasn't completed yet.
// ID: Indonesian TCG uses the same Pokémon names as English — no separate entry needed.
export const NATIVE_NAMES = {
  TW:{ Seedot:'橡實果', Nuzleaf:'長鼻葉', Shiftry:'狡猾天狗' },
  KR:{ Seedot:'도토링', Nuzleaf:'잎새코',  Shiftry:'다탱구'   },
  SC:{ Seedot:'橡实果', Nuzleaf:'长鼻叶',  Shiftry:'狡猾天狗' },
  JP:{ Seedot:'タネボー', Nuzleaf:'コノハナ', Shiftry:'ダーテング' },
  TH:{}, // populated at runtime from TCGdex th/cards/{id} endpoint
};

// ── BADGE DISPLAY ORDER ───────────────────────────────────────────────────────
export const BADGE_ORDER = ['EN','DE','FR','ES','IT','PT','JP','TW','TH','ID','KR','SC'];

// ── ERA DISPLAY NAMES + ORDER ─────────────────────────────────────────────────
export const ERA_MAP = {
  sv:'Scarlet & Violet Era', swsh:'Sword & Shield Era',
  sm:'Sun & Moon Era', xy:'XY Era', bw:'Black & White Era',
  hgss:'HeartGold & SoulSilver Era', pl:'Platinum Era',
  dp:'Diamond & Pearl Era', ex:'EX Series Era', base:'Original Era',
};

// pokemontcg.io series name → TCGdex era code (for ERA_MAP display names)
export const PTCGIO_SERIES_ERA = {
  'Base':'base','Gym Heroes':'base','Neo':'base','e-Card':'base','EX':'ex',
  'Diamond & Pearl':'dp','Platinum':'pl','HeartGold & SoulSilver':'hgss',
  'Black & White':'bw','XY':'xy','Sun & Moon':'sm',
  'Sword & Shield':'swsh','Scarlet & Violet':'sv',
};

// Canonical era release order, newest first.
// Used to sort era sections; eras not listed appear at the end.
export const ERA_ORDER_DESC = ['sv','swsh','sm','xy','bw','hgss','pl','dp','ex','base'];

// ── POKéMON CATALOGUE (Gen 1–9, dex# + gen) ───────────────────────────────────
// Popular suggestions for the Pokémon input
export const POKEMON_CATALOG = [
  // Gen 1
  {name:'Bulbasaur',dex:1,gen:1},{name:'Ivysaur',dex:2,gen:1},{name:'Venusaur',dex:3,gen:1},
  {name:'Charmander',dex:4,gen:1},{name:'Charmeleon',dex:5,gen:1},{name:'Charizard',dex:6,gen:1},
  {name:'Squirtle',dex:7,gen:1},{name:'Wartortle',dex:8,gen:1},{name:'Blastoise',dex:9,gen:1},
  {name:'Butterfree',dex:12,gen:1},{name:'Beedrill',dex:15,gen:1},
  {name:'Pidgey',dex:16,gen:1},{name:'Pidgeot',dex:18,gen:1},
  {name:'Rattata',dex:19,gen:1},{name:'Raticate',dex:20,gen:1},
  {name:'Pikachu',dex:25,gen:1},{name:'Raichu',dex:26,gen:1},
  {name:'Clefairy',dex:35,gen:1},{name:'Clefable',dex:36,gen:1},
  {name:'Jigglypuff',dex:39,gen:1},{name:'Wigglytuff',dex:40,gen:1},
  {name:'Meowth',dex:52,gen:1},{name:'Persian',dex:53,gen:1},
  {name:'Psyduck',dex:54,gen:1},{name:'Golduck',dex:55,gen:1},
  {name:'Growlithe',dex:58,gen:1},{name:'Arcanine',dex:59,gen:1},
  {name:'Poliwag',dex:60,gen:1},{name:'Poliwrath',dex:62,gen:1},
  {name:'Abra',dex:63,gen:1},{name:'Kadabra',dex:64,gen:1},{name:'Alakazam',dex:65,gen:1},
  {name:'Machop',dex:66,gen:1},{name:'Machamp',dex:68,gen:1},
  {name:'Geodude',dex:74,gen:1},{name:'Golem',dex:76,gen:1},
  {name:'Ponyta',dex:77,gen:1},{name:'Rapidash',dex:78,gen:1},
  {name:'Slowpoke',dex:79,gen:1},{name:'Slowbro',dex:80,gen:1},
  {name:'Magnemite',dex:81,gen:1},{name:'Magneton',dex:82,gen:1},
  {name:'Gastly',dex:92,gen:1},{name:'Haunter',dex:93,gen:1},{name:'Gengar',dex:94,gen:1},
  {name:'Onix',dex:95,gen:1},{name:'Drowzee',dex:96,gen:1},{name:'Hypno',dex:97,gen:1},
  {name:'Cubone',dex:104,gen:1},{name:'Marowak',dex:105,gen:1},
  {name:'Hitmonlee',dex:106,gen:1},{name:'Hitmonchan',dex:107,gen:1},
  {name:'Lickitung',dex:108,gen:1},
  {name:'Chansey',dex:113,gen:1},{name:'Kangaskhan',dex:115,gen:1},
  {name:'Scyther',dex:123,gen:1},
  {name:'Jynx',dex:124,gen:1},{name:'Electabuzz',dex:125,gen:1},{name:'Magmar',dex:126,gen:1},
  {name:'Pinsir',dex:127,gen:1},{name:'Tauros',dex:128,gen:1},
  {name:'Lapras',dex:131,gen:1},{name:'Ditto',dex:132,gen:1},
  {name:'Eevee',dex:133,gen:1},{name:'Vaporeon',dex:134,gen:1},{name:'Jolteon',dex:135,gen:1},{name:'Flareon',dex:136,gen:1},
  {name:'Porygon',dex:137,gen:1},{name:'Aerodactyl',dex:142,gen:1},
  {name:'Snorlax',dex:143,gen:1},
  {name:'Articuno',dex:144,gen:1},{name:'Zapdos',dex:145,gen:1},{name:'Moltres',dex:146,gen:1},
  {name:'Dratini',dex:147,gen:1},{name:'Dragonair',dex:148,gen:1},{name:'Dragonite',dex:149,gen:1},
  {name:'Mewtwo',dex:150,gen:1},{name:'Mew',dex:151,gen:1},
  // Gen 2
  {name:'Chikorita',dex:152,gen:2},{name:'Bayleef',dex:153,gen:2},{name:'Meganium',dex:154,gen:2},
  {name:'Cyndaquil',dex:155,gen:2},{name:'Quilava',dex:156,gen:2},{name:'Typhlosion',dex:157,gen:2},
  {name:'Totodile',dex:158,gen:2},{name:'Croconaw',dex:159,gen:2},{name:'Feraligatr',dex:160,gen:2},
  {name:'Furret',dex:162,gen:2},{name:'Hoothoot',dex:163,gen:2},{name:'Noctowl',dex:164,gen:2},
  {name:'Togepi',dex:175,gen:2},{name:'Togetic',dex:176,gen:2},{name:'Pichu',dex:172,gen:2},
  {name:'Cleffa',dex:173,gen:2},{name:'Igglybuff',dex:174,gen:2},
  {name:'Flaaffy',dex:180,gen:2},{name:'Ampharos',dex:181,gen:2},
  {name:'Marill',dex:183,gen:2},{name:'Azumarill',dex:184,gen:2},
  {name:'Sudowoodo',dex:185,gen:2},{name:'Aipom',dex:190,gen:2},
  {name:'Wooper',dex:194,gen:2},{name:'Quagsire',dex:195,gen:2},
  {name:'Espeon',dex:196,gen:2},{name:'Umbreon',dex:197,gen:2},
  {name:'Murkrow',dex:198,gen:2},{name:'Misdreavus',dex:200,gen:2},
  {name:'Wobbuffet',dex:202,gen:2},{name:'Girafarig',dex:203,gen:2},
  {name:'Heracross',dex:214,gen:2},{name:'Sneasel',dex:215,gen:2},
  {name:'Teddiursa',dex:216,gen:2},{name:'Ursaring',dex:217,gen:2},
  {name:'Houndour',dex:228,gen:2},{name:'Houndoom',dex:229,gen:2},
  {name:'Kingdra',dex:230,gen:2},{name:'Porygon2',dex:233,gen:2},
  {name:'Stantler',dex:234,gen:2},{name:'Blissey',dex:242,gen:2},
  {name:'Raikou',dex:243,gen:2},{name:'Entei',dex:244,gen:2},{name:'Suicune',dex:245,gen:2},
  {name:'Larvitar',dex:246,gen:2},{name:'Pupitar',dex:247,gen:2},{name:'Tyranitar',dex:248,gen:2},
  {name:'Lugia',dex:249,gen:2},{name:'Ho-Oh',dex:250,gen:2},{name:'Celebi',dex:251,gen:2},
  // Gen 3
  {name:'Treecko',dex:252,gen:3},{name:'Grovyle',dex:253,gen:3},{name:'Sceptile',dex:254,gen:3},
  {name:'Torchic',dex:255,gen:3},{name:'Combusken',dex:256,gen:3},{name:'Blaziken',dex:257,gen:3},
  {name:'Mudkip',dex:258,gen:3},{name:'Marshtomp',dex:259,gen:3},{name:'Swampert',dex:260,gen:3},
  {name:'Lotad',dex:270,gen:3},{name:'Lombre',dex:271,gen:3},{name:'Ludicolo',dex:272,gen:3},
  {name:'Seedot',dex:273,gen:3},{name:'Nuzleaf',dex:274,gen:3},{name:'Shiftry',dex:275,gen:3},
  {name:'Ralts',dex:280,gen:3},{name:'Kirlia',dex:281,gen:3},{name:'Gardevoir',dex:282,gen:3},
  {name:'Shroomish',dex:285,gen:3},{name:'Breloom',dex:286,gen:3},
  {name:'Slakoth',dex:287,gen:3},{name:'Slaking',dex:289,gen:3},
  {name:'Makuhita',dex:296,gen:3},{name:'Hariyama',dex:297,gen:3},
  {name:'Skitty',dex:300,gen:3},{name:'Delcatty',dex:301,gen:3},
  {name:'Meditite',dex:307,gen:3},{name:'Medicham',dex:308,gen:3},
  {name:'Electrike',dex:309,gen:3},{name:'Manectric',dex:310,gen:3},
  {name:'Plusle',dex:311,gen:3},{name:'Minun',dex:312,gen:3},
  {name:'Roselia',dex:315,gen:3},
  {name:'Carvanha',dex:318,gen:3},{name:'Sharpedo',dex:319,gen:3},
  {name:'Numel',dex:322,gen:3},{name:'Camerupt',dex:323,gen:3},
  {name:'Zangoose',dex:335,gen:3},{name:'Seviper',dex:336,gen:3},
  {name:'Absol',dex:359,gen:3},
  {name:'Snorunt',dex:361,gen:3},{name:'Glalie',dex:362,gen:3},
  {name:'Bagon',dex:371,gen:3},{name:'Shelgon',dex:372,gen:3},{name:'Salamence',dex:373,gen:3},
  {name:'Beldum',dex:374,gen:3},{name:'Metang',dex:375,gen:3},{name:'Metagross',dex:376,gen:3},
  {name:'Regirock',dex:377,gen:3},{name:'Regice',dex:378,gen:3},{name:'Registeel',dex:379,gen:3},
  {name:'Latias',dex:380,gen:3},{name:'Latios',dex:381,gen:3},
  {name:'Kyogre',dex:382,gen:3},{name:'Groudon',dex:383,gen:3},{name:'Rayquaza',dex:384,gen:3},
  {name:'Jirachi',dex:385,gen:3},{name:'Deoxys',dex:386,gen:3},
  // Gen 4
  {name:'Turtwig',dex:387,gen:4},{name:'Grotle',dex:388,gen:4},{name:'Torterra',dex:389,gen:4},
  {name:'Chimchar',dex:390,gen:4},{name:'Monferno',dex:391,gen:4},{name:'Infernape',dex:392,gen:4},
  {name:'Piplup',dex:393,gen:4},{name:'Prinplup',dex:394,gen:4},{name:'Empoleon',dex:395,gen:4},
  {name:'Shinx',dex:403,gen:4},{name:'Luxio',dex:404,gen:4},{name:'Luxray',dex:405,gen:4},
  {name:'Roserade',dex:407,gen:4},
  {name:'Lopunny',dex:428,gen:4},{name:'Mismagius',dex:429,gen:4},{name:'Honchkrow',dex:430,gen:4},
  {name:'Glameow',dex:431,gen:4},{name:'Purugly',dex:432,gen:4},
  {name:'Riolu',dex:447,gen:4},{name:'Lucario',dex:448,gen:4},
  {name:'Hippopotas',dex:449,gen:4},{name:'Hippowdon',dex:450,gen:4},
  {name:'Gible',dex:443,gen:4},{name:'Gabite',dex:444,gen:4},{name:'Garchomp',dex:445,gen:4},
  {name:'Munchlax',dex:446,gen:4},
  {name:'Togekiss',dex:468,gen:4},{name:'Leafeon',dex:470,gen:4},{name:'Glaceon',dex:471,gen:4},
  {name:'Gallade',dex:475,gen:4},{name:'Rotom',dex:479,gen:4},
  {name:'Uxie',dex:480,gen:4},{name:'Mesprit',dex:481,gen:4},{name:'Azelf',dex:482,gen:4},
  {name:'Dialga',dex:483,gen:4},{name:'Palkia',dex:484,gen:4},{name:'Heatran',dex:485,gen:4},
  {name:'Regigigas',dex:486,gen:4},{name:'Giratina',dex:487,gen:4},
  {name:'Cresselia',dex:488,gen:4},{name:'Manaphy',dex:490,gen:4},
  {name:'Darkrai',dex:491,gen:4},{name:'Shaymin',dex:492,gen:4},{name:'Arceus',dex:493,gen:4},
  // Gen 5
  {name:'Snivy',dex:495,gen:5},{name:'Servine',dex:496,gen:5},{name:'Serperior',dex:497,gen:5},
  {name:'Tepig',dex:498,gen:5},{name:'Pignite',dex:499,gen:5},{name:'Emboar',dex:500,gen:5},
  {name:'Oshawott',dex:501,gen:5},{name:'Dewott',dex:502,gen:5},{name:'Samurott',dex:503,gen:5},
  {name:'Purrloin',dex:509,gen:5},{name:'Liepard',dex:510,gen:5},
  {name:'Blitzle',dex:522,gen:5},{name:'Zebstrika',dex:523,gen:5},
  {name:'Audino',dex:531,gen:5},
  {name:'Sandile',dex:551,gen:5},{name:'Krokorok',dex:552,gen:5},{name:'Krookodile',dex:553,gen:5},
  {name:'Scraggy',dex:559,gen:5},{name:'Scrafty',dex:560,gen:5},
  {name:'Zorua',dex:570,gen:5},{name:'Zoroark',dex:571,gen:5},
  {name:'Minccino',dex:572,gen:5},{name:'Cinccino',dex:573,gen:5},
  {name:'Gothitelle',dex:576,gen:5},
  {name:'Axew',dex:610,gen:5},{name:'Fraxure',dex:611,gen:5},{name:'Haxorus',dex:612,gen:5},
  {name:'Cubchoo',dex:613,gen:5},{name:'Beartic',dex:614,gen:5},
  {name:'Deino',dex:633,gen:5},{name:'Zweilous',dex:634,gen:5},{name:'Hydreigon',dex:635,gen:5},
  {name:'Cobalion',dex:638,gen:5},{name:'Terrakion',dex:639,gen:5},{name:'Virizion',dex:640,gen:5},
  {name:'Reshiram',dex:643,gen:5},{name:'Zekrom',dex:644,gen:5},{name:'Kyurem',dex:646,gen:5},
  {name:'Keldeo',dex:647,gen:5},{name:'Meloetta',dex:648,gen:5},{name:'Genesect',dex:649,gen:5},
  // Gen 6
  {name:'Chespin',dex:650,gen:6},{name:'Quilladin',dex:651,gen:6},{name:'Chesnaught',dex:652,gen:6},
  {name:'Fennekin',dex:653,gen:6},{name:'Braixen',dex:654,gen:6},{name:'Delphox',dex:655,gen:6},
  {name:'Froakie',dex:656,gen:6},{name:'Frogadier',dex:657,gen:6},{name:'Greninja',dex:658,gen:6},
  {name:'Diggersby',dex:660,gen:6},
  {name:'Sylveon',dex:700,gen:6},{name:'Hawlucha',dex:701,gen:6},
  {name:'Klefki',dex:707,gen:6},
  {name:'Trevenant',dex:709,gen:6},{name:'Pumpkaboo',dex:710,gen:6},{name:'Gourgeist',dex:711,gen:6},
  {name:'Xerneas',dex:716,gen:6},{name:'Yveltal',dex:717,gen:6},{name:'Zygarde',dex:718,gen:6},
  {name:'Diancie',dex:719,gen:6},{name:'Hoopa',dex:720,gen:6},{name:'Volcanion',dex:721,gen:6},
  // Gen 7
  {name:'Rowlet',dex:722,gen:7},{name:'Dartrix',dex:723,gen:7},{name:'Decidueye',dex:724,gen:7},
  {name:'Litten',dex:725,gen:7},{name:'Torracat',dex:726,gen:7},{name:'Incineroar',dex:727,gen:7},
  {name:'Popplio',dex:728,gen:7},{name:'Brionne',dex:729,gen:7},{name:'Primarina',dex:730,gen:7},
  {name:'Lycanroc',dex:745,gen:7},
  {name:'Mimikyu',dex:778,gen:7},
  {name:'Kommo-o',dex:784,gen:7},
  {name:'Tapu Koko',dex:785,gen:7},{name:'Tapu Lele',dex:786,gen:7},{name:'Tapu Bulu',dex:787,gen:7},{name:'Tapu Fini',dex:788,gen:7},
  {name:'Cosmog',dex:789,gen:7},{name:'Solgaleo',dex:791,gen:7},{name:'Lunala',dex:792,gen:7},
  {name:'Necrozma',dex:800,gen:7},{name:'Marshadow',dex:802,gen:7},{name:'Zeraora',dex:807,gen:7},
  // Gen 8
  {name:'Grookey',dex:810,gen:8},{name:'Thwackey',dex:811,gen:8},{name:'Rillaboom',dex:812,gen:8},
  {name:'Scorbunny',dex:813,gen:8},{name:'Raboot',dex:814,gen:8},{name:'Cinderace',dex:815,gen:8},
  {name:'Sobble',dex:816,gen:8},{name:'Drizzile',dex:817,gen:8},{name:'Inteleon',dex:818,gen:8},
  {name:'Yamper',dex:835,gen:8},{name:'Boltund',dex:836,gen:8},
  {name:'Hatterene',dex:858,gen:8},{name:'Obstagoon',dex:862,gen:8},
  {name:'Morpeko',dex:877,gen:8},
  {name:'Zacian',dex:888,gen:8},{name:'Zamazenta',dex:889,gen:8},{name:'Eternatus',dex:890,gen:8},
  {name:'Urshifu',dex:892,gen:8},
  {name:'Regieleki',dex:894,gen:8},{name:'Regidrago',dex:895,gen:8},
  {name:'Calyrex',dex:898,gen:8},
  // Gen 9
  {name:'Sprigatito',dex:906,gen:9},{name:'Floragato',dex:907,gen:9},{name:'Meowscarada',dex:908,gen:9},
  {name:'Fuecoco',dex:909,gen:9},{name:'Crocalor',dex:910,gen:9},{name:'Skeledirge',dex:911,gen:9},
  {name:'Quaxly',dex:912,gen:9},{name:'Quaxwell',dex:913,gen:9},{name:'Quaquaval',dex:914,gen:9},
  {name:'Pawmot',dex:923,gen:9},
  {name:'Garganacl',dex:962,gen:9},
  {name:'Armarouge',dex:936,gen:9},{name:'Ceruledge',dex:937,gen:9},
  {name:'Annihilape',dex:979,gen:9},
  {name:'Gholdengo',dex:1000,gen:9},
  {name:'Iron Valiant',dex:1006,gen:9},{name:'Roaring Moon',dex:1005,gen:9},
  {name:'Koraidon',dex:1007,gen:9},{name:'Miraidon',dex:1008,gen:9},
  {name:'Ogerpon',dex:1017,gen:9},{name:'Terapagos',dex:1024,gen:9},
];

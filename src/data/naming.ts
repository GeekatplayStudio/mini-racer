/**
 * The catalog is written against real manufacturers and products so the data
 * stays checkable. What the player sees are sound-alike names: no real brand,
 * car or circuit name, and no logo, appears in the game.
 */

/** Set true only for private builds; shows the reference names instead. */
export const SHOW_REFERENCE_NAMES = false;

/** Whole-phrase brand names first, then product and model tokens. Order matters: longer first. */
const RULES: readonly (readonly [string, string])[] = [
  // Car makers.
  ['Porsche Motorsport', 'Porscha Motorsport'], ['Porsche', 'Porscha'],
  ['BMW M Motorsport', 'BMV N Motorsport'], ['BMW', 'BMV'],
  ['Mercedes-AMG', 'Mercado-AMC'], ['Mercedes', 'Mercado'], ['AMG', 'AMC'],
  ['Ferrari Competizioni GT', 'Ferrano Competizioni GT'], ['Ferrari', 'Ferrano'],
  ['Audi Sport', 'Auda Sport'], ['Audi', 'Auda'],
  ['Lamborghini Squadra Corse', 'Lamborgotti Squadra Corse'], ['Lamborghini', 'Lamborgotti'],
  ['McLaren Motorsport', 'McLauren Motorsport'], ['McLaren', 'McLauren'],
  ['Aston Martin Racing', 'Astin Marten Racing'], ['Aston Martin', 'Astin Marten'],
  // Car and engine model names.
  ['911 GT3 R (992)', '919 GT3 R (929)'], ['992 GT3 R', '929 GT3 R'], ['991.2 GT3 R', '919.2 GT3 R'],
  ['M4 GT3', 'N4 GT3'], ['M4 GT4', 'N4 GT4'], ['296 GT3', '269 GT3'], ['488 GT3', '484 GT3'],
  ['R8 LMS', 'R9 LMS'], ['Huracán', 'Hurricano'], ['Super Trofeo', 'Super Trofea'],
  ['720S', '702S'], ['650S', '605S'], ['Vantage', 'Vintage'],
  ['S58', 'S85'], ['P58', 'P85'], ['M178', 'M187'], ['M159', 'M195'], ['M177', 'M171'],
  ['F154', 'F145'], ['F163CE', 'F136CE'], ['M838T', 'M883T'], ['M840T', 'M804T'], ['FSI', 'FSE'],
  // Parts makers.
  ['Bosch Motorsport', 'Bosh Motorsport'], ['Bosch', 'Bosh'],
  ['Öhlins', 'Ohlund'], ['Bilstein', 'Bilstone'], ['Penske Racing Shocks', 'Penska Racing Shocks'],
  ['Multimatic', 'Multimatix'], ['ZF Sachs', 'ZT Saks'], ['JRZ', 'JRX'], ['KW', 'KV'],
  ['Eibach', 'Eibech'], ['H&R', 'H&N'], ['Hyperco', 'Hyperko'], ['Hotchkis', 'Hotchkin'],
  ['Brembo', 'Brembi'], ['AP Racing', 'AB Racing'], ['Alcon', 'Alcan'], ['Performance Friction', 'Precision Friction'],
  ['EBC Brakes Racing', 'EBD Brakes Racing'], ['Pagid Racing', 'Pagod Racing'], ['Ferodo Racing', 'Feroda Racing'],
  ['Endless', 'Endles'], ['CL Brakes', 'CR Brakes'], ['Wilwood', 'Willwood'], ['Continental Teves', 'Continento Tevez'],
  ['Tilton', 'Tiltan'], ['OBP Motorsport', 'OPB Motorsport'], ['Goodridge', 'Goodrige'], ['HEL Performance', 'HAL Performance'],
  ['Stäubli', 'Staubler'],
  ['BBS Motorsport', 'BBZ Motorsport'], ['OZ Racing', 'OS Racing'], ['RAYS', 'RAYZ'], ['Forgeline', 'Forgelane'],
  ['ATS Motorsport', 'ATZ Motorsport'], ['Braid', 'Brade'], ['Enkei', 'Enkai'], ['Titan7', 'Titan8'], ['TWS', 'TWZ'],
  ['Pirelli', 'Pirello'], ['Michelin', 'Michelan'], ['Goodyear', 'Goodyeer'], ['Hankook', 'Hankuk'],
  ['Yokohama', 'Yokohoma'], ['Toyo', 'Toya'], ['Avon', 'Avan'], ['Hoosier', 'Hoosler'],
  ['APR Performance', 'APX Performance'], ['Verus Engineering', 'Veris Engineering'], ['Voltex', 'Voltec'],
  ['Trackspec Motorsports', 'Trakspec Motorsports'],
  ['Recaro', 'Rekaro'], ['Sparco', 'Sparko'], ['OMP', 'OMB'], ['Sabelt', 'Sabelo'], ['Racetech', 'Racetek'],
  ['Schroth', 'Shroth'], ['Willans', 'Willens'], ['TRS', 'TRZ'], ['Lifeline', 'Lifelane'], ['SPA Design', 'SPE Design'],
  ['Krontec', 'Krontek'], ['Custom Cages', 'Kustom Cages'], ['Heigo', 'Heiko'], ['Wiechers Sport', 'Wiechert Sport'],
  ['Longacre', 'Longacer'], ['Lazer Lamps', 'Lazor Lamps'], ['Baja Designs', 'Baha Designs'],
  ['FAST Fresh Air Systems', 'FASST Fresh Air Systems'], ['CoolShirt Systems', 'KoolShirt Systems'], ['Chillout Motorsports', 'Chillin Motorsports'],
  ['AiM', 'AiN'], ['Racelogic', 'Racelogik'], ['MoTeC', 'MoTek'], ['Cosworth', 'Cozworth'], ['Ecumaster', 'Ecumeister'],
  ['DC Electronics', 'DG Electronics'], ['Varley', 'Varly'], ['Braille', 'Brail'], ['Super B', 'Super D'],
  ['bf1systems', 'bf2systems'], ['Izze Racing', 'Izzy Racing'], ['Texys', 'Texis'],
  ['Kenwood', 'Kenwud'], ['Stilo', 'Stila'], ['Sampson Racing Communications', 'Samson Racing Communications'], ['Zeronoise', 'Zeronoize'], ['MRTC', 'MRTK'],
  ['ITG', 'ITC'], ['BMC', 'BNC'], ['Pipercross', 'Pipercros'], ['Milltek Sport', 'Milteck Sport'], ['Supersprint', 'Supasprint'],
  ['Capristo', 'Capristi'], ['Akrapovič', 'Akrapovik'], ['Good Fabrications', 'Goode Fabrications'],
  ['Mishimoto', 'Mishimota'], ['Setrab', 'Setrap'], ['PWR', 'PWX'], ['CSF Radiators', 'CSV Radiators'], ['Wagner Tuning', 'Wagnar Tuning'],
  ['Mocal', 'Mokal'], ['Laminova', 'Laminovo'],
  ['Fuel Safe', 'Fuel Save'], ['Premier Fuel Systems', 'Premiere Fuel Systems'], ['ATL', 'ATK'],
  ['Injector Dynamics', 'Injector Dynamix'], ['Walbro', 'Walbra'], ['TI Automotive', 'TY Automotive'], ['Radium Engineering', 'Radian Engineering'],
  ['NGK', 'NKG'], ['AEM', 'AEN'], ['M&W Ignitions', 'N&W Ignitions'],
  ['Garrett', 'Garret'], ['BorgWarner', 'BergWarner'], ['Pure Turbos', 'Pura Turbos'],
  ['Wiseco', 'Wisco'], ['JE Pistons', 'JA Pistons'], ['CP-Carrillo', 'CP-Carillo'], ['Mahle Motorsport', 'Mahla Motorsport'],
  ['Pankl Racing Systems', 'Pankel Racing Systems'], ['K1 Technologies', 'K2 Technologies'], ['Arrow Precision', 'Arow Precision'],
  ['Callies', 'Callis'], ['Schrick', 'Shrick'], ['Cat Cams', 'Kat Cams'], ['Supertech', 'Supertek'],
  ['Pace Products', 'Pase Products'], ['Dailey Engineering', 'Daily Engineering'], ['ARE Dry Sump Systems', 'ARA Dry Sump Systems'], ['Auto Verdi', 'Auto Verde'],
  ['Jenvey', 'Jenvy'], ['AT Power', 'AD Power'], ['Clutch Masters', 'Clutch Meisters'], ['Fidanza', 'Fidenza'],
  ['Sadev', 'Sadef'], ['Holinger', 'Hollinger'], ['Hewland', 'Hewlend'], ['Xtrac', 'Xtrak'], ['Ricardo', 'Ricarda'],
  ['Samsonas', 'Samsonis'], ['Drenth', 'Drent'], ['Geartronics', 'Geartronix'], ['Shiftec', 'Shiftek'], ['MEGA-Line', 'MEGA-Lane'],
  ['Quaife', 'Quaif'], ['Kaaz', 'Kaas'], ['OS Giken', 'OS Gikan'], ['Drexler', 'Drexla'],
  ['Driveshaft Shop', 'Driveshaft Store'], ['GKN Motorsport', 'GKM Motorsport'],
  ['Hardrace', 'Hardrase'], ['SPL Parts', 'SPR Parts'], ['Elephant Racing', 'Elefant Racing'], ['Tarett Engineering', 'Tarret Engineering'],
  ['SKF Racing', 'SKV Racing'], ['Woodward', 'Woodword'], ['KYB', 'KYD'],
  ['MOMO', 'MOMA'], ['XAP Technology', 'XAB Technology'], ['Fanatec', 'Fanatek'],
  ['Plastics 4 Performance', 'Plastics for Performance'], ['ACW Motorsport Plastics', 'ACV Motorsport Plastics'],
  // Product names and model codes.
  ['TTX40', 'TTR40'], ['DSSV', 'DSXV'], ['MDS 2-way', 'MDX 2-way'], ['RS Pro 3', 'RX Pro 3'], ['8760', '8670'],
  ['P Zero', 'P Nero'], ['Pilot Sport', 'Pilote Sport'], ['Eagle F1 SuperSport', 'Eagle R1 SuperSport'], ['Ventus Race', 'Ventis Race'],
  ['ADVAN', 'ADVEN'], ['Proxes', 'Proxis'], ['GTC-300', 'GTX-300'], ['GTC-500', 'GTX-500'], ['GT-1000', 'GTX-1000'],
  ['Radi-CAL', 'Radi-KAL'], ['Superlite', 'Superlight'], ['Bluestuff', 'Bluestaff'], ['DS3.12', 'DS3.21'],
  ['RST 1', 'RSX 1'], ['RSL 1', 'RSE 1'], ['ME20', 'ME22'], ['RC6E', 'RC8E'],
  ['MS 6.4', 'MS 6.5'], ['MS 7.4', 'MS 7.5'], ['EMU Pro', 'EMO Pro'], ['M142', 'M124'], ['Antares', 'Antaris'],
  ['CCW Mk2', 'CCV Mk2'], ['P 1300 GT', 'P 1350 GT'], ['Pro ADV QRT', 'Pro ADX'], ['HTE-R', 'HTX-R'], ['HRC-R Air', 'HRX-R Air'],
  ['GT-PAD', 'GT-PED'], ['RT9119HR', 'RT9191'], ['Profi II-6', 'Profi III-6'], ['Zero 360', 'Zero 380'], ['Zero 2000', 'Zero 2100'],
  ['VBOX', 'VBOKS'], ['MXG', 'MXQ'], ['MXS', 'MXZ'], ['C187', 'C178'], ['DDU 11', 'DDU 12'], ['Pi Omega', 'Pi Sigma'],
  ['Red Top', 'Red Cap'], ['B2015', 'B2051'], ['Andrena', 'Andrea'], ['Maxogen', 'Maxigen'], ['CRF', 'CRX'],
  ['SCL924', 'SCL942'], ['TMT-200', 'TNT-200'], ['ATB', 'ATD'], ['Super Q', 'Super K'], ['Super Lock', 'Super Block'],
  ['Volk Racing', 'Folk Racing'], ['GS1R', 'GS2R'], ['Fullrace', 'Fulrace'], ['RS05RR', 'RS06RR'], ['T-R10', 'T-R12'],
  ['ERS', 'ERZ'], ['OT-II', 'OT-III'], ['CP8153', 'CP8351'], ['CP5500', 'CP5050'], ['CP3985', 'CP3895'], ['LL-30', 'LL-33'],
  ['UCW', 'UCV'], ['Type 12', 'Type 21'], ['E-Shift', 'E-Shyft'], ['AGS', 'AGX'], ['MK60', 'MK66'],
  ['Saver Cell', 'Safer Cell'], ['Enduro Cell', 'Endura Cell'], ['Mod. 30', 'Mod. 33'], ['R 383', 'R 838'], ['320 Alu S', '302 Alu S'],
  ['First 3/2', 'Prima 3/2'], ['Silverstone', 'Silverston'], ['Magnum', 'Magnus'], ['Platinum Collection', 'Platina Collection'],
  ['CAS-M', 'CAX-M'], ['LP6 Pro', 'LP8 Pro'], ['ST4 Evolution', 'ST5 Evolution'], ['Triple-R 750', 'Triple-R 705'],
  ['Cypher Pro', 'Cipher Pro'], ['Club System', 'Club Kit'], ['FSR', 'FSX'], ['Pro-H', 'Pro-K'],
  ['EV14', 'EV15'], ['ID1050-XDS', 'ID1005-XDS'], ['ID1700-XDS', 'ID1707-XDS'], ['HDEV 5.2', 'HDEV 5.5'],
  ['GSS342', 'GSS324'], ['BKS1000', 'BKS1100'], ['FP 200', 'FP 220'], ['IGN-1A', 'IGN-2A'], ['P65-T', 'P56-T'],
  ['GTX2867R', 'GTX2876R'], ['EFR 6758', 'EFR 6785'], ['G25-660', 'G25-606'], ['ProLine', 'ProLane'],
  ['PMU16', 'PMU18'], ['PDM32', 'PDM34'], ['PDM30', 'PDM33'], ['IPS32', 'IPS34'], ['PowerBox PBX 190', 'PowerBox PBX 109'],
  ['NX-1300', 'NX-1330'], ['Fearless', 'Fearles'], ['Competition 3A', 'Competition 3B'],
];

const table = new Map(RULES.map(([from, to]) => [from, to]));
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escape = escapeRegExp;
/** One pass, longest name first, whole words only: a replacement is never replaced again. */
const pattern = new RegExp(
  `(?<![A-Za-z0-9])(?:${[...table.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![A-Za-z0-9])`,
  'g',
);
const cache = new Map<string, string>();

/** Turns a reference name into the name shown in the game. */
export function alias(text: string): string {
  if (SHOW_REFERENCE_NAMES) return text;
  let out = cache.get(text);
  if (out === undefined) {
    out = text.replace(pattern, (match) => table.get(match) ?? match);
    cache.set(text, out);
  }
  return out;
}

/** Real names that must never reach the screen; used by the tests. */
export const RESERVED_NAMES: readonly string[] = RULES.map(([from]) => from);

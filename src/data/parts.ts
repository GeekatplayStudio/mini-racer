import type { BodyStyle } from './cars';

/**
 * GT3 parts catalog. Names and manufacturers are real product lines; prices
 * are estimates in US dollars for a new part (or a car set where noted) and
 * have not been checked against current price lists.
 */

export type SlotId =
  | 'chassis' | 'windows' | 'seat' | 'harness' | 'fire' | 'airjacks'
  | 'splitter' | 'wing' | 'diffuser'
  | 'engine' | 'intake' | 'exhaust' | 'ecu' | 'cooling' | 'fuelcell'
  | 'clutch' | 'gearbox' | 'shift' | 'diff' | 'driveshafts'
  | 'dampers' | 'springs' | 'steering'
  | 'discs' | 'pads' | 'calipers' | 'abs' | 'pedals'
  | 'wheels' | 'tyres'
  | 'logger' | 'loom' | 'battery'
  | 'cage' | 'mirrors' | 'lights' | 'cooldriver' | 'canards' | 'louvers'
  | 'pistons' | 'rods' | 'crank' | 'valvetrain' | 'oil' | 'throttle' | 'injectors' | 'fuelpump' | 'ignition'
  | 'turbo' | 'intercooler' | 'oilcooler' | 'flywheel' | 'finaldrive'
  | 'arb' | 'arms' | 'uprights' | 'rack' | 'lines' | 'ducts' | 'nuts' | 'pdm' | 'sensors' | 'radio';

export interface SlotDef {
  id: SlotId;
  label: string;
  group: string;
  /** Hidden under the bodywork, so the garage lifts the shell to show it. */
  internal: boolean;
  /** Only fitted when the engine is turbocharged. */
  turboOnly?: boolean;
}

const BASE_SLOTS: readonly SlotDef[] = [
  { id: 'chassis', label: 'Chassis', group: 'Chassis & safety', internal: false },
  { id: 'windows', label: 'Windows', group: 'Chassis & safety', internal: false },
  { id: 'seat', label: 'Seat', group: 'Chassis & safety', internal: true },
  { id: 'harness', label: 'Harness', group: 'Chassis & safety', internal: true },
  { id: 'fire', label: 'Fire system', group: 'Chassis & safety', internal: true },
  { id: 'airjacks', label: 'Air jacks', group: 'Chassis & safety', internal: true },
  { id: 'splitter', label: 'Front splitter', group: 'Aero', internal: false },
  { id: 'wing', label: 'Rear wing', group: 'Aero', internal: false },
  { id: 'diffuser', label: 'Diffuser', group: 'Aero', internal: false },
  { id: 'engine', label: 'Engine', group: 'Engine & fuel', internal: true },
  { id: 'intake', label: 'Intake', group: 'Engine & fuel', internal: true },
  { id: 'exhaust', label: 'Exhaust', group: 'Engine & fuel', internal: true },
  { id: 'ecu', label: 'Engine management', group: 'Engine & fuel', internal: true },
  { id: 'cooling', label: 'Cooling', group: 'Engine & fuel', internal: true },
  { id: 'fuelcell', label: 'Fuel cell', group: 'Engine & fuel', internal: true },
  { id: 'clutch', label: 'Clutch', group: 'Drivetrain', internal: true },
  { id: 'gearbox', label: 'Gearbox', group: 'Drivetrain', internal: true },
  { id: 'shift', label: 'Shift system', group: 'Drivetrain', internal: true },
  { id: 'diff', label: 'Differential', group: 'Drivetrain', internal: true },
  { id: 'driveshafts', label: 'Driveshafts', group: 'Drivetrain', internal: true },
  { id: 'dampers', label: 'Dampers', group: 'Suspension & steering', internal: true },
  { id: 'springs', label: 'Springs', group: 'Suspension & steering', internal: true },
  { id: 'steering', label: 'Steering wheel', group: 'Suspension & steering', internal: true },
  { id: 'discs', label: 'Brake discs', group: 'Brakes', internal: false },
  { id: 'pads', label: 'Brake pads', group: 'Brakes', internal: false },
  { id: 'calipers', label: 'Calipers', group: 'Brakes', internal: false },
  { id: 'abs', label: 'ABS', group: 'Brakes', internal: true },
  { id: 'pedals', label: 'Pedal box', group: 'Brakes', internal: true },
  { id: 'wheels', label: 'Wheels', group: 'Wheels & tyres', internal: false },
  { id: 'tyres', label: 'Tyres', group: 'Wheels & tyres', internal: false },
  { id: 'logger', label: 'Data & dash', group: 'Electronics', internal: true },
  { id: 'loom', label: 'Wiring loom', group: 'Electronics', internal: true },
  { id: 'battery', label: 'Battery', group: 'Electronics', internal: true },
];

export type Layout = 'front' | 'mid' | 'rear';

/** What a part does to the car. Only the fields relevant to its slot are set. */
export interface PartFx {
  /** Fractional engine power change, e.g. 0.02 is +2%. */
  power?: number;
  /** Added driveline efficiency. */
  eff?: number;
  /** Gearbox: base shift time, s. Shift system: multiplier on it. */
  shift?: number;
  /** Fractional mechanical grip change. */
  grip?: number;
  /** Fractional tyre wear change (negative is kinder). */
  wear?: number;
  /** Fractional brake force change. */
  brake?: number;
  /** Downforce and drag area added, m^2, and the share of that downforce on the front axle. */
  cl?: number;
  cd?: number;
  front?: number;
  /** Traction control and ABS intervention, 0..1. */
  tc?: number;
  abs?: number;
  /** Cockpit comfort, slows driver fatigue. */
  comfort?: number;
  /** Safety rating contribution. */
  safety?: number;
  /** Fuel capacity, kg. */
  fuelKg?: number;
  /** Tyre grip coefficient and wear per metre at full use. */
  mu?: number;
  tyreWear?: number;
  /** Engine: peak power, redline and aspiration. */
  kw?: number;
  redline?: number;
  turbo?: boolean;
  /** Gearbox ratio steps, first to top, relative to top gear. */
  gears?: readonly number[];
  /** Seconds saved per pit stop (air jacks, wheel nuts). */
  pit?: number;
  /** Engine speed the part adds to (or takes from) the safe rev ceiling, rpm. */
  revs?: number;
  /** Engine power the fuel part can feed, kW. */
  flow?: number;
  /** Ignition advance gained before knock, degrees. */
  knock?: number;
  /** Highest boost a turbo holds efficiently, bar. */
  boostMax?: number;
  /** Final drive ratio relative to standard; above 1 is shorter gearing. */
  ratio?: number;
}

export interface PartLook {
  /** Main and secondary colours. */
  c?: number;
  c2?: number;
  /** Shape variant; meaning depends on the slot. */
  style?: number;
}

export interface ChassisData {
  wheelbase: number;
  frontWeight: number;
  length: number;
  width: number;
  layout: Layout;
  engineFamily: string;
  /** Homologated bare-body drag and lift areas before aero parts. */
  cdA: number;
  clA: number;
  /** Speed at the redline in top gear, km/h. */
  topSpeedKmh: number;
  body: BodyStyle;
}

export interface Part {
  id: string;
  slot: SlotId;
  name: string;
  maker: string;
  /** New price, USD (estimate). */
  price: number;
  /** kg, whole car set where the part comes in sets. */
  mass: number;
  /** 1 (club level) to 4 (factory GT3 level). */
  tier: number;
  /** Chance of surviving a race distance when new. */
  rel: number;
  fx: PartFx;
  look: PartLook;
  note: string;
  /** Engine: the chassis families it bolts into. Gearbox: the layouts it suits. */
  fits?: readonly string[];
  chassis?: ChassisData;
}

const parts: Part[] = [];

function add(
  slot: SlotId, id: string, name: string, maker: string, price: number, mass: number, tier: number, rel: number,
  fx: PartFx, look: PartLook, note: string, extra: Partial<Part> = {},
): void {
  parts.push({ id, slot, name, maker, price, mass, tier, rel, fx, look, note, ...extra });
}

// --- Chassis: homologated rolling shells with cage, body panels and suspension arms.
const shell = (
  id: string, name: string, maker: string, price: number, mass: number, c: ChassisData,
): void => add('chassis', id, name, maker, price, mass, 4, 0.995, { safety: 3 }, {}, `${c.layout}-engined shell with FIA cage`, { chassis: c });

shell('ch-porsche-992', '911 GT3 R (992) shell', 'Porsche Motorsport', 128000, 555, {
  wheelbase: 2.507, frontWeight: 0.41, length: 4.62, width: 2.04, layout: 'rear', engineFamily: 'porsche', cdA: 0.8, clA: 0.35, topSpeedKmh: 282,
  body: { cabinStart: 0.3, cabinEnd: 0.72, noseHeight: 0.5, hoodHeight: 0.72, roofHeight: 1.26, deckHeight: 0.86, roofWidth: 0.66, rearFlare: 0.07, wingHeight: 1.3, fastback: true },
});
shell('ch-bmw-m4', 'M4 GT3 shell', 'BMW M Motorsport', 118000, 610, {
  wheelbase: 2.917, frontWeight: 0.5, length: 5.02, width: 2.04, layout: 'front', engineFamily: 'bmw', cdA: 0.83, clA: 0.35, topSpeedKmh: 286,
  body: { cabinStart: 0.4, cabinEnd: 0.8, noseHeight: 0.56, hoodHeight: 0.84, roofHeight: 1.3, deckHeight: 0.95, roofWidth: 0.68, rearFlare: 0.03, wingHeight: 1.36, fastback: false },
});
shell('ch-amg-gt3', 'AMG GT3 Evo shell', 'Mercedes-AMG', 122000, 588, {
  wheelbase: 2.665, frontWeight: 0.49, length: 4.75, width: 2.05, layout: 'front', engineFamily: 'mercedes', cdA: 0.81, clA: 0.35, topSpeedKmh: 280,
  body: { cabinStart: 0.46, cabinEnd: 0.84, noseHeight: 0.52, hoodHeight: 0.8, roofHeight: 1.24, deckHeight: 0.9, roofWidth: 0.64, rearFlare: 0.04, wingHeight: 1.3, fastback: true },
});
shell('ch-ferrari-296', '296 GT3 shell', 'Ferrari Competizioni GT', 145000, 560, {
  wheelbase: 2.66, frontWeight: 0.42, length: 4.57, width: 2.05, layout: 'mid', engineFamily: 'ferrari', cdA: 0.77, clA: 0.35, topSpeedKmh: 288,
  body: { cabinStart: 0.26, cabinEnd: 0.62, noseHeight: 0.42, hoodHeight: 0.62, roofHeight: 1.16, deckHeight: 0.84, roofWidth: 0.62, rearFlare: 0.06, wingHeight: 1.22, fastback: false },
});
shell('ch-audi-r8', 'R8 LMS GT3 Evo II shell', 'Audi Sport', 112000, 542, {
  wheelbase: 2.65, frontWeight: 0.43, length: 4.58, width: 2.0, layout: 'mid', engineFamily: 'vag', cdA: 0.79, clA: 0.35, topSpeedKmh: 284,
  body: { cabinStart: 0.27, cabinEnd: 0.63, noseHeight: 0.46, hoodHeight: 0.66, roofHeight: 1.17, deckHeight: 0.88, roofWidth: 0.64, rearFlare: 0.04, wingHeight: 1.24, fastback: false },
});
shell('ch-lambo-huracan', 'Huracán GT3 EVO2 shell', 'Lamborghini Squadra Corse', 125000, 538, {
  wheelbase: 2.645, frontWeight: 0.42, length: 4.55, width: 2.05, layout: 'mid', engineFamily: 'vag', cdA: 0.78, clA: 0.35, topSpeedKmh: 285,
  body: { cabinStart: 0.25, cabinEnd: 0.6, noseHeight: 0.4, hoodHeight: 0.58, roofHeight: 1.14, deckHeight: 0.86, roofWidth: 0.6, rearFlare: 0.05, wingHeight: 1.2, fastback: false },
});
shell('ch-mclaren-720s', '720S GT3 Evo shell', 'McLaren Motorsport', 132000, 548, {
  wheelbase: 2.67, frontWeight: 0.42, length: 4.66, width: 2.04, layout: 'mid', engineFamily: 'mclaren', cdA: 0.77, clA: 0.35, topSpeedKmh: 287,
  body: { cabinStart: 0.27, cabinEnd: 0.61, noseHeight: 0.42, hoodHeight: 0.6, roofHeight: 1.16, deckHeight: 0.8, roofWidth: 0.58, rearFlare: 0.06, wingHeight: 1.2, fastback: true },
});
shell('ch-aston-vantage', 'Vantage AMR GT3 shell', 'Aston Martin Racing', 115000, 572, {
  wheelbase: 2.704, frontWeight: 0.49, length: 4.6, width: 2.04, layout: 'front', engineFamily: 'aston', cdA: 0.81, clA: 0.35, topSpeedKmh: 281,
  body: { cabinStart: 0.42, cabinEnd: 0.8, noseHeight: 0.52, hoodHeight: 0.78, roofHeight: 1.25, deckHeight: 0.92, roofWidth: 0.64, rearFlare: 0.05, wingHeight: 1.3, fastback: true },
});

// --- Engines. look.style: 0 flat-six, 1 inline-six, 2 V8, 3 V6, 4 V10.
const engine = (
  id: string, name: string, maker: string, price: number, mass: number, tier: number, rel: number,
  kw: number, redline: number, turbo: boolean, style: number, family: string, note: string,
): void => add('engine', id, name, maker, price, mass, tier, rel, { kw, redline, turbo }, { style, c: turbo ? 0x8a8f9c : 0xb0b4c0 }, note, { fits: [family] });

engine('en-porsche-40', '4.0L flat-six (991.2 GT3 R)', 'Porsche Motorsport', 95000, 131, 2, 0.985, 368, 9000, false, 0, 'porsche', '500 hp, naturally aspirated');
engine('en-porsche-42', '4.2L flat-six (992 GT3 R)', 'Porsche Motorsport', 135000, 135, 4, 0.98, 415, 9250, false, 0, 'porsche', '565 hp, naturally aspirated');
engine('en-bmw-s58', 'S58 3.0L twin-turbo I6 (M4 GT4)', 'BMW M Motorsport', 60000, 120, 2, 0.985, 405, 7200, true, 1, 'bmw', '550 hp, twin-turbo');
engine('en-bmw-p58', 'P58 3.0L twin-turbo I6 (M4 GT3)', 'BMW M Motorsport', 115000, 124, 4, 0.975, 434, 7000, true, 1, 'bmw', '590 hp, twin-turbo');
engine('en-amg-m178', 'M178 4.0L V8 biturbo (AMG GT4)', 'Mercedes-AMG', 58000, 131, 2, 0.985, 375, 7000, true, 2, 'mercedes', '510 hp, biturbo');
engine('en-amg-m159', 'M159 6.2L V8 (AMG GT3)', 'Mercedes-AMG', 105000, 151, 3, 0.99, 405, 7500, false, 2, 'mercedes', '550 hp, naturally aspirated');
engine('en-ferrari-f154', 'F154 3.9L V8 twin-turbo (488 GT3)', 'Ferrari', 85000, 118, 3, 0.98, 405, 7000, true, 2, 'ferrari', '550 hp, twin-turbo');
engine('en-ferrari-f163', 'F163CE 3.0L V6 twin-turbo (296 GT3)', 'Ferrari', 140000, 100, 4, 0.975, 441, 8000, true, 3, 'ferrari', '600 hp, 120-degree V6');
engine('en-vag-gt4', '5.2L FSI V10 (R8 LMS GT4)', 'Audi Sport', 55000, 157, 1, 0.99, 364, 8250, false, 4, 'vag', '495 hp, naturally aspirated');
engine('en-vag-gt3', '5.2L FSI V10 (R8 LMS GT3)', 'Audi Sport', 110000, 153, 4, 0.985, 430, 8500, false, 4, 'vag', '585 hp, naturally aspirated');
engine('en-vag-st', '5.2L V10 (Huracán Super Trofeo EVO2)', 'Lamborghini Squadra Corse', 125000, 155, 4, 0.965, 448, 8500, false, 4, 'vag', '610 hp, short service life');
engine('en-mclaren-m838', 'M838T 3.8L V8 twin-turbo (650S GT3)', 'McLaren / Ricardo', 70000, 121, 2, 0.98, 368, 7500, true, 2, 'mclaren', '500 hp, twin-turbo');
engine('en-mclaren-m840', 'M840T 4.0L V8 twin-turbo (720S GT3)', 'McLaren / Ricardo', 125000, 117, 4, 0.975, 425, 8000, true, 2, 'mclaren', '580 hp, twin-turbo');
engine('en-aston-gt4', 'M177 4.0L V8 twin-turbo (Vantage GT4)', 'Aston Martin Racing / AMG', 52000, 130, 1, 0.985, 350, 7000, true, 2, 'aston', '476 hp, twin-turbo');
engine('en-aston-gt3', 'M177 4.0L V8 twin-turbo (Vantage GT3)', 'Aston Martin Racing / AMG', 105000, 126, 3, 0.98, 400, 7200, true, 2, 'aston', '545 hp, twin-turbo');

// --- Intake.
add('intake', 'in-stock', 'Homologated airbox', 'OEM', 900, 5.2, 1, 0.999, {}, { c: 0x2a2d38 }, 'Plastic airbox with paper filter');
add('intake', 'in-pipercross', 'Race foam filter kit', 'Pipercross', 1450, 4.6, 2, 0.998, { power: 0.006 }, { c: 0x3a66c8 }, 'Multi-layer foam filter');
add('intake', 'in-itg', 'Maxogen carbon airbox', 'ITG', 3200, 3.4, 3, 0.998, { power: 0.012 }, { c: 0x1c1d24, c2: 0xd8232a }, 'Carbon airbox, tri-foam filter');
add('intake', 'in-bmc', 'CRF carbon racing airbox', 'BMC', 4600, 3.0, 4, 0.997, { power: 0.017 }, { c: 0x15161b, c2: 0xd8232a }, 'Carbon dynamic airbox');

// --- Exhaust.
add('exhaust', 'ex-steel', 'Stainless race system', 'Milltek Sport', 3800, 24, 1, 0.998, {}, { c: 0x9aa0ac }, 'Stainless steel, silenced');
add('exhaust', 'ex-supersprint', 'Race stainless manifold-back', 'Supersprint', 5400, 21, 2, 0.997, { power: 0.006 }, { c: 0xb4bac6 }, 'Tuned-length stainless');
add('exhaust', 'ex-capristo', 'Titanium race exhaust', 'Capristo', 8900, 14, 3, 0.996, { power: 0.011 }, { c: 0xc8b48a }, 'Titanium, open');
add('exhaust', 'ex-akrapovic', 'Evolution titanium system', 'Akrapovič', 11800, 12.5, 4, 0.996, { power: 0.015 }, { c: 0xd0a868 }, 'Titanium with cast collectors');
add('exhaust', 'ex-inconel', 'Inconel 625 race headers', 'Good Fabrications', 16500, 10.5, 4, 0.993, { power: 0.019 }, { c: 0xa89a8a }, 'Thin-wall Inconel, lightest');

// --- Engine management. Traction control quality comes from here.
add('ecu', 'ecu-ecumaster', 'EMU Pro 16', 'Ecumaster', 3300, 0.9, 1, 0.99, { tc: 0.55 }, { c: 0x2a6fd6 }, 'Basic traction control');
add('ecu', 'ecu-motec', 'M142 direct-injection ECU', 'MoTeC', 6900, 0.9, 2, 0.993, { power: 0.006, tc: 0.72 }, { c: 0xe0b020 }, 'GT traction control package');
add('ecu', 'ecu-cosworth', 'Antares 8 ECU', 'Cosworth', 9800, 1.0, 3, 0.994, { power: 0.01, tc: 0.82 }, { c: 0x22242c, c2: 0xd8232a }, 'Twelve-stage traction control');
add('ecu', 'ecu-bosch64', 'Motorsport MS 6.4', 'Bosch Motorsport', 11500, 0.9, 3, 0.996, { power: 0.012, tc: 0.88 }, { c: 0x8a8f9c }, 'GT3 standard unit');
add('ecu', 'ecu-bosch74', 'Motorsport MS 7.4', 'Bosch Motorsport', 15800, 0.9, 4, 0.996, { power: 0.016, tc: 0.94 }, { c: 0x6a6f7c, c2: 0xd8232a }, 'Latest generation, finest control');

// --- Cooling.
add('cooling', 'co-stock', 'Aluminium radiator', 'OEM', 1900, 16, 1, 0.975, { power: -0.006 }, { c: 0x8a8f9c }, 'Road-derived core');
add('cooling', 'co-mishimoto', 'Performance aluminium radiator', 'Mishimoto', 2600, 14.5, 2, 0.985, {}, { c: 0xb4bac6 }, 'Dual-pass aluminium');
add('cooling', 'co-setrab', 'ProLine radiator and oil cooler', 'Setrab', 4800, 13.5, 3, 0.993, { power: 0.004 }, { c: 0x1c1d24 }, 'Adds dedicated oil cooler');
add('cooling', 'co-pwr', 'Motorsport radiator package', 'PWR', 7900, 12.2, 4, 0.997, { power: 0.008 }, { c: 0x22242c, c2: 0x2a6fd6 }, 'Bar-and-plate cores, GT3 supplier');

// --- Fuel cell.
add('fuelcell', 'fc-fuelsafe', 'Enduro Cell 80 L (FT3)', 'Fuel Safe', 3900, 17, 1, 0.997, { fuelKg: 60, safety: 1 }, { c: 0x2a2d38 }, '80 litres');
add('fuelcell', 'fc-premier', 'FT3 bladder 100 L', 'Premier Fuel Systems', 5600, 16, 2, 0.998, { fuelKg: 75, safety: 1 }, { c: 0x22242c }, '100 litres');
add('fuelcell', 'fc-atl-ft3', 'Saver Cell 110 L (FT3)', 'ATL', 6800, 15.5, 3, 0.998, { fuelKg: 82, safety: 1.5 }, { c: 0x1c1d24, c2: 0xd8232a }, '110 litres');
add('fuelcell', 'fc-atl-ft35', 'FT3.5 bladder 120 L, dry-break', 'ATL', 11200, 14, 4, 0.999, { fuelKg: 90, safety: 2 }, { c: 0x15161b, c2: 0xf2c21a }, '120 litres, fast refuelling');

// --- Clutch.
add('clutch', 'cl-sachs-sinter', 'RCS 2-plate sintered 184 mm', 'ZF Sachs', 2100, 5.4, 1, 0.985, { shift: 0.012 }, { c: 0x8a8f9c }, 'Sintered, heavy');
add('clutch', 'cl-tilton-cerametallic', 'OT-II 3-plate cerametallic 5.5"', 'Tilton', 2900, 3.6, 2, 0.988, { shift: 0.008 }, { c: 0xb0762a }, 'Cerametallic triple plate');
add('clutch', 'cl-ap-sinter', 'CP8153 3-plate sintered 140 mm', 'AP Racing', 3800, 3.2, 3, 0.992, { shift: 0.005 }, { c: 0xd8232a }, 'Low inertia');
add('clutch', 'cl-sachs-carbon', 'RCS 3-plate carbon 140 mm', 'ZF Sachs', 7400, 2.3, 4, 0.994, { shift: 0.002 }, { c: 0x1c1d24 }, 'Carbon, very low inertia');
add('clutch', 'cl-tilton-carbon', 'Carbon-carbon 3-plate 5.5"', 'Tilton', 8600, 2.0, 4, 0.995, { shift: 0 }, { c: 0x15161b, c2: 0xb0762a }, 'Lightest, smoothest take-up');

// --- Gearbox. fits lists the engine layouts each transmission suits.
const SIX_CLOSE = [2.85, 2.12, 1.66, 1.35, 1.14, 1.0];
const SIX_WIDE = [3.1, 2.2, 1.68, 1.35, 1.13, 1.0];
const SIX_SPRINT = [2.7, 2.06, 1.64, 1.35, 1.15, 1.0];
add('gearbox', 'gb-sadev', 'SCL924 6-speed sequential', 'Sadev', 24000, 82, 2, 0.98, { shift: 0.085, eff: 0.012, gears: SIX_WIDE }, { c: 0x8a8f9c }, 'Transaxle, wide ratios', { fits: ['mid', 'rear'] });
add('gearbox', 'gb-holinger', 'MF 6-speed sequential', 'Holinger', 31000, 79, 3, 0.987, { shift: 0.07, eff: 0.018, gears: SIX_CLOSE }, { c: 0x9aa0ac, c2: 0xd8232a }, 'Transaxle, close ratios', { fits: ['mid', 'rear'] });
add('gearbox', 'gb-hewland-tmt', 'TMT-200 6-speed sequential', 'Hewland', 34000, 76, 3, 0.986, { shift: 0.065, eff: 0.02, gears: SIX_CLOSE }, { c: 0xa8aebb }, 'Transaxle, magnesium case', { fits: ['mid', 'rear', 'front'] });
add('gearbox', 'gb-ricardo', '6-speed sequential transaxle', 'Ricardo', 42000, 74, 4, 0.99, { shift: 0.055, eff: 0.024, gears: SIX_SPRINT }, { c: 0x6a6f7c }, 'Factory GT supplier', { fits: ['mid', 'rear'] });
add('gearbox', 'gb-xtrac', '6-speed sequential transaxle', 'Xtrac', 46000, 73, 4, 0.992, { shift: 0.05, eff: 0.026, gears: SIX_SPRINT }, { c: 0x5a606c, c2: 0x2a6fd6 }, 'Factory GT3 supplier', { fits: ['mid', 'rear', 'front'] });
add('gearbox', 'gb-samsonas', 'RWD 6-speed sequential', 'Samsonas', 15500, 62, 1, 0.975, { shift: 0.095, eff: 0.008, gears: SIX_WIDE }, { c: 0x8a8f9c }, 'In-line box for front-engined cars', { fits: ['front'] });
add('gearbox', 'gb-drenth', 'MPG 6-speed sequential', 'Drenth', 21000, 60, 2, 0.982, { shift: 0.08, eff: 0.014, gears: SIX_CLOSE }, { c: 0x9aa0ac }, 'In-line box for front-engined cars', { fits: ['front'] });

// --- Shift system.
add('shift', 'sh-lever', 'Sequential lever, flat-shift', 'OEM', 900, 2.2, 1, 0.995, { shift: 1.6 }, { c: 0x8a8f9c }, 'Manual lever with ignition cut');
add('shift', 'sh-geartronics', 'Pneumatic paddle shift', 'Geartronics', 5200, 4.0, 2, 0.985, { shift: 1.0 }, { c: 0x2a6fd6 }, 'Air-actuated paddles');
add('shift', 'sh-shiftec', 'AGS pneumatic paddle shift', 'Shiftec', 7400, 3.6, 3, 0.99, { shift: 0.82 }, { c: 0x22a860 }, 'Closed-loop air shift');
add('shift', 'sh-megaline', 'E-Shift electric actuator', 'MEGA-Line', 10800, 2.4, 4, 0.994, { shift: 0.68 }, { c: 0x1c1d24, c2: 0xf2c21a }, 'Electric, no compressor');

// --- Differential.
add('diff', 'df-quaife', 'ATB helical LSD', 'Quaife', 1900, 11.5, 1, 0.997, { grip: 0 }, { c: 0x8a8f9c }, 'Gear type, no adjustment');
add('diff', 'df-kaaz', 'Super Q 1.5-way plate LSD', 'Kaaz', 2300, 11, 2, 0.992, { grip: 0.003 }, { c: 0xe0b020 }, 'Plate type');
add('diff', 'df-osgiken', 'Super Lock LSD', 'OS Giken', 3600, 11.8, 3, 0.995, { grip: 0.006, wear: -0.02 }, { c: 0xd8232a }, 'Many plates, smooth lock');
add('diff', 'df-drexler', 'Motorsport LSD, adjustable ramps', 'Drexler', 5900, 10.2, 4, 0.996, { grip: 0.01, wear: -0.03 }, { c: 0x2a6fd6 }, 'Ramp and preload tuning, GT3 supplier');

// --- Driveshafts.
add('driveshafts', 'ds-stock', 'Uprated steel shafts', 'OEM', 1800, 11, 1, 0.975, {}, { c: 0x6a6f7c }, 'Road-derived joints');
add('driveshafts', 'ds-dss', 'Pro-Level axles', 'Driveshaft Shop', 3400, 10, 2, 0.99, { eff: 0.002 }, { c: 0x8a8f9c }, 'Chromoly, rated for 1,000 hp');
add('driveshafts', 'ds-gkn', 'Motorsport tripod shafts', 'GKN Motorsport', 6200, 8.2, 3, 0.995, { eff: 0.004 }, { c: 0xb4bac6 }, 'Low-friction tripod joints');
add('driveshafts', 'ds-pankl', 'Gun-drilled tripod shafts', 'Pankl Racing Systems', 9400, 6.9, 4, 0.997, { eff: 0.006 }, { c: 0xc8ccd6 }, 'Lightest, factory GT3 supplier');

// --- Dampers. look.c is the body colour, c2 the spring colour.
add('dampers', 'dm-bilstein', 'MDS 2-way', 'Bilstein', 6800, 19, 1, 0.995, {}, { c: 0xf2c21a, c2: 0x2a6fd6 }, 'Two-way adjustable');
add('dampers', 'dm-jrz', 'RS Pro 3', 'JRZ', 7900, 18.5, 2, 0.994, { grip: 0.004 }, { c: 0x8a8f9c, c2: 0xd8232a }, 'Three-way, remote canister');
add('dampers', 'dm-kw', 'Competition 3A', 'KW', 9800, 18, 2, 0.995, { grip: 0.008, wear: -0.02 }, { c: 0x8a35d6, c2: 0xf2c21a }, 'Three-way, solid piston');
add('dampers', 'dm-sachs', 'Race Engineering 4-way', 'ZF Sachs', 11500, 17.5, 3, 0.996, { grip: 0.009, wear: -0.02 }, { c: 0x2a6fd6, c2: 0xb4bac6 }, 'Four-way adjustable');
add('dampers', 'dm-penske', '8760 4-way', 'Penske Racing Shocks', 12400, 17, 3, 0.996, { grip: 0.01, wear: -0.03 }, { c: 0xd8232a, c2: 0x2a6fd6 }, 'Four-way, nitrogen charged');
add('dampers', 'dm-ohlins', 'TTX40 4-way', 'Öhlins', 14800, 16.8, 4, 0.997, { grip: 0.012, wear: -0.04 }, { c: 0xe0b020, c2: 0xf2c21a }, 'Twin-tube, GT3 benchmark');
add('dampers', 'dm-multimatic', 'DSSV spool-valve', 'Multimatic', 21000, 16.2, 4, 0.998, { grip: 0.015, wear: -0.05 }, { c: 0xc8ccd6, c2: 0x22242c }, 'Spool valve, most consistent');

// --- Springs.
add('springs', 'sp-hr', 'Race springs 60 mm', 'H&R', 620, 8.8, 1, 0.999, {}, { c: 0xd8232a }, 'Linear rate');
add('springs', 'sp-eibach', 'ERS race spring system', 'Eibach', 880, 8.2, 2, 0.999, { grip: 0.002 }, { c: 0xd8232a }, 'Wide rate range, 2% tolerance');
add('springs', 'sp-hyperco', 'High-travel OBD springs', 'Hyperco', 1250, 7.4, 3, 0.999, { grip: 0.004 }, { c: 0x2a6fd6 }, 'Optimum body diameter, lightest');

// --- Steering wheel.
add('steering', 'st-momo', 'Mod. 30 suede wheel', 'MOMO', 320, 1.3, 1, 0.999, { comfort: 0 }, { c: 0x22242c, style: 0 }, 'Round wheel, no controls');
add('steering', 'st-sparco', 'R 383 with button plate', 'Sparco', 780, 1.5, 2, 0.998, { comfort: 0.03 }, { c: 0x22242c, c2: 0xd8232a, style: 0 }, 'Round wheel, six buttons');
add('steering', 'st-omp', '320 Alu S formula wheel', 'OMP', 1100, 1.2, 2, 0.998, { comfort: 0.05 }, { c: 0x1c1d24, c2: 0xf2c21a, style: 1 }, 'Flat-bottom, quick release');
add('steering', 'st-xap', 'GT carbon wheel with paddles', 'XAP Technology', 4900, 1.4, 3, 0.996, { comfort: 0.09 }, { c: 0x15161b, c2: 0x22a860, style: 1 }, 'Carbon, integrated switches');
add('steering', 'st-cosworth', 'CCW Mk2 display wheel', 'Cosworth', 7200, 1.6, 4, 0.996, { comfort: 0.12 }, { c: 0x15161b, c2: 0x2a6fd6, style: 2 }, 'Built-in display and shift lights');
add('steering', 'st-fanatec', 'M4 GT3 steering wheel', 'Fanatec / BMW M Motorsport', 5400, 1.5, 4, 0.995, { comfort: 0.11 }, { c: 0x15161b, c2: 0xd8232a, style: 2 }, 'The wheel fitted to the real M4 GT3');

// --- Brake discs (car set).
add('discs', 'bd-ebc', 'Floating iron discs 355 mm', 'EBC Brakes Racing', 2400, 37, 1, 0.985, { brake: -0.03 }, { c: 0x8a8f9c, style: 0 }, 'Plain face, smaller diameter');
add('discs', 'bd-alcon', 'Iron discs 380 mm, crescent grooves', 'Alcon', 4300, 35, 2, 0.992, {}, { c: 0x9aa0ac, style: 1 }, 'Ventilated, grooved');
add('discs', 'bd-ap', 'Iron discs 380 mm, J-hook', 'AP Racing', 5200, 34, 3, 0.994, { brake: 0.015 }, { c: 0xa8aebb, style: 1 }, 'J-hook face for bite');
add('discs', 'bd-pfc', 'V3 iron discs 380 mm', 'Performance Friction', 6100, 32.5, 4, 0.996, { brake: 0.025 }, { c: 0xb4bac6, style: 2 }, 'Snap-ring floating mount');
add('discs', 'bd-brembo', 'Racing iron discs 390 mm, Type V', 'Brembo', 6800, 33.5, 4, 0.996, { brake: 0.03 }, { c: 0xb4bac6, style: 2 }, 'Largest diameter, GT3 supplier');

// --- Brake pads (car set).
add('pads', 'bp-ebc', 'Bluestuff NDX', 'EBC Brakes Racing', 380, 4.2, 1, 0.99, { brake: -0.04 }, { c: 0x2a6fd6 }, 'Track-day compound');
add('pads', 'bp-ferodo', 'DS3.12', 'Ferodo Racing', 720, 4.0, 2, 0.994, { brake: 0.01 }, { c: 0x22a860 }, 'High bite, sprint');
add('pads', 'bp-cl', 'RC6E endurance', 'CL Brakes', 760, 4.3, 2, 0.997, { brake: 0, wear: -0.01 }, { c: 0xd8232a }, 'Sintered, long life');
add('pads', 'bp-endless', 'ME20', 'Endless', 980, 4.0, 3, 0.996, { brake: 0.02 }, { c: 0x2a6fd6 }, 'Stable at high temperature');
add('pads', 'bp-pagid-rsl', 'RSL 1 endurance', 'Pagid Racing', 1050, 4.1, 3, 0.998, { brake: 0.015, wear: -0.01 }, { c: 0xf2c21a }, 'Endurance standard, low wear');
add('pads', 'bp-pfc', '11 compound', 'Performance Friction', 1120, 3.9, 4, 0.996, { brake: 0.035 }, { c: 0x22242c }, 'High friction, smooth release');
add('pads', 'bp-pagid-rst', 'RST 1 sprint', 'Pagid Racing', 1180, 4.0, 4, 0.994, { brake: 0.04 }, { c: 0xf2c21a }, 'Highest bite');

// --- Calipers (car set). look.c is the caliper colour.
add('calipers', 'bc-wilwood', 'Superlite 6R forged, 4-piston rear', 'Wilwood', 3600, 13.5, 1, 0.99, { brake: -0.03 }, { c: 0x22242c }, 'Two-piece forged');
add('calipers', 'bc-alcon', 'Monobloc 6-piston front, 4 rear', 'Alcon', 9800, 12.4, 3, 0.995, { brake: 0.01 }, { c: 0x8a8f9c }, 'GT3 supplier');
add('calipers', 'bc-ap', 'Radi-CAL 6-piston front, 4 rear', 'AP Racing', 13800, 11.2, 4, 0.996, { brake: 0.025 }, { c: 0xd8232a }, 'Organic design, stiffest');
add('calipers', 'bc-pfc', 'ZR monobloc 6-piston front, 4 rear', 'Performance Friction', 12600, 11.6, 4, 0.996, { brake: 0.02 }, { c: 0x15161b }, 'Forged monobloc');
add('calipers', 'bc-brembo', 'Racing monobloc 6-piston front, 4 rear', 'Brembo', 14500, 11.4, 4, 0.997, { brake: 0.028 }, { c: 0xe8232a }, 'GT3 benchmark');

// --- ABS.
add('abs', 'abs-none', 'No ABS (balance bar only)', 'None', 0, 0, 1, 1, { abs: 0 }, { c: 0x3a3e4c }, 'Driver modulates the brakes');
add('abs', 'abs-mk60', 'MK60 race-coded ABS', 'Continental Teves', 3900, 2.8, 2, 0.995, { abs: 0.7 }, { c: 0x8a8f9c }, 'Road unit with race map');
add('abs', 'abs-m4', 'Motorsport ABS M4', 'Bosch Motorsport', 7200, 2.6, 3, 0.997, { abs: 0.85 }, { c: 0x6a6f7c }, 'Twelve-position map switch');
add('abs', 'abs-m5', 'Motorsport ABS M5', 'Bosch Motorsport', 9600, 2.4, 4, 0.998, { abs: 0.94 }, { c: 0x5a606c, c2: 0xd8232a }, 'Current GT3 standard');

// --- Pedal box.
add('pedals', 'pd-wilwood', 'Floor-mount pedal assembly', 'Wilwood', 620, 4.6, 1, 0.997, {}, { c: 0x8a8f9c }, 'Balance bar');
add('pedals', 'pd-obp', 'Pro-Race V2 pedal box', 'OBP Motorsport', 980, 4.2, 2, 0.997, { brake: 0.004, comfort: 0.01 }, { c: 0x22242c }, 'Adjustable ratio');
add('pedals', 'pd-tilton', '600-series floor-mount', 'Tilton', 1650, 3.4, 3, 0.998, { brake: 0.008, comfort: 0.02 }, { c: 0xb0762a }, 'Forged aluminium');
add('pedals', 'pd-ap', 'CP5500 pedal box, cockpit bias', 'AP Racing', 2900, 3.1, 4, 0.999, { brake: 0.012, comfort: 0.03 }, { c: 0xd8232a }, 'Cockpit-adjustable balance');

// --- Wheels (set of four, 18 inch). look.style is the spoke count.
add('wheels', 'wh-braid', 'Fullrace forged 18"', 'Braid', 4200, 46, 1, 0.997, {}, { c: 0xe8e8ee, style: 6 }, 'Five-stud forged aluminium');
add('wheels', 'wh-ats', 'GTR forged centre-lock 18"', 'ATS Motorsport', 6400, 43, 2, 0.998, { grip: 0.002 }, { c: 0x22242c, style: 10 }, 'Forged aluminium');
add('wheels', 'wh-forgeline', 'GS1R centre-lock 18"', 'Forgeline', 7200, 42, 3, 0.998, { grip: 0.003 }, { c: 0xc8a030, style: 5 }, 'Forged 6061 monoblock');
add('wheels', 'wh-oz', 'Racing forged magnesium 18"', 'OZ Racing', 9800, 38, 4, 0.997, { grip: 0.006 }, { c: 0xf2f2f6, style: 10 }, 'Forged magnesium');
add('wheels', 'wh-rays', 'Volk Racing forged centre-lock 18"', 'RAYS', 8900, 40, 3, 0.998, { grip: 0.004 }, { c: 0x9a6a30, style: 6 }, 'Mould-forged aluminium');
add('wheels', 'wh-bbs', 'Motorsport forged magnesium 18"', 'BBS Motorsport', 11200, 37, 4, 0.998, { grip: 0.007 }, { c: 0xe0b020, style: 12 }, 'Lightest, factory GT3 supplier');

// --- Tyres (set of four slicks). look.c is the sidewall marking colour.
add('tyres', 'ty-toyo', 'Proxes RS1 slick', 'Toyo', 1750, 46, 1, 0.99, { mu: 1.585, tyreWear: 7.0e-6 }, { c: 0x2a6fd6 }, 'Durable club slick');
add('tyres', 'ty-avon', 'GT slick', 'Avon', 1900, 45, 1, 0.99, { mu: 1.6, tyreWear: 9.0e-6 }, { c: 0xe8e8ee }, 'Quick to warm, wears fast');
add('tyres', 'ty-hankook', 'Ventus Race F200', 'Hankook', 2050, 45.5, 2, 0.993, { mu: 1.61, tyreWear: 7.5e-6 }, { c: 0xf07a1c }, 'Consistent over a stint');
add('tyres', 'ty-yokohama', 'ADVAN A005 slick', 'Yokohama', 2250, 45, 2, 0.993, { mu: 1.625, tyreWear: 8.0e-6 }, { c: 0xd8232a }, 'Strong on braking');
add('tyres', 'ty-goodyear', 'Eagle F1 SuperSport slick', 'Goodyear', 2400, 44.5, 3, 0.994, { mu: 1.64, tyreWear: 8.5e-6 }, { c: 0xf2c21a }, 'Balanced grip and life');
add('tyres', 'ty-pirelli', 'P Zero DHF', 'Pirelli', 2650, 44.5, 3, 0.995, { mu: 1.65, tyreWear: 8.0e-6 }, { c: 0xf2c21a }, 'GT World Challenge control tyre');
add('tyres', 'ty-michelin-s9', 'Pilot Sport GT S9M (hard)', 'Michelin', 2900, 44, 3, 0.996, { mu: 1.63, tyreWear: 6.0e-6 }, { c: 0xe8e8ee }, 'Longest life');
add('tyres', 'ty-michelin-s7', 'Pilot Sport GT S7M (soft)', 'Michelin', 2900, 44, 4, 0.994, { mu: 1.7, tyreWear: 11.0e-6 }, { c: 0xe8e8ee }, 'Most grip, short life');

// --- Front splitter. look.style: 0 short, 1 long, 2 long with dive planes.
add('splitter', 'spl-stock', 'Homologated front lip', 'OEM', 1800, 4.5, 1, 0.995, { cl: 0.28, cd: 0.012, front: 1 }, { c: 0x22242c, style: 0 }, 'Short lip');
add('splitter', 'spl-apr', 'Carbon wind splitter', 'APR Performance', 3200, 5.2, 2, 0.992, { cl: 0.46, cd: 0.02, front: 1 }, { c: 0x1c1d24, style: 1 }, 'Flat carbon blade with rods');
add('splitter', 'spl-verus', 'Carbon splitter with air dam', 'Verus Engineering', 4600, 5.8, 3, 0.992, { cl: 0.6, cd: 0.026, front: 1 }, { c: 0x15161b, style: 1 }, 'CFD-developed profile');
add('splitter', 'spl-evo', 'GT3 Evo splitter with dive planes', 'Homologated Evo kit', 9800, 6.4, 4, 0.99, { cl: 0.78, cd: 0.034, front: 1 }, { c: 0x15161b, style: 2 }, 'Full-width with twin dive planes');

// --- Rear wing. look.style: 0 pylon, 1 swan-neck, 2 twin element.
add('wing', 'wg-apr-gtc300', 'GTC-300 67" carbon wing', 'APR Performance', 2600, 6.8, 1, 0.996, { cl: 0.62, cd: 0.05, front: 0 }, { c: 0x22242c, style: 0 }, 'Single element, pylon mount');
add('wing', 'wg-apr-gtc500', 'GTC-500 74" carbon wing', 'APR Performance', 3900, 8.4, 2, 0.996, { cl: 0.95, cd: 0.072, front: 0 }, { c: 0x1c1d24, style: 0 }, '3D aerofoil, pylon mount');
add('wing', 'wg-voltex', 'Type 12 swan-neck 1800 mm', 'Voltex', 6800, 8.0, 3, 0.995, { cl: 1.18, cd: 0.078, front: 0 }, { c: 0x15161b, style: 1 }, 'Wind-tunnel developed');
add('wing', 'wg-verus', 'UCW high-efficiency wing', 'Verus Engineering', 5200, 7.6, 3, 0.995, { cl: 1.05, cd: 0.064, front: 0 }, { c: 0x1c1d24, style: 1 }, 'Low drag for its downforce');
add('wing', 'wg-apr-gt1000', 'GT-1000 dual-element 71"', 'APR Performance', 7900, 10.8, 3, 0.994, { cl: 1.42, cd: 0.118, front: 0 }, { c: 0x15161b, style: 2 }, 'Maximum downforce, draggy');
add('wing', 'wg-evo', 'GT3 Evo swan-neck wing', 'Homologated Evo kit', 14500, 9.2, 4, 0.996, { cl: 1.36, cd: 0.082, front: 0 }, { c: 0x15161b, style: 1 }, 'Factory GT3 wing');

// --- Diffuser. look.style is the strake count.
add('diffuser', 'dif-none', 'Flat rear undertray', 'OEM', 900, 5.5, 1, 0.998, { cl: 0.18, cd: 0.004, front: 0.3 }, { c: 0x22242c, style: 0 }, 'No tunnels');
add('diffuser', 'dif-apr', 'Carbon rear diffuser', 'APR Performance', 2400, 7.2, 2, 0.996, { cl: 0.42, cd: 0.01, front: 0.3 }, { c: 0x1c1d24, style: 3 }, 'Three strakes');
add('diffuser', 'dif-verus', 'Full flat floor and diffuser', 'Verus Engineering', 5600, 11, 3, 0.995, { cl: 0.68, cd: 0.012, front: 0.38 }, { c: 0x15161b, style: 5 }, 'Flat floor feeds the tunnels');
add('diffuser', 'dif-evo', 'GT3 Evo floor and diffuser', 'Homologated Evo kit', 12800, 12.5, 4, 0.995, { cl: 0.9, cd: 0.014, front: 0.4 }, { c: 0x15161b, style: 7 }, 'Factory GT3 underfloor');

// --- Windows.
add('windows', 'wn-glass', 'Laminated glass', 'OEM', 1400, 26, 1, 0.999, {}, { c: 0x1a2a3c, style: 0 }, 'Heavy road glass');
add('windows', 'wn-acw', 'Polycarbonate window kit', 'ACW Motorsport Plastics', 1900, 11.5, 2, 0.998, { comfort: 0.01 }, { c: 0x1c3044, style: 1 }, 'Hard-coated, sliding vent');
add('windows', 'wn-p4p', 'Lexan kit, heated screen', 'Plastics 4 Performance', 3200, 10.5, 3, 0.998, { comfort: 0.03 }, { c: 0x203850, style: 1 }, 'Heated screen stays clear');

// --- Seat. look.c is the shell colour.
add('seat', 'se-omp-hte', 'HTE-R fibreglass', 'OMP', 1050, 9.5, 1, 0.999, { comfort: 0.02, safety: 1 }, { c: 0x22242c, c2: 0xd8232a }, 'FIA 8855-1999');
add('seat', 'se-sparco', 'Pro ADV QRT', 'Sparco', 1500, 7.8, 2, 0.999, { comfort: 0.04, safety: 1.2 }, { c: 0x22242c, c2: 0x2a6fd6 }, 'Head restraint wings');
add('seat', 'se-racetech', 'RT9119HR', 'Racetech', 1950, 8.6, 2, 0.999, { comfort: 0.05, safety: 1.5 }, { c: 0x1c1d24, c2: 0xe8e8ee }, 'Back-mounted, very stiff');
add('seat', 'se-sabelt', 'GT-PAD carbon', 'Sabelt', 4300, 5.4, 3, 0.999, { comfort: 0.08, safety: 1.8 }, { c: 0x15161b, c2: 0xd8232a }, 'Carbon shell, modular padding');
add('seat', 'se-omp-carbon', 'HRC-R Air carbon', 'OMP', 5200, 5.0, 4, 0.999, { comfort: 0.1, safety: 1.9 }, { c: 0x15161b, c2: 0xf2c21a }, 'Ventilated carbon shell');
add('seat', 'se-recaro', 'P 1300 GT carbon', 'Recaro', 6900, 5.2, 4, 0.999, { comfort: 0.12, safety: 2 }, { c: 0x15161b, c2: 0xe8e8ee }, 'FIA 8862-2009, GT3 standard');

// --- Harness. look.c is the webbing colour.
add('harness', 'ha-trs', 'Magnum 6-point', 'TRS', 260, 2.4, 1, 0.999, { safety: 1 }, { c: 0x2a6fd6 }, 'Steel adjusters');
add('harness', 'ha-omp', 'First 3/2 6-point', 'OMP', 340, 2.0, 2, 0.999, { safety: 1.1, comfort: 0.005 }, { c: 0xd8232a }, 'HANS width shoulder straps');
add('harness', 'ha-willans', 'Silverstone 6-point', 'Willans', 420, 1.9, 2, 0.999, { safety: 1.2, comfort: 0.01 }, { c: 0x22242c }, 'Aluminium adjusters');
add('harness', 'ha-sabelt', 'Enduro 6-point', 'Sabelt', 560, 1.6, 3, 0.999, { safety: 1.3, comfort: 0.015 }, { c: 0xd8232a }, 'Quick driver-change adjusters');
add('harness', 'ha-schroth', 'Profi II-6 FE', 'Schroth', 640, 1.5, 4, 0.999, { safety: 1.4, comfort: 0.02 }, { c: 0xe8e8ee }, 'Lightweight, endurance buckle');

// --- Fire system.
add('fire', 'fi-spa', 'Extreme AFFF 4.25 L mechanical', 'SPA Design', 420, 6.8, 1, 0.999, { safety: 1 }, { c: 0xd8232a }, 'Pull cable');
add('fire', 'fi-omp', 'Platinum Collection electric', 'OMP', 780, 5.6, 2, 0.999, { safety: 1.2 }, { c: 0xd8232a }, 'Electric trigger');
add('fire', 'fi-lifeline-2000', 'Zero 2000 4.0 L electric', 'Lifeline', 980, 5.2, 3, 0.999, { safety: 1.4 }, { c: 0xd8232a }, 'FIA 8865');
add('fire', 'fi-lifeline-360', 'Zero 360 novec 3.0 kg', 'Lifeline', 2100, 4.1, 4, 0.999, { safety: 1.8 }, { c: 0xb4bac6, c2: 0xd8232a }, 'Gas, no residue, lightest');

// --- Air jacks. look.style is the number of jacks.
add('airjacks', 'aj-none', 'No air jacks (trolley jack)', 'None', 0, 0, 1, 1, { pit: 0 }, { c: 0x3a3e4c, style: 0 }, 'Slow pit stops');
add('airjacks', 'aj-ap', 'CP3985 air jack set, three', 'AP Racing', 3800, 6.3, 3, 0.997, { pit: 9 }, { c: 0xb4bac6, style: 3 }, 'Three-jack system');
add('airjacks', 'aj-krontec', 'LL-30 air jack set, four', 'Krontec', 5900, 7.6, 4, 0.998, { pit: 11 }, { c: 0xc8ccd6, style: 4 }, 'Four jacks, safety lock');

// --- Data logger and dash.
add('logger', 'lg-aim-mxs', 'MXS 1.3 Strada dash', 'AiM', 1500, 0.7, 1, 0.997, { comfort: 0.01 }, { c: 0x22242c, c2: 0x22a860 }, 'Dash only');
add('logger', 'lg-racelogic', 'VBOX Video HD2', 'Racelogic', 3900, 1.4, 2, 0.997, { comfort: 0.02 }, { c: 0x22242c, c2: 0xd8232a }, 'Video with GPS data');
add('logger', 'lg-aim-mxg', 'MXG 1.3 dash logger', 'AiM', 3300, 1.1, 2, 0.997, { comfort: 0.03 }, { c: 0x1c1d24, c2: 0x2a6fd6 }, 'Seven-inch dash logger');
add('logger', 'lg-motec', 'C187 colour display logger', 'MoTeC', 6900, 0.9, 3, 0.998, { comfort: 0.05 }, { c: 0x15161b, c2: 0xe0b020 }, 'Seven-inch display, 500 MB');
add('logger', 'lg-bosch', 'DDU 11 display and logger', 'Bosch Motorsport', 9400, 1.2, 4, 0.998, { comfort: 0.06 }, { c: 0x15161b, c2: 0x8a8f9c }, 'GT3 standard display');
add('logger', 'lg-cosworth', 'Pi Omega display logger', 'Cosworth', 8200, 1.0, 4, 0.998, { comfort: 0.06 }, { c: 0x15161b, c2: 0xd8232a }, 'Factory team telemetry');

// --- Wiring loom.
add('loom', 'lm-stock', 'Trimmed road harness', 'OEM', 1200, 14, 1, 0.97, {}, { c: 0x3a3e4c }, 'Heavy, many unused branches');
add('loom', 'lm-club', 'Motorsport harness, Raychem DR-25', 'DC Electronics', 6500, 8.5, 3, 0.992, {}, { c: 0x22242c }, 'Heat-shrink sheathed, Deutsch DTM');
add('loom', 'lm-milspec', 'Mil-spec concentric-twist loom', 'DC Electronics', 15500, 6.2, 4, 0.998, {}, { c: 0x15161b, c2: 0xd8232a }, 'Autosport connectors, lightest');

// --- Battery.
add('battery', 'bt-varley', 'Red Top 30', 'Varley', 260, 9.7, 1, 0.995, {}, { c: 0xd8232a }, 'Lead-acid');
add('battery', 'bt-braille', 'B2015 AGM', 'Braille', 290, 6.8, 2, 0.995, {}, { c: 0x22242c }, 'Lightweight AGM');
add('battery', 'bt-superb', 'Andrena 12V 20Ah lithium', 'Super B', 1250, 3.2, 4, 0.997, {}, { c: 0xf07a1c }, 'Lithium iron phosphate');

// --- More tyres and wheels.
add('tyres', 'ty-michelin-s8', 'Pilot Sport GT S8M (medium)', 'Michelin', 2900, 44, 4, 0.995, { mu: 1.665, tyreWear: 8.0e-6 }, { c: 0xe8e8ee }, 'All-round race compound');
add('tyres', 'ty-hoosier', 'Racing slick R80', 'Hoosier', 2300, 43.5, 3, 0.992, { mu: 1.66, tyreWear: 12.0e-6 }, { c: 0x8a35d6 }, 'Sprint compound, very short life');
add('tyres', 'ty-hankook-soft', 'Ventus Race F200 soft', 'Hankook', 2150, 45.5, 3, 0.993, { mu: 1.655, tyreWear: 9.5e-6 }, { c: 0xf07a1c }, 'Qualifying grip');
add('wheels', 'wh-enkei', 'RS05RR 18"', 'Enkei', 3300, 44.5, 1, 0.997, {}, { c: 0x3a3e4c, style: 10 }, 'Flow-formed aluminium');
add('wheels', 'wh-titan7', 'T-R10 forged 18"', 'Titan7', 3900, 43, 2, 0.997, { grip: 0.001 }, { c: 0x8a6a40, style: 10 }, 'Fully forged, ten spoke');
add('wheels', 'wh-tws', 'Motorsport forged magnesium 18"', 'TWS', 9400, 38.5, 4, 0.997, { grip: 0.006 }, { c: 0x1c1d24, style: 12 }, 'Forged magnesium, centre-lock');

// --- Roll cage.
add('cage', 'cg-cds', 'Multipoint CDS steel cage', 'Custom Cages', 4200, 46, 1, 0.999, { safety: 2 }, { c: 0xd8dae2 }, 'Cold-drawn steel, weld-in');
add('cage', 'cg-heigo', '25CrMo4 weld-in cage', 'Heigo', 6800, 38, 2, 0.999, { safety: 2.4, grip: 0.002 }, { c: 0xe8e8ee }, 'Chromoly, lighter');
add('cage', 'cg-wiechers', 'Chromoly cage with door bars', 'Wiechers Sport', 7900, 36, 3, 0.999, { safety: 2.6, grip: 0.003 }, { c: 0xc8ccd6 }, 'Ties into the suspension towers');
add('cage', 'cg-t45', 'T45 multipoint cage', 'Custom Cages', 9800, 33, 3, 0.999, { safety: 2.8, grip: 0.004 }, { c: 0xb4bac6 }, 'T45 aerospace tube');
add('cage', 'cg-fia', 'Homologated FIA cage with X-brace', 'Homologated Evo kit', 16500, 31, 4, 0.999, { safety: 3.2, grip: 0.006 }, { c: 0xf4f4f0 }, 'Stiffest shell, FIA homologated');

// --- Mirrors and rear vision.
add('mirrors', 'mi-stock', 'Road door mirrors', 'OEM', 300, 2.4, 1, 0.999, {}, { style: 0 }, 'Heavy, poor view');
add('mirrors', 'mi-longacre', 'Wide interior mirror and race door mirrors', 'Longacre', 380, 1.6, 2, 0.999, { comfort: 0.01 }, { style: 1 }, 'Panoramic interior mirror');
add('mirrors', 'mi-apr', 'Formula GT3 carbon mirrors', 'APR Performance', 620, 1.2, 2, 0.999, { comfort: 0.005, cd: -0.001 }, { style: 1 }, 'Low-drag carbon housings');
add('mirrors', 'mi-camera', 'Rear-view camera and display', 'Racelogic', 1900, 1.1, 3, 0.997, { comfort: 0.02 }, { style: 1 }, 'Camera replaces the interior mirror');
add('mirrors', 'mi-radar', 'Collision avoidance radar CAS-M', 'Bosch Motorsport', 8900, 1.4, 4, 0.997, { comfort: 0.04 }, { style: 1 }, 'Rear radar shows closing cars');

// --- Lighting.
add('lights', 'li-stock', 'Halogen road lamps', 'OEM', 400, 4.5, 1, 0.995, {}, { c: 0xfff2b8 }, 'Road units');
add('lights', 'li-baja', 'LP6 Pro LED pair', 'Baja Designs', 1650, 3.0, 3, 0.998, { comfort: 0.008 }, { c: 0xffffff }, 'High-output LED');
add('lights', 'li-lazer-st4', 'ST4 Evolution LED', 'Lazer Lamps', 1450, 2.6, 3, 0.998, { comfort: 0.008 }, { c: 0xffffff }, 'Compact endurance LED');
add('lights', 'li-lazer-pod', 'Triple-R 750 endurance pod', 'Lazer Lamps', 2300, 3.4, 3, 0.998, { comfort: 0.012 }, { c: 0xffffff }, 'Long-range pod');
add('lights', 'li-evo', 'GT3 LED matrix endurance package', 'Homologated Evo kit', 5200, 2.8, 4, 0.999, { comfort: 0.016 }, { c: 0xdff0ff }, 'Factory endurance lighting');

// --- Driver cooling.
add('cooldriver', 'dc-none', 'No driver cooling', 'None', 0, 0, 1, 1, { comfort: -0.04 }, {}, 'Cockpit can pass 50 C');
add('cooldriver', 'dc-blower', 'Helmet air blower', 'FAST Fresh Air Systems', 420, 1.4, 2, 0.997, { comfort: 0.03 }, {}, 'Filtered air to the helmet');
add('cooldriver', 'dc-coolshirt', 'Club System cool shirt, ice box', 'CoolShirt Systems', 780, 3.8, 2, 0.996, { comfort: 0.06 }, {}, 'Ice-water shirt');
add('cooldriver', 'dc-fast', 'Cool suit with helmet air', 'FAST Fresh Air Systems', 1900, 4.2, 3, 0.996, { comfort: 0.09 }, {}, 'Shirt and helmet air together');
add('cooldriver', 'dc-chillout', 'Cypher Pro micro cooler', 'Chillout Motorsports', 2400, 2.9, 4, 0.997, { comfort: 0.1 }, {}, 'Compressor cooler, no ice');

// --- Dive planes. look.style is the number per side.
add('canards', 'cn-none', 'No dive planes', 'None', 0, 0, 1, 1, {}, { style: 0 }, 'Clean nose');
add('canards', 'cn-apr', 'Carbon canards, pair', 'APR Performance', 320, 0.5, 2, 0.997, { cl: 0.05, cd: 0.004, front: 1 }, { c: 0x1c1d24, style: 1 }, 'One per side');
add('canards', 'cn-verus', 'Dual dive plane set', 'Verus Engineering', 690, 0.9, 3, 0.997, { cl: 0.09, cd: 0.007, front: 1 }, { c: 0x15161b, style: 2 }, 'Two per side');
add('canards', 'cn-evo', 'GT3 Evo twin dive planes', 'Homologated Evo kit', 2400, 0.8, 4, 0.998, { cl: 0.12, cd: 0.008, front: 1 }, { c: 0x15161b, style: 2 }, 'Factory front-end balance kit');

// --- Hood and arch vents. look.style: 0 none, 1 hood, 2 hood and arches.
add('louvers', 'lv-none', 'Closed bonnet', 'OEM', 200, 0, 1, 0.999, {}, { style: 0 }, 'No extraction');
add('louvers', 'lv-hood', 'Bonnet louver kit', 'Trackspec Motorsports', 420, 0.6, 2, 0.999, { cl: 0.03, cd: 0.001, front: 1, power: 0.002 }, { c: 0x22242c, style: 1 }, 'Vents radiator air');
add('louvers', 'lv-arch', 'Wheel-arch louvers', 'Trackspec Motorsports', 360, 0.5, 2, 0.999, { cl: 0.04, front: 1 }, { c: 0x22242c, style: 1 }, 'Relieves arch pressure');
add('louvers', 'lv-verus', 'Carbon vented bonnet and arch vents', 'Verus Engineering', 2900, 0.4, 3, 0.999, { cl: 0.08, cd: 0.002, front: 1, power: 0.004 }, { c: 0x15161b, style: 2 }, 'Bonnet and arches');
add('louvers', 'lv-evo', 'GT3 Evo vented bonnet and extractors', 'Homologated Evo kit', 6400, 0.4, 4, 0.999, { cl: 0.11, cd: 0.002, front: 1, power: 0.005 }, { c: 0x15161b, style: 2 }, 'Factory extraction package');

// --- Engine internals. revs moves the safe rev ceiling.
add('pistons', 'pi-cast', 'Cast pistons', 'OEM', 1400, 3.6, 1, 0.985, { revs: -200 }, {}, 'Road pistons');
add('pistons', 'pi-wiseco', 'Forged 2618 piston set', 'Wiseco', 2100, 3.2, 2, 0.992, {}, {}, 'Forged, skirt coated');
add('pistons', 'pi-je', 'FSR forged pistons', 'JE Pistons', 2600, 3.1, 3, 0.994, { revs: 100, power: 0.002 }, {}, 'Forged side relief');
add('pistons', 'pi-cp', 'Forged race pistons, DLC pins', 'CP-Carrillo', 3400, 3.0, 3, 0.995, { revs: 150, power: 0.003 }, {}, 'Low-friction pins');
add('pistons', 'pi-mahle', 'Motorsport forged pistons, coated', 'Mahle Motorsport', 5200, 2.8, 4, 0.997, { revs: 250, power: 0.005 }, {}, 'Factory race supplier');
add('pistons', 'pi-pankl', 'Billet pistons, thermal barrier crown', 'Pankl Racing Systems', 6900, 2.7, 4, 0.997, { revs: 300, power: 0.006 }, {}, 'Lightest');

add('rods', 'ro-stock', 'Forged steel rods', 'OEM', 1300, 4.2, 1, 0.985, { revs: -200 }, {}, 'Road rods');
add('rods', 'ro-k1', 'H-beam 4340 rods', 'K1 Technologies', 1500, 3.9, 2, 0.992, {}, {}, 'ARP 2000 bolts');
add('rods', 'ro-carrillo', 'Pro-H 4340 rods', 'CP-Carrillo', 2900, 3.7, 3, 0.996, { revs: 150 }, {}, 'Race standard');
add('rods', 'ro-arrow', 'I-beam 300M rods', 'Arrow Precision', 3400, 3.5, 3, 0.996, { revs: 200 }, {}, 'Fully machined 300M');
add('rods', 'ro-pankl', 'Titanium rods', 'Pankl Racing Systems', 9800, 2.4, 4, 0.995, { revs: 400, power: 0.003 }, {}, 'Titanium, life-limited');

add('crank', 'cr-stock', 'Forged production crank', 'OEM', 2200, 21, 1, 0.99, {}, {}, 'Road crankshaft');
add('crank', 'cr-callies', 'Billet 4340 crankshaft', 'Callies', 4800, 19.5, 3, 0.996, { revs: 100 }, {}, 'Billet, gun-drilled');
add('crank', 'cr-arrow', 'Billet EN40B nitrided crank', 'Arrow Precision', 5900, 18.5, 3, 0.997, { revs: 200 }, {}, 'Nitrided EN40B');
add('crank', 'cr-pankl', 'Knife-edged billet crank', 'Pankl Racing Systems', 9400, 16.8, 4, 0.996, { revs: 300, power: 0.003 }, {}, 'Lightweight, low windage');

add('valvetrain', 'vt-stock', 'Road cams and springs', 'OEM', 1900, 13, 1, 0.985, { revs: -300, power: -0.01 }, {}, 'Road profile');
add('valvetrain', 'vt-schrick', 'Stage 2 cams, dual springs', 'Schrick', 3600, 12.6, 2, 0.99, {}, {}, 'Fast-road profile');
add('valvetrain', 'vt-catcams', 'Race cams, titanium retainers', 'Cat Cams', 4900, 12.0, 3, 0.992, { revs: 200, power: 0.006 }, {}, 'Race profile');
add('valvetrain', 'vt-supertech', 'Titanium valves, beehive springs', 'Supertech', 5600, 11.2, 3, 0.994, { revs: 300, power: 0.008 }, {}, 'Light valves');
add('valvetrain', 'vt-works', 'Works cams, DLC followers, titanium valves', 'Homologated Evo kit', 11800, 10.8, 4, 0.995, { revs: 450, power: 0.012 }, {}, 'Factory GT3 valvetrain');

add('oil', 'oi-wet', 'Wet sump with baffles', 'OEM', 900, 9, 1, 0.96, { power: -0.008 }, { c: 0x3a3e4c, style: 0 }, 'Oil surge in long corners');
add('oil', 'oi-pace', 'Dry sump kit, 4-stage', 'Pace Products', 4600, 13.5, 3, 0.992, { power: 0.003 }, { c: 0x8a8f9c, style: 1 }, 'External tank');
add('oil', 'oi-dailey', 'Dry sump kit, 3-stage billet pump', 'Dailey Engineering', 5400, 13, 3, 0.993, { power: 0.004 }, { c: 0x9aa0ac, style: 1 }, 'Integrated pan and pump');
add('oil', 'oi-are', 'Dry sump kit, 5-stage', 'ARE Dry Sump Systems', 6200, 14, 3, 0.994, { power: 0.005 }, { c: 0xb4bac6, style: 1 }, 'High crankcase vacuum');
add('oil', 'oi-verdi', 'Dry sump, carbon tank', 'Auto Verdi', 8900, 12, 4, 0.996, { power: 0.007 }, { c: 0x15161b, style: 1 }, 'Lightest, best scavenging');

add('throttle', 'th-single', 'Single cable throttle body', 'OEM', 600, 2.8, 1, 0.998, { power: -0.006 }, {}, 'Road unit');
add('throttle', 'th-bosch', 'Drive-by-wire throttle 82 mm', 'Bosch Motorsport', 1100, 1.9, 2, 0.998, {}, {}, 'Motorsport DBW');
add('throttle', 'th-atpower-dbw', 'Shaftless drive-by-wire throttle', 'AT Power', 2300, 1.7, 3, 0.998, { power: 0.004 }, {}, 'No shaft in the airflow');
add('throttle', 'th-jenvey', 'Individual throttle bodies 50 mm', 'Jenvey', 3900, 4.6, 3, 0.996, { power: 0.006 }, {}, 'One butterfly per cylinder');
add('throttle', 'th-atpower-itb', 'Individual throttles, carbon trumpets', 'AT Power', 5200, 4.0, 4, 0.996, { power: 0.009 }, {}, 'Shaftless ITBs');

// --- Fuel delivery. flow is the engine power the part can feed.
add('injectors', 'ij-stock', 'Production injectors', 'OEM', 700, 0.7, 1, 0.99, { flow: 330 }, {}, 'Feeds about 440 hp');
add('injectors', 'ij-bosch-ev14', 'EV14 980 cc set', 'Bosch Motorsport', 1200, 0.6, 2, 0.995, { flow: 400 }, {}, 'Feeds about 535 hp');
add('injectors', 'ij-id1050', 'ID1050-XDS set', 'Injector Dynamics', 1500, 0.6, 3, 0.996, { flow: 450 }, {}, 'Feeds about 600 hp');
add('injectors', 'ij-id1700', 'ID1700-XDS set', 'Injector Dynamics', 1900, 0.6, 3, 0.995, { flow: 560 }, {}, 'Feeds about 750 hp');
add('injectors', 'ij-hdev', 'HDEV 5.2 direct injectors', 'Bosch Motorsport', 4200, 0.8, 4, 0.996, { flow: 600, power: 0.004 }, {}, 'High-pressure direct injection');

add('fuelpump', 'fp-stock', 'In-tank production pump', 'OEM', 350, 1.3, 1, 0.985, { flow: 320 }, {}, 'Feeds about 430 hp');
add('fuelpump', 'fp-walbro', 'GSS342 255 lph', 'Walbro', 240, 0.9, 2, 0.99, { flow: 390 }, {}, 'Feeds about 520 hp');
add('fuelpump', 'fp-bosch044', '044 motorsport pump', 'Bosch Motorsport', 380, 1.1, 2, 0.994, { flow: 430 }, {}, 'Feeds about 575 hp');
add('fuelpump', 'fp-bosch200', 'FP 200 pump', 'Bosch Motorsport', 620, 0.9, 3, 0.996, { flow: 480 }, {}, 'Feeds about 640 hp');
add('fuelpump', 'fp-ti', 'BKS1000 brushless pump', 'TI Automotive', 1500, 1.2, 4, 0.997, { flow: 580 }, {}, 'Speed-controlled brushless');
add('fuelpump', 'fp-radium', 'Twin brushless pumps and surge tank', 'Radium Engineering', 2100, 2.6, 4, 0.998, { flow: 620 }, {}, 'No starvation in long corners');

add('ignition', 'ig-stock', 'Production coils, copper plugs', 'OEM', 500, 1.8, 1, 0.98, {}, {}, 'Road ignition');
add('ignition', 'ig-ngk', 'High-output coils, racing plugs', 'NGK', 760, 1.6, 2, 0.993, { knock: 0.6 }, {}, 'Colder plugs');
add('ignition', 'ig-aem', 'IGN-1A smart coils', 'AEM', 900, 2.2, 2, 0.992, { knock: 0.5 }, {}, 'High-energy inductive coils');
add('ignition', 'ig-bosch', 'P65-T coils, iridium plugs', 'Bosch Motorsport', 1700, 1.5, 3, 0.996, { knock: 1 }, {}, 'Motorsport pencil coils');
add('ignition', 'ig-mw', 'CDI ignition and racing plugs', 'M&W Ignitions', 2400, 1.9, 4, 0.995, { knock: 1.6 }, {}, 'Capacitor discharge');

// --- Forced induction (turbocharged engines only).
add('turbo', 'tu-stock', 'Production twin turbos', 'OEM', 3800, 16, 1, 0.985, { boostMax: 1.0, power: -0.01 }, { c: 0x9a6a30 }, 'Holds 1.0 bar');
add('turbo', 'tu-gtx', 'GTX2867R Gen II pair', 'Garrett', 5200, 14.5, 2, 0.99, { boostMax: 1.3 }, { c: 0xb4bac6 }, 'Holds 1.3 bar');
add('turbo', 'tu-efr', 'EFR 6758 pair', 'BorgWarner', 5600, 15, 3, 0.992, { boostMax: 1.35, power: 0.004 }, { c: 0xc8ccd6 }, 'Gamma-Ti turbine, fast spool');
add('turbo', 'tu-g25', 'G25-660 pair', 'Garrett', 6200, 13.5, 3, 0.993, { boostMax: 1.45, power: 0.008 }, { c: 0xd0d4dc }, 'Holds 1.45 bar');
add('turbo', 'tu-pure', 'Billet-wheel hybrid pair', 'Pure Turbos', 7400, 15.5, 3, 0.986, { boostMax: 1.6, power: 0.006 }, { c: 0x2a6fd6 }, 'Most boost, least durable');
add('turbo', 'tu-works', 'Works motorsport turbos', 'Homologated Evo kit', 14500, 12.8, 4, 0.994, { boostMax: 1.5, power: 0.012 }, { c: 0xe0b020 }, 'Factory GT3 units');

add('intercooler', 'ic-stock', 'Production charge cooler', 'OEM', 1500, 9.5, 1, 0.99, {}, { c: 0x8a8f9c }, 'Heat soaks in traffic');
add('intercooler', 'ic-mishimoto', 'Bar-and-plate intercooler', 'Mishimoto', 1300, 8.8, 2, 0.994, { knock: 0.6 }, { c: 0xb4bac6 }, 'Larger core');
add('intercooler', 'ic-wagner', 'Competition intercooler', 'Wagner Tuning', 1900, 9.0, 2, 0.995, { knock: 0.9 }, { c: 0xc8ccd6 }, 'Tube-fin competition core');
add('intercooler', 'ic-csf', 'Charge-air cooler upgrade', 'CSF Radiators', 2400, 8.2, 3, 0.996, { knock: 1.2, power: 0.003 }, { c: 0x22242c }, 'Lower intake temperature');
add('intercooler', 'ic-pwr', 'Motorsport charge-air cooler', 'PWR', 4600, 7.0, 4, 0.997, { knock: 2, power: 0.006 }, { c: 0x15161b, c2: 0x2a6fd6 }, 'GT3 supplier');

add('oilcooler', 'oc-stock', 'Oil-to-water heat exchanger', 'OEM', 300, 2.2, 1, 0.975, {}, {}, 'Road unit');
add('oilcooler', 'oc-mocal', '34-row oil cooler', 'Mocal', 430, 2.6, 2, 0.988, {}, {}, 'Air-cooled');
add('oilcooler', 'oc-setrab', 'ProLine 25-row', 'Setrab', 520, 2.4, 2, 0.99, {}, {}, 'Air-cooled, pressure tested');
add('oilcooler', 'oc-laminova', 'Oil-to-water exchanger', 'Laminova', 980, 1.9, 3, 0.993, {}, {}, 'Compact, stable temperature');
add('oilcooler', 'oc-pwr', 'Engine and gearbox oil cooler pack', 'PWR', 2600, 3.6, 4, 0.997, {}, {}, 'Cools the gearbox too');

add('flywheel', 'fw-dual', 'Dual-mass flywheel', 'OEM', 900, 12.5, 1, 0.992, { shift: 0.01 }, {}, 'Heavy, slow to rev');
add('flywheel', 'fw-steel', 'Single-mass steel', 'Clutch Masters', 620, 7.8, 2, 0.996, { shift: 0.004 }, {}, 'Single mass');
add('flywheel', 'fw-fidanza', 'Lightweight aluminium', 'Fidanza', 560, 5.4, 2, 0.994, { shift: 0.002 }, {}, 'Replaceable friction face');
add('flywheel', 'fw-tilton', 'Billet steel flywheel', 'Tilton', 880, 4.2, 3, 0.997, { shift: 0 }, {}, 'For 5.5-inch clutches');
add('flywheel', 'fw-ap', 'Flex plate with starter ring', 'AP Racing', 1250, 2.9, 4, 0.997, { shift: -0.003 }, {}, 'Lowest inertia');

// --- Final drive: shorter gearing accelerates harder, longer reaches a higher top speed.
add('finaldrive', 'fd-xshort', 'Crown wheel and pinion, sprint', 'Drexler', 3200, 4.3, 3, 0.996, { ratio: 1.08 }, {}, 'Shortest: tight circuits');
add('finaldrive', 'fd-short', 'Crown wheel and pinion, short', 'Holinger', 2900, 4.3, 2, 0.996, { ratio: 1.04 }, {}, 'Short');
add('finaldrive', 'fd-std', 'Crown wheel and pinion, standard', 'Hewland', 2600, 4.2, 2, 0.997, { ratio: 1.0 }, {}, 'Homologated ratio');
add('finaldrive', 'fd-long', 'Crown wheel and pinion, long', 'Xtrac', 3100, 4.2, 3, 0.997, { ratio: 0.96 }, {}, 'Long');
add('finaldrive', 'fd-xlong', 'Crown wheel and pinion, extra long', 'Sadev', 3000, 4.2, 3, 0.996, { ratio: 0.92 }, {}, 'Longest: fast circuits');

// --- Suspension hardware.
add('arb', 'ar-stock', 'Tubular road bars', 'OEM', 500, 9.8, 1, 0.999, {}, { c: 0x3a3e4c }, 'Fixed rate');
add('arb', 'ar-eibach', 'Anti-Roll-Kit, adjustable', 'Eibach', 780, 9.2, 2, 0.999, { grip: 0.002 }, { c: 0xd8232a }, 'Two-position ends');
add('arb', 'ar-hr', 'Adjustable hollow bars', 'H&R', 860, 8.6, 2, 0.999, { grip: 0.003 }, { c: 0xd8232a }, 'Hollow, three-position');
add('arb', 'ar-hotchkis', 'Competition sway bars', 'Hotchkis', 1150, 8.9, 2, 0.999, { grip: 0.003 }, { c: 0x2a6fd6 }, 'Greaseable bushings');
add('arb', 'ar-kw', 'Blade-adjustable bar kit', 'KW', 3900, 7.4, 3, 0.998, { grip: 0.006 }, { c: 0x8a35d6 }, 'Blade ends');
add('arb', 'ar-multimatic', 'Cockpit-adjustable blade bars', 'Multimatic', 6400, 6.9, 4, 0.998, { grip: 0.008 }, { c: 0xc8ccd6 }, 'Driver-adjustable in the car');

add('arms', 'am-stock', 'Pressed arms, rubber bushes', 'OEM', 2400, 31, 1, 0.99, { grip: -0.006 }, {}, 'Bushes flex under load');
add('arms', 'am-hardrace', 'Adjustable arms, pillow-ball', 'Hardrace', 3600, 27.5, 2, 0.994, { grip: 0.001 }, {}, 'Hardened bushes');
add('arms', 'am-spl', 'Adjustable arms, spherical bearings', 'SPL Parts', 4800, 26, 2, 0.995, { grip: 0.002 }, {}, 'Full geometry adjustment');
add('arms', 'am-elephant', 'Billet uniball control arms', 'Elephant Racing', 5600, 25, 3, 0.996, { grip: 0.004 }, {}, 'Billet, uniball joints');
add('arms', 'am-tarett', 'Machined aluminium wishbone kit', 'Tarett Engineering', 7200, 23.5, 3, 0.996, { grip: 0.006 }, {}, 'Lightweight machined arms');
add('arms', 'am-evo', 'GT3 wishbones, aerospace rod ends', 'Homologated Evo kit', 14800, 22, 4, 0.997, { grip: 0.008 }, {}, 'Factory double wishbones');

add('uprights', 'up-stock', 'Cast uprights, road bearings', 'OEM', 2200, 26, 1, 0.985, {}, {}, 'Road hubs');
add('uprights', 'up-skf', 'Motorsport bearing and hub kit', 'SKF Racing', 3400, 24.5, 2, 0.993, { eff: 0.001 }, {}, 'Low-friction bearings');
add('uprights', 'up-fab', 'Fabricated steel uprights', 'Elephant Racing', 5200, 22, 3, 0.992, { grip: 0.002 }, {}, 'Corrected geometry');
add('uprights', 'up-pankl', 'Billet 7075 uprights', 'Pankl Racing Systems', 12800, 19, 4, 0.996, { grip: 0.003, eff: 0.002 }, {}, 'Machined from billet');
add('uprights', 'up-evo', 'Forged uprights, centre-lock hubs', 'Homologated Evo kit', 16500, 18.2, 4, 0.997, { grip: 0.004, eff: 0.002 }, {}, 'Factory GT3 corners');

add('rack', 'rk-stock', 'Road electric power steering', 'OEM', 1500, 10.5, 1, 0.995, {}, {}, 'Slow ratio');
add('rack', 'rk-quaife', 'Quick-ratio rack', 'Quaife', 1800, 8.8, 2, 0.996, { comfort: 0.01, grip: 0.001 }, {}, 'Fewer turns lock to lock');
add('rack', 'rk-dce', 'Electric power steering kit', 'DC Electronics', 2600, 8.2, 3, 0.996, { comfort: 0.03 }, {}, 'Adjustable assistance');
add('rack', 'rk-woodward', 'Motorsport hydraulic rack', 'Woodward', 3200, 7.6, 3, 0.996, { comfort: 0.02, grip: 0.002 }, {}, 'Best feel');
add('rack', 'rk-kyb', 'Motorsport EPS, titanium rack', 'KYB', 9800, 6.4, 4, 0.997, { comfort: 0.04, grip: 0.003 }, {}, 'Factory GT supplier');

// --- Brake hydraulics and cooling.
add('lines', 'bl-rubber', 'Rubber hoses, DOT 4 fluid', 'OEM', 180, 2.6, 1, 0.985, { brake: -0.02 }, {}, 'Spongy when hot');
add('lines', 'bl-goodridge', 'Braided stainless lines, RBF 600', 'Goodridge', 420, 2.2, 2, 0.995, { brake: 0.004 }, {}, 'Firm pedal');
add('lines', 'bl-hel', 'Braided lines, SRF fluid', 'HEL Performance', 520, 2.2, 3, 0.997, { brake: 0.008 }, {}, 'Highest wet boiling point');
add('lines', 'bl-endless', 'PTFE smooth-bore lines, RF-650', 'Endless', 760, 2.1, 3, 0.997, { brake: 0.01 }, {}, 'Racing fluid');
add('lines', 'bl-staubli', 'Dry-break motorsport lines', 'Stäubli', 2400, 2.0, 4, 0.998, { brake: 0.012 }, {}, 'Quick-change calipers');

add('ducts', 'du-none', 'No brake ducting', 'None', 0, 0, 1, 0.97, { brake: -0.03 }, {}, 'Brakes fade');
add('ducts', 'du-verus', 'Backing-plate duct kit', 'Verus Engineering', 620, 2.4, 2, 0.992, { brake: 0.006, cd: 0.002 }, {}, 'Hose to the disc centre');
add('ducts', 'du-ap', 'Carbon brake ducts', 'AP Racing', 1900, 1.8, 3, 0.995, { brake: 0.012, cd: 0.003 }, {}, 'Carbon scoops');
add('ducts', 'du-evo', 'Carbon ducts with blanking plates', 'Homologated Evo kit', 4800, 1.6, 4, 0.997, { brake: 0.016, cd: 0.002 }, {}, 'Tunable cooling');

add('nuts', 'nu-steel', 'Steel wheel nuts', 'OEM', 120, 1.9, 1, 0.998, {}, {}, 'Five per wheel');
add('nuts', 'nu-rays', 'Forged aluminium racing nuts', 'RAYS', 260, 0.8, 2, 0.996, {}, {}, 'Light, five per wheel');
add('nuts', 'nu-bbs', 'Centre-lock nuts, steel', 'BBS Motorsport', 1400, 2.4, 3, 0.998, { pit: 6 }, {}, 'One nut per wheel');
add('nuts', 'nu-krontec', 'Centre-lock aluminium, retained', 'Krontec', 2900, 1.5, 4, 0.998, { pit: 7.5 }, {}, 'Nut stays in the gun socket');

// --- Electronics.
add('pdm', 'pd-fuses', 'Fuse and relay panel', 'OEM', 300, 3.2, 1, 0.975, {}, {}, 'Fuses and relays');
add('pdm', 'pd-ecumaster', 'PMU16', 'Ecumaster', 1150, 0.5, 2, 0.993, {}, {}, 'Sixteen solid-state outputs');
add('pdm', 'pd-aim', 'PDM32', 'AiM', 2600, 0.8, 3, 0.995, {}, {}, 'Thirty-two outputs');
add('pdm', 'pd-motec', 'PDM30', 'MoTeC', 3400, 0.9, 3, 0.997, {}, {}, 'Programmable logic');
add('pdm', 'pd-cosworth', 'IPS32 Mk2', 'Cosworth', 4900, 1.0, 4, 0.998, {}, {}, 'Intelligent power system');
add('pdm', 'pd-bosch', 'PowerBox PBX 190', 'Bosch Motorsport', 6900, 1.6, 4, 0.998, {}, {}, 'GT3 standard unit');

add('sensors', 'sn-stock', 'Production sensor set', 'OEM', 600, 1.6, 1, 0.99, {}, {}, 'Engine sensors only');
add('sensors', 'sn-bosch-basic', 'Wheel speed and pressure pack', 'Bosch Motorsport', 2400, 1.9, 2, 0.995, { comfort: 0.01 }, {}, 'Better traction control signals');
add('sensors', 'sn-bf1', 'Tyre pressure monitoring kit', 'bf1systems', 3200, 0.8, 3, 0.996, { wear: -0.015 }, {}, 'Live tyre pressures');
add('sensors', 'sn-izze', 'Tyre and brake infrared pack', 'Izze Racing', 3900, 2.1, 3, 0.996, { comfort: 0.02, wear: -0.01 }, {}, 'Surface temperatures');
add('sensors', 'sn-texys', 'Damper pots and ride-height lasers', 'Texys', 6800, 2.6, 4, 0.996, { grip: 0.003, comfort: 0.02 }, {}, 'Chassis set-up data');
add('sensors', 'sn-bosch-full', 'Full GT3 sensor suite', 'Bosch Motorsport', 9800, 3.0, 4, 0.997, { grip: 0.004, wear: -0.02, comfort: 0.03 }, {}, 'Everything logged');

add('radio', 'ra-none', 'No radio', 'None', 0, 0, 1, 1, { comfort: -0.02 }, {}, 'Pit board only');
add('radio', 'ra-kenwood', 'NX-1300 car kit', 'Kenwood', 780, 1.2, 2, 0.994, { comfort: 0.01 }, {}, 'Analogue and digital');
add('radio', 'ra-stilo', 'Digital race radio and helmet kit', 'Stilo', 1500, 1.1, 3, 0.996, { comfort: 0.02 }, {}, 'Helmet-integrated');
add('radio', 'ra-sampson', 'Full-duplex race radio', 'Sampson Racing Communications', 1900, 1.4, 3, 0.996, { comfort: 0.02 }, {}, 'Talk without pressing');
add('radio', 'ra-zeronoise', 'Fearless intercom system', 'Zeronoise', 2300, 1.0, 3, 0.997, { comfort: 0.025 }, {}, 'Noise cancelling');
add('radio', 'ra-mrtc', 'Noise-cancelling intercom', 'MRTC', 2900, 1.3, 4, 0.997, { comfort: 0.03 }, {}, 'Endurance paddock standard');

const EXTRA_SLOTS: readonly SlotDef[] = [
  { id: 'cage', label: 'Roll cage', group: 'Chassis & safety', internal: true },
  { id: 'mirrors', label: 'Mirrors & rear view', group: 'Chassis & safety', internal: false },
  { id: 'lights', label: 'Lighting', group: 'Chassis & safety', internal: false },
  { id: 'cooldriver', label: 'Driver cooling', group: 'Chassis & safety', internal: true },
  { id: 'canards', label: 'Dive planes', group: 'Aero', internal: false },
  { id: 'louvers', label: 'Bonnet & arch vents', group: 'Aero', internal: false },
  { id: 'pistons', label: 'Pistons', group: 'Engine internals', internal: true },
  { id: 'rods', label: 'Connecting rods', group: 'Engine internals', internal: true },
  { id: 'crank', label: 'Crankshaft', group: 'Engine internals', internal: true },
  { id: 'valvetrain', label: 'Cams & valvetrain', group: 'Engine internals', internal: true },
  { id: 'oil', label: 'Oil system', group: 'Engine internals', internal: true },
  { id: 'flywheel', label: 'Flywheel', group: 'Engine internals', internal: true },
  { id: 'throttle', label: 'Throttle bodies', group: 'Engine & fuel', internal: true },
  { id: 'injectors', label: 'Injectors', group: 'Engine & fuel', internal: true },
  { id: 'fuelpump', label: 'Fuel pump', group: 'Engine & fuel', internal: true },
  { id: 'ignition', label: 'Ignition', group: 'Engine & fuel', internal: true },
  { id: 'turbo', label: 'Turbochargers', group: 'Engine & fuel', internal: true, turboOnly: true },
  { id: 'intercooler', label: 'Intercooler', group: 'Engine & fuel', internal: true, turboOnly: true },
  { id: 'oilcooler', label: 'Oil cooler', group: 'Engine & fuel', internal: true },
  { id: 'finaldrive', label: 'Final drive', group: 'Drivetrain', internal: true },
  { id: 'arb', label: 'Anti-roll bars', group: 'Suspension & steering', internal: true },
  { id: 'arms', label: 'Wishbones', group: 'Suspension & steering', internal: true },
  { id: 'uprights', label: 'Uprights & hubs', group: 'Suspension & steering', internal: true },
  { id: 'rack', label: 'Steering rack', group: 'Suspension & steering', internal: true },
  { id: 'lines', label: 'Brake lines & fluid', group: 'Brakes', internal: true },
  { id: 'ducts', label: 'Brake cooling', group: 'Brakes', internal: false },
  { id: 'nuts', label: 'Wheel nuts', group: 'Wheels & tyres', internal: false },
  { id: 'pdm', label: 'Power distribution', group: 'Electronics', internal: true },
  { id: 'sensors', label: 'Sensors', group: 'Electronics', internal: true },
  { id: 'radio', label: 'Team radio', group: 'Electronics', internal: true },
];

const GROUP_ORDER = [
  'Chassis & safety', 'Aero', 'Engine & fuel', 'Engine internals', 'Drivetrain',
  'Suspension & steering', 'Brakes', 'Wheels & tyres', 'Electronics',
];

/** Every slot of a GT3 car, grouped for display. */
export const SLOTS: readonly SlotDef[] = [...BASE_SLOTS, ...EXTRA_SLOTS]
  .map((slot, index) => ({ slot, index }))
  .sort((a, b) => GROUP_ORDER.indexOf(a.slot.group) - GROUP_ORDER.indexOf(b.slot.group) || a.index - b.index)
  .map((x) => x.slot);

export const PARTS: readonly Part[] = parts;

const byId = new Map(parts.map((p) => [p.id, p]));
if (byId.size !== parts.length) throw new Error('Duplicate part id in catalog');

export function getPart(id: string): Part | undefined {
  return byId.get(id);
}

export function partsForSlot(slot: SlotId): Part[] {
  return parts.filter((p) => p.slot === slot);
}

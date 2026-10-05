import type { TrackDef } from '../sim/track';

/**
 * Brands Hatch Indy layout, traced by eye from the circuit map: Brabham
 * Straight, Paddock Hill Bend, Druids hairpin, Graham Hill Bend, Cooper
 * Straight, Surtees, McLaren, Clearways and Clark Curve. Run clockwise.
 */
export const BRANDS_HATCH_INDY: TrackDef = {
  id: 'brands-hatch-indy',
  name: 'Brands Hatch Indy',
  publicName: 'Kentish Bowl',
  country: 'GBR',
  lengthM: 1944,
  widthM: 12,
  difficulty: 2,
  defaultLaps: 6,
  points: [
    [0, 0],
    [130, 4],
    [235, 22],
    [300, 72],
    [322, 150],
    [334, 232],
    [338, 292],
    [312, 330],
    [272, 322],
    [254, 282],
    [252, 220],
    [240, 160],
    [196, 122],
    [110, 108],
    [10, 110],
    [-80, 116],
    [-150, 136],
    [-205, 176],
    [-262, 198],
    [-322, 184],
    [-362, 138],
    [-368, 78],
    [-336, 28],
    [-270, 4],
    [-180, -4],
    [-90, -3],
  ],
};

/**
 * Monza, traced by eye: the long main straight, first chicane, Curva Grande,
 * second chicane, the two Lesmos, Ascari and the Parabolica.
 */
export const MONZA: TrackDef = {
  id: 'monza',
  name: 'Autodromo Nazionale Monza',
  publicName: 'Parco Reale',
  country: 'ITA',
  lengthM: 5793,
  widthM: 12,
  difficulty: 3,
  defaultLaps: 4,
  points: [
    [0, 0], [300, 0], [600, 0], [668, 6], [706, 26], [744, 40], [840, 42],
    [980, 66], [1085, 150], [1125, 285], [1128, 420], [1140, 462], [1152, 505], [1152, 570],
    [1140, 655], [1090, 705], [1010, 720], [935, 708], [860, 672], [700, 632],
    [470, 598], [392, 580], [345, 556], [300, 566], [250, 600], [170, 608],
    [-100, 604], [-350, 602], [-455, 586], [-535, 520], [-570, 400], [-555, 215],
    [-495, 95], [-400, 32], [-250, 6], [-120, 0],
  ],
};

/** Red Bull Ring, traced by eye: short lap, long climbs, three heavy braking zones. */
export const RED_BULL_RING: TrackDef = {
  id: 'red-bull-ring',
  name: 'Red Bull Ring',
  publicName: 'Styrian Hills',
  country: 'AUT',
  lengthM: 4318,
  widthM: 12,
  difficulty: 3,
  defaultLaps: 5,
  points: [
    [0, 0], [170, 0], [330, 0], [470, 12], [540, 62], [556, 145], [560, 300], [546, 440],
    [520, 522], [462, 552], [408, 512], [336, 400], [300, 332], [258, 290], [188, 280],
    [110, 310], [42, 372], [-22, 448], [-92, 470], [-168, 450], [-218, 382], [-230, 282],
    [-226, 160], [-200, 70], [-142, 16], [-62, 0],
  ],
};

/** Interlagos, traced by eye and run anticlockwise: Senna S, the back straight, the lake and the twisting infield. */
export const INTERLAGOS: TrackDef = {
  id: 'interlagos',
  name: 'Autodromo Jose Carlos Pace (Interlagos)',
  publicName: 'Lago Azul',
  country: 'BRA',
  lengthM: 4309,
  widthM: 12,
  difficulty: 4,
  defaultLaps: 5,
  pitSide: 0,
  points: [
    [0, 0], [160, 0], [300, -2], [420, -8], [490, -46], [540, -52], [600, -92], [612, -172],
    [562, -242], [470, -272], [200, -292], [-50, -302], [-150, -292], [-212, -242], [-218, -172],
    [-182, -132], [-110, -137], [-40, -152], [30, -187], [110, -197], [172, -162], [166, -116],
    [120, -95], [0, -90], [-150, -90], [-262, -80], [-332, -55], [-357, -10], [-332, 25],
    [-250, 30], [-120, 8],
  ],
};

export const TRACKS: readonly TrackDef[] = [BRANDS_HATCH_INDY, RED_BULL_RING, INTERLAGOS, MONZA];

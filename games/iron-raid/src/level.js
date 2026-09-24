// Stage 1 "Coastal Village" layout. All x values are world pixels; ground top is y = 196.
// Edit this file to rearrange the stage.
export const LEVEL = {
  width: 3600,
  groundEnd: 3330, // after this: open water
  dockStart: 2760,
  bossScroll: 3100,
  bossX: 3336,

  // Scenery (no gameplay effect)
  huts: [300, 880, 1320, 2050, 2380],
  palms: [120, 520, 700, 1150, 1500, 1720, 1980, 2250, 2600],
  sandbags: [760, 1640, 2150],
  campfires: [1360],

  // One-way platforms (hut roofs etc.): [x, y, width]
  platforms: [[896, 150, 40], [1336, 150, 40], [2066, 150, 40], [2396, 150, 40]],
  // Solid crate stacks: [x, height in crates]
  crateStacks: [[1580, 2], [2920, 2], [2960, 1]],

  // Destructibles: [type, x]
  props: [['barrel', 590], ['barrel', 606], ['crate', 1100], ['barrel', 1700], ['crate', 2280], ['barrel', 2840], ['crate', 3060]],

  // Prisoners: [x, item]
  pows: [[470, 'B'], [1060, 'G'], [1880, 'S'], [2470, 'R'], [2640, 'food'], [3010, 'G']],

  // The player's slug parked here
  tank: 1220,

  // Placed enemies: [x, kind, state, y?]
  soldiers: [
    [340, 'rifle', 'idle'], [372, 'rifle', 'idle'],
    [916, 'grenadier', 'idle', 150],
    [1370, 'rifle', 'idle'], [1400, 'knife', 'idle'],
    [2090, 'rifle', 'idle', 150],
    [2420, 'grenadier', 'idle', 150],
    [2900, 'rifle', 'idle'], [2940, 'grenadier', 'idle', 160],
  ],

  // Events fire when the player passes x. Locks freeze the camera until every spawn is dead.
  events: [
    { x: 40, type: 'banner', text: 'MISSION 1', sub: 'START!' },
    {
      x: 700, type: 'lock', scroll: 560,
      spawns: [
        { t: 0.3, kind: 'rifle' }, { t: 1.2, kind: 'rifle' }, { t: 2.2, kind: 'knife' },
        { t: 3.5, kind: 'rifle' }, { t: 4.2, kind: 'grenadier' }, { t: 5.5, kind: 'knife' }, { t: 6.2, kind: 'rifle' },
      ],
    },
    { x: 1180, type: 'hint', text: 'JUMP IN!' },
    {
      x: 1560, type: 'lock', scroll: 1470,
      spawns: [{ t: 0.5, kind: 'apc', stopX: 1780 }, { t: 2, kind: 'rifle' }, { t: 4, kind: 'rifle' }, { t: 7, kind: 'knife' }],
    },
    { x: 1950, type: 'wave', spawns: [{ t: 0, kind: 'knife' }, { t: 0.4, kind: 'knife' }, { t: 0.8, kind: 'knife' }] },
    {
      x: 2250, type: 'lock', scroll: 2160,
      spawns: [{ t: 0.5, kind: 'heli' }, { t: 2.5, kind: 'rifle' }, { t: 5, kind: 'grenadier' }, { t: 7, kind: 'rifle' }],
    },
    { x: 2700, type: 'wave', spawns: [{ t: 0, kind: 'rifle' }, { t: 1, kind: 'rifle' }] },
    { x: 3150, type: 'boss' },
  ],
};

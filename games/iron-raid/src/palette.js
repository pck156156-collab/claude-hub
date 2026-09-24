// Palette from the design doc (section 6.2) plus a few supporting shades.
export const C = {
  outline: '#1b1b22',
  white: '#ffffff',
  // player
  olive: '#5b6b3a', oliveS: '#3f4a28', oliveL: '#7a8a4e',
  red: '#c8392b', redS: '#8e2219', redL: '#e8604c',
  khaki: '#8a7a4a', khakiS: '#6a5c36',
  hair: '#5a3a22',
  // enemy
  grey: '#6e7780', greyS: '#3e4a57', greyL: '#9aa3ab',
  // skin
  skin: '#f2c79b', skinS: '#c98e62', skinD: '#8a5a3c',
  // metal
  gun: '#4a4e57', gunS: '#2c2f36', gunL: '#7c8290',
  // fire
  fire0: '#fff3b0', fire1: '#ffb23f', fire2: '#e5542c', fire3: '#5a2a1e',
  smoke: '#5c5550', smokeL: '#8a827a',
  // world
  sky0: '#4da3d9', sky1: '#6dbbe8', sky2: '#8fd3f4', sky3: '#b8e6f8',
  sea: '#3a8fc0', seaL: '#6cc0e0', seaD: '#23628a',
  sand: '#e6c98a', sandS: '#c9a866', dirt: '#9a6b45', dirtS: '#7a5236',
  leaf: '#4f8a3a', leafS: '#2f5a2a', leafL: '#78b04a', trunk: '#8a6038', trunkS: '#5e3f24',
  wood: '#a8754a', woodS: '#74502f', woodL: '#c89660',
  thatch: '#d9b05a', thatchS: '#a5803a',
  far: '#7fb3cc', farS: '#5e9cb8', mid: '#3f6e5a',
  gold: '#ffd54f', goldS: '#c9981f',
  cloth: '#e8e0c8', clothS: '#bfb391',
  blue: '#3a7fd0', glass: '#9fe3ff',
};

export function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

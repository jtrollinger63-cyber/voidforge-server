// Track layouts (closed loops of control points, in metres) and per-track visual themes.
// Sample 0 (the first control point) is the start/finish line; the grid is behind it.

export const THEMES = {
  greenfield: {
    name: 'Greenfield', night: false,
    skyTop: '#2f7fd6', skyMid: '#7fb9ee', skyHorizon: '#dcefff', fog: '#cfe6fa', fogNear: 160, fogFar: 900,
    ground: '#5f9c3f', groundDark: '#4c8433', road: '#3b3d42',
    sun: '#fff4e0', sunIntensity: 3.0, sunDir: [-0.55, 0.75, -0.35], hemiSky: '#bfdcff', hemiGround: '#5a7a3a', hemiIntensity: 0.9, envIntensity: 0.55,
    scenery: 'pine', hills: ['#5d7f4a', '#6e8f5a'], dust: '#8a7a5a',
  },
  dune: {
    name: 'Dune', night: false,
    skyTop: '#2d78c4', skyMid: '#e7b98a', skyHorizon: '#ffe6bf', fog: '#f0cfa4', fogNear: 120, fogFar: 820,
    ground: '#d9ab6a', groundDark: '#c8975a', road: '#4a4440',
    sun: '#ffd9a0', sunIntensity: 3.4, sunDir: [0.6, 0.55, 0.45], hemiSky: '#ffe3bf', hemiGround: '#b9824a', hemiIntensity: 0.95, envIntensity: 0.5,
    scenery: 'desert', hills: ['#c08a54', '#d29c62'], dust: '#d9b27a',
  },
  midnight: {
    name: 'Midnight', night: true,
    skyTop: '#04081c', skyMid: '#0c1a3f', skyHorizon: '#2a3d72', fog: '#0a1430', fogNear: 60, fogFar: 640,
    ground: '#1c3a2a', groundDark: '#162e22', road: '#2a2c33',
    sun: '#9db8ff', sunIntensity: 1.1, sunDir: [-0.4, 0.8, 0.3], hemiSky: '#3b55a0', hemiGround: '#101a2c', hemiIntensity: 0.55, envIntensity: 0.18,
    scenery: 'night', hills: ['#0d1a2e', '#12233b'], dust: '#6a7a9a',
  },
};

export const TRACKS = [
  {
    id: 'greenfield', name: 'Greenfield GP', theme: 'greenfield', width: 26, blurb: 'Fast sweepers and one tight hairpin.', startAt: [200, 0],
    points: [
      [0, 0], [170, 0], [340, -4], [470, -40], [560, -130], [575, -250], [520, -340], [420, -375],
      [330, -330], [290, -250], [210, -205], [120, -240], [60, -320], [-40, -360], [-150, -330],
      [-220, -250], [-200, -150], [-120, -80], [-50, -35],
    ],
  },
  {
    id: 'dune', name: 'Dune Rally', theme: 'dune', width: 24, blurb: 'Twisty desert run with a long back straight.', startAt: [280, 522],
    points: [
      [110, -88], [20, -86], [-27, -68], [-46, -22], [-27, 24], [20, 42], [140, 40], [270, 70], [330, 155], [300, 250], [200, 300], [90, 280], [10, 330],
      [-20, 430], [60, 510], [200, 530], [360, 510], [520, 460], [640, 360], [650, 220], [600, 100],
      [520, 0], [520, -120], [420, -190], [280, -175], [180, -125],
    ],
  },
  {
    id: 'midnight', name: 'Midnight Ridge', theme: 'midnight', width: 26, blurb: 'Flowing night circuit lit by street lamps.', startAt: [300, 0],
    points: [
      [0, 0], [200, 0], [400, 0], [560, 40], [660, 130], [670, 250], [600, 340], [490, 360],
      [400, 310], [350, 230], [270, 190], [180, 220], [130, 300], [60, 360], [-60, 360],
      [-150, 300], [-170, 200], [-120, 110], [-50, 45],
    ],
  },
];

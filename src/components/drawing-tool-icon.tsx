import type {DrawingKind} from '../lib/drawing-definitions';

type Glyph = {
  outline: string;
  guide?: string;
  shade?: string;
  anchors?: readonly (readonly [number, number])[];
};

// Geometry in a 24-unit grid. The points are the handles the user places.
const glyphs: Record<DrawingKind, Glyph> = {
  trend: {
    outline: 'M4 18 20 6', anchors: [[4, 18], [20, 6]],
  },
  ray: {
    outline: 'M4 18 20 6', anchors: [[4, 18], [12, 12]],
    guide: 'M20 6 22 4.5',
  },
  extended: {
    outline: 'M7 16 17 8', anchors: [[7, 16], [17, 8]],
    guide: 'M2 20 7 16M17 8 22 4',
  },
  arrow: {
    outline: 'M4 19 19 5M12 5h7v7', anchors: [[4, 19]],
  },
  info: {
    outline: 'M4 18 13 8M15 5h6v7h-6zM17 8.5h2',
    anchors: [[4, 18], [13, 8]],
  },
  hline: {outline: 'M3 12h18', anchors: [[12, 12]]},
  hray: {outline: 'M5 12h16', anchors: [[5, 12]]},
  vline: {outline: 'M12 3v18', anchors: [[12, 12]]},
  cross: {outline: 'M3 12h18M12 3v18', anchors: [[12, 12]]},
  channel: {
    outline: 'M4 18 20 10M4 12 20 4',
    shade: 'M4 12 20 4v6L4 18z', anchors: [[4, 18], [20, 10], [4, 12]],
  },
  regression: {
    outline: 'M3 18h4l3-6 4 2 5-7h2',
    guide: 'M3 13 21 3M3 22 21 12',
  },
  pitchfork: {
    outline: 'M4 19 20 5M7 9l7-6M12 18l9-8',
    anchors: [[4, 19], [7, 9], [12, 18]],
  },
  fib: {
    outline: 'M5 5h15M5 9h15M5 12h15M5 16h15M5 20h15',
    guide: 'M5 20 20 5', anchors: [[5, 20], [20, 5]],
  },
  fibExtension: {
    outline: 'M3 20 10 11l5 4M15 15h6M15 10h6M15 5h6',
    guide: 'M15 15V5', anchors: [[3, 20], [10, 11], [15, 15]],
  },
  fibChannel: {
    outline: 'M4 19l16-8M4 14l16-8M4 10l12-6',
    guide: 'M4 19V10', anchors: [[4, 19], [20, 11], [4, 14]],
  },
  fibTime: {
    outline: 'M4 5v14M8 8v11M13 5v14M20 5v14',
    guide: 'M4 19h16', anchors: [[4, 19], [8, 19]],
  },
  fibFan: {
    outline: 'M4 19 20 5M4 19 20 10M4 19l16-3',
    guide: 'M20 5v12', anchors: [[4, 19], [20, 5]],
  },
  gannBox: {
    outline: 'M4 5h16v14H4zM4 19 20 5M4 5l16 14M12 5v14M4 12h16',
    anchors: [[4, 19], [20, 5]],
  },
  gannFan: {
    outline: 'M4 19 11 4M4 19 16 5M4 19 21 9M4 19l17-4',
    anchors: [[4, 19], [16, 5]],
  },
  rect: {
    outline: 'M5 6h14v12H5z', shade: 'M5 6h14v12H5z',
    anchors: [[5, 6], [19, 18]],
  },
  rotated: {
    outline: 'M3 13 15 5l6 8-12 8z', anchors: [[3, 13], [15, 5], [21, 13]],
  },
  circle: {
    outline: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    guide: 'M12 12h8', anchors: [[12, 12], [20, 12]],
  },
  ellipse: {
    outline: 'M21 12a9 5.5 0 1 1-18 0 9 5.5 0 0 1 18 0Z',
    guide: 'M3 11V6.5h5M16 17.5h5V13',
  },
  triangle: {
    outline: 'M4 18 10 5l10 13Z', anchors: [[4, 18], [10, 5], [20, 18]],
  },
  polyline: {
    outline: 'M4 19 9 8l6 7 5-8', anchors: [[4, 19], [9, 8], [15, 15], [20, 7]],
  },
  brush: {
    outline: 'M3 19c4 1 6-1 7-4l-2-2c-4 0-3 4-5 6Zm5-6L18 4c1-1 3 1 2 2l-10 9',
    shade: 'M3 19c4 1 6-1 7-4l-2-2c-4 0-3 4-5 6Z',
  },
  highlighter: {
    outline: 'M7 17l-1-4 9-9 4 4-9 9H7Zm0 0-3 3m11-16 4 4M9 20h11',
    shade: 'M6 13l9-9 4 4-9 9H7Z',
  },
  curve: {
    outline: 'M4 17C7 4 16 4 20 17',
    guide: 'M4 17 12 7l8 10', anchors: [[4, 17], [12, 7], [20, 17]],
  },
  doubleCurve: {
    outline: 'M4 16c4-13 5-13 8-4s5 9 8-5',
    guide: 'M4 16 8 5m8 14 4-12', anchors: [[4, 16], [8, 5], [16, 19], [20, 7]],
  },
  arc: {
    outline: 'M4 16a9 9 0 0 1 16 0', guide: 'M4 16h16', anchors: [[4, 16], [20, 16]],
  },
  abcd: {
    outline: 'M4 5 9 15l5-5 6 10', anchors: [[4, 5], [9, 15], [14, 10], [20, 20]],
  },
  xabcd: {
    outline: 'M3 18 8 5l4 8 4-5 5 10',
    shade: 'M3 18 8 5l4 8Z M12 13l4-5 5 10Z',
    anchors: [[3, 18], [8, 5], [12, 13], [16, 8], [21, 18]],
  },
  headShoulders: {
    outline: 'M3 16 6 9l3 6 3-11 3 11 3-6 3 7',
    guide: 'M3 17h18', anchors: [[6, 9], [12, 4], [18, 9]],
  },
  elliott: {
    outline: 'M3 20 7 13l3 3 4-9 3 4 4-7', anchors: [[7, 13], [14, 7], [21, 4]],
  },
  elliottABC: {
    outline: 'M3 5 8 13l5-4 8 11', anchors: [[8, 13], [13, 9], [21, 20]],
  },
  cycle: {outline: 'M4 17a4 4 0 0 1 8 0 4 4 0 0 1 8 0M4 17h16', anchors: [[4, 17], [12, 17]]},
  ruler: {outline: 'M3 15 15 3l6 6L9 21zM7 11l2 2m1-5 2 2m1-5 2 2'},
  priceRange: {outline: 'M5 5h14M5 19h14M12 6v12m-3-9 3-3 3 3m-6 6 3 3 3-3'},
  dateRange: {outline: 'M5 5v14M19 5v14M6 12h12m-9-3-3 3 3 3m6-6 3 3-3 3'},
  position: {
    outline: 'M4 5h16v14H4zM8 15l8-6m-3 0h3v3',
    shade: 'M4 5h16v14H4z', anchors: [[4, 19], [20, 5]],
  },
  long: {
    outline: 'M4 5h16v14H4zM4 14h16m-8-2V7m-2.5 2.5L12 7l2.5 2.5',
    shade: 'M4 5h16v9H4z',
  },
  short: {
    outline: 'M4 5h16v14H4zM4 10h16m-8 2v5m-2.5-2.5L12 17l2.5-2.5',
    shade: 'M4 10h16v9H4z',
  },
  vwap: {
    outline: 'M4 19h16M5 17V7l5 3 4-4 6 2M7 14l4-1 4-2 5 1',
    anchors: [[5, 17]],
  },
  text: {outline: 'M5 7V5h14v2M12 5v14m-3 0h6'},
  note: {outline: 'M5 4h14v11l-5 5H5zm9 16v-5h5M8 9h8m-8 3h5'},
  priceLabel: {
    outline: 'M4 12 9 7h11v10H9zM12 10h5m-5 4h5', anchors: [[4, 12]],
  },
  callout: {
    outline: 'M9 4h12v9H9zM4 20l5-7m3-6h6m-6 3h4', anchors: [[4, 20]],
  },
  flag: {outline: 'M6 20V4c4-3 8 3 13 0v9c-5 3-9-3-13 0', anchors: [[6, 20]]},
  markUp: {outline: 'M12 4 5 11h4v8h6v-8h4z', shade: 'M12 4 5 11h4v8h6v-8h4z'},
  markDown: {outline: 'M12 20 5 13h4V5h6v8h4z', shade: 'M12 20 5 13h4V5h6v8h4z'},
  angle: {outline: 'M4 18h16M4 18 18 5M11 18a7 7 0 0 0-2-5', anchors: [[4, 18]]},
  flatChannel: {
    outline: 'M4 17h16M4 13 20 5', shade: 'M4 13 20 5v12H4z',
    anchors: [[4, 17], [4, 13], [20, 5]],
  },
  disjoint: {
    outline: 'M4 19l16-2M4 8l16-3', guide: 'M4 8v11m16-14v12',
    anchors: [[4, 19], [20, 17], [4, 8], [20, 5]],
  },
  insideFork: {
    outline: 'M5 19 20 6M9 10l7-6M12 17l9-7', guide: 'M5 19 7 13l5 4',
    anchors: [[7, 13], [9, 10], [12, 17]],
  },
  schiff: {
    outline: 'M5 15 20 5M7 9l8-5M12 18l9-7', guide: 'M5 21v-6',
    anchors: [[5, 21], [7, 9], [12, 18]],
  },
  modifiedSchiff: {
    outline: 'M8 15 21 6M9 8l7-4M13 18l8-6', guide: 'M3 20l5-5',
    anchors: [[3, 20], [9, 8], [13, 18]],
  },
  fibTrendTime: {
    outline: 'M3 17l5-8 5 5M13 14v6M17 7v13M21 3v17',
    guide: 'M13 20h8', anchors: [[3, 17], [8, 9], [13, 14]],
  },
  fibCircles: {
    outline: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    anchors: [[12, 12], [20, 12]],
  },
  fibSpiral: {outline: 'M21 14a8.5 8.5 0 1 1-8.5-8.5 6 6 0 1 1-6 6A3.5 3.5 0 1 1 10 15a1.5 1.5 0 0 1 0-3'},
  fibArcs: {outline: 'M4 17a8 8 0 0 1 16 0M7 17a5 5 0 0 1 10 0M10 17a2 2 0 0 1 4 0', guide: 'M4 17h16'},
  fibWedge: {
    outline: 'M4 19 14 4M4 19l16-6M8 13a7 7 0 0 1 3 3m0-8a12 12 0 0 1 5 6m-3-9a16 16 0 0 1 6 8',
    anchors: [[4, 19], [14, 4], [20, 13]],
  },
  pitchfan: {
    outline: 'M4 20 11 4M4 20 16 7M4 20l17-8M4 20l17-2',
    guide: 'M11 4l10 8', anchors: [[4, 20], [11, 4], [21, 12]],
  },
  gannSquare: {
    outline: 'M4 4h16v16H4zM4 4l16 16M4 20 20 4M4 12h16',
    guide: 'M12 4v16',
  },
  gannFixed: {
    outline: 'M6 8h13v12H6zM6 20 19 8M10 8v12m5-12v12M6 12h13m-13 4h13M4 4h5M4 4v3',
  },
  path: {outline: 'M3 18 8 13l5 3 7-10M15 7l5-1 1 5', anchors: [[3, 18], [8, 13], [13, 16]]},
  arrowMarker: {
    outline: 'M4 16 14 6l-3-1 9-1-1 9-1-3L8 20z',
    shade: 'M4 16 14 6l-3-1 9-1-1 9-1-3L8 20z',
  },
  markLeft: {outline: 'M4 12l7-7v4h9v6h-9v4z', shade: 'M4 12l7-7v4h9v6h-9v4z'},
  markRight: {outline: 'M20 12l-7-7v4H4v6h9v4z', shade: 'M20 12l-7-7v4H4v6h9v4z'},
  cypher: {
    outline: 'M3 19 8 8l4 5 4-9 5 13', guide: 'M3 19l13-15m-4 9 9 4',
    anchors: [[3, 19], [8, 8], [12, 13], [16, 4], [21, 17]],
  },
  trianglePattern: {
    outline: 'M4 6 8 18l5-9 4 6 4-4', guide: 'M4 6l17 5M4 20l17-9',
    anchors: [[4, 6], [8, 18], [13, 9], [17, 15], [21, 11]],
  },
  threeDrives: {
    outline: 'M3 20 6 15l3 3 4-8 3 4 5-9', guide: 'M6 15 21 5',
    anchors: [[6, 15], [13, 10], [21, 5]],
  },
  elliottTriangle: {
    outline: 'M3 5 7 19l5-11 4 8 5-5', guide: 'M3 5l18 6m-18 9 18-9',
    anchors: [[7, 19], [12, 8], [21, 11]],
  },
  elliottDouble: {
    outline: 'M3 6 7 12l2-3 3 7 3-5 6 9',
    anchors: [[7, 12], [12, 16], [21, 20]],
  },
  elliottTriple: {
    outline: 'M3 4 6 10l2-3 4 8 2-4 3 6 2-3 2 6',
    anchors: [[6, 10], [12, 15], [17, 17], [21, 20]],
  },
  timeCycles: {outline: 'M4 6v12m5-12v12m6-12v12m5-12v12', shade: 'M4 6h5v12H4zm11 0h5v12h-5z', guide: 'M4 18h16'},
  sine: {outline: 'M3 12c2-7 4-7 6 0s4 7 6 0 4-7 6 0', guide: 'M3 12h18'},
  forecast: {outline: 'M4 18l6-5m7-6h4v4m0-4-4 4', guide: 'M10 13 17 9', anchors: [[4, 18], [10, 13]]},
  barsPattern: {
    outline: 'M4 11v8m4-12v9m4-12v10M3 14h2m2-4h2m2-3h2',
    guide: 'M16 11v8m4-12v9', anchors: [[16, 19]],
  },
  ghost: {
    outline: 'M5 15v6m0-4h2v2H5m7-10v10m0-7h2v4h-2m6-12v9m0-6h2v3h-2',
    guide: 'M5 19 20 7',
  },
  sector: {outline: 'M5 18h14a14 14 0 0 0-5-11Z', shade: 'M5 18h14a14 14 0 0 0-5-11Z', anchors: [[5, 18]]},
  volumeRange: {
    outline: 'M4 5v14h16V5M7 8h5m-5 4h9m-9 4h6', anchors: [[4, 19], [20, 19]],
  },
  volumeAnchor: {
    outline: 'M5 5v14m3-11h6m-6 4h11m-11 4h8', guide: 'M5 19h15', anchors: [[5, 19]],
  },
  priceNote: {outline: 'M4 16v-8h6l4-3h6v14h-9l-3-3zM12 10h5m-5 4h5', anchors: [[4, 16]]},
  pin: {outline: 'M12 20c-2-3-6-7-6-10a6 6 0 0 1 12 0c0 3-4 7-6 10Z', anchors: [[12, 10]]},
  table: {outline: 'M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9', shade: 'M4 5h16v5H4z'},
  comment: {outline: 'M4 5h16v11h-9l-5 4v-4H4zm4 5h8m-8 3h5'},
  signpost: {outline: 'M8 21V4m0 2h10l3 4-3 4H8m3-4h5', anchors: [[8, 21]]},
  anchoredText: {outline: 'M5 18V5h14M9 10h9m-4.5 0v9m-2 0h4', anchors: [[5, 5]]},
  anchoredNote: {outline: 'M7 4h13v12l-4 4H7zm9 16v-4h4M10 9h7m-7 4h5', anchors: [[7, 4]]},
  image: {outline: 'M4 5h16v14H4zm0 11 5-5 4 4 3-3 4 4', anchors: [[16, 9]]},
  social: {outline: 'M4 5h16v12h-9l-4 3v-3H4zm5 4 6 5m0-5-6 5'},
  symbol: {outline: 'M12 4l2.4 5.1 5.6.8-4 3.9.9 5.7-4.9-2.7-4.9 2.7.9-5.7-4-3.9 5.6-.8Z'},
};

export function DrawingToolIcon({kind, size = 19}: {kind: DrawingKind; size?: number}) {
  const {outline, guide, shade, anchors} = glyphs[kind];
  return <svg className="drawing-tool-icon" data-tool-icon={kind} width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {shade && <path d={shade} fill="currentColor" fillOpacity=".18" stroke="none"/>}
    {guide && <path d={guide} strokeOpacity=".55" strokeWidth="1.25" strokeDasharray="2 2.6"/>}
    <path d={outline}/>
    {anchors?.map(([x, y]) => <circle key={x + ':' + y} cx={x} cy={y} r="1.58" fill="currentColor" stroke="none"/>)}
  </svg>;
}

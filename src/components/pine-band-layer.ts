import type {IPrimitivePaneRenderer, ISeriesPrimitive, SeriesAttachedParameter, UTCTimestamp} from 'lightweight-charts';
import type {BandPoint, PineBand} from '../lib/pine-bands';

function firstAt(points: BandPoint[], time: number) {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid][0] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class PineBandLayer implements ISeriesPrimitive {
  private attachment?: SeriesAttachedParameter;
  private bands: PineBand[];
  constructor(bands: PineBand[]) { this.bands = bands; }
  attached(params: SeriesAttachedParameter) { this.attachment = params; }
  detached() { this.attachment = undefined; }
  private renderer: IPrimitivePaneRenderer = {
    draw: target => {
      if (!this.attachment) return;
      const {chart, series} = this.attachment, scale = chart.timeScale();
      const range = scale.getVisibleRange();
      if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return;
      const {from, to} = range;
      target.useMediaCoordinateSpace(({context}) => {
        for (const band of this.bands) for (const {points, color} of band.runs) {
          if (points.length < 2 || points[0][0] > to || points.at(-1)![0] < from) continue;
          const start = Math.max(0, firstAt(points, from) - 1);
          const end = Math.min(points.length, firstAt(points, to) + 2);
          const bottom: [number, number][] = [];
          context.beginPath();
          for (let i = start; i < end; i++) {
            const [t, a, b] = points[i], x = scale.timeToCoordinate(t as UTCTimestamp);
            const y1 = series.priceToCoordinate(a), y2 = series.priceToCoordinate(b);
            if (x === null || y1 === null || y2 === null) continue;
            if (!bottom.length) context.moveTo(x, y1);
            else context.lineTo(x, y1);
            bottom.push([x, y2]);
          }
          for (let i = bottom.length - 1; i >= 0; i--) context.lineTo(...bottom[i]);
          context.closePath();
          context.fillStyle = color;
          context.fill();
        }
      });
    },
  };
  private views = [{zOrder: () => 'bottom' as const, renderer: () => this.renderer}];
  paneViews() { return this.views; }
}

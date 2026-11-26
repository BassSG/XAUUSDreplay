type PlotSample = {time: number; value: unknown; options?: {color?: unknown}};
type RawPlot = {data: PlotSample[]; options: {plot1?: string; plot2?: string; fillgaps?: boolean;
  overlay?: boolean; color?: unknown; show_last?: number; gradient?: boolean}};
export type BandPoint = [time: number, first: number, second: number];
export type PineBand = {indicatorId: string; overlay: boolean; runs: {color: string; points: BandPoint[]}[]};

export function readPineBand(fill: RawPlot, plots: Record<string, RawPlot>, indicatorId: string, overlay: boolean, from: number): PineBand | null {
  const first = plots[fill.options.plot1 ?? ''], second = plots[fill.options.plot2 ?? ''];
  if (!first || !second || fill.options.gradient) return null;
  const samples = (plot: RawPlot) => new Map(plot.data.map(row => [row.time, row.value]));
  const upper = samples(first), lower = samples(second);
  const band: PineBand = {indicatorId, overlay: first.options.overlay ?? overlay, runs: []};
  let run: PineBand['runs'][number] | undefined;
  const start = fill.options.show_last ? Math.max(0, fill.data.length - fill.options.show_last) : 0;
  for (let i = start; i < fill.data.length; i++) {
    const row = fill.data[i], time = Math.floor(row.time / 1000);
    if (time < from) continue;
    const color = row.options && 'color' in row.options ? row.options.color : fill.options.color;
    if (typeof color !== 'string' || !color || color === 'na') { run = undefined; continue; }
    const a = upper.get(row.time), b = lower.get(row.time);
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      if (fill.options.fillgaps === false) run = undefined;
      continue;
    }
    const point: BandPoint = [time, a, b];
    if (!run || run.color !== color) {
      run = {color, points: []};
      band.runs.push(run);
    }
    // Constant oscillator levels need only the two ends of a horizontal band.
    const last = run.points.at(-1), prior = run.points.at(-2);
    if (prior && last && prior[1] === a && prior[2] === b && last[1] === a && last[2] === b)
      run.points[run.points.length - 1] = point;
    else run.points.push(point);
  }
  return band.runs.length ? band : null;
}

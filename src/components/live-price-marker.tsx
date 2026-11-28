import {useEffect, useLayoutEffect, useState} from 'react';
import type {IPriceLine, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter} from 'lightweight-charts';
import {candleWindow} from '../lib/live-market';
import type {CandleCalendar} from '../lib/engine';

const mint = '#69d4b6';
const priceInk = '#102720';
const timeInk = '#20483d';
const priceFormat = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

export class LivePriceMarker implements ISeriesPrimitive {
  private attachment?: SeriesAttachedParameter;
  private line?: IPriceLine;
  private label?: {price: number; formattedPrice: string; countdown: string};
  private readonly axisRenderer: IPrimitivePaneRenderer = {
    draw: target => {
      const label = this.label;
      const y = label ? this.attachment?.series.priceToCoordinate(label.price) : null;
      if (!label || y == null) return;

      target.useMediaCoordinateSpace(({context, mediaSize}) => {
        if (y < 0 || y >= mediaSize.height) return;
        const height = label.countdown ? 32 : 19;
        const top = Math.max(0, Math.min(mediaSize.height - height, Math.round(y) - 9));
        const priceFont = "600 12px 'Segoe UI', sans-serif";
        const timeFont = '11px Consolas, ui-monospace, monospace';
        context.font = priceFont;
        const priceWidth = context.measureText(label.formattedPrice).width;
        context.font = timeFont;
        const timeWidth = context.measureText(label.countdown).width;
        const width = Math.min(mediaSize.width, Math.ceil(Math.max(priceWidth, timeWidth)) + 14);
        if (width <= 14) return;

        context.fillStyle = mint;
        context.beginPath();
        context.roundRect(0, top, width, height, [0, 4, 4, 0]);
        context.fill();
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.font = priceFont;
        context.fillStyle = priceInk;
        context.fillText(label.formattedPrice, 7, top + 9, width - 14);
        if (label.countdown) {
          context.font = timeFont;
          context.fillStyle = timeInk;
          context.fillText(label.countdown, 7, top + 23, width - 14);
        }
      });
    },
  };
  private readonly axisViews: IPrimitivePaneView[] = [{zOrder: () => 'top', renderer: () => this.axisRenderer}];

  attached(attachment: SeriesAttachedParameter) {
    this.attachment = attachment;
  }

  detached() {
    this.clear();
    this.attachment = undefined;
  }

  priceAxisPaneViews() {
    return this.axisViews;
  }

  setPrice(price: number, countdown: string) {
    const attachment = this.attachment;
    if (!attachment) return;
    const {series, requestUpdate} = attachment;
    const previous = this.label;
    if (previous?.price === price && previous.countdown === countdown) return;
    this.label = {price, formattedPrice: priceFormat.format(price), countdown};
    if (!this.line) {
      this.line = series.createPriceLine({price, color: mint, lineWidth: 1, lineStyle: 2, axisLabelVisible: false});
      series.applyOptions({priceLineVisible: false, lastValueVisible: false});
    } else if (previous?.price !== price) {
      this.line.applyOptions({price});
    }
    requestUpdate();
  }

  clear() {
    const attachment = this.attachment;
    if (attachment && this.line) {
      attachment.series.removePriceLine(this.line);
      attachment.series.applyOptions({priceLineVisible: true, lastValueVisible: true});
      this.line = undefined;
      this.label = undefined;
      attachment.requestUpdate();
    }
  }
}

type Props = {
  marker: LivePriceMarker;
  price: number;
  seconds: number;
  serverNow: () => number;
  calendar: CandleCalendar;
};

function windowAt(stamp: number, seconds: number, calendar: CandleCalendar) {
  try {
    return candleWindow(stamp, seconds, calendar);
  } catch {
    // There is no broker session in the gap when the server clock changes.
    return null;
  }
}

export function LivePriceCountdown({marker, price, seconds, serverNow, calendar}: Props) {
  const [stamp, setStamp] = useState(serverNow);
  useEffect(() => {
    const update = () => setStamp(previous => Math.max(previous, serverNow()));
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [serverNow]);

  const window = windowAt(stamp, seconds, calendar);
  const remaining = window ? Math.max(0, window.close - stamp) : 0;
  const minutes = Math.floor(remaining / 60);
  const two = (value: number) => String(value).padStart(2, '0');
  const countdown = window
    ? (minutes >= 60 ? Math.floor(minutes / 60) + ':' : '') + two(minutes % 60) + ':' + two(remaining % 60)
    : '';

  useLayoutEffect(() => { marker.setPrice(price, countdown); }, [marker, price, countdown]);
  useLayoutEffect(() => () => marker.clear(), [marker]);

  return window && <time className="live-price-timer" role="timer" aria-label="เวลาที่เหลือก่อนปิดแท่ง"
    dateTime={'PT' + remaining + 'S'} data-open={window.open} data-close={window.close}>{countdown}</time>;
}

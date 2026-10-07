export const pineExamples={
'EMA 20 / 50': `//@version=6
indicator("EMA 20 / 50", overlay=true)
plot(ta.ema(close, 20), title="EMA 20", color=color.orange, linewidth=2)
plot(ta.ema(close, 50), title="EMA 50", color=color.aqua, linewidth=2)`,
'RSI 14': `//@version=6
indicator("RSI 14", overlay=false)
plot(ta.rsi(close, 14), title="RSI", color=color.purple, linewidth=2)
hline(70, "Overbought", color=color.gray)
hline(30, "Oversold", color=color.gray)`,
'Bollinger Bands': `//@version=6
indicator("Bollinger Bands", overlay=true)
basis = ta.sma(close, 20)
dev = 2 * ta.stdev(close, 20)
plot(basis, title="Basis", color=color.orange)
plot(basis + dev, title="Upper", color=color.aqua)
plot(basis - dev, title="Lower", color=color.aqua)`
};

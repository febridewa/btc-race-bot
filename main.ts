// Mean-reversion scalper for make.fun btc-race-24h-20261117-0603.
// Trades CBBTC/USDC on 1-minute on-chain bars, long only, $1,000 paper money.
//
// Why this strategy (measured on the published 24h dev window, 1,440 bars):
// - The pool's price moves only when someone trades on it, so it tracks the
//   wider BTC market with noise: 1-minute returns show a small positive
//   lag-1 autocorrelation (+0.15) but hourly returns mean-revert hard
//   (lag-1 autocorrelation about -0.30 to -0.40). A bar's close that sits far
//   below its own 10-hour mean tends to come back over the next hours.
// - A full-size round trip costs about 26-37 bps (4 bps fee + 2 bps modelled
//   slippage + price impact against the pool's open depth), while 1-minute
//   moves are only ~6 bps of noise, so fast trend-following churns itself to
//   death on this window: the kit's EMA-cross baseline lost $106, RSI/Bollinger
//   $24, ADX $33, while buy-and-hold made $1.07. This bot therefore trades
//   rarely (2-4 round trips a day) and only at deep, slow deviations.
// - Signal: the z-score of log(close) against its rolling 600-bar (10h) mean
//   and population standard deviation. Buy 50% of cash when z <= -1.25.
//   Scale in with up to three adds of 50% of the remaining cash when the dip
//   deepens (z <= -2.0, then -2.25, then -2.5): averaging down into a
//   mean-reverting dip lowers the entry price. Sell the whole position when
//   z >= +1.0, i.e. the price has come back through its mean and into
//   strength. No stop-loss: the conditional data say even extreme dips revert
//   on average, so a stop would cut the trades that revert the most.
// - Every parameter was checked across a neighbourhood (windows 360-720,
//   entry z -1.25 to -1.75, exit z 0.75-1.0): all of them end the dev window
//   positive. The chosen point is the middle of that plateau, not a peak.
// - Deterministic: pure float64 arithmetic on the bars the harness sends, no
//   clock, no environment, no randomness. Two runs on the same data decide
//   the same orders.
//
// Dev-window local grade (kit grade-local, process driver): net PnL +$16.65,
// 13 trades, max drawdown 0.70%, fees $2.47. House baselines on the same
// window: buy-and-hold +$1.07, momentum +$2.45, ema-cross -$106.21,
// rsi-bollinger -$24.25, adx-momentum -$32.66, hold-cash $0.00.

import { runBars, type Bar, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Rolling window for the mean and standard deviation, in 1-minute bars (10 hours). */
const WIN_BARS = 600;
/** A bar's close must sit this many standard deviations under the mean to buy. */
const Z_IN = -1.25;
/** The z-score the position is sold at (price back through its mean, into strength). */
const Z_OUT = 1.0;
/** The z-score each scale-in add waits for, in order. */
const SCALE_STEPS = [-2.0, -2.25, -2.5];
/** Each buy spends this share of the cash on hand (percent). */
const BUY_FRAC_PERCENT = 50;
/** Slippage cap on every order, in bps (1-minute moves are far smaller). */
const MAX_SLIPPAGE_BPS = 1000;
/** At least 20 closes before the z-score is read at all. */
const MIN_BARS = 20;

/** Rolling mean / population standard deviation of log closes, O(1) per bar. */
class ZScore {
  private readonly win: number;
  private readonly buf: number[] = [];
  private sum = 0;
  private sumSq = 0;

  constructor(win: number) {
    this.win = win;
  }

  push(x: number): void {
    this.buf.push(x);
    this.sum += x;
    this.sumSq += x * x;
    if (this.buf.length > this.win) {
      const y = this.buf.shift()!;
      this.sum -= y;
      this.sumSq -= y * y;
    }
  }

  /** The z-score of x against the window so far, or null while it is too short or flat. */
  z(x: number): number | null {
    const n = this.buf.length;
    if (n < MIN_BARS) return null;
    const mean = this.sum / n;
    const variance = this.sumSq / n - mean * mean;
    if (variance <= 1e-24) return null;
    return (x - mean) / Math.sqrt(variance);
  }
}

const zscore = new ZScore(WIN_BARS);
/** How many scale-in adds the current position has taken. */
let adds = 0;
/**
 * The client_id of a buy sent on the previous batch but not yet confirmed by
 * a fill in this batch, or null. The harness reports every fill or rejection
 * in the next batch, so a buy is never re-sent while one is in flight, and a
 * scale-in step whose buy was rejected is not lost: it is retried while the
 * dip still holds. (On the dev window no order is ever rejected, so this
 * changes nothing there; it only hardens the race window.)
 */
let pendingBuyId: string | null = null;
let pendingBuyWasAdd = false;

/** Fold this batch's fills into the pending-buy bookkeeping. */
function confirmPending(batch: { fills: { client_id: string; status: string }[] }): void {
  if (pendingBuyId === null) return;
  const fill = batch.fills.find((f) => f.client_id === pendingBuyId);
  if (fill === undefined) return;
  if (fill.status === 'rejected' && pendingBuyWasAdd) adds -= 1;
  pendingBuyId = null;
}

await runBars({
  onBatch(state: BarsState, batch: { bars: Bar[]; fills: { client_id: string; status: string }[] }): OrderInput[] {
    confirmPending(batch);
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || state.warmingUp) return [];
    const x = Math.log(Number(bar.c) / 1e5);
    zscore.push(x);
    const z = zscore.z(x);
    if (z === null) return [];

    const held = state.positions.get(SYMBOL);
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    if (held === undefined) {
      adds = 0;
      if (z <= Z_IN && pendingBuyId === null) {
        const amount = (state.cash * BigInt(BUY_FRAC_PERCENT)) / 100n;
        if (amount >= minNotional) {
          pendingBuyId = `e${state.seq}`;
          pendingBuyWasAdd = false;
          return [{ side: 'buy', symbol: SYMBOL, client_id: pendingBuyId, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    if (adds < SCALE_STEPS.length && z <= SCALE_STEPS[adds] && state.cash >= minNotional && pendingBuyId === null) {
      const amount = (state.cash * BigInt(BUY_FRAC_PERCENT)) / 100n;
      if (amount >= minNotional) {
        adds += 1;
        pendingBuyId = `a${adds}-${state.seq}`;
        pendingBuyWasAdd = true;
        return [{ side: 'buy', symbol: SYMBOL, client_id: pendingBuyId, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    if (z >= Z_OUT) {
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});

# btc-race-bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/febridewa/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/febridewa/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A mean-reversion trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain prices with $1,000 of paper money — nothing is traded for real.

**Strategy:** the pool's price tracks the wider BTC market with noise, so hourly returns mean-revert (lag-1 autocorrelation about -0.30 to -0.40 on the dev window). The bot buys 50% of cash when the log close sits 1.25 standard deviations below its 10-hour rolling mean, scales in with up to three adds as the dip deepens (z <= -2.0, -2.25, -2.5), and sells everything when the price comes back through its mean into strength (z >= +1.0). It trades rarely — 2–4 round trips a day — because a full-size round trip costs ~26–37 bps in fees, slippage and price impact while 1-minute moves are only ~6 bps of noise.

**Dev-window result (kit grade-local):** net PnL **+$16.65**, 13 trades, max drawdown 0.70%, fees $2.47. House baselines on the same window: buy-and-hold +$1.07, momentum +$2.45, ema-cross -$106.21, rsi-bollinger -$24.25, adx-momentum -$32.66, hold-cash $0.00.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout), runs on Node 22 with the standard library only, and is fully deterministic: pure float64 arithmetic on the bars it is sent, no clock, no environment, no randomness.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6etrfz79&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>

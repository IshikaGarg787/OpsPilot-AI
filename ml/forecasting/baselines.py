"""Step 4: baseline forecasters.

Every function takes the *history* (a daily pd.Series, index = dates) and a
horizon (number of future days) and returns a pd.Series of forecasts for the
next `horizon` days. They only look at history, so there is no leakage.
"""
import numpy as np
import pandas as pd


def _future_index(history, horizon):
    return pd.date_range(history.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")


def moving_average(history, horizon, window=7):
    """Baseline 1: forecast every future day = mean of the last `window` days."""
    value = history.iloc[-window:].mean()
    return pd.Series(value, index=_future_index(history, horizon))


def seasonal_naive(history, horizon, season=7):
    """Next Sunday = last Sunday, next Monday = last Monday, ..."""
    last_cycle = history.iloc[-season:].to_numpy()
    values = [last_cycle[i % season] for i in range(horizon)]
    return pd.Series(values, index=_future_index(history, horizon), dtype=float)


def seasonal_moving_average(history, horizon, season=7, k=4):
    """Next Sunday = average of the last k Sundays (weekday-aware moving average)."""
    idx = _future_index(history, horizon)
    values = []
    for date in idx:
        same_weekday = history[history.index.dayofweek == date.dayofweek].iloc[-k:]
        values.append(same_weekday.mean())
    return pd.Series(values, index=idx, dtype=float)


BASELINES = {
    "moving_avg_7": lambda h, n: moving_average(h, n, window=7),
    "moving_avg_28": lambda h, n: moving_average(h, n, window=28),
    "seasonal_naive": lambda h, n: seasonal_naive(h, n, season=7),
    "seasonal_moving_avg_4w": lambda h, n: seasonal_moving_average(h, n, season=7, k=4),
}

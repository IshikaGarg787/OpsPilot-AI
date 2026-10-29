"""Leakage-safe features for the ML forecaster (XGBoost).

Rule: a feature for target day T may only use actuals from days <= T - h0,
where h0 = the smallest multiple of 7 that is >= horizon. All lags/rolling
stats are shifted by h0, so ONE model can forecast every day of the horizon
without recursive prediction. Calendar and holiday features are known in
advance, so they are allowed for future days.
"""
import numpy as np
import pandas as pd


def base_lag(horizon):
    return int(np.ceil(horizon / 7) * 7)


def build_features(series, horizon=7, holiday_share=None):
    """series: daily counts (may end with NaN for future days). Returns a DataFrame."""
    h0 = base_lag(horizon)
    X = pd.DataFrame(index=series.index)
    lags = [h0, h0 + 7, h0 + 14, h0 + 21]
    for k in lags:
        X[f"lag_{k}"] = series.shift(k)
    X["same_wd_mean4"] = X[[f"lag_{k}" for k in lags]].mean(axis=1)
    X["same_wd_max4"] = X[[f"lag_{k}" for k in lags]].max(axis=1)
    shifted = series.shift(h0)
    X["roll7_mean"] = shifted.rolling(7).mean()
    X["roll28_mean"] = shifted.rolling(28).mean()
    X["roll28_std"] = shifted.rolling(28).std()
    X["roll91_mean"] = shifted.rolling(91, min_periods=60).mean()
    X["level_ratio"] = X["roll7_mean"] / (X["roll28_mean"] + 1)
    # calendar (known in advance)
    X["dow"] = series.index.dayofweek
    X["is_weekend"] = series.index.dayofweek.isin([4, 5]).astype(int)   # Fri/Sat here
    X["month"] = series.index.month
    X["dom"] = series.index.day
    X["woy"] = series.index.isocalendar().week.to_numpy().astype(int)
    if holiday_share is not None:
        hs = holiday_share.reindex(series.index).fillna(0.0)
        X["holiday_share"] = hs
        X["hs_prev"] = hs.shift(1).fillna(0.0)
        X["hs_next"] = hs.shift(-1).fillna(0.0)
    return X

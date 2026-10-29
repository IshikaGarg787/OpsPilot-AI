"""Time-series cross-validation (expanding window, walk-forward).

Layout of the data:

  |------------- CV region (tuning + model selection) -------------|--- FINAL TEST ---|
  |   train ...   fold1 | fold2 | fold3 | fold4 | fold5 | fold6   |  last 12 weeks   |

* Each fold is 8 weeks. The model is re-fitted at every weekly origin using ONLY
  data before that origin (expanding window) and forecasts the next 7 days.
* The FINAL TEST is never used for tuning. It is evaluated once at the end.
"""
import numpy as np
import pandas as pd
from .evaluate import mae, rmse, smape, weekly_wape


def make_folds(n_days, final_test_days=84, n_folds=6, fold_days=56):
    cv_end = n_days - final_test_days
    folds = []
    for i in range(n_folds):
        end = cv_end - (n_folds - 1 - i) * fold_days
        folds.append((end - fold_days, end))
    return folds


def walk_forward(series, fn, start, end, horizon=7, step=7):
    rows = []
    for origin in range(start, end - horizon + 1, step):
        hist = series.iloc[:origin]
        actual = series.iloc[origin:origin + horizon]
        pred = fn(hist, horizon)
        rows.append(pd.DataFrame({"date": actual.index, "origin": hist.index[-1],
                                  "actual": actual.to_numpy(float), "forecast": pred.to_numpy(float)}))
    return pd.concat(rows, ignore_index=True)


def cross_validate(series, fn, folds, horizon=7, step=7):
    """Returns (predictions with a 'fold' column, per-fold score table)."""
    parts, scores = [], []
    for i, (a, b) in enumerate(folds, 1):
        p = walk_forward(series, fn, a, b, horizon, step)
        p["fold"] = i
        parts.append(p)
        y, f = p["actual"].to_numpy(), p["forecast"].to_numpy()
        scores.append({"fold": i, "MAE": mae(y, f), "RMSE": rmse(y, f),
                       "sMAPE": smape(y, f), "weekly_WAPE": weekly_wape(p)})
    return pd.concat(parts, ignore_index=True), pd.DataFrame(scores)


def cv_summary(score_df):
    return {"MAE_mean": score_df["MAE"].mean(), "MAE_std": score_df["MAE"].std(),
            "RMSE_mean": score_df["RMSE"].mean(), "sMAPE_mean": score_df["sMAPE"].mean(),
            "weekly_WAPE_mean": score_df["weekly_WAPE"].mean()}

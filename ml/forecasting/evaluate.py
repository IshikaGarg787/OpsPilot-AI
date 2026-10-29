"""Step 3 + 5: time-based evaluation (rolling origin) and metrics."""
import numpy as np
import pandas as pd


def mae(y, yhat):
    return float(np.mean(np.abs(y - yhat)))


def rmse(y, yhat):
    return float(np.sqrt(np.mean((y - yhat) ** 2)))


def smape(y, yhat):
    """Symmetric MAPE in %. Days where both actual and forecast are 0 count as 0 error."""
    denom = np.abs(y) + np.abs(yhat)
    ratio = np.where(denom == 0, 0.0, 2 * np.abs(y - yhat) / np.where(denom == 0, 1, denom))
    return float(100 * np.mean(ratio))


def rolling_origin_eval(series, forecast_fn, test_days=84, horizon=7, step=7):
    """Walk-forward evaluation.

    The last `test_days` days are the test period. We move an 'origin' through
    it every `step` days; at each origin the model sees only data BEFORE the
    origin and forecasts the next `horizon` days. Returns a DataFrame with
    actual vs forecast for every test day.
    """
    first_test = len(series) - test_days
    rows = []
    for origin in range(first_test, len(series) - horizon + 1, step):
        history = series.iloc[:origin]
        actual = series.iloc[origin:origin + horizon]
        pred = forecast_fn(history, horizon)
        rows.append(pd.DataFrame({
            "date": actual.index,
            "origin": history.index[-1],
            "actual": actual.to_numpy(),
            "forecast": pred.to_numpy(),
        }))
    return pd.concat(rows, ignore_index=True)


def weekly_wape(pred_df):
    """Error of the 7-day TOTAL (what a manager plans staffing on), in %.
    = sum|weekly actual - weekly forecast| / sum(weekly actual). Each forecast
    origin gives one 7-day block."""
    g = pred_df.groupby("origin")[["actual", "forecast"]].sum()
    return float(100 * np.abs(g["actual"] - g["forecast"]).sum() / g["actual"].sum())


def score(pred_df):
    y, yhat = pred_df["actual"].to_numpy(float), pred_df["forecast"].to_numpy(float)
    return {"MAE": round(mae(y, yhat), 3), "RMSE": round(rmse(y, yhat), 3),
            "sMAPE_%": round(smape(y, yhat), 2),
            "weekly_WAPE_%": round(weekly_wape(pred_df), 2), "n_days": len(y)}

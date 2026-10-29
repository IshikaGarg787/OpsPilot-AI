"""Candidate models. Every factory returns fn(history, horizon) -> pd.Series
(the same interface as the baselines), so they all plug into the same
walk-forward evaluation and cross-validation."""
import logging
import numpy as np
import pandas as pd

from .features import build_features, base_lag
from .baselines import moving_average, seasonal_moving_average

logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
logging.getLogger("prophet").setLevel(logging.ERROR)


def _future_index(history, horizon):
    return pd.date_range(history.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")


# ---------------------------------------------------------------- Holt-Winters
def holt_winters(trend=None, damped=False, train_days=365):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    import warnings

    def fn(history, horizon):
        y = history.iloc[-train_days:].astype(float).asfreq("D")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fit = ExponentialSmoothing(y, trend=trend, damped_trend=damped if trend else False,
                                       seasonal="add", seasonal_periods=7,
                                       initialization_method="estimated").fit()
            f = fit.forecast(horizon)
        return pd.Series(np.clip(f.to_numpy(), 0, None), index=_future_index(history, horizon))
    return fn


# --------------------------------------------------------------------- Prophet
def prophet_model(holiday_share=None, mode="additive", changepoint_prior_scale=0.05,
                  seasonality_prior_scale=10.0, yearly=False, train_days=730):
    from prophet import Prophet

    def fn(history, horizon):
        h = history.iloc[-train_days:]
        df = pd.DataFrame({"ds": h.index, "y": h.to_numpy(float)})
        future = pd.DataFrame({"ds": _future_index(history, horizon)})
        m = Prophet(weekly_seasonality=True, daily_seasonality=False,
                    yearly_seasonality=yearly, seasonality_mode=mode,
                    changepoint_prior_scale=changepoint_prior_scale,
                    seasonality_prior_scale=seasonality_prior_scale)
        if holiday_share is not None:
            df["hs"] = holiday_share.reindex(h.index).fillna(0.0).to_numpy()
            future["hs"] = holiday_share.reindex(future["ds"]).fillna(0.0).to_numpy()
            m.add_regressor("hs")
        logging.getLogger("cmdstanpy").disabled = True
        logging.getLogger("prophet").disabled = True
        m.fit(df)
        yhat = m.predict(future)["yhat"].to_numpy()
        return pd.Series(np.clip(yhat, 0, None), index=future["ds"])
    return fn


# --------------------------------------------------------------------- XGBoost
def xgboost_model(holiday_share=None, horizon=7, train_days=None, log_target=False,
                  objective="reg:squarederror", n_estimators=300, learning_rate=0.05,
                  max_depth=4, min_child_weight=5, subsample=0.8, colsample_bytree=0.8,
                  reg_lambda=1.0, seed=42):
    import xgboost as xgb

    def fn(history, horizon_):
        # --- training rows come from history only
        X_all = build_features(history, horizon, holiday_share)
        y_all = history
        if train_days:
            X_all, y_all = X_all.iloc[-train_days:], y_all.iloc[-train_days:]
        ok = X_all.notna().all(axis=1)
        X_tr, y_tr = X_all[ok], y_all[ok]
        y_fit = np.log1p(y_tr) if log_target else y_tr
        model = xgb.XGBRegressor(
            objective=objective, n_estimators=n_estimators, learning_rate=learning_rate,
            max_depth=max_depth, min_child_weight=min_child_weight, subsample=subsample,
            colsample_bytree=colsample_bytree, reg_lambda=reg_lambda, tree_method="hist",
            n_jobs=2, random_state=seed, verbosity=0)
        model.fit(X_tr, y_fit)
        # --- future rows: extend with NaN so any leakage would surface as NaN
        fidx = _future_index(history, horizon_)
        ext = history.reindex(history.index.append(fidx))
        X_f = build_features(ext, horizon, holiday_share).loc[fidx]
        lag_cols = [c for c in X_f.columns if c.startswith(("lag_", "roll", "same_wd", "level"))]
        assert not X_f[lag_cols].isna().any().any(), "leakage guard: NaN in future lag features"
        pred = model.predict(X_f)
        if log_target:
            pred = np.expm1(pred)
        return pd.Series(np.clip(pred, 0, None), index=fidx)
    return fn


# -------------------------------------------------------------------- Ensemble
def ensemble(fns, weights=None):
    def fn(history, horizon):
        preds = [f(history, horizon) for f in fns]
        w = np.ones(len(preds)) / len(preds) if weights is None else np.asarray(weights)
        return sum(wi * p for wi, p in zip(w, preds))
    return fn

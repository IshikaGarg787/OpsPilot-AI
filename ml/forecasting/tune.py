"""Hyper-parameter tuning with time-series cross-validation.

Everything here uses ONLY the CV region (data before the last 84 days).
The final test period is never touched.

Usage (from the repo root): python -m ml.forecasting.tune -> writes ml/artifacts/forecasting/best_params.json and tuning_trials_*.csv
"""
import json, random, sys, time, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")

from ml.forecasting.prepare_series import load_issues, build_daily_series, build_holiday_share
from ml.forecasting.models import holt_winters, prophet_model, xgboost_model
from ml.forecasting.cv import make_folds, cross_validate, cv_summary

ISSUES, HOLI = "data/raw/issues.csv", "data/raw/holidays_by_country.csv"
START, FINAL_TEST, HORIZON = "2018-01-01", 84, 7
N_FOLDS, FOLD_DAYS = 6, 56
N_XGB, N_PROPHET = 60, 40
rng = random.Random(7)

daily = build_daily_series(load_issues(ISSUES), start=START)
test_start = daily.index[-FINAL_TEST]
hs, _ = build_holiday_share(ISSUES, HOLI, daily.index, weights_until=test_start)
folds = make_folds(len(daily), FINAL_TEST, N_FOLDS, FOLD_DAYS)

def evaluate(fn):
    _, sc = cross_validate(daily, fn, folds, HORIZON)
    return cv_summary(sc)

def run_search(name, configs, build):
    rows, t0 = [], time.time()
    for i, cfg in enumerate(configs, 1):
        res = evaluate(build(cfg))
        rows.append({**cfg, **res})
        if i % 10 == 0 or i == len(configs):
            best = min(r["MAE_mean"] for r in rows)
            print(f"[{name}] {i}/{len(configs)} best CV MAE so far = {best:.3f}  ({time.time()-t0:.0f}s)", flush=True)
    df = pd.DataFrame(rows).sort_values("MAE_mean").reset_index(drop=True)
    df.to_csv(f"ml/artifacts/forecasting/tuning_trials_{name}.csv", index=False)
    return df

best = {}

# ------------------------------------------------------------ Holt-Winters (grid)
hw_cfgs = [dict(trend=t, damped=d, train_days=td) for t in (None, "add") for d in (False, True)
           for td in (180, 365, 730) if not (t is None and d)]
df = run_search("holt_winters", hw_cfgs, lambda c: holt_winters(c["trend"], c["damped"], c["train_days"]))
r = df.iloc[0]; best["holt_winters"] = dict(trend=None if pd.isna(r.trend) else r.trend, damped=bool(r.damped), train_days=int(r.train_days))

# ------------------------------------------------------------ Prophet (random)
pr_space = dict(mode=["additive", "multiplicative"], changepoint_prior_scale=[0.005, 0.01, 0.05, 0.1, 0.3],
                seasonality_prior_scale=[1.0, 10.0], yearly=[False, True], train_days=[365, 730, 1095],
                use_holidays=[False, True])
pr_cfgs = [{k: rng.choice(v) for k, v in pr_space.items()} for _ in range(N_PROPHET)]
df = run_search("prophet", pr_cfgs, lambda c: prophet_model(hs if c["use_holidays"] else None, c["mode"],
                c["changepoint_prior_scale"], c["seasonality_prior_scale"], c["yearly"], c["train_days"]))
r = df.iloc[0]
best["prophet"] = dict(mode=r["mode"], changepoint_prior_scale=float(r.changepoint_prior_scale),
                       seasonality_prior_scale=float(r.seasonality_prior_scale), yearly=bool(r.yearly),
                       train_days=int(r.train_days), use_holidays=bool(r.use_holidays))

# ------------------------------------------------------------ XGBoost (random)
xg_space = dict(objective=["reg:squarederror", "reg:absoluteerror", "count:poisson"], log_target=[False, True],
                n_estimators=[100, 200, 300, 500], learning_rate=[0.02, 0.05, 0.1], max_depth=[2, 3, 4, 6],
                min_child_weight=[1, 3, 5, 10], subsample=[0.6, 0.8, 1.0], colsample_bytree=[0.5, 0.8, 1.0],
                reg_lambda=[0.1, 1.0, 5.0, 10.0], train_days=[None, 730, 1095], use_holidays=[False, True])
xg_cfgs = []
while len(xg_cfgs) < N_XGB:
    c = {k: rng.choice(v) for k, v in xg_space.items()}
    if c["objective"] == "count:poisson":
        c["log_target"] = False            # poisson already models counts on the raw scale
    xg_cfgs.append(c)
def build_xgb(c):
    return xgboost_model(hs if c["use_holidays"] else None, HORIZON, c["train_days"], c["log_target"],
                         c["objective"], c["n_estimators"], c["learning_rate"], c["max_depth"],
                         c["min_child_weight"], c["subsample"], c["colsample_bytree"], c["reg_lambda"])
df = run_search("xgboost", xg_cfgs, build_xgb)
r = df.iloc[0]
best["xgboost"] = dict(objective=r.objective, log_target=bool(r.log_target), n_estimators=int(r.n_estimators),
                       learning_rate=float(r.learning_rate), max_depth=int(r.max_depth),
                       min_child_weight=int(r.min_child_weight), subsample=float(r.subsample),
                       colsample_bytree=float(r.colsample_bytree), reg_lambda=float(r.reg_lambda),
                       train_days=None if pd.isna(r.train_days) else int(r.train_days),
                       use_holidays=bool(r.use_holidays))

def _xgb_cfg(r):
    return dict(objective=r.objective, log_target=bool(r.log_target), n_estimators=int(r.n_estimators),
                learning_rate=float(r.learning_rate), max_depth=int(r.max_depth),
                min_child_weight=int(r.min_child_weight), subsample=float(r.subsample),
                colsample_bytree=float(r.colsample_bytree), reg_lambda=float(r.reg_lambda),
                train_days=None if pd.isna(r.train_days) else int(r.train_days),
                use_holidays=bool(r.use_holidays))
# The single best random-search config can be fragile (near-ties in CV behave very differently on new data).
# So we also keep the top 5 and average their forecasts in run_models.py.
best["xgboost_top5"] = [_xgb_cfg(r) for r in df.head(5).itertuples()]

json.dump(best, open("ml/artifacts/forecasting/best_params.json", "w"), indent=2)
print("\nBEST PARAMS\n", json.dumps(best, indent=2))

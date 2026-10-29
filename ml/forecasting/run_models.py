"""Compare baselines vs tuned candidates with cross-validation + an untouched final test.

Usage (from the repo root): python -m ml.forecasting.run_models   (uses ml/artifacts/forecasting/best_params.json; run tune first only to re-tune)
Outputs (in ml/artifacts/forecasting/):
  model_comparison.csv, cv_fold_scores.csv, forecast_next_7d.csv, forecast_next_14d.csv,
  forecast_final_test.png, surge_eval.csv
"""
import json, warnings
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
warnings.filterwarnings("ignore")

from ml.forecasting.prepare_series import load_issues, build_daily_series, build_holiday_share, quality_report
from ml.forecasting.baselines import BASELINES
from ml.forecasting.models import holt_winters, prophet_model, xgboost_model, ensemble
from ml.forecasting.cv import make_folds, cross_validate, cv_summary, walk_forward
from ml.forecasting.evaluate import score

ISSUES, HOLI = "data/raw/issues.csv", "data/raw/holidays_by_country.csv"
START, FINAL_TEST, HORIZON = "2018-01-01", 84, 7
N_FOLDS, FOLD_DAYS = 6, 56

daily = build_daily_series(load_issues(ISSUES), start=START)
test_start = daily.index[-FINAL_TEST]
future_idx = pd.date_range(daily.index[0], daily.index[-1] + pd.Timedelta(days=30), freq="D")
hs, _ = build_holiday_share(ISSUES, HOLI, future_idx, weights_until=test_start)
best = json.load(open("ml/artifacts/forecasting/best_params.json"))
folds = make_folds(len(daily), FINAL_TEST, N_FOLDS, FOLD_DAYS)


def build_models(horizon):
    b = best
    xb = {k: v for k, v in b["xgboost"].items() if k != "use_holidays"}
    pb = {k: v for k, v in b["prophet"].items() if k != "use_holidays"}
    if "xgboost_top5" in b:      # average of the 5 best configs: more stable than one random-search winner
        cfgs = [{k: v for k, v in c.items() if k != "use_holidays"} | {"_hs": c["use_holidays"]} for c in b["xgboost_top5"]]
        xgb_t = ensemble([xgboost_model(hs if c.pop("_hs") else None, horizon, **c) for c in cfgs])
    else:
        xgb_t = xgboost_model(hs if b["xgboost"]["use_holidays"] else None, horizon, **xb)
    pro_t = prophet_model(hs if b["prophet"]["use_holidays"] else None, **pb)
    hw_t = holt_winters(**b["holt_winters"])
    m = {k: v for k, v in BASELINES.items()}
    m["holt_winters_tuned"] = hw_t
    m["prophet_default"] = prophet_model(hs)
    m["prophet_tuned"] = pro_t
    m["xgboost_default"] = xgboost_model(hs, horizon)
    m["xgboost_tuned"] = xgb_t
    m["ensemble_prophet+xgb"] = ensemble([pro_t, xgb_t])
    m["ensemble_hw+prophet+xgb"] = ensemble([hw_t, pro_t, xgb_t])
    return m


models = build_models(HORIZON)
rows, fold_rows, cv_preds = [], [], {}
for name, fn in models.items():
    p, sc = cross_validate(daily, fn, folds, HORIZON)
    cv_preds[name] = p
    sc.insert(0, "model", name); fold_rows.append(sc)
    s = cv_summary(sc)
    t = score(walk_forward(daily, fn, len(daily) - FINAL_TEST, len(daily), HORIZON))   # final test (once)
    rows.append({"model": name, "CV_MAE": s["MAE_mean"], "CV_MAE_std": s["MAE_std"], "CV_RMSE": s["RMSE_mean"],
                 "CV_sMAPE_%": s["sMAPE_mean"], "CV_weekly_WAPE_%": s["weekly_WAPE_mean"],
                 "TEST_MAE": t["MAE"], "TEST_RMSE": t["RMSE"], "TEST_sMAPE_%": t["sMAPE_%"],
                 "TEST_weekly_WAPE_%": t["weekly_WAPE_%"]})
    print(f"{name:26s} CV MAE {s['MAE_mean']:.2f} ± {s['MAE_std']:.2f} | TEST MAE {t['MAE']:.2f}", flush=True)

table = pd.DataFrame(rows).sort_values("CV_MAE").reset_index(drop=True).round(3)
table.to_csv("ml/artifacts/forecasting/model_comparison.csv", index=False)
pd.concat(fold_rows).round(3).to_csv("ml/artifacts/forecasting/cv_fold_scores.csv", index=False)
selected = table.loc[0, "model"]                      # chosen on CV only, never on the test set
print("\n== Model comparison (sorted by CV MAE) ==\n", table.to_string(index=False))
print(f"\nSelected on CV: {selected}")

# ---------------- prediction intervals from CV residuals of the selected model
cvp = cv_preds[selected].copy()
cvp["wk"] = np.where(cvp["date"].dt.dayofweek.isin([4, 5]), "weekend", "workday")
cvp["res"] = cvp["actual"] - cvp["forecast"]
q = cvp.groupby("wk")["res"].quantile([0.05, 0.95]).unstack()
print("\nResidual quantiles (actual - forecast) from CV:\n", q.round(1))

def add_interval(df):
    wk = np.where(df["date"].dt.dayofweek.isin([4, 5]), "weekend", "workday")
    df["lower_90"] = np.clip(df["forecast"] + q.loc[wk, 0.05].to_numpy(), 0, None)
    df["upper_90"] = df["forecast"] + q.loc[wk, 0.95].to_numpy()
    return df

# ---------------- final test plot + interval coverage
fn_sel = models[selected]
tp = add_interval(walk_forward(daily, fn_sel, len(daily) - FINAL_TEST, len(daily), HORIZON))
cov = float(((tp.actual >= tp.lower_90) & (tp.actual <= tp.upper_90)).mean())
print(f"90% interval coverage on final test: {cov*100:.1f}%")

# ---------------- surge flag evaluation on the final test
hist_wd = daily[:test_start - pd.Timedelta(days=1)]
hist_wd = hist_wd[~hist_wd.index.dayofweek.isin([4, 5])].iloc[-365:]
surge_rows = []
for qt in (0.75, 0.85, 0.90):
    thr = float(hist_wd.quantile(qt))
    flag, truth = tp.forecast >= thr, tp.actual >= thr
    tpn, fpn, fnn = int((flag & truth).sum()), int((flag & ~truth).sum()), int((~flag & truth).sum())
    prec = tpn / (tpn + fpn) if tpn + fpn else float("nan"); rec = tpn / (tpn + fnn) if tpn + fnn else float("nan")
    surge_rows.append({"threshold_quantile": qt, "threshold_tickets": round(thr, 1), "flagged_days": int(flag.sum()),
                       "actual_surge_days": int(truth.sum()), "precision": round(prec, 2), "recall": round(rec, 2)})
surge = pd.DataFrame(surge_rows); surge.to_csv("ml/artifacts/forecasting/surge_eval.csv", index=False)
print("\nSurge-flag evaluation on final test:\n", surge.to_string(index=False))
SURGE_THR = float(hist_wd.quantile(0.75))   # "high-load day" = above the 75th percentile of recent workdays

fig, axes = plt.subplots(1, 2, figsize=(15, 4.6), gridspec_kw={"width_ratios": [2.2, 1]})
ax = axes[0]
ax.fill_between(tp["date"], tp["lower_90"], tp["upper_90"], color="tab:blue", alpha=0.15, label="90% interval")
ax.plot(daily.index[-FINAL_TEST:], daily.iloc[-FINAL_TEST:], color="black", lw=1.4, label="actual")
ax.plot(tp["date"], tp["forecast"], color="tab:blue", lw=1.3, label=f"{selected} (7-day-ahead)")
base = walk_forward(daily, BASELINES["seasonal_moving_avg_4w"], len(daily) - FINAL_TEST, len(daily), HORIZON)
ax.plot(base["date"], base["forecast"], color="tab:orange", lw=1, ls="--", label="seasonal moving avg (baseline)")
ax.axhline(SURGE_THR, color="tab:red", lw=0.8, ls=":", label=f"high-load threshold ({SURGE_THR:.0f})")
ax.set_title("Final test (never used for tuning): actual vs forecast"); ax.set_ylabel("tickets / day"); ax.legend(fontsize=8)
ax = axes[1]
show = table[table.model.isin(["moving_avg_7", "seasonal_naive", "seasonal_moving_avg_4w", "holt_winters_tuned",
                               "prophet_tuned", "xgboost_tuned", "ensemble_prophet+xgb"])].iloc[::-1]
ax.barh(show["model"], show["CV_MAE"], xerr=show["CV_MAE_std"], color="tab:blue", alpha=0.8, capsize=3)
ax.set_title("Cross-validated MAE (mean ± std over 6 folds)"); ax.set_xlabel("MAE (tickets/day)")
fig.tight_layout(); fig.savefig("ml/artifacts/forecasting/forecast_final_test.png", dpi=130)

# ---------------- production-style forecasts from the end of the data
for H in (7, 14):
    fn = build_models(H)[selected]
    f = fn(daily, H)
    out = add_interval(pd.DataFrame({"date": f.index, "forecast": f.round(1).to_numpy()}))
    out["forecast"] = out["forecast"].round(1); out["lower_90"] = out["lower_90"].round(1); out["upper_90"] = out["upper_90"].round(1)
    out["weekday"] = out["date"].dt.day_name()
    out["high_load_threshold"] = round(SURGE_THR, 1)
    out["high_load_flag"] = (out["forecast"] >= SURGE_THR).astype(int)
    out["model"] = selected
    out.to_csv(f"ml/artifacts/forecasting/forecast_next_{H}d.csv", index=False)
    print(f"\nForecast next {H} days (from {daily.index[-1].date()}):\n", out.to_string(index=False))

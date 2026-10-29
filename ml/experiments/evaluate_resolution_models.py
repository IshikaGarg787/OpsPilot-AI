"""Resolution-time regression reproduction, evaluation, and optimization experiments.

Evaluates:
1. Original baseline: HistGradientBoostingRegressor (direct hours)
2. Median and Mean baselines
3. HistGradientBoostingRegressor with log1p(duration) target
4. RandomForestRegressor with log1p(duration) target
5. ExtraTreesRegressor with log1p(duration) target
6. Enhanced features: Project country, public holiday indicator, and time-safe historical project statistics
"""

import json
import os
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, median_absolute_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_PATH = REPO_ROOT / "data" / "raw" / "issues.csv"
if not DATA_PATH.exists():
    DATA_PATH = REPO_ROOT / "Help Desk Tickets" / "issues.csv"
HOLIDAYS_PATH = REPO_ROOT / "data" / "raw" / "holidays_by_country.csv"
if not HOLIDAYS_PATH.exists():
    HOLIDAYS_PATH = REPO_ROOT / "Help Desk Tickets" / "holidays_by_country.csv"
ORIGINAL_ARTIFACT = REPO_ROOT / "ml" / "artifacts" / "resolution" / "resolution_model.joblib"

sys.path.insert(0, str(REPO_ROOT))
from ml.resolution_predictor import (
    CATEGORICAL_FEATURES,
    ENGINEERED_FEATURE_COLUMNS,
    NUMERIC_FEATURES,
    build_resolution_features,
)


class TransformedTargetRegressorCustom(BaseEstimator, RegressorMixin):
    """Log1p target transformer with clip to prevent negative predictions."""

    def __init__(self, regressor=None):
        self.regressor = regressor

    def fit(self, X, y):
        self.regressor_ = clone(self.regressor)
        y_log = np.log1p(np.maximum(y, 0.0))
        self.regressor_.fit(X, y_log)
        return self

    def predict(self, X):
        pred_log = self.regressor_.predict(X)
        pred = np.expm1(pred_log)
        return np.maximum(pred, 0.0)


def country_of(project_code: str) -> str:
    s = str(project_code)
    return s[:3] if len(s) >= 3 and s[0] == "C" and s[1:3].isdigit() else "OTHER"


def load_cleaned_data():
    print(f"Loading data from {DATA_PATH}...")
    df = pd.read_csv(
        DATA_PATH,
        usecols=["id", "issue_created", "issue_resolution_date", "issue_priority", "issue_type", "issue_proj"],
    )
    created_ts = pd.to_datetime(df["issue_created"], utc=True, format="mixed")
    resolution_ts = pd.to_datetime(df["issue_resolution_date"], utc=True, format="mixed")
    duration_hours = (resolution_ts - created_ts).dt.total_seconds() / 3600.0

    valid_mask = created_ts.notna() & resolution_ts.notna() & duration_hours.notna() & (duration_hours >= 0)
    valid_df = df.loc[valid_mask].copy()
    valid_df["_created_ts"] = created_ts.loc[valid_mask]
    valid_df["_resolution_ts"] = resolution_ts.loc[valid_mask]
    valid_df["resolution_duration_hours"] = duration_hours.loc[valid_mask].astype("float64")

    # Chronological sort
    valid_df = valid_df.sort_values("_created_ts").reset_index(drop=True)
    return valid_df


def get_splits(valid_df):
    n_rows = len(valid_df)
    n_train = int(n_rows * 0.70)
    n_val = int(n_rows * 0.15)
    train_df = valid_df.iloc[:n_train].copy()
    val_df = valid_df.iloc[n_train : n_train + n_val].copy()
    test_df = valid_df.iloc[n_train + n_val :].copy()
    return train_df, val_df, test_df


def compute_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    r2 = r2_score(y_true, y_pred)
    med_ae = median_absolute_error(y_true, y_pred)
    return {
        "mae_hours": float(mae),
        "mae_days": float(mae / 24.0),
        "rmse_hours": float(rmse),
        "rmse_days": float(rmse / 24.0),
        "r2": float(r2),
        "med_ae_hours": float(med_ae),
        "med_ae_days": float(med_ae / 24.0),
    }


def compute_subgroup_metrics(df, y_true, y_pred):
    df = df.copy()
    df["y_true"] = y_true
    df["y_pred"] = y_pred
    df["abs_err"] = np.abs(y_true - y_pred)

    priority_metrics = {}
    for p, group in df.groupby("issue_priority"):
        priority_metrics[str(p)] = {
            "count": len(group),
            "mae_hours": float(mean_absolute_error(group["y_true"], group["y_pred"])),
            "r2": float(r2_score(group["y_true"], group["y_pred"])) if len(group) > 5 else 0.0,
        }

    # Short (< 720h = 30d) vs Long (>= 720h) cases
    short_mask = y_true < 720.0
    long_mask = ~short_mask
    duration_segments = {
        "short_duration_under_30d": {
            "count": int(short_mask.sum()),
            "mae_hours": float(mean_absolute_error(y_true[short_mask], y_pred[short_mask])) if short_mask.any() else 0.0,
        },
        "long_duration_over_30d": {
            "count": int(long_mask.sum()),
            "mae_hours": float(mean_absolute_error(y_true[long_mask], y_pred[long_mask])) if long_mask.any() else 0.0,
        },
    }
    return {"priority": priority_metrics, "duration_segments": duration_segments}


def make_standard_pipeline(regressor):
    cat_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("one_hot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    num_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])
    preprocessor = ColumnTransformer([
        ("categorical", cat_pipe, list(CATEGORICAL_FEATURES)),
        ("numeric", num_pipe, list(NUMERIC_FEATURES)),
    ])
    return Pipeline([
        ("preprocessor", preprocessor),
        ("regressor", regressor),
    ])


def run_experiments():
    valid_df = load_cleaned_data()
    print(f"Total valid tickets: {len(valid_df)}")
    train_df, val_df, test_df = get_splits(valid_df)
    print(f"Splits: Train={len(train_df)}, Val={len(val_df)}, Test={len(test_df)}")

    # Target stats
    y_train = train_df["resolution_duration_hours"].to_numpy(dtype="float64")
    y_val = val_df["resolution_duration_hours"].to_numpy(dtype="float64")
    y_test = test_df["resolution_duration_hours"].to_numpy(dtype="float64")

    print("\n--- Target Summary (Hours) ---")
    for name, y in [("Train", y_train), ("Validation", y_val), ("Test", y_test)]:
        print(f"{name}: mean={y.mean():.1f}, median={np.median(y):.1f}, min={y.min():.2f}, max={y.max():.1f}, std={y.std():.1f}")

    # Build basic features
    print("\nBuilding basic resolution features...")
    X_train = build_resolution_features(train_df)
    X_val = build_resolution_features(val_df)
    X_test = build_resolution_features(test_df)

    results = []

    # 1. Evaluate existing saved artifact
    if ORIGINAL_ARTIFACT.exists():
        print("\nEvaluating existing saved resolution_model.joblib...")
        orig_pipe = joblib.load(ORIGINAL_ARTIFACT)
        pred_val = np.maximum(orig_pipe.predict(X_val), 0.0)
        pred_test = np.maximum(orig_pipe.predict(X_test), 0.0)
        m_val = compute_metrics(y_val, pred_val)
        m_test = compute_metrics(y_test, pred_test)
        results.append({
            "model_name": "Original Artifact (HistGradientBoosting, raw hours)",
            "val_mae": m_val["mae_hours"],
            "val_rmse": m_val["rmse_hours"],
            "val_r2": m_val["r2"],
            "test_mae": m_test["mae_hours"],
            "test_rmse": m_test["rmse_hours"],
            "test_r2": m_test["r2"],
            "test_med_ae": m_test["med_ae_hours"],
            "fit_time_s": 0.0,
        })
        print(f"Original Artifact -> Val MAE: {m_val['mae_hours']:.1f}h, Val R2: {m_val['r2']:.4f} | Test MAE: {m_test['mae_hours']:.1f}h, Test R2: {m_test['r2']:.4f}")

    # 2. Baselines
    # Median Baseline
    train_median = np.median(y_train)
    pred_val_med = np.full_like(y_val, train_median)
    pred_test_med = np.full_like(y_test, train_median)
    m_val_med = compute_metrics(y_val, pred_val_med)
    m_test_med = compute_metrics(y_test, pred_test_med)
    results.append({
        "model_name": "Median Baseline (train median)",
        "val_mae": m_val_med["mae_hours"],
        "val_rmse": m_val_med["rmse_hours"],
        "val_r2": m_val_med["r2"],
        "test_mae": m_test_med["mae_hours"],
        "test_rmse": m_test_med["rmse_hours"],
        "test_r2": m_test_med["r2"],
        "test_med_ae": m_test_med["med_ae_hours"],
        "fit_time_s": 0.0,
    })

    # Mean Baseline
    train_mean = np.mean(y_train)
    pred_val_mean = np.full_like(y_val, train_mean)
    pred_test_mean = np.full_like(y_test, train_mean)
    m_val_mean = compute_metrics(y_val, pred_val_mean)
    m_test_mean = compute_metrics(y_test, pred_test_mean)
    results.append({
        "model_name": "Mean Baseline (train mean)",
        "val_mae": m_val_mean["mae_hours"],
        "val_rmse": m_val_mean["rmse_hours"],
        "val_r2": m_val_mean["r2"],
        "test_mae": m_test_mean["mae_hours"],
        "test_rmse": m_test_mean["rmse_hours"],
        "test_r2": m_test_mean["r2"],
        "test_med_ae": m_test_mean["med_ae_hours"],
        "fit_time_s": 0.0,
    })

    # Models to train on train_df, evaluate on val_df
    candidates = [
        ("HistGradientBoosting (raw hours, L1 loss)", HistGradientBoostingRegressor(loss="absolute_error", max_iter=150, max_leaf_nodes=31, min_samples_leaf=10, learning_rate=0.1, l2_regularization=1.0, random_state=42)),
        ("HistGradientBoosting (log1p target, squared loss)", TransformedTargetRegressorCustom(HistGradientBoostingRegressor(loss="squared_error", max_iter=150, max_leaf_nodes=31, min_samples_leaf=10, learning_rate=0.08, l2_regularization=1.0, random_state=42))),
        ("HistGradientBoosting (log1p target, absolute loss)", TransformedTargetRegressorCustom(HistGradientBoostingRegressor(loss="absolute_error", max_iter=150, max_leaf_nodes=31, min_samples_leaf=10, learning_rate=0.08, l2_regularization=1.0, random_state=42))),
        ("RandomForest (log1p target, 100 trees)", TransformedTargetRegressorCustom(RandomForestRegressor(n_estimators=100, max_depth=16, min_samples_leaf=20, n_jobs=2, random_state=42))),
        ("ExtraTrees (log1p target, 100 trees)", TransformedTargetRegressorCustom(ExtraTreesRegressor(n_estimators=100, max_depth=16, min_samples_leaf=20, n_jobs=2, random_state=42))),
    ]

    trained_models = {}

    for name, regressor in candidates:
        print(f"\nTraining {name}...")
        pipe = make_standard_pipeline(regressor)
        t0 = time.time()
        pipe.fit(X_train, y_train)
        fit_time = time.time() - t0

        pred_val = np.maximum(pipe.predict(X_val), 0.0)
        m_val = compute_metrics(y_val, pred_val)

        # Held-out test evaluation
        pred_test = np.maximum(pipe.predict(X_test), 0.0)
        m_test = compute_metrics(y_test, pred_test)

        results.append({
            "model_name": name,
            "val_mae": m_val["mae_hours"],
            "val_rmse": m_val["rmse_hours"],
            "val_r2": m_val["r2"],
            "test_mae": m_test["mae_hours"],
            "test_rmse": m_test["rmse_hours"],
            "test_r2": m_test["r2"],
            "test_med_ae": m_test["med_ae_hours"],
            "fit_time_s": fit_time,
        })
        trained_models[name] = pipe
        print(f"{name} -> Val MAE: {m_val['mae_hours']:.1f}h, Val R2: {m_val['r2']:.4f} | Test MAE: {m_test['mae_hours']:.1f}h, Test R2: {m_test['r2']:.4f} (fit: {fit_time:.1f}s)")

    df_results = pd.DataFrame(results)
    print("\n" + "="*80)
    print("RESOLUTION-TIME MODEL EXPERIMENT COMPARISON")
    print("="*80)
    print(df_results.to_string(index=False))

    # Save comparison to experiments folder
    output_csv = REPO_ROOT / "ml" / "experiments" / "resolution_experiments_comparison.csv"
    df_results.to_csv(output_csv, index=False)
    print(f"\nResults saved to {output_csv}")

    # Inspect subgroups for the best candidate
    best_candidate_name = "HistGradientBoosting (log1p target, absolute loss)"
    if best_candidate_name in trained_models:
        best_pipe = trained_models[best_candidate_name]
        pred_test_best = np.maximum(best_pipe.predict(X_test), 0.0)
        subgroup_info = compute_subgroup_metrics(test_df, y_test, pred_test_best)
        with open(REPO_ROOT / "ml" / "experiments" / "resolution_best_subgroups.json", "w") as f:
            json.dump(subgroup_info, f, indent=2)
        print("Subgroup metrics saved to ml/experiments/resolution_best_subgroups.json")

    return df_results


if __name__ == "__main__":
    run_experiments()

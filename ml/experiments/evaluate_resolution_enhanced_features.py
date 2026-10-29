"""Enhanced feature engineering experiment for Resolution-Time Model A.

Tests:
- Extraction of project country code ('C00'-'C17', 'OTHER')
- Calendar public holiday matching from holidays_by_country.csv
- Time-safe prior project volume and prior project median resolution duration
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
from sklearn.ensemble import HistGradientBoostingRegressor
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


class TransformedTargetRegressorCustom(BaseEstimator, RegressorMixin):
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


def load_data_and_features():
    print(f"Loading data from {DATA_PATH}...")
    df = pd.read_csv(
        DATA_PATH,
        usecols=["id", "issue_created", "issue_resolution_date", "issue_priority", "issue_type", "issue_proj"],
    )
    created_ts = pd.to_datetime(df["issue_created"], utc=True, format="mixed")
    resolution_ts = pd.to_datetime(df["issue_resolution_date"], utc=True, format="mixed")
    duration_hours = (resolution_ts - created_ts).dt.total_seconds() / 3600.0

    valid_mask = created_ts.notna() & resolution_ts.notna() & duration_hours.notna() & (duration_hours >= 0)
    df = df.loc[valid_mask].copy()
    df["_created_ts"] = created_ts.loc[valid_mask]
    df["_resolution_ts"] = resolution_ts.loc[valid_mask]
    df["resolution_duration_hours"] = duration_hours.loc[valid_mask].astype("float64")
    df = df.sort_values("_created_ts").reset_index(drop=True)

    # Base features
    created = df["_created_ts"]
    df["created_year"] = created.dt.year.astype("float64")
    df["created_month"] = created.dt.month.astype("float64")
    df["created_dayofweek"] = created.dt.dayofweek.astype("float64")
    df["created_hour"] = created.dt.hour.astype("float64")
    df["created_dayofmonth"] = created.dt.day.astype("float64")
    df["created_is_weekend"] = (created.dt.dayofweek >= 5).astype("float64")

    # Enhanced feature 1: Project Country
    df["project_country"] = df["issue_proj"].map(country_of).astype("string")

    # Enhanced feature 2: Public Holiday
    hol_df = pd.read_csv(HOLIDAYS_PATH, parse_dates=["date"])
    hol_df["date_str"] = hol_df["date"].dt.strftime("%Y-%m-%d")
    hol_pairs = set(zip(hol_df["country"], hol_df["date_str"]))
    created_date_str = created.dt.strftime("%Y-%m-%d")
    df["is_public_holiday"] = [
        1.0 if (country, d) in hol_pairs else 0.0
        for country, d in zip(df["project_country"], created_date_str)
    ]

    return df


def run_enhanced_experiment():
    df = load_data_and_features()
    n_rows = len(df)
    n_train = int(n_rows * 0.70)
    n_val = int(n_rows * 0.15)
    train_df = df.iloc[:n_train].copy()
    val_df = df.iloc[n_train : n_train + n_val].copy()
    test_df = df.iloc[n_train + n_val :].copy()

    y_train = train_df["resolution_duration_hours"].to_numpy(dtype="float64")
    y_val = val_df["resolution_duration_hours"].to_numpy(dtype="float64")
    y_test = test_df["resolution_duration_hours"].to_numpy(dtype="float64")

    cat_cols_enhanced = ["issue_priority", "issue_type", "issue_proj", "project_country"]
    num_cols_enhanced = [
        "created_year", "created_month", "created_dayofweek", "created_hour",
        "created_dayofmonth", "created_is_weekend", "is_public_holiday"
    ]

    preprocessor = ColumnTransformer([
        ("categorical", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("one_hot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]), cat_cols_enhanced),
        ("numeric", Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]), num_cols_enhanced),
    ])

    pipe = Pipeline([
        ("preprocessor", preprocessor),
        ("regressor", TransformedTargetRegressorCustom(
            HistGradientBoostingRegressor(
                loss="squared_error",
                max_iter=150,
                max_leaf_nodes=31,
                min_samples_leaf=10,
                learning_rate=0.08,
                l2_regularization=1.0,
                random_state=42,
            )
        )),
    ])

    t0 = time.time()
    pipe.fit(train_df[cat_cols_enhanced + num_cols_enhanced], y_train)
    fit_time = time.time() - t0

    pred_val = np.maximum(pipe.predict(val_df[cat_cols_enhanced + num_cols_enhanced]), 0.0)
    m_val = compute_metrics(y_val, pred_val)

    pred_test = np.maximum(pipe.predict(test_df[cat_cols_enhanced + num_cols_enhanced]), 0.0)
    m_test = compute_metrics(y_test, pred_test)

    print("\n--- Enhanced Feature Pipeline Evaluation ---")
    print(f"Validation -> MAE: {m_val['mae_hours']:.1f}h, RMSE: {m_val['rmse_hours']:.1f}h, R2: {m_val['r2']:.4f}")
    print(f"Test -> MAE: {m_test['mae_hours']:.1f}h, RMSE: {m_test['rmse_hours']:.1f}h, R2: {m_test['r2']:.4f}, MedAE: {m_test['med_ae_hours']:.1f}h")
    print(f"Fit time: {fit_time:.1f}s")

    # Compare with basic features
    print("\nComparison with basic features + log1p:")
    print("Basic + log1p: Val MAE 878.7h | Test MAE 523.1h, MedAE 170.0h")
    print(f"Enhanced + log1p: Val MAE {m_val['mae_hours']:.1f}h | Test MAE {m_test['mae_hours']:.1f}h, MedAE {m_test['med_ae_hours']:.1f}h")


if __name__ == "__main__":
    run_enhanced_experiment()

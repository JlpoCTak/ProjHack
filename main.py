import io
import json
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Any

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, send_from_directory
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# Импорт вашего готового загрузчика модели (ml.py)
from ml import category_model


# -----------------------
# Конфигурация / утилиты
# -----------------------

REQUIRED_COLUMNS = [
    "Date",
    "Category",
    "RefNo",
    "Date.1",
    "Withdrawal",
    "Deposit",
    "Balance",
]


def safe_float(x):
    try:
        # handle numpy types
        return float(np.nan_to_num(x, nan=0.0))
    except Exception:
        try:
            return float(str(x).strip()) if str(x).strip() != "" else 0.0
        except Exception:
            return 0.0


def normalize_numeric_columns(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
    df = df.copy()
    for col in cols:
        if col in df.columns:
            df[col] = (
                df[col]
                .astype(str)
                .str.replace(",", "", regex=False)
                .str.replace(" ", "", regex=False)
                .replace("", np.nan)
            )
            # convert to float safely
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
        else:
            df[col] = 0.0
    return df


def df_to_operations_simple(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Преобразует dataframe в список dict-ов с нужными полями,
    подготовленных к JSON-сериализации. Убирает datetime/NaT.
    """
    ops = []
    for idx, row in df.reset_index(drop=True).iterrows():
        # date: try Date.1 then Date, convert to ISO-like string or empty
        date_raw = ""
        if "Date.1" in df.columns and pd.notna(row.get("Date.1")):
            date_raw = str(row.get("Date.1"))
        elif "Date" in df.columns and pd.notna(row.get("Date")):
            date_raw = str(row.get("Date"))
        # normalize date strings (if it's Timestamp)
        if isinstance(date_raw, (pd.Timestamp, np.datetime64)):
            try:
                date_str = pd.to_datetime(date_raw).strftime("%Y-%m-%d")
            except Exception:
                date_str = str(date_raw)
        else:
            date_str = str(date_raw) if date_raw is not None else ""

        category = row.get("Category", "") or ""
        ref_no = row.get("RefNo", "") or row.get("ref_no", "") or ""
        withdrawal = safe_float(row.get("Withdrawal", 0.0))
        deposit = safe_float(row.get("Deposit", 0.0))
        balance = safe_float(row.get("Balance", 0.0))

        ops.append(
            {
                "index": int(idx),
                "date": date_str,
                "category": str(category),
                "ref_no": str(ref_no),
                "withdrawal": withdrawal,
                "deposit": deposit,
                "balance": balance,
            }
        )
    return ops


# -----------------------
# Anomaly model (как раньше)
# -----------------------

@dataclass
class OperationAnalysis:
    index: int
    date: str
    category: str
    ref_no: str
    withdrawal: float
    deposit: float
    balance: float
    anomaly_score: float
    is_anomaly: bool


class TransactionModel:
    def __init__(self) -> None:
        self.scaler: Optional[StandardScaler] = None
        self.model: Optional[IsolationForest] = None

    def _prepare_frame(self, df: pd.DataFrame) -> pd.DataFrame:
        # Do not require all columns here (we'll be flexible) but try to ensure numeric columns exist
        df = df.copy()
        df = normalize_numeric_columns(df, ["Withdrawal", "Deposit", "Balance"])
        return df

    def fit(self, df: pd.DataFrame) -> None:
        df = self._prepare_frame(df)
        X = df[["Withdrawal", "Deposit", "Balance"]].to_numpy()
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)

        self.model = IsolationForest(
            n_estimators=200,
            contamination="auto",
            random_state=42,
            n_jobs=-1,
        )
        self.model.fit(X_scaled)

    def analyze(self, df: pd.DataFrame) -> List[OperationAnalysis]:
        if self.model is None or self.scaler is None:
            raise RuntimeError("Model is not fitted")

        df = self._prepare_frame(df)
        X = df[["Withdrawal", "Deposit", "Balance"]].to_numpy()
        X_scaled = self.scaler.transform(X)

        scores = -self.model.score_samples(X_scaled)
        preds = self.model.predict(X_scaled)  # -1 anomaly, 1 normal

        result: List[OperationAnalysis] = []
        for idx, (row, score, pred) in enumerate(zip(df.reset_index(drop=True).itertuples(), scores, preds)):
            # get Date/Date.1 safely
            dt = ""
            if hasattr(row, "Date.1"):
                dt = getattr(row, "Date.1") or ""
            if not dt and hasattr(row, "Date"):
                dt = getattr(row, "Date") or ""
            result.append(
                OperationAnalysis(
                    index=int(idx),
                    date=str(dt),
                    category=str(getattr(row, "Category", "") or ""),
                    ref_no=str(getattr(row, "RefNo", "") or ""),
                    withdrawal=float(getattr(row, "Withdrawal", 0.0) or 0.0),
                    deposit=float(getattr(row, "Deposit", 0.0) or 0.0),
                    balance=float(getattr(row, "Balance", 0.0) or 0.0),
                    anomaly_score=float(score),
                    is_anomaly=bool(int(pred) == -1),
                )
            )
        return result


# -----------------------
# Приложение Flask
# -----------------------

app = Flask(__name__, static_folder=".")
transaction_model = TransactionModel()


def read_csv_from_text(csv_text: str) -> pd.DataFrame:
    data = io.StringIO(csv_text)
    # try to read with pandas, letting it guess headers
    df = pd.read_csv(data)
    return df


def load_default_data() -> pd.DataFrame:
    # Read bundled CSV if exists
    df = pd.read_csv("ci_data.csv")
    return df


# Train transaction anomaly model on bundled CSV if possible (non-fatal)
try:
    base_df = load_default_data()
    transaction_model.fit(base_df)
except Exception as exc:  # noqa
    print(f"Failed to train initial transaction model: {exc}")


# -----------------------
# Routes: static
# -----------------------

@app.route("/")
def root():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def serve_file(path):
    # Serve any file from current directory (index.html, main.js, styles.css, ci_data.csv, etc.)
    return send_from_directory(".", path)


# -----------------------
# API: analyze (anomaly)
# -----------------------

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    payload = request.get_json(force=True, silent=True) or {}
    csv_text = payload.get("csv")
    retrain = bool(payload.get("retrain", False))

    if not csv_text:
        return jsonify({"error": "csv field is required"}), 400

    try:
        df = read_csv_from_text(csv_text)

        if retrain:
            # optionally retrain anomaly detector on uploaded data
            try:
                transaction_model.fit(df)
            except Exception as e:
                # don't fail the whole request on retrain error; log and continue
                print("Transaction retrain failed:", e)

        analyses = transaction_model.analyze(df)

        anomalies = [a for a in analyses if a.is_anomaly]
        summary = {
            "total_operations": len(analyses),
            "anomaly_count": len(anomalies),
            "anomaly_ratio": float(len(anomalies) / len(analyses)) if analyses else 0.0,
            "total_withdrawal": float(df["Withdrawal"].sum()) if "Withdrawal" in df else 0.0,
            "total_deposit": float(df["Deposit"].sum()) if "Deposit" in df else 0.0,
        }

        # prepare safe operations (no datetime objects, plain floats/ints/strings)
        ops = []
        for a in analyses:
            ops.append(
                {
                    "index": int(a.index),
                    "date": str(a.date),
                    "category": str(a.category),
                    "ref_no": str(a.ref_no),
                    "withdrawal": float(a.withdrawal),
                    "deposit": float(a.deposit),
                    "balance": float(a.balance),
                    "anomaly_score": float(a.anomaly_score),
                    "is_anomaly": bool(a.is_anomaly),
                }
            )

        return jsonify({"summary": summary, "operations": ops})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


# -----------------------
# API: predict categories (uses pre-trained model from ml.py)
# -----------------------

@app.route("/api/predict_category_csv", methods=["POST"])
def api_predict_category_csv():
    payload = request.get_json(force=True, silent=True) or {}
    csv_text = payload.get("csv")
    retrain = bool(payload.get("retrain", False))

    if not csv_text:
        return jsonify({"error": "csv is required"}), 400

    try:
        df = read_csv_from_text(csv_text)

        # DO NOT attempt to retrain the category model here (ml.py loads a pre-trained model).
        if retrain:
            # if ml.py supports fit in your setup, you can train - but we avoid surprise behavior
            # Return a warning but continue with prediction
            print("Warning: retrain flag ignored for category model in this endpoint.")

        # Fill categories using the loaded model
        try:
            df_pred = category_model.predict(df)
        except Exception as e:
            return jsonify({"error": f"Category model predict failed: {e}"}), 500

        # Ensure safe serialization: keep only core columns and cast numbers
        # prefer original column names Date / Date.1, RefNo, Withdrawal, Deposit, Balance, Category
        safe_cols = []
        for c in ["Date", "Date.1", "Category", "RefNo", "Withdrawal", "Deposit", "Balance"]:
            if c in df_pred.columns:
                safe_cols.append(c)

        # Build a dataframe with at least Date/Category/RefNo/Withdrawal/Deposit/Balance
        out_df = pd.DataFrame()
        # choose Date.1 if exists else Date
        if "Date.1" in df_pred.columns:
            out_df["Date"] = df_pred["Date.1"].astype(str)
        elif "Date" in df_pred.columns:
            out_df["Date"] = df_pred["Date"].astype(str)
        else:
            out_df["Date"] = [""] * len(df_pred)

        out_df["Category"] = df_pred.get("Category", "").astype(str)
        # RefNo may be named differently in uploads; try common variants
        if "RefNo" in df_pred.columns:
            out_df["RefNo"] = df_pred["RefNo"].astype(str)
        elif "ref_no" in df_pred.columns:
            out_df["RefNo"] = df_pred["ref_no"].astype(str)
        else:
            out_df["RefNo"] = df_pred.index.astype(str)

        # numeric columns
        for num in ["Withdrawal", "Deposit", "Balance"]:
            if num in df_pred.columns:
                out_df[num] = pd.to_numeric(df_pred[num], errors="coerce").fillna(0.0)
            else:
                out_df[num] = 0.0

        # produce rows list (safe primitives)
        rows = []
        for idx, r in out_df.reset_index(drop=True).iterrows():
            rows.append(
                {
                    "index": int(idx),
                    "date": str(r["Date"]),
                    "category": str(r["Category"]),
                    "ref_no": str(r["RefNo"]),
                    "withdrawal": float(r["Withdrawal"]),
                    "deposit": float(r["Deposit"]),
                    "balance": float(r["Balance"]),
                }
            )

        # For backwards compatibility with main.js which sometimes expects "operations" key
        operations = rows.copy()

        return jsonify({"rows": rows, "operations": operations})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


# -----------------------
# Health
# -----------------------

@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({"status": "ok"})


# -----------------------
# Run
# -----------------------

if __name__ == "__main__":
    # dev server
    app.run(host="0.0.0.0", port=8000, debug=True)

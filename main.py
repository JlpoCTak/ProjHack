import io
import json
from dataclasses import dataclass, asdict
from typing import List, Optional

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, send_from_directory
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from ml import category_model   # <-- твой ml.py загружает model = joblib.load(...)



REQUIRED_COLUMNS = [
    "Date",
    "Category",
    "RefNo",
    "Date.1",
    "Withdrawal",
    "Deposit",
    "Balance",
]


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

        missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
        if missing:
            raise ValueError(f"Missing columns in CSV: {', '.join(missing)}")


        for col in ["Withdrawal", "Deposit", "Balance"]:
            df[col] = (
                df[col]
                .astype(str)
                .str.replace(",", "", regex=False)
                .str.replace(" ", "", regex=False)
                .replace("", np.nan)
                .astype(float)
                .fillna(0.0)
            )

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

        # Higher score -> more normal; we invert for intuition
        scores = -self.model.score_samples(X_scaled)
        preds = self.model.predict(X_scaled)  # -1 anomaly, 1 normal

        result: List[OperationAnalysis] = []
        for idx, (row, score, pred) in enumerate(zip(df.itertuples(), scores, preds)):
            result.append(
                OperationAnalysis(
                    index=idx,
                    date=str(getattr(row, "Date", "")),
                    category=str(getattr(row, "Category", "")),
                    ref_no=str(getattr(row, "RefNo", "")),
                    withdrawal=float(getattr(row, "Withdrawal", 0.0)),
                    deposit=float(getattr(row, "Deposit", 0.0)),
                    balance=float(getattr(row, "Balance", 0.0)),
                    anomaly_score=float(score),
                    is_anomaly=bool(pred == -1),
                )
            )
        return result


# -----------------------
# Application setup
# -----------------------

app = Flask(__name__)
app.config["DEBUG"] = True
app.config["PROPAGATE_EXCEPTIONS"] = True
transaction_model = TransactionModel()


def read_csv_from_text(csv_text: str) -> pd.DataFrame:
    data = io.StringIO(csv_text)
    df = pd.read_csv(data)
    return df


def load_default_data() -> pd.DataFrame:

    df = pd.read_csv("ci_data.csv")
    return df



try:
    base_df = load_default_data()
    transaction_model.fit(base_df)
except Exception as exc:
    print(f"Failed to train initial model: {exc}")


@app.route("/")
def root():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def files(path):
    return send_from_directory(".", path)

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
            transaction_model.fit(df)

        analyses = transaction_model.analyze(df)

        anomalies = [a for a in analyses if a.is_anomaly]
        summary = {
            "total_operations": len(analyses),
            "anomaly_count": len(anomalies),
            "anomaly_ratio": float(len(anomalies) / len(analyses)) if analyses else 0.0,
            "total_withdrawal": float(df["Withdrawal"].sum()) if "Withdrawal" in df else 0.0,
            "total_deposit": float(df["Deposit"].sum()) if "Deposit" in df else 0.0,
        }

        return jsonify(
            {
                "summary": summary,
                "operations": [asdict(a) for a in analyses],
            }
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 400


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({"status": "ok"})

@app.post("/api/predict_category_csv")
def predict_category_csv():
    try:
        data = request.get_json()
        if not data or "csv" not in data:
            return jsonify({"error": "No CSV provided"}), 400

        csv_text = data["csv"]

        print("\n========== RAW CSV RECEIVED ==========")
        print(csv_text[:500])
        print("======================================\n")

        from io import StringIO
        df = pd.read_csv(StringIO(csv_text), dtype=str)

        print("Parsed DF columns:", df.columns.tolist())
        print(df.head())

        from ml import category_model
        df_pred = category_model.predict(df)

        print("\n=== AFTER PREDICT ===")
        print(df_pred.head())
        print("=====================\n")

        rows = df_pred.to_dict(orient="records")
        return jsonify({"rows": rows})

    except Exception as e:
        print("\n\n🔥🔥🔥 SERVER ERROR IN /predict_category_csv 🔥🔥🔥")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500




if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
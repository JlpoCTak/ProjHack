import pandas as pd
import numpy as np
import joblib

MODEL_PATH = "category_model.joblib"

class CategoryModel:
    def __init__(self):
        try:
            self.model = joblib.load(MODEL_PATH)
            print("[ML] Model loaded")
        except Exception as e:
            print("[ML] ERROR LOADING MODEL:", e)
            self.model = None

    def prepare(self, df):
        df = df.copy()

        for col in ["Withdrawal", "Deposit", "Balance"]:
            if col not in df.columns:
                df[col] = 0

            df[col] = (
                df[col]
                .astype(str)
                .str.replace(",", ".", regex=False)
                .str.replace(" ", "", regex=False)
            )

            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        df["Amount"] = df["Deposit"] - df["Withdrawal"]

        # Создаём RefText — текстовая фича
        df["RefText"] = df.get("RefNo", "").astype(str).fillna("")

        # === ВАЖНО ===
        # Создаём Month и Day — именно ЭТИХ колонок не хватало
        if "Date" in df.columns:
            parsed = pd.to_datetime(df["Date"], errors="coerce", dayfirst=True)
        elif "Date.1" in df.columns:
            parsed = pd.to_datetime(df["Date.1"], errors="coerce", dayfirst=True)
        else:
            parsed = pd.to_datetime("2000-01-01")  # fallback

        df["Day"] = parsed.dt.day.fillna(0).astype(int)
        df["Month"] = parsed.dt.month.fillna(0).astype(int)

        return df

    def predict(self, df):
        df = df.copy()

        if "Category" not in df.columns:
            df["Category"] = ""

        need_pred = df["Category"].isna() | (df["Category"].str.strip() == "")
        if not need_pred.any():
            return df

        if self.model is None:
            print("[ML] Model missing")
            return df

        prepared = self.prepare(df)

        # Модель ожидает ТАКИЕ колонки:
        REQUIRED_COLS = [
            "Withdrawal", "Deposit", "Balance",
            "Amount", "RefText",
            "Month", "Day"
        ]

        X = prepared.loc[need_pred, REQUIRED_COLS]

        print("[ML] PREDICT X SHAPE:", X.shape)
        print(X.head())

        preds = self.model.predict(X)

        df.loc[need_pred, "Category"] = preds

        return df

category_model = CategoryModel()

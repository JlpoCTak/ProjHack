import pandas as pd
import numpy as np
import joblib


MODEL_PATH = "category_model.joblib"


class CategoryModel:
    """
    Упрощённая версия ml.py:
    - Модель НЕ обучается
    - Только загружается из category_model.joblib
    - Только предсказывает категории
    """

    def __init__(self):
        self.pipeline = None
        self.load()

    # ---------------------------------------------------------
    # ЗАГРУЗКА ГОТОВОЙ МОДЕЛИ
    # ---------------------------------------------------------
    def load(self):
        try:
            self.pipeline = joblib.load(MODEL_PATH)
            print(f"[ML] Category model loaded from {MODEL_PATH}")
        except Exception as e:
            print("[ML] ERROR loading model:", e)
            self.pipeline = None

    # ---------------------------------------------------------
    # ПОДГОТОВКА ДАННЫХ ДЛЯ ПРЕДСКАЗАНИЯ
    # ---------------------------------------------------------
    def _prepare_df(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        # Числовые колонки
        for col in ["Withdrawal", "Deposit", "Balance"]:
            df[col] = (
                df[col]
                .astype(str)
                .str.replace(",", ".", regex=False)
                .str.replace(" ", "", regex=False)
                .replace("", np.nan)
                .astype(float)
                .fillna(0.0)
            )

        # Amount = Deposit - Withdrawal
        df["Amount"] = df["Deposit"] - df["Withdrawal"]

        # Дата, только извлекаем день / месяц (без DateParsed!)
        date_col = "Date.1" if "Date.1" in df.columns else "Date"
        parsed = pd.to_datetime(df[date_col], errors="coerce", dayfirst=True)
        df["Day"] = parsed.dt.day.fillna(0).astype(int)
        df["Month"] = parsed.dt.month.fillna(0).astype(int)

        # Строковый текстовый признак
        df["RefText"] = df["RefNo"].astype(str).fillna("")

        return df

    # ---------------------------------------------------------
    # ПРЕДСКАЗАНИЕ ДЛЯ ВСЕГО CSV
    # ---------------------------------------------------------
    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        df — таблица, загруженная с сайта
        Возвращает df с заполненной Category (если была пустой)
        """
        if self.pipeline is None:
            raise RuntimeError("Модель не загружена")

        df2 = self._prepare_df(df)

        X = df2[[
            "RefText",
            "Withdrawal", "Deposit", "Balance",
            "Amount", "Month", "Day"
        ]]

        preds = self.pipeline.predict(X)
        df2["PredictedCategory"] = preds

        # Если Category пустая — ставим предсказание
        if "Category" not in df2.columns:
            df2["Category"] = df2["PredictedCategory"]
        else:
            df2["Category"] = df2["Category"].fillna("")
            df2["Category"] = df2.apply(
                lambda row: row["Category"] if str(row["Category"]).strip() else row["PredictedCategory"],
                axis=1
            )

        # не возвращаем PredictedCategory наружу
        df2 = df2.drop(columns=["PredictedCategory"])

        return df2

    # ---------------------------------------------------------
    # ПРЕДСКАЗАНИЕ ПО ОДНОЙ ЗАПИСИ
    # ---------------------------------------------------------
    def predict_one(self, record: dict) -> str:
        df = pd.DataFrame([record])
        df2 = self.predict(df)
        return df2.iloc[0]["Category"]


# Глобальный экземпляр
category_model = CategoryModel()

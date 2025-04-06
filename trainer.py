"""
trainer.py
Скрипт для обучения модели категорий транзакций на основе ci_data.csv.
Результат: category_model.joblib
"""

import pandas as pd
import numpy as np
import joblib
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression


INPUT_CSV = "ci_data.csv"
MODEL_PATH = "category_model.joblib"


def prepare_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # Числовые признаки
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

    # Доп. признак amount
    df["Amount"] = df["Deposit"] - df["Withdrawal"]

    # Даты
    date_col = "Date.1" if "Date.1" in df.columns else "Date"
    df["DateParsed"] = pd.to_datetime(df[date_col], errors="coerce", dayfirst=True)
    df["Day"] = df["DateParsed"].dt.day.fillna(0).astype(int)
    df["Month"] = df["DateParsed"].dt.month.fillna(0).astype(int)
    df["Year"] = df["DateParsed"].dt.year.fillna(0).astype(int)

    # Текстовый признак (RefNo как источник магазина)
    df["RefText"] = df["RefNo"].astype(str).fillna("")

    return df


def train():
    print("Загрузка данных:", INPUT_CSV)
    df = pd.read_csv(INPUT_CSV)

    df = prepare_df(df)

    # Берём строки, где категория указана
    df_train = df[df["Category"].notnull() & (df["Category"].astype(str).str.strip() != "")]
    if df_train.empty:
        raise ValueError("В CSV нет строк с Category — модель обучить невозможно.")

    print(f"Строк для обучения: {len(df_train)}")

    X = df_train[["RefText", "Withdrawal", "Deposit", "Balance", "Amount", "Month", "Day"]]
    y = df_train["Category"].astype(str)

    # Пайплайн
    text_pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 6),
            max_features=2000
        ))
    ])

    num_pipeline = Pipeline([
        ("scale", StandardScaler())
    ])

    preprocessor = ColumnTransformer([
        ("text", text_pipeline, "RefText"),
        ("num", num_pipeline, ["Withdrawal", "Deposit", "Balance", "Amount", "Month", "Day"])
    ])

    model = Pipeline([
        ("pre", preprocessor),
        ("clf", LogisticRegression(max_iter=1000, class_weight="balanced"))
    ])

    print("Обучение модели...")
    model.fit(X, y)

    joblib.dump(model, MODEL_PATH)
    print(f"✔ Модель сохранена в {MODEL_PATH}")


if __name__ == "__main__":
    train()

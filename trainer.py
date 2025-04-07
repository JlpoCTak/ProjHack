
import pandas as pd
import numpy as np
import joblib
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

INPUT_CSV = "ci_data.csv"
MODEL_PATH = "category_model.joblib"


def prepare_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

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

    df["Amount"] = df["Deposit"] - df["Withdrawal"]

    date_col = "Date.1" if "Date.1" in df.columns else "Date"
    df["DateParsed"] = pd.to_datetime(df[date_col], errors="coerce", dayfirst=True)
    df["Day"] = df["DateParsed"].dt.day.fillna(0).astype(int)
    df["Month"] = df["DateParsed"].dt.month.fillna(0).astype(int)
    df["Year"] = df["DateParsed"].dt.year.fillna(0).astype(int)

    df["RefText"] = df["RefNo"].astype(str).fillna("")

    return df


def train():
    print("Загрузка данных:", INPUT_CSV)
    df = pd.read_csv(INPUT_CSV)
    df = prepare_df(df)

    df_train = df[df["Category"].notnull() & (df["Category"].astype(str).str.strip() != "")]
    if df_train.empty:
        raise ValueError("В CSV нет строк с Category — модель обучить невозможно.")

    print(f"Строк для обучения: {len(df_train)}")

    X = df_train[["RefText", "Withdrawal", "Deposit", "Balance", "Amount", "Month", "Day"]]
    y = df_train["Category"].astype(str)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    text_pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 6), max_features=2000))
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
        ("clf", GradientBoostingClassifier())
    ])

    print("Обучение модели...")
    model.fit(X_train, y_train)

    print("\n=== Метрики качества ===")
    y_pred = model.predict(X_test)

    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))

    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    with open("metrics.txt", "w", encoding="utf-8") as f:
        f.write("Classification Report:\n")
        f.write(classification_report(y_test, y_pred))
        f.write("\nConfusion Matrix:\n")
        f.write(str(confusion_matrix(y_test, y_pred)))

    print("✔ Метрики сохранены в metrics.txt")

    joblib.dump(model, MODEL_PATH)
    print(f"✔ Модель сохранена в {MODEL_PATH}")


if __name__ == "__main__":
    train()

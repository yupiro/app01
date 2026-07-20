import os

import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import MinMaxScaler

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.models import Sequential

LSTM_WINDOW_SIZE = 60
LINEAR_WINDOW = 120
MOVING_AVERAGE_WINDOW = 20


def fetch_history(ticker: str, period: str = "2y") -> pd.DataFrame:
    df = yf.download(ticker, period=period, progress=False, auto_adjust=True)
    if df.empty:
        raise ValueError(f"銘柄コード '{ticker}' のデータが取得できませんでした。")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def fetch_company_name(ticker: str) -> str:
    try:
        info = yf.Ticker(ticker).get_info()
        return info.get("longName") or info.get("shortName") or ticker.upper()
    except Exception:
        return ticker.upper()


GAFAM_TICKERS = {
    "GOOGL": "Google",
    "AAPL": "Apple",
    "META": "Meta",
    "AMZN": "Amazon",
    "MSFT": "Microsoft",
}


def fetch_gafam_comparison(period: str = "1y"):
    tickers = list(GAFAM_TICKERS.keys())
    df = yf.download(tickers, period=period, auto_adjust=True, progress=False)
    if df.empty:
        raise ValueError("GAFAMのデータが取得できませんでした。")

    close = df["Close"][tickers].dropna()
    if close.empty:
        raise ValueError("GAFAMの共通取引データが取得できませんでした。")

    normalized = close.div(close.iloc[0]).mul(100)

    series = {}
    for ticker in tickers:
        series[ticker] = {
            "label": GAFAM_TICKERS[ticker],
            "normalized_prices": [round(float(v), 2) for v in normalized[ticker].tolist()],
            "raw_prices": [round(float(v), 2) for v in close[ticker].tolist()],
        }

    return {
        "dates": close.index.strftime("%Y-%m-%d").tolist(),
        "series": series,
    }


def predict_moving_average(close_prices: np.ndarray, days_ahead: int, window: int = MOVING_AVERAGE_WINDOW) -> np.ndarray:
    prices = close_prices.flatten()
    recent = prices[-window:] if len(prices) >= window else prices
    drift = np.diff(recent).mean() if len(recent) > 1 else 0.0
    last_price = prices[-1]
    return np.array([last_price + drift * (i + 1) for i in range(days_ahead)])


def predict_linear_regression(close_prices: np.ndarray, days_ahead: int, window: int = LINEAR_WINDOW) -> np.ndarray:
    prices = close_prices.flatten()
    recent = prices[-window:] if len(prices) >= window else prices
    x_train = np.arange(len(recent)).reshape(-1, 1)
    model = LinearRegression().fit(x_train, recent)
    x_future = np.arange(len(recent), len(recent) + days_ahead).reshape(-1, 1)
    return model.predict(x_future)


def build_lstm_model(input_shape) -> Sequential:
    model = Sequential([
        LSTM(50, return_sequences=True, input_shape=input_shape),
        Dropout(0.2),
        LSTM(50, return_sequences=False),
        Dropout(0.2),
        Dense(25),
        Dense(1),
    ])
    model.compile(optimizer="adam", loss="mean_squared_error")
    return model


def make_sequences(scaled_data: np.ndarray, window: int):
    x, y = [], []
    for i in range(window, len(scaled_data)):
        x.append(scaled_data[i - window:i, 0])
        y.append(scaled_data[i, 0])
    return np.array(x), np.array(y)


def predict_lstm(close_prices: np.ndarray, days_ahead: int, epochs: int = 15, window: int = LSTM_WINDOW_SIZE) -> np.ndarray:
    if len(close_prices) < window + 10:
        raise ValueError("LSTM予測に十分な履歴データがありません（データ量不足）。")

    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled_data = scaler.fit_transform(close_prices)

    x_train, y_train = make_sequences(scaled_data, window)
    x_train = x_train.reshape(x_train.shape[0], x_train.shape[1], 1)

    model = build_lstm_model((x_train.shape[1], 1))
    model.fit(x_train, y_train, batch_size=32, epochs=epochs, verbose=0)

    current_window = scaled_data[-window:].reshape(1, window, 1)
    predicted_scaled = []

    for _ in range(days_ahead):
        next_scaled = model.predict(current_window, verbose=0)[0, 0]
        predicted_scaled.append(next_scaled)
        current_window = np.append(current_window[:, 1:, :], [[[next_scaled]]], axis=1)

    return scaler.inverse_transform(np.array(predicted_scaled).reshape(-1, 1)).flatten()


ALGORITHMS = {
    "lstm": {"label": "LSTM（深層学習）", "func": predict_lstm},
    "linear": {"label": "線形回帰", "func": predict_linear_regression},
    "moving_average": {"label": "移動平均・トレンド", "func": predict_moving_average},
}


def predict_stock(ticker: str, days_ahead: int = 7, algorithms=None):
    algorithms = algorithms or list(ALGORITHMS.keys())
    unknown = [a for a in algorithms if a not in ALGORITHMS]
    if unknown:
        raise ValueError(f"未対応のアルゴリズムです: {', '.join(unknown)}")

    df = fetch_history(ticker)
    company_name = fetch_company_name(ticker)
    close_prices = df["Close"].values.reshape(-1, 1)

    if len(close_prices) < 30:
        raise ValueError("予測に十分な履歴データがありません（データ量不足）。")

    predictions = {}
    for key in algorithms:
        spec = ALGORITHMS[key]
        predicted_prices = spec["func"](close_prices, days_ahead)
        predictions[key] = {
            "label": spec["label"],
            "future_prices": [round(float(p), 2) for p in predicted_prices],
        }

    history_dates = df.index[-120:].strftime("%Y-%m-%d").tolist()
    history_prices = close_prices[-120:].flatten().tolist()

    last_date = df.index[-1]
    future_dates = pd.bdate_range(
        start=last_date + pd.Timedelta(days=1), periods=days_ahead
    ).strftime("%Y-%m-%d").tolist()

    return {
        "ticker": ticker.upper(),
        "company_name": company_name,
        "history_dates": history_dates,
        "history_prices": [round(float(p), 2) for p in history_prices],
        "future_dates": future_dates,
        "last_actual_price": round(float(close_prices[-1][0]), 2),
        "predictions": predictions,
    }


def backtest_stock(ticker: str, target_date: str, days_ahead: int = 7, algorithms=None, context_days: int = 30):
    algorithms = algorithms or list(ALGORITHMS.keys())
    unknown = [a for a in algorithms if a not in ALGORITHMS]
    if unknown:
        raise ValueError(f"未対応のアルゴリズムです: {', '.join(unknown)}")

    df = fetch_history(ticker, period="5y")
    company_name = fetch_company_name(ticker)

    try:
        target_ts = pd.Timestamp(target_date)
    except (ValueError, TypeError):
        raise ValueError("日付の形式が正しくありません。")

    normalized_index = df.index.normalize()
    matches = np.where(normalized_index == target_ts.normalize())[0]
    if len(matches) == 0:
        raise ValueError("選択した日付の取引データがありません（土日・祝日・上場前の可能性があります）。別の日付を選択してください。")
    target_idx = int(matches[0])

    cutoff_idx = target_idx - days_ahead
    min_required = max((LSTM_WINDOW_SIZE + 10) if "lstm" in algorithms else 0, 30)
    if cutoff_idx < min_required:
        raise ValueError("選択した日付では学習データが不足しています。もっと後の日付にするか、予測日数を減らしてください。")

    close_prices = df["Close"].values.reshape(-1, 1)
    training_prices = close_prices[: cutoff_idx + 1]

    predictions = {}
    for key in algorithms:
        spec = ALGORITHMS[key]
        predicted_prices = spec["func"](training_prices, days_ahead)
        actual_prices = close_prices[cutoff_idx + 1: target_idx + 1].flatten()
        final_predicted = float(predicted_prices[-1])
        final_actual = float(actual_prices[-1])
        deviation = final_predicted - final_actual
        predictions[key] = {
            "label": spec["label"],
            "predicted_prices": [round(float(p), 2) for p in predicted_prices],
            "final_predicted": round(final_predicted, 2),
            "final_actual": round(final_actual, 2),
            "deviation": round(deviation, 2),
            "deviation_pct": round((deviation / final_actual) * 100, 2),
        }

    context_start = max(0, cutoff_idx - context_days + 1)
    context_dates = df.index[context_start: cutoff_idx + 1].strftime("%Y-%m-%d").tolist()
    context_prices = close_prices[context_start: cutoff_idx + 1].flatten().tolist()

    prediction_dates = df.index[cutoff_idx + 1: target_idx + 1].strftime("%Y-%m-%d").tolist()
    actual_prices_window = close_prices[cutoff_idx + 1: target_idx + 1].flatten().tolist()

    return {
        "ticker": ticker.upper(),
        "company_name": company_name,
        "cutoff_date": df.index[cutoff_idx].strftime("%Y-%m-%d"),
        "target_date": df.index[target_idx].strftime("%Y-%m-%d"),
        "context_dates": context_dates,
        "context_prices": [round(float(p), 2) for p in context_prices],
        "prediction_dates": prediction_dates,
        "actual_prices": [round(float(p), 2) for p in actual_prices_window],
        "predictions": predictions,
    }

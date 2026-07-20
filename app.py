from flask import Flask, render_template, request, jsonify

from stock_predictor import ALGORITHMS, backtest_stock, fetch_gafam_comparison, predict_stock

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html", algorithms=ALGORITHMS)


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(silent=True) or {}
    ticker = (data.get("ticker") or "").strip()
    days_ahead = int(data.get("days_ahead", 7))
    algorithms = data.get("algorithms") or list(ALGORITHMS.keys())

    if not ticker:
        return jsonify({"error": "銘柄コードを入力してください。"}), 400
    if not (1 <= days_ahead <= 30):
        return jsonify({"error": "予測日数は1〜30の範囲で指定してください。"}), 400
    if not algorithms:
        return jsonify({"error": "アルゴリズムを1つ以上選択してください。"}), 400

    try:
        result = predict_stock(ticker, days_ahead=days_ahead, algorithms=algorithms)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "予測処理中にエラーが発生しました。銘柄コードを確認してください。"}), 500


@app.route("/backtest", methods=["POST"])
def backtest():
    data = request.get_json(silent=True) or {}
    ticker = (data.get("ticker") or "").strip()
    target_date = (data.get("target_date") or "").strip()
    days_ahead = int(data.get("days_ahead", 7))
    algorithms = data.get("algorithms") or list(ALGORITHMS.keys())

    if not ticker:
        return jsonify({"error": "銘柄コードを入力してください。"}), 400
    if not target_date:
        return jsonify({"error": "検証する日付を選択してください。"}), 400
    if not (1 <= days_ahead <= 30):
        return jsonify({"error": "予測日数は1〜30の範囲で指定してください。"}), 400
    if not algorithms:
        return jsonify({"error": "アルゴリズムを1つ以上選択してください。"}), 400

    try:
        result = backtest_stock(ticker, target_date, days_ahead=days_ahead, algorithms=algorithms)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "検証処理中にエラーが発生しました。銘柄コードや日付を確認してください。"}), 500


@app.route("/gafam-comparison")
def gafam_comparison():
    period = request.args.get("period", "1y")
    if period not in ("3mo", "6mo", "1y", "2y", "5y"):
        return jsonify({"error": "期間の指定が正しくありません。"}), 400

    try:
        result = fetch_gafam_comparison(period=period)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "GAFAM比較データの取得中にエラーが発生しました。"}), 500


if __name__ == "__main__":
    app.run(debug=True)

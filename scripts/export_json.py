"""data/<label>/*.csv を、ウェブページ用の data/rankings.json にまとめる。"""
import json
from pathlib import Path
import pandas as pd

LABELS = {  # 表示順と表示名
    "fy2025": "FY2025(2024年10月〜2025年9月・通年)",
    "fy2026q3": "FY2026(2025年10月〜2026年6月・9か月)",
}
TABLES = ["top100_us", "top100_nyc", "japanese_us", "japanese_nyc"]


def records(path):
    df = pd.read_csv(path)
    return json.loads(df.to_json(orient="records", force_ascii=False))


def main():
    root = Path("data")
    out = {"datasets": []}
    for label, name in LABELS.items():
        d = root / label
        if not d.exists():
            continue
        item = {"id": label, "name": name,
                "summary": json.loads((d / "summary.json").read_text(encoding="utf-8"))}
        for t in TABLES:
            item[t] = records(d / f"{t}.csv")
        out["datasets"].append(item)
    (root / "rankings.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("wrote data/rankings.json:", [x["id"] for x in out["datasets"]])


if __name__ == "__main__":
    main()

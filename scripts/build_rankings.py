"""
米国労働省(DOL)OFLCのLCA開示データ(xlsx)から、H-1B等の申請件数ランキングを作るスクリプト。

使い方:
    python scripts/build_rankings.py --label fy2025 raw/LCA_Disclosure_Data_FY2025_Q*.xlsx
    python scripts/build_rankings.py --label fy2026q3 raw/LCA_Disclosure_Data_FY2026_Q3.xlsx

出力:
    data/<label>/top100_us.csv        全社TOP100(全米)
    data/<label>/top100_nyc.csv       全社TOP100(NYC勤務のみ)
    data/<label>/japanese_us.csv      日系企業グループ別ランキング(全米)
    data/<label>/japanese_nyc.csv     日系企業グループ別ランキング(NYC勤務のみ)
    data/<label>/summary.json         集計対象の件数や期間
"""
import argparse, json, re, sys
from pathlib import Path
import pandas as pd
from python_calamine import CalamineWorkbook

sys.path.insert(0, str(Path(__file__).parent))
from jp_companies import JP  # (グループ名, 業種, 社名の正規表現)

KEEP = ["CASE_NUMBER", "CASE_STATUS", "DECISION_DATE", "SOC_CODE", "NEW_EMPLOYMENT",
        "EMPLOYER_NAME", "WORKSITE_CITY", "WORKSITE_STATE",
        "WAGE_RATE_OF_PAY_FROM", "WAGE_UNIT_OF_PAY"]
TO_YEAR = {"Year": 1, "Hour": 2080, "Week": 52, "Bi-Weekly": 26, "Month": 12}
NYC_CITIES = {"NEW YORK", "NEW YORK CITY", "MANHATTAN", "BROOKLYN", "BRONX", "QUEENS",
              "STATEN ISLAND", "LONG ISLAND CITY", "FLUSHING", "ASTORIA", "JAMAICA",
              "JACKSON HEIGHTS", "FOREST HILLS", "ELMHURST", "BAYSIDE"}


def read_lca(path):
    """xlsxを1行ずつ読み、必要な列だけのDataFrameにする(250MB級でもメモリを抑える)。"""
    rows = CalamineWorkbook.from_path(str(path)).get_sheet_by_index(0).iter_rows()
    header = next(rows)
    idx = [header.index(c) for c in KEEP]
    return pd.DataFrame(([r[i] for i in idx] for r in rows), columns=KEEP)


def normalize_name(s):
    s = re.sub(r"[.,]", "", str(s).upper().strip())
    s = re.sub(r"\b(INC|LLC|LLP|LP|LTD|CORP|CORPORATION|CO|COMPANY|NA|PC|PLLC)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def prepare(files):
    df = pd.concat([read_lca(f) for f in files], ignore_index=True)
    df["DECISION_DATE"] = pd.to_datetime(df["DECISION_DATE"], errors="coerce")
    # 同じ案件番号が複数ファイルに出る場合は、最新の審査結果だけを残す
    df = df.sort_values("DECISION_DATE").drop_duplicates("CASE_NUMBER", keep="last")
    period = (df["DECISION_DATE"].min(), df["DECISION_DATE"].max(), len(df))
    df = df[df["CASE_STATUS"] == "Certified"].copy()
    wage = pd.to_numeric(df["WAGE_RATE_OF_PAY_FROM"], errors="coerce")
    df["wage"] = wage * df["WAGE_UNIT_OF_PAY"].map(TO_YEAR)
    df["valid_wage"] = df["wage"].between(20_000, 2_000_000)  # 範囲外は入力ミスとみなす
    df["nyc"] = (df["WORKSITE_STATE"] == "NY") & \
        df["WORKSITE_CITY"].astype(str).str.upper().str.strip().isin(NYC_CITIES)
    df["new_hire"] = pd.to_numeric(df["NEW_EMPLOYMENT"], errors="coerce").fillna(0) > 0
    df["it"] = df["SOC_CODE"].astype(str).str[:5].isin(["15-11", "15-12"])
    df["key"] = df["EMPLOYER_NAME"].map(normalize_name)
    upper = df["EMPLOYER_NAME"].astype(str).str.upper().str.strip()
    df["jp_group"] = None
    df["jp_sector"] = None
    for group, sector, pattern in JP:
        hit = upper.str.contains(pattern, regex=True, na=False) & df["jp_group"].isna()
        df.loc[hit, "jp_group"] = group
        df.loc[hit, "jp_sector"] = sector
    return df, period


def stats(x):
    v = x.loc[x["valid_wage"], "wage"]
    states = x["WORKSITE_STATE"].dropna()
    return pd.Series({
        "cases": len(x),
        "nyc_cases": int(x["nyc"].sum()),
        "new_hires": int(x["new_hire"].sum()),
        "median_wage": round(float(v.median()), 0) if len(v) else None,
        "it_share": round(float(x["it"].mean()), 4),
        "top_state": states.value_counts().index[0] if len(states) else "",
    })


def most_common_name(s):
    return s.astype(str).str.strip().value_counts().index[0]


def company_ranking(df, n=100):
    g = df.groupby("key").apply(stats, include_groups=False)
    g["employer"] = df.groupby("key")["EMPLOYER_NAME"].agg(most_common_name)
    g["jp_group"] = df.groupby("key")["jp_group"].first()
    g = g.sort_values("cases", ascending=False).head(n).reset_index(drop=True)
    g.insert(0, "rank", g["cases"].rank(method="min", ascending=False).astype(int))
    return g[["rank", "employer", "cases", "nyc_cases", "new_hires", "median_wage",
              "it_share", "top_state", "jp_group"]]


def japanese_ranking(df):
    j = df[df["jp_group"].notna()]
    g = j.groupby(["jp_group", "jp_sector"]).apply(stats, include_groups=False).reset_index()
    g["main_entity"] = g["jp_group"].map(j.groupby("jp_group")["EMPLOYER_NAME"].agg(most_common_name))
    g = g.sort_values("cases", ascending=False).reset_index(drop=True)
    g.insert(0, "rank", g["cases"].rank(method="min", ascending=False).astype(int))
    return g[["rank", "jp_group", "jp_sector", "cases", "nyc_cases", "new_hires",
              "median_wage", "it_share", "top_state", "main_entity"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True, help="出力フォルダ名(例: fy2025)")
    ap.add_argument("--out", default="data")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    df, (start, end, total) = prepare(a.files)
    out = Path(a.out) / a.label
    out.mkdir(parents=True, exist_ok=True)
    company_ranking(df).to_csv(out / "top100_us.csv", index=False)
    company_ranking(df[df["nyc"]]).to_csv(out / "top100_nyc.csv", index=False)
    japanese_ranking(df).to_csv(out / "japanese_us.csv", index=False)
    japanese_ranking(df[df["nyc"]]).to_csv(out / "japanese_nyc.csv", index=False)
    summary = {"label": a.label, "files": [Path(f).name for f in a.files],
               "decision_date_from": str(start.date()), "decision_date_to": str(end.date()),
               "cases_total": int(total), "cases_certified": int(len(df)),
               "employers": int(df["key"].nunique())}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()

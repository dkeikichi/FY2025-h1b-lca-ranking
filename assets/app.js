(() => {
  "use strict";

  const state = { year: null, scope: "us", kind: "top100", q: "", sortKey: "cases", sortDir: "desc" };
  let data = null;

  const $ = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat("ja-JP");
  const fmtUsd = (v) => (v == null ? "-" : "$" + fmtInt.format(Math.round(v)));
  const fmtPct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const COLUMNS = {
    top100: [
      { key: "rank", label: "順位", cls: "rank num" },
      { key: "employer", label: "会社(申請法人)", cls: "name" },
      { key: "cases", label: "件数", cls: "num" },
      { key: "nyc_cases", label: "うちNYC", cls: "num", usOnly: true },
      { key: "new_hires", label: "新規雇用", cls: "num" },
      { key: "median_wage", label: "基本給の中央値", cls: "wage num" },
      { key: "it_share", label: "IT職の比率", cls: "num" },
      { key: "top_state", label: "最多の州", cls: "", usOnly: true },
    ],
    japanese: [
      { key: "rank", label: "順位", cls: "rank num" },
      { key: "jp_group", label: "日系グループ", cls: "name" },
      { key: "jp_sector", label: "業種", cls: "" },
      { key: "cases", label: "件数", cls: "num" },
      { key: "nyc_cases", label: "うちNYC", cls: "num", usOnly: true },
      { key: "new_hires", label: "新規雇用", cls: "num" },
      { key: "median_wage", label: "基本給の中央値", cls: "wage num" },
      { key: "it_share", label: "IT職の比率", cls: "num" },
      { key: "top_state", label: "最多の州", cls: "", usOnly: true },
    ],
  };

  function currentRows() {
    const ds = data.datasets.find((d) => d.id === state.year);
    const table = ds[`${state.kind}_${state.scope}`] || [];
    const q = state.q.trim().toLowerCase();
    let rows = q
      ? table.filter((r) => [r.employer, r.jp_group, r.main_entity].some((v) => v && String(v).toLowerCase().includes(q)))
      : table.slice();
    const k = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y), "ja") * dir;
    });
    return { ds, rows, total: table.length };
  }

  function columns() {
    return COLUMNS[state.kind].filter((c) => !(c.usOnly && state.scope === "nyc"));
  }

  function renderHead() {
    const cells = columns().map((c) => {
      const sorted = state.sortKey === c.key;
      const aria = sorted ? ` aria-sort="${state.sortDir === "asc" ? "ascending" : "descending"}"` : "";
      return `<th scope="col" class="${c.cls}"${aria}><button type="button" data-key="${c.key}">${c.label}</button></th>`;
    });
    $("thead").innerHTML = `<tr>${cells.join("")}</tr>`;
  }

  function cell(c, r, maxWage) {
    const v = r[c.key];
    switch (c.key) {
      case "employer": {
        const tag = r.jp_group ? `<span class="jp-tag" title="${esc(r.jp_group)}">日系</span>` : "";
        return `<td class="${c.cls}">${esc(v)}${tag}</td>`;
      }
      case "jp_group":
        return `<td class="${c.cls}">${esc(v)}<small>${esc(r.main_entity)}</small></td>`;
      case "median_wage": {
        const w = v == null || !maxWage ? 0 : Math.max(2, (v / maxWage) * 100);
        return `<td class="${c.cls}"><div class="wage-cell"><span>${fmtUsd(v)}</span><span class="bar" aria-hidden="true"><i style="width:${w}%"></i></span></div></td>`;
      }
      case "it_share":
        return `<td class="${c.cls}">${fmtPct(v)}</td>`;
      case "cases":
      case "nyc_cases":
      case "new_hires":
      case "rank":
        return `<td class="${c.cls}">${v == null ? "-" : fmtInt.format(v)}</td>`;
      default:
        return `<td class="${c.cls}">${esc(v)}</td>`;
    }
  }

  function renderBody() {
    const { ds, rows, total } = currentRows();
    const cols = columns();
    const maxWage = Math.max(0, ...rows.map((r) => r.median_wage || 0));
    if (!rows.length) {
      $("tbody").innerHTML = `<tr><td class="empty" colspan="${cols.length}">「${esc(state.q)}」に一致する会社はこの表にありません。TOP100に入っていない会社は「日系企業」や別の年度・勤務地で探してみてください。英語の社名でも検索できます。</td></tr>`;
    } else {
      $("tbody").innerHTML = rows
        .map((r) => {
          const jp = state.kind === "top100" ? !!r.jp_group : r.jp_sector === "金融";
          return `<tr class="${jp ? "jp" : ""}">${cols.map((c) => cell(c, r, maxWage)).join("")}</tr>`;
        })
        .join("");
    }
    const s = ds.summary;
    const scopeName = state.scope === "nyc" ? "NYC勤務のみ" : "全米";
    const kindName = state.kind === "top100" ? "全社TOP100" : "日系企業グループ";
    const highlight = state.kind === "top100" ? "色付きの行は日系企業です。" : "色付きの行は金融です。";
    $("facts").innerHTML =
      `<span>審査日 <b>${s.decision_date_from.replaceAll("-", "/")}</b> 〜 <b>${s.decision_date_to.replaceAll("-", "/")}</b></span>` +
      `<span>認証された申請 <b>${fmtInt.format(s.cases_certified)}</b> 件</span>` +
      `<span>${scopeName}の${kindName}を <b>${fmtInt.format(rows.length)}</b> / ${fmtInt.format(total)} 行表示</span>` +
      `<span>${highlight}</span>`;
  }

  function render() {
    renderHead();
    renderBody();
    const hash = `#${state.year}/${state.scope}/${state.kind}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function readHash() {
    const [y, s, k] = location.hash.replace(/^#/, "").split("/");
    if (data.datasets.some((d) => d.id === y)) state.year = y;
    if (s === "us" || s === "nyc") state.scope = s;
    if (k === "top100" || k === "japanese") state.kind = k;
  }

  function syncInputs() {
    document.querySelectorAll('input[name="year"]').forEach((el) => (el.checked = el.value === state.year));
    document.querySelectorAll('input[name="scope"]').forEach((el) => (el.checked = el.value === state.scope));
    document.querySelectorAll('input[name="kind"]').forEach((el) => (el.checked = el.value === state.kind));
  }

  function init(json) {
    data = json;
    state.year = data.datasets[0].id;
    $("year-choices").innerHTML = data.datasets
      .map((d) => `<label class="choice"><input type="radio" name="year" value="${d.id}"><span>${esc(d.name)}</span></label>`)
      .join("");
    readHash();
    syncInputs();

    $("controls").addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === "year" || t.name === "scope" || t.name === "kind") {
        state[t.name] = t.value;
        state.sortKey = "cases";
        state.sortDir = "desc";
        render();
      }
    });
    $("controls").addEventListener("submit", (e) => e.preventDefault());
    $("q").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderBody();
    });
    $("thead").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-key]");
      if (!b) return;
      const k = b.dataset.key;
      if (state.sortKey === k) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = k;
        state.sortDir = k === "rank" || k === "employer" || k === "jp_group" || k === "jp_sector" || k === "top_state" ? "asc" : "desc";
      }
      render();
    });
    window.addEventListener("hashchange", () => {
      readHash();
      syncInputs();
      render();
    });
    render();
  }

  fetch("data/rankings.json")
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(init)
    .catch(() => {
      $("tbody").innerHTML =
        '<tr><td class="empty">data/rankings.json を読み込めませんでした。ファイルを直接開いた場合は、リポジトリのフォルダで <code>python -m http.server</code> を実行し、http://localhost:8000 を開いてください。</td></tr>';
    });
})();

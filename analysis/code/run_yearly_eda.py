"""Year-selectable EDA/bootstrap for sample-filled benchmark cells only.
pip install numpy matplotlib
python run_yearly_eda.py --year 2020
python run_yearly_eda.py --start-year 2016 --end-year 2024

Reads saved per-company audit samples used to fill the integrated CSV. Does not
reconstruct ECOS microdata or alter benchmark values. Supports available years
in the integrated CSV; new years require that year's benchmark/provenance/audit.
"""

import argparse
import csv
import json
import hashlib
import math
from pathlib import Path
from collections import defaultdict, Counter
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ticker import FuncFormatter, FixedLocator

ROOT = Path(__file__).resolve().parent
GROUPS = {
    "제조업": "manufacturing",
    "도소매업": "wholesale_retail",
    "건설업": "construction",
    "부동산임대업": "real_estate_rental",
}
NAMES = {
    "유동비율": "CUR_RATIO",
    "부채비율": "DEBT_RATIO",
    "매출액영업이익률": "OPM",
    "총자산영업이익률": "ROA_OP",
    "이자보상비율": "ICR",
}
LABELS = ["Q1", "중앙값", "Q3"]


def read(p):
    """Read a UTF-8 CSV as rows keyed by column name."""
    with p.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write(p, rows):
    """Write nonempty rows using the first row to determine CSV columns."""
    if not rows:
        return
    with p.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def quantile(a, p):
    """Calculate a linearly interpolated quantile for the independent NumPy check."""
    a = sorted(a)
    t = (len(a) - 1) * p
    i = int(t)
    return a[i] + (a[min(i + 1, len(a) - 1)] - a[i]) * (t - i)


def group_name(name):
    """Map source industry labels to the names used in the OFS sample."""
    return {"도매 및 소매업": "도소매업", "부동산업": "부동산임대업"}.get(name, name)


def configure_font():
    """Select an installed Korean font and configure chart defaults."""
    candidates = [
        Path("C:/Windows/Fonts/malgun.ttf"),
        Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
    ]
    font_path = next((path for path in candidates if path.exists()), None)
    if font_path:
        font_manager.fontManager.addfont(str(font_path))
        plt.rcParams["font.family"] = font_manager.FontProperties(
            fname=str(font_path)
        ).get_name()
    else:
        print(
            "한글 글꼴을 찾지 못했습니다. Nanum Gothic 또는 Noto Sans CJK를 설치하세요.",
            flush=True,
        )
    plt.rcParams.update(
        {
            "axes.unicode_minus": False,
            "font.size": 9,
            "axes.spines.top": False,
            "axes.spines.right": False,
        }
    )


def write_explanation(out, report):
    """상세한 화면 안내는 민감도 분석 후 reclassify_relative에서 생성한다."""
    year = report["year"]
    text = (
        f"# {year}년 표본 EDA와 신뢰구간\n\n"
        f"OFS 표본 {report['sample_series']}개 업종·지표를 분석했다. "
        "95% 신뢰구간은 표본에서 추정한 분위수 경계의 불확실성이다. "
        "전체 업종 대표성이나 연체 예측 성능을 입증하지 않는다.\n\n"
        f"[신뢰구간 CSV](../02_부트스트랩/신뢰구간_통합_{year}.csv)\n"
    )
    (out / "04_설명및검증" / f"EDA_설명및검증_{year}.md").write_text(
        text, encoding="utf-8"
    )


def load_sources():
    """Read the benchmark and provenance files, then index audit samples by series."""
    integrated = ROOT / "2016-2025_4개업종_전체기업_5개재무지표.csv"
    ledger = ROOT / "2016-2025_4개업종_전체기업_5개재무지표_계산및보충내역.md"
    rows = read(integrated)
    labels = {}
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| 20"):
            continue
        c = [x.strip() for x in line.strip("|").split("|")]
        if len(c) == 10:
            labels[(c[0], group_name(c[1]), c[2])] = c[7:10]
    audits = {}
    paths = [integrated, ledger]
    path = ROOT / "loansight_ofs_20261031.sample_audit.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["fs_div"] == "OFS" and data["tables"] == [
        "public.fs4_report",
        "public.fs4_value",
    ]
    series = defaultdict(list)
    for v in data["observations"]:
        series[(v["year"], v["industry"], v["metric"])].append(v)
    for g in data["groups"]:
        key = (g["year"], g["industry"], g["metric"])
        assert ("dump", key) not in audits
        audits[("dump", key)] = {
            "values": series.get(key, []),
            "group": g,
            "path": path,
        }
    paths.append(path)
    return rows, labels, audits, paths


def bootstrap(x, key, iterations):
    """Resample the OFS observations and cross-check the resulting quartile intervals."""
    seed = int.from_bytes(
        hashlib.sha256(("20251031|" + "|".join(key)).encode()).digest()[:8], "big"
    )
    rng = np.random.default_rng(seed)
    draws = []
    for start in range(0, iterations, 200):
        sample = rng.choice(
            x, size=(min(200, iterations - start), len(x)), replace=True
        )
        draws.append(np.quantile(sample, [0.25, 0.5, 0.75], axis=1).T)
    b = np.concatenate(draws)
    ci = np.quantile(b, [0.025, 0.975], axis=0)
    assert b.shape == (iterations, 3)
    for j in range(3):
        for i, p in enumerate([0.025, 0.975]):
            assert np.isclose(ci[i, j], quantile(b[:, j], p), rtol=1e-12, atol=1e-8)
    return ci


def recommendation(r, args):
    """Return the display guidance and the unfavorable quartile boundary."""
    return (
        "상대 구간 표시",
        "표본 수·CI·경계 부근을 함께 안내",
        "Q3" if r["지표"] == "부채비율" else "Q1",
    )


def year_analysis(year, allrows, labels, audits, paths, args):
    """Validate one year of samples and write its distribution, CI and audit outputs."""
    year = str(year)
    rows = [r for r in allrows if r["연도"] == year]
    assert len(rows) == 20
    out = args.output / f"eda_{year}"
    for folder in ["01_분포그래프", "02_부트스트랩", "03_데이터", "04_설명및검증"]:
        (out / folder).mkdir(parents=True, exist_ok=True)
    results = []
    summary = []
    values = []
    recommendations = []
    checked = 0
    data_by_key = {}
    status_by_key = {}
    for row in rows:
        industry = group_name(row["산업명"])
        key = (year, industry, row["지표"])
        source = labels[key]
        sample = any("OFS" in s for s in source)
        rec = {
            "연도": year,
            "산업": industry,
            "지표": row["지표"],
            "출처": "",
            "표본수": "",
            "활용구분": "",
            "이유": "",
            "취약방향경계": "Q3" if row["지표"] == "부채비율" else "Q1",
        }
        if not sample:
            rec["출처"] = (
                "ECOS" if all(x == "ECOS" for x in source) else "미확보 또는 일부 ECOS"
            )
            rec["활용구분"] = "ECOS 사용·검증 제외" if rec["출처"] == "ECOS" else "보류"
            rec["이유"] = (
                "공표 분위수는 표본 재추출 대상 아님"
                if rec["출처"] == "ECOS"
                else "분위수 미확보"
            )
            candidates = [
                audits.get((stage, (year, industry, NAMES[row["지표"]])))
                for stage in ["dump", "common"]
            ]
            g = next((c["group"] for c in candidates if c), None)
            if g:
                rec["표본수"] = g["n"]
                rec["이유"] += "; " + json.dumps(
                    g.get("excluded", {}), ensure_ascii=False
                )
            recommendations.append(rec)
            status_by_key[(industry, row["지표"])] = rec["활용구분"]
            continue
        # No mixed-population distribution is inferred.
        stage = "dump" if any("덤프" in s for s in source) else "common"
        assert all(
            ("덤프" in s if stage == "dump" else "common OFS" in s) for s in source
        ), key
        audit = audits[(stage, (year, industry, NAMES[row["지표"]]))]
        records = audit["values"]
        assert len(records) == audit["group"]["n"] and len(
            {v["corp_code"] for v in records}
        ) == len(records)
        x = np.array([v["value"] for v in records], dtype=float)
        assert np.isfinite(x).all() and len(x) >= 2
        q = np.quantile(x, [0.25, 0.5, 0.75])
        expected = np.array(
            [float(row[c]) for c in ["제1사분위수", "중앙값", "제3사분위수"]]
        )
        assert np.allclose(q, expected, rtol=1e-10, atol=1e-6), (key, q, expected)
        assert np.allclose(
            q, [quantile(x, p) for p in [0.25, 0.5, 0.75]], rtol=1e-12, atol=1e-8
        )
        ci = bootstrap(x, key, args.iterations)
        checked += 6
        result = {
            "연도": year,
            "산업": industry,
            "지표": row["지표"],
            "표본수": len(x),
            "단위": "%",
            "IQR": float(q[2] - q[0]),
        }
        for j, label in enumerate(LABELS):
            result.update(
                {
                    label: float(q[j]),
                    label + "_CI95_하한": float(ci[0, j]),
                    label + "_CI95_상한": float(ci[1, j]),
                }
            )
            if label != "중앙값":
                result[label + "_경계민감비중"] = float(
                    ((x >= ci[0, j]) & (x <= ci[1, j])).mean()
                )
        results.append(result)
        data_by_key[(industry, row["지표"])] = (x, result)
        desc = {
            **result,
            "최솟값": float(x.min()),
            "최댓값": float(x.max()),
            "음수수": int((x < 0).sum()),
            "0수": int((x == 0).sum()),
            "표본출처": stage,
            "사전제외사유": json.dumps(
                audit["group"].get("excluded", {}), ensure_ascii=False
            ),
        }
        summary.append(desc)
        for v in records:
            values.append(
                {
                    "연도": year,
                    "산업": industry,
                    "지표": row["지표"],
                    "corp_code": v["corp_code"],
                    "값": v["value"],
                    "단위": "%",
                    "표본출처": v.get("source", v.get("method", stage)),
                }
            )
        status, reason, active = recommendation(result, args)
        rec.update(
            {
                "출처": "loansight public OFS",
                "표본수": len(x),
                "활용구분": status,
                "이유": reason,
                "취약방향경계": active,
            }
        )
        recommendations.append(rec)
        status_by_key[(industry, row["지표"])] = status
    assert len(recommendations) == 20 and checked == 6 * len(results)
    write(out / "03_데이터" / f"sample_values_{year}.csv", values)
    write(out / "03_데이터" / f"summary_{year}.csv", summary)
    write(out / "02_부트스트랩" / f"신뢰구간_통합_{year}.csv", results)
    for industry, slug in GROUPS.items():
        fig, axes = plt.subplots(2, 5, figsize=(21, 8.5))
        for j, name in enumerate(NAMES):
            key = (industry, name)
            if key not in data_by_key:
                for ax in axes[:, j]:
                    ax.text(
                        0.5,
                        0.5,
                        status_by_key[key],
                        ha="center",
                        va="center",
                        transform=ax.transAxes,
                        fontsize=9,
                    )
                    ax.set_xticks([])
                    ax.set_yticks([])
                axes[0, j].set_title(name)
                continue
            x, r = data_by_key[key]
            lo, hi = np.quantile(x, [0.01, 0.99])
            central = x[(x >= lo) & (x <= hi)]
            ax = axes[0, j]
            ax.hist(
                central,
                bins=min(40, max(5, int(np.sqrt(len(central))))),
                color="#4d7294",
                edgecolor="white",
            )
            ax.set_title(
                f"{name}\nn={len(x)}, P1~P99 확대\n화면 밖 {len(x)-len(central)}개"
            )
            ax.set_ylabel("기업 수")
            ax.set_xlabel("%")
            for label, color in [
                ("Q1", "#b47a2a"),
                ("중앙값", "#202c36"),
                ("Q3", "#b47a2a"),
            ]:
                ax.axvline(
                    r[label], color=color, ls="--" if label != "중앙값" else "-", lw=1
                )
            ax = axes[1, j]
            ax.step(
                np.sort(x),
                np.arange(1, len(x) + 1) / len(x),
                where="post",
                color="#4d7294",
            )
            scale = max(0.1, float(np.median(np.abs(x))) * 0.1)
            ax.set_xscale("symlog", linthresh=scale)
            ax.set_ylim(0, 1.03)
            ticks = ax.get_xticks()
            a, b = ax.get_xlim()
            ticks = ticks[
                (ticks >= a)
                & (ticks <= b)
                & ((ticks == 0) | (np.abs(ticks) >= scale * 2))
            ]
            if len(ticks) > 7:
                ticks = ticks[np.linspace(0, len(ticks) - 1, 7).astype(int)]
            ax.xaxis.set_major_locator(FixedLocator(ticks))
            ax.xaxis.set_major_formatter(
                FuncFormatter(
                    lambda v, p: (
                        f"{v:g}"
                        if abs(v) < 1
                        else f"{v:,.0f}" if abs(v) < 100000 else f"{v:.0e}"
                    )
                )
            )
            ax.tick_params(axis="x", labelsize=8, labelrotation=30)
            for label, color in [
                ("Q1", "#b47a2a"),
                ("중앙값", "#202c36"),
                ("Q3", "#b47a2a"),
            ]:
                ax.axvline(r[label], color=color, ls="--", lw=1)
            ax.set_title(
                f"전체 누적분포\nQ1 {r['Q1']:.2f} · 중앙값 {r['중앙값']:.2f} · Q3 {r['Q3']:.2f}"
            )
            ax.set_xlabel("% (대칭 로그축)")
            ax.set_ylabel("누적 비율")
        fig.suptitle(f"{year}년 {industry} · 실제 표본 분위수 사용 항목만", fontsize=16)
        fig.text(
            0.02,
            0.02,
            "상단은 화면만 P1~P99로 확대 · 통계/하단 ECDF에는 극단값 포함 · 기업별 계산값은 기존 보충 감사 기록에서 복원",
            fontsize=10,
        )
        fig.tight_layout(rect=(0, 0.06, 1, 0.94))
        fig.savefig(
            out / "01_분포그래프" / f"{slug}_{year}.png", dpi=120, facecolor="white"
        )
        plt.close(fig)
    fig, axes = plt.subplots(4, 5, figsize=(22, 12))
    for i, industry in enumerate(GROUPS):
        for j, name in enumerate(NAMES):
            ax = axes[i, j]
            key = (industry, name)
            ax.set_title(" · ".join(key), fontsize=10)
            if key not in data_by_key:
                ax.text(
                    0.5,
                    0.5,
                    status_by_key[key],
                    ha="center",
                    va="center",
                    transform=ax.transAxes,
                    fontsize=9,
                )
                ax.set_xticks([])
                ax.set_yticks([])
                continue
            x, r = data_by_key[key]
            for y, label, color in [
                (2, "Q1", "#456b90"),
                (1, "중앙값", "#202c36"),
                (0, "Q3", "#b47a2a"),
            ]:
                ax.hlines(
                    y,
                    r[label + "_CI95_하한"],
                    r[label + "_CI95_상한"],
                    color=color,
                    lw=5,
                    alpha=0.5,
                )
                ax.plot(r[label], y, "o", color=color)
            ax.set_yticks([2, 1, 0], LABELS)
            ax.set_ylim(-0.6, 2.6)
            ax.set_xlabel(f"% · n={len(x)}")
            ax.tick_params(axis="x", labelrotation=25)
            ax.grid(axis="x", alpha=0.15)
    fig.suptitle(f"{year}년 OFS 표본 · Q1·중앙값·Q3 및 부트스트랩 95% CI", fontsize=16)
    fig.text(
        0.02,
        0.015,
        "점: 추정 통계량 · 선: 추정 불확실성 · 축 범위는 패널마다 다름 · 기업값 안전구간이 아님",
        fontsize=10,
    )
    fig.tight_layout(rect=(0, 0.04, 1, 0.95))
    fig.savefig(
        out / "02_부트스트랩" / f"신뢰구간_통합_{year}.png", dpi=120, facecolor="white"
    )
    plt.close(fig)
    lines = [
        f"# {year}년 표본 재무비율 EDA·신뢰구간 해석",
        "",
        f"새 loansight public OFS의 실제 표본 분위수 {len(results)}개 항목만 분석했다. ECOS 공표값 및 미확보 항목은 제외했다. 기업별 원금액 계산의 감사 기록을 사용해 갱신된 통합 CSV 분위수와 대조했다. EDA 실행 자체는 기준값을 바꾸지 않는다.",
        "",
        "## 방법과 한계",
        "",
        f"- 기업 단위 복원추출 {args.iterations:,}회, Q1·중앙값·Q3를 같은 재추출에서 계산, percentile 95% CI. 연도·업종·지표별 고정 난수.",
        "- ECOS 제외는 출처 기록 기준이며 원래 표본을 재구성한 것이 아니다. 일부 공표/결측 혼합 행도 표본 분포로 만들지 않았다.",
        "- 히스토그램은 P1~P99 화면 확대, ECDF·통계는 극단값 포함. 이상치 자동 삭제 없음.",
        "- CI는 통계량 추정의 불확실성으로, 안전 범위나 부실확률이 아니다. 모집단 대표성·회계오류·기간 문제를 해결하지 못하며 전체 항목 동시 95% 보장이 아니다.",
        "- 이자보상비율은 % 단위. 배수로 표시하려면 100으로 나눈다. 부채비율에서 제외한 자본 비양수 기업은 별도 자본잠식 확인 대상이다.",
        "",
        "## 화면 활용 권고 규칙",
        "",
        f"- 아래 규칙은 연도간 일관성을 위한 보수적 운영 가설이다. 검증된 통계 합격선·위험 판정 기준이 아니다. n={args.min_use}/{args.min_conditional}, CI폭/IQR={args.use_width}/{args.reference_width}는 설정값이며 조정 가능하다.",
        f"- 취약 방향 경계는 부채비율 Q3, 나머지 Q1. 경계 CI폭과 중앙값 CI폭을 IQR로 나누어 함께 확인한다.",
        "- 소표본, 임대업과 ECOS 상위 업종 범위 차이, 수익성 Q1 CI의 0 포함, 이자보상비율 중앙값 CI의 100% 포함은 참고용 우선 사유다. 이 자체가 통계적 실패를 뜻하지 않는다.",
        "- 활용 후보라도 위험 경고로 자동 연결하지 않는다. 경계 CI 안은 경계 부근으로 안내할 수 있다. CI 밖을 안전으로 표시하지 않는다.",
        "",
        "| 업종 | 지표 | 출처 | n | 활용 권고 | 이유 |",
        "|---|---|---|---:|---|---|",
    ]
    for r in recommendations:
        lines.append(
            "| "
            + " | ".join(
                str(r[c])
                for c in ["산업", "지표", "출처", "표본수", "활용구분", "이유"]
            )
            + " |"
        )
    lines += [
        "",
        "## 통계 결과",
        "",
        "단위 %. 괄호는 각각의 95% CI.",
        "",
        "| 업종 | 지표 | n | Q1 (CI) | 중앙값 (CI) | Q3 (CI) |",
        "|---|---|---:|---|---|---|",
    ]
    for r in results:
        lines.append(
            "| "
            + " | ".join(
                [r["산업"], r["지표"], str(r["표본수"])]
                + [
                    f"{r[k]:.2f} ({r[k+'_CI95_하한']:.2f}~{r[k+'_CI95_상한']:.2f})"
                    for k in LABELS
                ]
            )
            + " |"
        )
    lines += [
        "",
        "## 재현·검증",
        "",
        f"- 원본 분위수 일치 검사 {len(results)*3}개, CI 선형보간 검사 {checked}개 통과. 회사별 중복·표본 수·유한값 검사 통과.",
        "- sample_values는 실제 회사별 입력값이며 부트스트랩 가상 표본이 아니다. summary는 실제 분석한 표본 항목만의 집계 통계다. 출처·결측 포함 전체 20조건은 화면비교기준_활용권고 CSV에서 확인한다.",
        "- 재실행: 상위 폴더에서 `py -3 .\\run_yearly_eda.py --year " + year + "`",
        "- 2016~2025년 권고는 동일한 운영 가설 규칙으로 작성했다. 통계적으로 검증된 위험 판정 합격선은 아니다.",
    ]
    doc = out / "02_부트스트랩" / f"신뢰구간_통합해석_{year}.md"
    doc.write_text("\n".join(lines) + "\n", encoding="utf-8")
    hashes = {
        str(p.relative_to(ROOT.parent)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in paths
    }
    report = {
        "year": year,
        "sample_series": len(results),
        "ci_checks": checked,
        "point_checks": len(results) * 3,
        "sample_observations": len(values),
        "recommendation_counts": dict(Counter(r["활용구분"] for r in recommendations)),
        "iterations": args.iterations,
        "rules": {
            "min_use": args.min_use,
            "min_conditional": args.min_conditional,
            "use_width": args.use_width,
            "reference_width": args.reference_width,
        },
        "input_hashes": hashes,
    }
    (out / "04_설명및검증/verification.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_explanation(out, report)
    import os

    summary_root = args.output.parent if args.output.name == "eda" else args.output
    central = summary_root / "2016-2025_표본EDA_화면활용권고.csv"
    central_link = os.path.relpath(central, out).replace("\\", "/")
    links = [
        f"# {year}년 EDA 결과",
        "",
        f"- [신뢰구간과 화면 활용 해석](02_부트스트랩/신뢰구간_통합해석_{year}.md)",
        f"- [전체 연도 화면 활용 권고 CSV]({central_link}) — 연도 열로 필터",
        f"- [신뢰구간 그래프](02_부트스트랩/신뢰구간_통합_{year}.png)",
        f"- [신뢰구간 CSV](02_부트스트랩/신뢰구간_통합_{year}.csv)",
        f"- [기업별 표본](03_데이터/sample_values_{year}.csv)",
        f"- [요약 통계](03_데이터/summary_{year}.csv)",
    ]
    for group, slug in GROUPS.items():
        links.append(f"- [{group} 분포](01_분포그래프/{slug}_{year}.png)")
    links.append(f"- [EDA 설명 및 검증](04_설명및검증/EDA_설명및검증_{year}.md)")
    if (out / f"05_구간민감도/구간민감도_해석_{year}.md").exists():
        links.append(f"- [구간 배정 민감도](05_구간민감도/구간민감도_해석_{year}.md)")
    (out / "README.md").write_text("\n".join(links) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {k: v for k, v in report.items() if k not in ("input_hashes", "rules")},
            ensure_ascii=True,
        ),
        flush=True,
    )
    return recommendations, report


def main():
    """Load the sources, run each year, then update sensitivity and display guidance."""
    p = argparse.ArgumentParser(description=__doc__)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--year", type=int)
    g.add_argument("--start-year", type=int)
    p.add_argument("--end-year", type=int)
    p.add_argument("--output", type=Path, default=ROOT.parent / "05_재실행결과" / "eda")
    p.add_argument("--iterations", type=int, default=5000)
    p.add_argument("--min-use", type=int, default=100)
    p.add_argument("--min-conditional", type=int, default=30)
    p.add_argument("--use-width", type=float, default=0.5)
    p.add_argument("--reference-width", type=float, default=1.0)
    p.add_argument(
        "--with-sensitivity",
        action="store_true",
        help="Run quartile assignment sensitivity after EDA/bootstrap",
    )
    args = p.parse_args()
    if (
        args.iterations < 1000
        or not (0 < args.min_conditional <= args.min_use)
        or not (0 < args.use_width <= args.reference_width)
    ):
        p.error("Invalid bootstrap or provisional rule settings")
    if args.year and args.end_year:
        p.error("--end-year requires --start-year")
    years = (
        [args.year]
        if args.year
        else list(
            range(
                args.start_year,
                (args.end_year if args.end_year is not None else args.start_year) + 1,
            )
        )
    )
    if not years:
        p.error("end year must not precede start year")
    rows, labels, audits, paths = load_sources()
    available = {int(r["연도"]) for r in rows}
    if set(years) - available:
        p.error(f"Unavailable years; supplied data supports {sorted(available)}")
    summary_root = args.output.parent if args.output.name == "eda" else args.output
    central = summary_root / "2016-2025_표본EDA_화면활용권고.csv"
    seed = (
        central
        if central.exists()
        else summary_root / "2016-2024_표본EDA_화면활용권고.csv"
    )
    combined = (
        [r for r in read(seed) if int(r["연도"]) not in years] if seed.exists() else []
    )
    configure_font()
    reports = []
    for year in years:
        r, v = year_analysis(year, rows, labels, audits, paths, args)
        combined.extend(r)
        reports.append(v)
    args.output.mkdir(parents=True, exist_ok=True)
    combined.sort(
        key=lambda r: (
            int(r["연도"]),
            list(GROUPS).index(r["산업"]),
            list(NAMES).index(r["지표"]),
        )
    )
    assert len({(r["연도"], r["산업"], r["지표"]) for r in combined}) == len(combined)
    complete_years = sorted({int(r["연도"]) for r in combined})
    assert all(sum(int(r["연도"]) == y for r in combined) == 20 for y in complete_years)
    write(central, combined)
    reports = [
        json.loads(
            (args.output / f"eda_{y}/04_설명및검증/verification.json").read_text(
                encoding="utf-8"
            )
        )
        for y in complete_years
    ]
    name = "2016-2025"
    lines = [
        f"# {name}년 표본 재무비율 EDA·추정 안정성 점검",
        "",
        "업종별 재무비율 비교 기준 구축을 위한 탐색적 데이터 분석(EDA) 및 부트스트랩 기반 분위수 추정 안정성 점검을 수행했다. 실제 부실·연체 예측 성능 검증은 포함하지 않는다. ECOS 공표 분위수는 제외했다. 상대 구간은 위험등급이 아니며 표본 수와 추정 불확실성을 함께 확인한다.",
        "",
        "## 연도별 결과",
        "",
        "| 연도 | 분석 표본 항목 | 분위수 대조 | CI 검증 | 결과 |",
        "|---|---:|---:|---:|---|",
    ]
    import os

    for r in reports:
        link = os.path.relpath(
            args.output / f"eda_{r['year']}/README.md", summary_root
        ).replace("\\", "/")
        lines.append(
            f"| {r['year']} | {r['sample_series']} | {r['point_checks']} | {r['ci_checks']} | [연도별 안내]({link}) |"
        )
    lines += [
        "",
        "## 실행",
        "",
        "```powershell",
        "py -3 -m pip install numpy matplotlib",
        "py -3 .\\run_yearly_eda.py --year 2020",
        "py -3 .\\run_yearly_eda.py --start-year 2016 --end-year 2025",
        "```",
        "",
        "연도는 현재 원본에 포함된 2016~2025년 중 선택할 수 있다. 새 연도는 해당 연도의 통합 기준값·출처 기록·기업별 감사 표본을 준비하면 같은 코드로 분석할 수 있다. 결과는 eda_연도 하위에 저장하며, 원본 기준값 CSV는 바꾸지 않는다. 재실행하면 해당 분석 결과를 갱신한다. 2025년은 명시적으로 요청한 경우에만 갱신된다.",
        "",
        "## 권고별 현황",
        "",
        "| 연도 | 상대 구간 표시 | ECOS 제외 | 보류 |",
        "|---|---:|---:|---:|",
    ]
    for r in reports:
        c = r["recommendation_counts"]
        lines.append(
            "| "
            + " | ".join(
                [r["year"]]
                + [
                    str(c.get(k, 0))
                    for k in ["상대 구간 표시", "ECOS 사용·검증 제외", "보류"]
                ]
            )
            + " |"
        )
    lines += [
        "",
        "기본 저장 위치는 eda/eda_연도이다. 화면 활용 권고는 상위 통합 CSV 한 개만 관리한다. 특정 연도를 재실행하면 그 연도 20행만 갱신하고 다른 연도의 권고는 유지한다.",
    ]
    (summary_root / f"{name}_표본EDA_결과안내.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )
    if args.with_sensitivity:
        # Sensitivity uses the sample and confidence interval files written above.
        from run_sensitivity import main as sensitivity_main

        requested = (
            ["--year", str(years[0])]
            if len(years) == 1
            else ["--start-year", str(min(years)), "--end-year", str(max(years))]
        )
        sensitivity_main(
            requested
            + ["--eda-root", str(args.output), "--iterations", str(args.iterations)]
        )

    if not args.with_sensitivity:
        print("민감도와 상대 구간 종합 결과는 --with-sensitivity 실행 시 생성됩니다.")
        return
    # Build display guidance after confidence intervals and sensitivity are available.
    from reclassify_relative import main as reclassify_main

    reclassify_main(
        [
            "--start-year",
            str(min(years)),
            "--end-year",
            str(max(years)),
            "--eda-root",
            str(args.output),
            "--min-use",
            str(args.min_use),
            "--min-conditional",
            str(args.min_conditional),
            "--use-width",
            str(args.use_width),
            "--reference-width",
            str(args.reference_width),
        ]
    )


if __name__ == "__main__":
    main()

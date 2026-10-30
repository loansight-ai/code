"""Conservative account mapping: never turn a missing component into zero."""

import re
from decimal import Decimal, InvalidOperation, localcontext

MAPPING_VERSION = "financial-accounts-v3"
FORMULA_VERSION = "financial-formulas-v3"
PERIODS = ("current", "previous", "before_previous")
AMOUNT_KEYS = ("thstrm_amount", "frmtrm_amount", "bfefrmtrm_amount")
TERM_KEYS = ("thstrm_nm", "frmtrm_nm", "bfefrmtrm_nm")

# key, display name, statement types, standard IDs, exact nonstandard aliases.
# Broad aggregates (e.g. CurrentBorrowings or trade AND other receivables) are
# deliberately not treated as their narrower components.
ACCOUNTS = [
    ("revenue", "매출액", "IS,CIS", ["Revenue"], ["매출액", "수익(매출액)"]),
    (
        "operating_profit",
        "영업이익",
        "IS,CIS",
        ["ProfitLossFromOperatingActivities", "dart_OperatingIncomeLoss"],
        ["영업이익", "영업이익(손실)"],
    ),
    ("net_profit", "당기순이익", "IS,CIS", ["ProfitLoss"], ["당기순이익", "당기순이익(손실)"]),
    ("cost_of_sales", "매출원가", "IS,CIS", ["CostOfSales"], ["매출원가"]),
    ("gross_profit", "매출총이익", "IS,CIS", ["GrossProfit"], ["매출총이익", "매출총이익(손실)"]),
    (
        "sga",
        "판매비와관리비",
        "IS,CIS",
        ["dart_TotalSellingGeneralAdministrativeExpenses"],
        ["판매비와관리비", "판매비및관리비"],
    ),
    (
        "interest_expense",
        "이자비용",
        "IS,CIS",
        ["InterestExpense", "FinanceCostsInterestExpense"],
        ["이자비용"],
    ),
    ("assets", "자산총계", "BS", ["Assets"], ["자산총계"]),
    ("liabilities", "부채총계", "BS", ["Liabilities"], ["부채총계"]),
    ("equity", "자본총계", "BS", ["Equity"], ["자본총계"]),
    ("current_assets", "유동자산", "BS", ["CurrentAssets"], ["유동자산"]),
    ("current_liabilities", "유동부채", "BS", ["CurrentLiabilities"], ["유동부채"]),
    ("inventory", "재고자산", "BS", ["Inventories"], ["재고자산"]),
    ("receivables", "매출채권", "BS", ["TradeReceivables"], ["매출채권"]),
    ("payables", "매입채무", "BS", ["TradePayables"], ["매입채무"]),
    ("contract_assets", "계약자산", "BS", ["ContractAssets"], ["계약자산"]),
    ("contract_liabilities", "계약부채", "BS", ["ContractLiabilities"], ["계약부채"]),
    ("investment_property", "투자부동산", "BS", ["InvestmentProperty"], ["투자부동산"]),
    (
        "short_borrowings",
        "단기차입금",
        "BS",
        ["dart_ShortTermBorrowings", "ShorttermBorrowings"],
        ["단기차입금"],
    ),
    (
        "current_long_borrowings",
        "유동성장기차입금",
        "BS",
        ["dart_CurrentPortionOfLongTermBorrowings"],
        ["유동성장기차입금"],
    ),
    (
        "long_borrowings",
        "장기차입금",
        "BS",
        ["dart_LongTermBorrowings", "NoncurrentPortionOfNoncurrentLoansReceived"],
        ["장기차입금"],
    ),
    (
        "current_borrowings_aggregate",
        "유동 차입·사채 집계",
        "BS",
        ["CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings"],
        [],
    ),
    ("noncurrent_borrowings_aggregate", "비유동 차입·사채 집계", "BS", ["LongtermBorrowings"], []),
    (
        "bonds",
        "비유동 사채",
        "BS",
        ["dart_BondsIssued", "NoncurrentPortionOfNoncurrentBondsIssued"],
        ["사채"],
    ),
    ("current_bonds", "유동성사채", "BS", ["dart_CurrentPortionOfBonds"], ["유동성사채"]),
    ("note_borrowing_subtotal", "주석 차입금 소계 (리스 제외)", "BS", [], []),
    (
        "current_lease",
        "유동 리스부채",
        "BS",
        ["CurrentLeaseLiabilities", "LeaseLiabilitiesCurrent"],
        ["유동리스부채"],
    ),
    (
        "noncurrent_lease",
        "비유동 리스부채",
        "BS",
        ["NoncurrentLeaseLiabilities", "LeaseLiabilitiesNoncurrent"],
        ["비유동리스부채"],
    ),
    ("rental_deposits", "임대보증금", "BS", [], ["임대보증금"]),
    (
        "operating_cashflow",
        "영업활동현금흐름",
        "CF",
        ["CashFlowsFromUsedInOperatingActivities"],
        ["영업활동현금흐름", "영업활동으로인한현금흐름"],
    ),
    (
        "investing_cashflow",
        "투자활동현금흐름",
        "CF",
        ["CashFlowsFromUsedInInvestingActivities"],
        ["투자활동현금흐름", "투자활동으로인한현금흐름"],
    ),
    (
        "financing_cashflow",
        "재무활동현금흐름",
        "CF",
        ["CashFlowsFromUsedInFinancingActivities"],
        ["재무활동현금흐름", "재무활동으로인한현금흐름"],
    ),
    ("depreciation", "감가상각비", "CF", ["AdjustmentsForDepreciationExpense"], ["감가상각비"]),
    (
        "cash_beginning",
        "기초 현금및현금성자산",
        "CF",
        [
            "dart_CashAndCashEquivalentsAtBeginningOfPeriodCf",
            "CashAndCashEquivalentsAtBeginningOfPeriod",
        ],
        ["기초현금및현금성자산", "기초의현금및현금성자산"],
    ),
    (
        "cash_ending",
        "기말 현금및현금성자산",
        "CF",
        [
            "dart_CashAndCashEquivalentsAtEndOfPeriodCf",
            "CashAndCashEquivalentsAtEndOfPeriod",
        ],
        ["기말현금및현금성자산", "기말의현금및현금성자산"],
    ),
    (
        "amortisation",
        "무형자산상각비",
        "CF",
        ["AdjustmentsForAmortisationExpense"],
        ["무형자산상각비"],
    ),
    (
        "ppe_acquisition",
        "유형자산 취득 지출",
        "CF",
        ["PurchaseOfPropertyPlantAndEquipment", "PaymentsToAcquirePropertyPlantAndEquipment"],
        ["유형자산의취득"],
    ),
    (
        "intangible_acquisition",
        "무형자산 취득 지출",
        "CF",
        ["PurchaseOfIntangibleAssets", "PaymentsToAcquireIntangibleAssets"],
        ["무형자산의취득"],
    ),
    (
        "interest_paid",
        "이자 지급",
        "CF",
        ["InterestPaidClassifiedAsOperatingActivities"],
        ["이자의지급", "이자지급"],
    ),
    (
        "tax_paid",
        "법인세 지급",
        "CF",
        ["IncomeTaxesPaidRefundClassifiedAsOperatingActivities"],
        ["법인세납부", "법인세의납부"],
    ),
]


def clean_name(value: str) -> str:
    return re.sub(r"\s+", "", value)


def amount(value) -> Decimal | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if value.startswith("(") and value.endswith(")"):
        value = "-" + value[1:-1]
    # Dashes and empty cells are not proof of a zero balance.
    if not re.fullmatch(r"-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", value):
        return None
    value = value.replace(",", "")
    try:
        result = Decimal(value)
        return (
            result
            if result.is_finite()
            and len(result.as_tuple().digits) <= 30
            and result.as_tuple().exponent >= -6
            else None
        )
    except InvalidOperation:
        return None


def standard_ids(names):
    return {name for name in names if name.startswith("dart_")} | {
        f"{prefix}_{name}"
        for name in names
        if not name.startswith("dart_")
        for prefix in ("ifrs", "ifrs-full")
    }


def map_facts(rows: list[dict]) -> list[dict]:
    facts = []
    for key, label, statements, ids, aliases in ACCOUNTS:
        allowed = statements.split(",")
        candidates = [r for r in rows if r.get("sj_div") in allowed]
        matches = [r for r in candidates if r.get("account_id") in standard_ids(ids)]
        method = "standard_id"
        if not matches:
            # Never override an unrecognised standard ID with a familiar name.
            matches = [
                r
                for r in candidates
                if r.get("account_id") in ("", "-표준계정코드 미사용-")
                and clean_name(r.get("account_nm", "")) in aliases
            ]
            method = "exact_nonstandard_name"
        # IS and CIS may repeat the same income statement. Prefer the IS.
        if matches:
            preferred = min(allowed.index(r["sj_div"]) for r in matches)
            matches = [r for r in matches if allowed.index(r["sj_div"]) == preferred]
        for period, field in zip(PERIODS, AMOUNT_KEYS, strict=True):
            values = {amount(r.get(field)) for r in matches}
            currencies = {r.get("currency") for r in matches}
            value = next(iter(values)) if len(values) == 1 else None
            reason = None
            if not matches:
                reason = "account_not_found"
            elif len(values) != 1 or len(currencies) != 1:
                reason = "ambiguous_account"
            elif currencies != {"KRW"}:
                value, reason = None, "unsupported_currency"
            elif value is None:
                reason = "amount_not_disclosed"
            facts.append(
                {
                    "key": key,
                    "label": label,
                    "period": period,
                    "value": str(value) if reason is None else None,
                    "state": "CONFIRMED" if reason is None else "MISSING",
                    "reason": reason,
                    "currency": "KRW",
                    "unit": "원",
                    "mapping_method": method if matches else None,
                    "sources": [
                        {
                            "row": rows.index(r),
                            "account_id": r.get("account_id"),
                            "account_name": r.get("account_nm"),
                            "statement": r["sj_div"],
                            "amount_field": field,
                            "raw_amount": r.get(field),
                        }
                        for r in matches
                    ],
                }
            )
    return facts


# Calculations whose definitions do not depend on an undecided balance/day policy.
RATIOS = [
    ("current_ratio", "유동비율", "유동성", "current_assets", "current_liabilities", "%"),
    ("debt_ratio", "부채비율", "레버리지", "liabilities", "equity", "%"),
    ("equity_ratio", "자기자본비율", "레버리지", "equity", "assets", "%"),
    ("operating_margin", "매출액영업이익률", "수익성", "operating_profit", "revenue", "%"),
    ("operating_roa", "총자산영업이익률", "수익성", "operating_profit", "assets", "%"),
    ("gross_margin", "매출총이익률", "수익성", "gross_profit", "revenue", "%"),
    ("cost_ratio", "매출원가율", "수익성", "cost_of_sales", "revenue", "%"),
    ("interest_coverage", "이자보상비율", "수익성", "operating_profit", "interest_expense", "배"),
    ("cash_profit", "영업CF/영업이익", "수익성", "operating_cashflow", "operating_profit", "배"),
    (
        "cash_current_liabilities",
        "영업CF/유동부채",
        "유동성",
        "operating_cashflow",
        "current_liabilities",
        "%",
    ),
]
PENDING = [
    (
        "inventory_days",
        "재고자산 회전일수",
        "활동성",
        "적용 재고잔액 ÷ 매출원가 × 기간 일수",
        "balance_days_policy_unset",
    ),
    (
        "receivable_days",
        "매출채권 회수일수",
        "활동성",
        "적용 매출채권 ÷ 매출액 × 기간 일수",
        "balance_days_policy_unset",
    ),
    (
        "payable_days",
        "매입채무 지급일수",
        "활동성",
        "적용 매입채무 ÷ 적용 원가 × 기간 일수",
        "balance_days_policy_unset",
    ),
    (
        "ccc",
        "현금전환주기",
        "활동성",
        "재고일수 + 채권일수 − 채무일수",
        "balance_days_policy_unset",
    ),
    (
        "ebitda_coverage",
        "EBITDA 이자보상비율",
        "수익성",
        "정의된 EBITDA ÷ 이자비용",
        "ebitda_policy_unset",
    ),
    (
        "cash_coverage",
        "현금보상비율",
        "유동성",
        "승인된 현금보상 산식 적용",
        "cash_coverage_policy_unset",
    ),
    ("capex_cashflow", "CAPEX/영업CF", "성장성", "정의된 투자 지출 ÷ 영업CF", "capex_policy_unset"),
    (
        "construction_receivable_days",
        "공사미수금 회수기간",
        "활동성",
        "공사미수금 ÷ 대응 매출 × 기간 일수",
        "construction_receivables_missing",
    ),
    (
        "pf_equity",
        "PF·조건부 의무/자본",
        "레버리지",
        "검증된 PF·조건부 의무 ÷ 자본 × 100",
        "pf_details_missing",
    ),
    (
        "pf_within_year",
        "1년 내 PF 비중",
        "레버리지",
        "1년 내 PF 의무 ÷ 전체 PF 의무 × 100",
        "pf_details_missing",
    ),
    (
        "debt_within_year",
        "1년 내 만기 차입 비중",
        "레버리지",
        "1년 내 만기 차입 ÷ 총차입금 × 100",
        "maturity_details_missing",
    ),
    (
        "average_funding_rate",
        "평균 조달금리",
        "레버리지",
        "차입별 금리의 잔액 가중평균",
        "funding_rate_details_missing",
    ),
    (
        "finance_cost_burden",
        "금융비용부담률",
        "수익성",
        "정의된 금융비용 ÷ 매출액 × 100",
        "finance_cost_scope_unset",
    ),
]


def divide(numerator, denominator, scale=100):
    if numerator is None or denominator is None:
        return None, "missing_input"
    if denominator <= 0:
        return None, "nonpositive_denominator"
    with localcontext() as ctx:
        ctx.prec = 60
        return str((numerator / denominator * scale).quantize(Decimal("0.0001"))), None


def calculate(facts, lease="include"):
    with localcontext() as ctx:
        ctx.prec = 60
        return _calculate(facts, lease)


def _calculate(facts, lease):
    lookup = {(f["key"], f["period"]): f for f in facts}
    labels = {a[0]: a[1] for a in ACCOUNTS}
    result = []

    def get(key, period):
        return amount(lookup.get((key, period), {}).get("value"))

    def add(
        key,
        label,
        group,
        unit,
        formula,
        inputs,
        values,
        basis="공시 보고기간 · 기말 잔액/기간 손익",
    ):
        current, previous = values[0][0], values[1][0]
        change = (
            str(Decimal(current) - Decimal(previous))
            if current is not None and previous is not None
            else None
        )
        result.append(
            {
                "key": key,
                "label": label,
                "group": group,
                "unit": unit,
                "formula": formula,
                "inputs": inputs,
                "basis": basis,
                "values": [
                    {
                        "period": p,
                        "value": v,
                        "state": "CONFIRMED" if r is None else "NOT_COMPUTABLE",
                        "reason": r,
                    }
                    for p, (v, r) in zip(PERIODS, values, strict=True)
                ],
                "change": change,
                "change_unit": "%p" if unit == "%" else unit,
            }
        )

    for key, label, group, numerator, denominator, unit in RATIOS:
        inputs = [numerator, denominator]
        values = []
        for period in PERIODS:
            n, d = get(numerator, period), get(denominator, period)
            if key == "debt_ratio" and lease == "exclude":
                inputs = ["liabilities", "current_lease", "noncurrent_lease", "equity"]
                c, nc = get("current_lease", period), get("noncurrent_lease", period)
                n = n - c - nc if n is not None and c is not None and nc is not None else None
                if n is not None and n < 0:
                    n = None
            values.append(divide(n, d, 100 if unit == "%" else 1))
        formula = f"{labels[numerator]} ÷ {labels[denominator]}" + (" × 100" if unit == "%" else "")
        if key == "debt_ratio" and lease == "exclude":
            formula = "(부채총계 − 유동 리스부채 − 비유동 리스부채) ÷ 자본총계 × 100"
        if key == "operating_roa":
            add(
                key,
                label,
                group,
                unit,
                "영업이익 ÷ 기말 자산총계 × 100",
                inputs,
                values,
                "각 비교기간의 영업이익 · 해당 기간 기말 자산총계 기준",
            )
        else:
            add(key, label, group, unit, formula, inputs, values)

    debt_keys = [
        "short_borrowings",
        "current_long_borrowings",
        "long_borrowings",
        "bonds",
        "current_bonds",
    ]
    if lease == "include":
        debt_keys += ["current_lease", "noncurrent_lease"]
    totals = {}
    for p in PERIODS:
        components = [get(k, p) for k in debt_keys]
        totals[p] = (
            sum(components, Decimal(0))
            if all(v is not None and v >= 0 for v in components)
            else None
        )
    note_summaries = note_borrowing_summaries(facts, lease)
    note_totals = {p: amount(note_summaries[p]["adjusted_subtotal"]) for p in PERIODS}
    note_inputs = ["note_borrowing_subtotal"]
    if lease == "include":
        note_inputs += ["current_lease", "noncurrent_lease"]
    add(
        "note_borrowing_ratio",
        "주석 차입금 소계/총자산",
        "레버리지",
        "%",
        "주석 차입금 소계(리스 옵션 적용) ÷ 총자산 × 100",
        note_inputs + ["assets"],
        [divide(note_totals[p], get("assets", p)) for p in PERIODS],
        "회사 자본관리 주석의 검산된 구성 범위 · 전체 차입 범위와 구분",
    )
    add(
        "borrowing_ratio",
        "차입금의존도",
        "레버리지",
        "%",
        "정의된 총차입금 ÷ 총자산 × 100",
        debt_keys + ["assets"],
        [divide(totals[p], get("assets", p)) for p in PERIODS],
    )
    add(
        "short_borrowing_ratio",
        "단기차입금 비중",
        "레버리지",
        "%",
        "단기차입금 ÷ 정의된 총차입금 × 100",
        debt_keys,
        [divide(get("short_borrowings", p), totals[p]) for p in PERIODS],
    )
    add(
        "borrowing_investment_property",
        "총차입금/투자부동산",
        "레버리지",
        "%",
        "정의된 총차입금 ÷ 투자부동산 장부금액 × 100",
        debt_keys + ["investment_property"],
        [divide(totals[p], get("investment_property", p)) for p in PERIODS],
    )
    for account in ("revenue", "inventory", "receivables", "contract_assets"):
        values = []
        for i, p in enumerate(PERIODS):
            n = get(account, p)
            d = get(account, PERIODS[i + 1]) if i < 2 else None
            values.append(divide(n - d if n is not None and d is not None else None, d))
        add(
            f"{account}_growth",
            f"{labels[account]} 증가율",
            "성장성",
            "%",
            "(당기 − 전기) ÷ 전기 × 100",
            [account],
            values,
            "공시 비교기간 · 0/음수 전기는 증가율 보류",
        )
    by_key = {m["key"]: m for m in result}
    for account in ("inventory", "receivables", "contract_assets"):
        values = []
        for i in range(3):
            left = by_key[f"{account}_growth"]["values"][i]
            right = by_key["revenue_growth"]["values"][i]
            values.append(
                (str(Decimal(left["value"]) - Decimal(right["value"])), None)
                if left["value"] is not None and right["value"] is not None
                else (None, left["reason"] or right["reason"])
            )
        add(
            f"{account}_sales_gap",
            f"{labels[account]} 증가율 − 매출 증가율",
            "성장성",
            "%p",
            f"{labels[account]} 증가율 − 매출액 증가율",
            [account, "revenue"],
            values,
            "같은 공시 비교기간의 증가율 차이",
        )
    for key, label, group, formula, reason in PENDING:
        add(
            key,
            label,
            group,
            "일"
            if group == "활동성"
            else "%"
            if key
            in {
                "pf_equity",
                "pf_within_year",
                "debt_within_year",
                "average_funding_rate",
                "finance_cost_burden",
            }
            else "배",
            formula,
            [],
            [(None, reason)] * 3,
            "자료·산식 정책 확보 후 계산 · 임의 근사하지 않음",
        )
    return result, {p: str(v) if v is not None else None for p, v in totals.items()}


def note_borrowing_summaries(facts, lease):
    lookup = {(f["key"], f["period"]): f for f in facts}
    summaries = {}
    with localcontext() as ctx:
        ctx.prec = 60
        for period in PERIODS:
            fact = lookup.get(("note_borrowing_subtotal", period), {})
            base = amount(fact.get("value"))
            source = next(iter(fact.get("sources", [])), {})
            current_lease = lookup.get(("current_lease", period), {})
            noncurrent_lease = lookup.get(("noncurrent_lease", period), {})
            adjusted = base
            reason = fact.get("reason", "account_not_found")
            if base is not None and lease == "include":
                amounts = [amount(f.get("value")) for f in (current_lease, noncurrent_lease)]
                adjusted = (
                    base + sum(amounts) if all(v is not None and v >= 0 for v in amounts) else None
                )
                if adjusted is None:
                    reason = "missing_lease_input"
            summaries[period] = {
                "base_subtotal": str(base) if base is not None else None,
                "adjusted_subtotal": str(adjusted) if adjusted is not None else None,
                "lease": lease,
                "state": "RECONCILED_SUBTOTAL" if base is not None else "MISSING",
                "reason": reason,
                "components": source.get("components", []),
                "reconciliation": source.get("control"),
                "source_xpath": source.get("source_xpath"),
                "source_sha256": source.get("source_sha256"),
                "scope": source.get("scope"),
            }
    return summaries


def comparisons(facts):
    """Exact monetary differences and the OP bridge; no browser arithmetic."""
    lookup = {(f["key"], f["period"]): amount(f["value"]) for f in facts}
    changes = {}
    with localcontext() as ctx:
        ctx.prec = 60
        for key, *_ in ACCOUNTS:
            current, previous = lookup.get((key, "current")), lookup.get((key, "previous"))
            difference = (
                current - previous if current is not None and previous is not None else None
            )
            growth, reason = divide(difference, previous)
            transition = None
            if current is not None and previous is not None:
                if current < 0 <= previous:
                    transition = "NEGATIVE_TURN"
                elif current >= 0 > previous:
                    transition = "POSITIVE_TURN"
            changes[key] = {
                "amount": str(difference) if difference is not None else None,
                "growth": growth,
                "reason": reason,
                "transition": transition,
            }
        deltas = [
            changes[k]["amount"] for k in ("revenue", "cost_of_sales", "sga", "operating_profit")
        ]
        bridge = None
        if all(v is not None for v in deltas):
            revenue, cost, sga, profit = (Decimal(v) for v in deltas)
            bridge = [
                {"label": label, "value": str(v)}
                for label, v in (
                    ("매출 증감", revenue),
                    ("매출원가 증감", -cost),
                    ("판관비 증감", -sga),
                    ("기타·조정 잔차", profit - revenue + cost + sga),
                )
            ]
    return changes, bridge

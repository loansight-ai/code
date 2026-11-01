"""CSV field contracts shared by validation and typed persistence."""

FINANCIAL_META = set(
    "corp_code corp_name industry industry_group bsns_year fs_div rcept_no is_format".split()
)
FINANCIAL_AMOUNTS = set(
    """
bs_ta bs_ca bs_cash bs_stfi bs_ar bs_contract_a bs_inv bs_ca_other bs_nca bs_ppe bs_ip
bs_rou bs_intan bs_goodwill bs_assoc bs_dta bs_nca_other bs_tl bs_cl bs_ap bs_stb
bs_cpltd bs_cbond bs_clease bs_contract_l bs_ctax bs_cl_other bs_ncl bs_ltb bs_bond
bs_nclease bs_dbo bs_dtl bs_ncl_other bs_te bs_eq_p bs_nci bs_cap bs_capsur bs_re
bs_other_eq bs_tle bs_borrow bs_borrow_st bs_lease is_rev is_cogs is_gp is_sga is_opex
is_op_other is_op is_other_inc is_other_exp is_fin_inc is_fin_cost is_eq_method
is_nonop_other is_ebt is_tax is_disc is_ni is_ni_p is_ni_nci is_oci is_tci is_dep
is_ebitda cf_cfo cf_ni cf_cash_gen cf_dep cf_amort cf_wc cf_int_paid cf_int_rec cf_div_rec
cf_tax_paid cf_cfi cf_capex cf_ppe_disp cf_intan_acq cf_ip_acq cf_ip_disp cf_cfi_other
cf_cff cf_stb_in cf_stb_out cf_ltb_in cf_ltb_out cf_bond_in cf_bond_out cf_lease_pay
cf_div_paid cf_eq_iss cf_ts_acq cf_cff_other cf_fx cf_net cf_cash_beg cf_cash_end cf_fcf
cf_net_borrow sce_beg sce_adj sce_ni sce_oci sce_div sce_iss sce_ts sce_other sce_end
is_int_exp nt_rate_wavg nt_rate_min nt_rate_max nt_dev nt_fv_gain nt_disp_gain nt_pf nt_rental
""".split()
)
EVENT_COLUMNS = set(
    """
id industry corp_code corp_name event_type use event_date date_basis rcept_no rcept_dt
source title fiscal_period detail severity is_first_of_type verified
""".split()
)
COVERAGE_COUNTS = set(
    """
filings_b_count filings_i_count audit_api_calls label_candidates audit_doc_reports audit_doc_ok
""".split()
)
COVERAGE_COLUMNS = COVERAGE_COUNTS | set(
    """
corp_code industry corp_name corp_cls_name first_period last_period major_dfocr major_ctrcvsbgrq
major_bnkmngtpcbg major_range major_fetched_at filings_b filings_range filings_fetched_at
filings_i first_event_date
""".split()
)
SCHEMAS = {
    "financial": ("fs4_wide_ok", FINANCIAL_META | FINANCIAL_AMOUNTS | {"nt_ip_model"}),
    "events": ("risk_event", EVENT_COLUMNS),
    "coverage": ("event_coverage", COVERAGE_COLUMNS),
}

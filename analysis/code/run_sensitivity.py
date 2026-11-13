"""Quartile-assignment sensitivity for sample-filled benchmarks only.

pip install numpy matplotlib
python run_sensitivity.py --year 2025
python run_sensitivity.py --start-year 2016 --end-year 2025

Fixed original companies are reassigned under changed reference thresholds.
No default benchmark, data-cleaning rule or risk grade is changed.
"""
import argparse,csv,json,hashlib
from pathlib import Path
from collections import Counter
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter
from run_yearly_eda import ROOT, GROUPS, NAMES, read, write, configure_font, write_explanation

BINS=['Q1 미만','Q1 이상·중앙값 미만','중앙값 이상·Q3 이하','Q3 초과']
def assign(x,q):
    """Strict tails. At Q1/Q3 use middle groups; exact median uses upper middle."""
    x=np.asarray(x);q=np.asarray(q)
    return np.where(x<q[...,0,None],0,np.where(x>q[...,2,None],3,np.where(x<q[...,1,None],1,2))).astype(np.int8)
def direction(x,q,metric):
    return x>q[...,2,None] if metric=='부채비율' else x<q[...,0,None]
def loo_thresholds(x):
    n=len(x);order=np.argsort(x,kind='stable');a=x[order];p=np.array([.25,.5,.75]);pos=(n-2)*p;j=np.floor(pos).astype(int);f=pos-j
    deleted=np.arange(n)[:,None];low=j[None,:]+(j[None,:]>=deleted);high=np.minimum(j+1,n-2)[None,:];high=high+(high>=deleted)
    thresholds=a[low]+(a[high]-a[low])*f;result=np.empty_like(thresholds);result[order]=thresholds
    for i in {0,n//2,n-1,int(np.argmin(x)),int(np.argmax(x))}:assert np.allclose(result[i],np.quantile(np.delete(x,i),p),rtol=1e-12,atol=1e-8)
    return result
def rate_stats(a):return float(a.mean()),float(np.quantile(a,.95)),float(a.max())
def write_empty_safe(path,rows,fields=None):
    if rows:write(path,rows)
    elif fields:
        with path.open('w',encoding='utf-8-sig',newline='') as f:csv.writer(f).writerow(fields)

def analyze_series(x,companies,year,group,metric,args):
    n=len(x);q=np.quantile(x,[.25,.5,.75]);base=assign(x,q);binary=direction(x,q,metric)
    assert base.shape==(n,) and np.all((base>=0)&(base<=3))
    seed=int.from_bytes(hashlib.sha256(('sensitivity-v1|20251101|'+ '|'.join([str(year),group,metric])).encode()).digest()[:8],'big')
    rng=np.random.default_rng(seed);flips=np.zeros(n,dtype=np.int64);binary_flips=np.zeros(n,dtype=np.int64);transition=np.zeros((4,4),dtype=np.int64);rates=[];binary_rates=[]
    for start in range(0,args.iterations,200):
        count=min(200,args.iterations-start);samples=rng.choice(x,size=(count,n),replace=True);thresholds=np.quantile(samples,[.25,.5,.75],axis=1).T
        assigned=assign(x,thresholds);changed=assigned!=base;bc=direction(x,thresholds,metric)!=binary
        flips+=changed.sum(axis=0);binary_flips+=bc.sum(axis=0);rates.extend(changed.mean(axis=1));binary_rates.extend(bc.mean(axis=1))
        for a in range(4):
            mask=base==a
            for b in range(4):transition[a,b]+=int((assigned[:,mask]==b).sum())
    assert transition.sum()==n*args.iterations and transition.sum()-np.trace(transition)==flips.sum()
    loo=loo_thresholds(x);lc=assign(x,loo)!=base;lb=direction(x,loo,metric)!=binary
    # Company omitted from reference is excluded from that round's evaluation.
    np.fill_diagonal(lc,False);np.fill_diagonal(lb,False)
    loo_rates=lc.sum(axis=1)/(n-1);loo_binary=lb.sum(axis=1)/(n-1)
    worst=int(np.argmax(loo_rates));mean,p95,mx=rate_stats(np.array(rates));bm,bp95,bmax=rate_stats(np.array(binary_rates))
    prefix={'연도':str(year),'산업':group,'지표':metric,'표본수':n,'비교방향경계':'Q3 초과' if metric=='부채비율' else 'Q1 미만'}
    summary={**prefix,'Q1':q[0],'중앙값':q[1],'Q3':q[2],'bootstrap_반복수':args.iterations,'bootstrap_4구간_평균변경률':mean,'bootstrap_4구간_회차변경률_P95':p95,'bootstrap_4구간_회차변경률_최대':mx,'bootstrap_비교방향_평균변경률':bm,'bootstrap_비교방향_회차변경률_P95':bp95,'LOO_4구간_평균변경률':float(loo_rates.mean()),'LOO_4구간_최대변경률':float(loo_rates.max()),'LOO_비교방향_최대변경률':float(loo_binary.max()),'LOO_최대영향_제외기업코드':companies[worst],'원표본_Q1동점수':int((x==q[0]).sum()),'원표본_중앙값동점수':int((x==q[1]).sum()),'원표본_Q3동점수':int((x==q[2]).sum())}
    scenarios=[]
    for name,p,winsor in [('경계추정표본_양끝제외',args.trim_percent/100,False),('경계추정표본_양끝제외_강한변경',args.stress_percent/100,False),('경계추정표본_양끝윈저화',args.trim_percent/100,True)]:
        low,high=np.quantile(x,[p,1-p]);reference=np.clip(x,low,high) if winsor else x[(x>=low)&(x<=high)]
        assert len(reference)>=4
        sq=np.quantile(reference,[.25,.5,.75]);sa=assign(x,sq);sb=direction(x,sq,metric)
        scenarios.append({**prefix,'시나리오':name,'한쪽꼬리비중':p,'경계추정_유효표본수':len(reference),'평가표본수':n,'변경_Q1':sq[0],'변경_중앙값':sq[1],'변경_Q3':sq[2],'4구간_변경기업수':int((sa!=base).sum()),'4구간_변경률':float((sa!=base).mean()),'비교방향_변경기업수':int((sb!=binary).sum()),'비교방향_변경률':float((sb!=binary).mean()),'원본자료변경':'없음; 가상 시나리오만'})
    summary['양끝제외_4구간_변경률']=scenarios[0]['4구간_변경률'];summary['강한양끝제외_4구간_변경률']=scenarios[1]['4구간_변경률']
    details=[{**prefix,'corp_code':companies[i],'값':x[i],'원래구간':BINS[int(base[i])],'원래비교방향구간여부':bool(binary[i]),'bootstrap_4구간_변경빈도':flips[i]/args.iterations,'bootstrap_비교방향_변경빈도':binary_flips[i]/args.iterations,'LOO_4구간_변경빈도':lc[:,i].sum()/(n-1),'LOO_비교방향_변경빈도':lb[:,i].sum()/(n-1)} for i in range(n)]
    transitions=[]
    for a in range(4):
        denom=int((base==a).sum())*args.iterations
        for b in range(4):transitions.append({**prefix,'원래구간':BINS[a],'재배정구간':BINS[b],'누적배정건수':int(transition[a,b]),'원래구간내_전환비중':float(transition[a,b]/denom) if denom else ''})
    return summary,details,scenarios,transitions

def selected_from_ledger(year):
    path=ROOT/'2016-2025_4개업종_전체기업_5개재무지표_계산및보충내역.md';selected=set()
    aliases={'도매 및 소매업':'도소매업','부동산업':'부동산임대업'}
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.startswith(f'| {year} |'):continue
        c=[v.strip() for v in line.strip('|').split('|')]
        if len(c)==10 and any('OFS' in v for v in c[7:10]):
            assert all('OFS' in v for v in c[7:10]),'Mixed-source quartile series must be resolved first'
            selected.add((aliases.get(c[1],c[1]),c[2]))
    return selected,path

def process_year(year,args):
    base=args.eda_root/f'eda_{year}';source=base/'03_데이터'/f'sample_values_{year}.csv';ci_source=base/'02_부트스트랩'/f'신뢰구간_통합_{year}.csv'
    observations=read(source);ci_rows=read(ci_source);selected,ledger=selected_from_ledger(year)
    assert selected and {(r['산업'],r['지표']) for r in ci_rows}==selected
    assert {(r['산업'],r['지표']) for r in observations}==selected
    assert all(r['연도']==str(year) for r in observations)
    out=base/'05_구간민감도';out.mkdir(parents=True,exist_ok=True)
    summaries=[];details=[];scenarios=[];transitions=[]
    for group in GROUPS:
        for metric in NAMES:
            if (group,metric) not in selected:continue
            rec=[r for r in observations if (r['산업'],r['지표'])==(group,metric)];companies=[r['corp_code'] for r in rec];assert len(set(companies))==len(companies)
            x=np.array([float(r['값']) for r in rec]);assert np.isfinite(x).all() and len(x)>=2
            previous=next(r for r in ci_rows if (r['산업'],r['지표'])==(group,metric));assert len(x)==int(previous['표본수'])
            assert np.allclose(np.quantile(x,[.25,.5,.75]),[float(previous[k]) for k in ['Q1','중앙값','Q3']],atol=1e-6,rtol=1e-12)
            s,d,c,t=analyze_series(x,companies,year,group,metric,args);summaries.append(s);details.extend(d);scenarios.extend(c);transitions.extend(t)
    write(out/f'구간민감도_요약_{year}.csv',summaries);write(out/f'구간민감도_기업별_{year}.csv',details);write(out/f'구간민감도_극단값시나리오_{year}.csv',scenarios);write(out/f'구간민감도_전환행렬_{year}.csv',transitions)
    fig,axes=plt.subplots(4,1,figsize=(15,13))
    for ax,group in zip(axes,GROUPS):
        sr=[s for s in summaries if s['산업']==group]
        ax.set_title(group,loc='left')
        if not sr:ax.text(.5,.5,'분석할 표본 항목 없음 (ECOS 사용 또는 보류)',ha='center',va='center',transform=ax.transAxes);ax.set_xticks([]);ax.set_yticks([]);continue
        y=np.arange(len(sr));width=.19
        for j,(col,label,color) in enumerate([('bootstrap_4구간_평균변경률','재추출: 4구간 평균 변경','#456b90'),('bootstrap_비교방향_평균변경률','재추출: 한쪽 경계 평균 변경','#b47a2a'),('LOO_4구간_최대변경률','한 기업 제외: 최대 변경','#6d9277'),('양끝제외_4구간_변경률',f'양끝 각 {args.trim_percent:g}% 제외: 변경','#90749e')]):
            ax.barh(y+(j-1.5)*width,[s[col] for s in sr],height=width,label=label,color=color)
        ax.set_yticks(y,[s['지표']+f" (n={s['표본수']})" for s in sr]);ax.invert_yaxis();ax.set_xlim(0,1);ax.xaxis.set_major_formatter(PercentFormatter(1));ax.grid(axis='x',alpha=.15)
    handles,labels=next(ax for ax in axes if ax.get_legend_handles_labels()[0]).get_legend_handles_labels()
    fig.legend(handles,labels,loc='lower center',ncol=2,fontsize=10)
    fig.suptitle(f'{year}년 표본 기준의 구간 배정 민감도',fontsize=17)
    fig.text(.02,.055,'재추출 평균·단일 제외 최악·꼬리 제외 시나리오는 서로 다른 조건임. 변경률은 부실확률이나 분류 오류율이 아님.',fontsize=10)
    fig.tight_layout(rect=(0,.08,1,.95));fig.savefig(out/f'구간민감도_{year}.png',dpi=130,facecolor='white');plt.close(fig)
    lines=[f'# {year}년 구간 배정 민감도 점검','',
      f'ECOS 값을 제외하고 실제 표본으로 채운 {len(summaries)}개 업종·지표만 분석했다. 기존 기준값·표본과 활용 권고는 변경하지 않았다. 기간 미확인 ROA는 제외했다.', '',
      '## 무엇을 비교했나','',
      '- 같은 원래 기업값을 고정하고 비교 기준 Q1·중앙값·Q3만 바꿔 기업의 구간이 얼마나 달라지는지 봤다.',
      '- 네 구간: Q1 미만 / Q1 이상·중앙값 미만 / 중앙값 이상·Q3 이하 / Q3 초과. Q1·Q3와 같은 값은 가운데 구간이며 중앙값과 같으면 위쪽 가운데 구간이다. 동점 때문에 정확히 25%씩 나뉘지 않을 수 있다.',
      '- 한쪽 경계: 부채비율은 Q3 초과, 나머지는 Q1 미만 여부를 따로 확인했다. 이는 비교 방향일 뿐 위험 판정이 아니다.',
      f'- 부트스트랩: 기업을 중복 허용해 {args.iterations:,}번 다시 뽑아 기준을 계산했다. 매회 원래 모든 기업의 구간을 다시 배정했다. 표본 내 민감도이며, 미래 기업의 오분류확률이나 부실확률이 아니다.',
      '- 한 기업 제외(LOO): 각 기업을 하나씩 빼고 기준을 다시 계산했다. 해당 회차에 뺀 기업은 비교에서 제외하고 나머지 n−1개 기업만 평가했다. 최대 변경률은 가장 영향이 컸던 한 기업을 제외했을 때다.',
      f'- 극단값 시나리오: 기준을 만드는 표본만 양끝 각 {args.trim_percent:g}% 또는 {args.stress_percent:g}% 구간 밖을 제외하거나, 각 {args.trim_percent:g}% 밖을 경계값으로 눌렀다(윈저화). 평가할 기업값은 고정해 전체 n개 기업을 비교했다. 소표본에서는 한두 기업을 빼는 것만으로 실제 제외 비중이 커질 수 있다.',
      '- 극단값은 실제 손실일 수도 있으므로 이 시나리오는 삭제·보정 권고가 아니다. 기존 분위수는 꼬리 윈저화에 거의 변하지 않을 수 있으며 이것만으로 원자료가 정확하다는 뜻도 아니다.', '',
      '## 결과 읽기','',
      '- 4구간 평균 변경률: 재추출 한 번당 원래 구간과 달라지는 기업 비중의 평균.',
      '- 한쪽 경계 평균 변경률: Q1 미만(부채비율은 Q3 초과) 여부가 바뀌는 기업 비중의 평균.',
      '- 회차 P95는 모의실험 변경률 분포의 95백분위이며 새로운 신뢰구간은 아니다.',
      '- 기업별 변경빈도는 그 기업의 상대 구간이 얼마나 흔들리는지를 뜻한다. 안전·위험 여부와는 다르다.', '',
      '네 구간은 순위로 정해지므로 동점이 적은 자료에서는 재추출 변경률이 주로 표본 수에 영향을 받는다. 서로 다른 지표의 비율 숫자나 극단값의 크기가 얼마나 다른지 직접 측정하는 지표는 아니다. 경계값 CI와 구간 변경률을 함께 읽어야 한다.', '',
      '| 산업 | 지표 | n | 재추출 4구간 평균 | 재추출 한쪽 경계 평균 | 한 기업 제외 최대 | 양끝 제외 |','|---|---|---:|---:|---:|---:|---:|']
    for s in summaries:lines.append('| '+' | '.join([s['산업'],s['지표'],str(s['표본수'])]+[f'{s[k]:.1%}' for k in ['bootstrap_4구간_평균변경률','bootstrap_비교방향_평균변경률','LOO_4구간_최대변경률','양끝제외_4구간_변경률']])+' |')
    worst=max(summaries,key=lambda s:s['bootstrap_4구간_평균변경률'])
    lines+=['','## 화면 적용 시 해석','',
      f"- 이 연도에서 재추출 4구간 평균 변경률이 가장 큰 것은 {worst['산업']} {worst['지표']}로 {worst['bootstrap_4구간_평균변경률']:.1%}다. 표본 수는 {worst['표본수']}개다.",
      '- 변경률이 큰 항목은 하나의 선으로 단정하기보다 분포를 참고 표시하고 경계 부근 안내를 우선한다. 수치 하나로 자동 통과·탈락을 정하는 합격선은 만들지 않았다.',
      '- 변경률이 작아도 수집된 기업이 전체 업종을 대표한다는 뜻은 아니다. 연도·산업·OFS 기준과 표본 수를 함께 표시한다. 부동산임대업과 ECOS 부동산업 전체를 같은 집단처럼 해석하지 않는다.',
      '- 현재 표본 내 위치를 설명하는 하위 구간과 실제 경고·주의는 분리한다. 이번 결과는 이후 연체·회생 예측 성능의 검증이 아니다.', '',
      '## 업종별 구체적 해석','']
    for group in GROUPS:
        sr=[s for s in summaries if s['산업']==group]
        if not sr:lines.append(f'- {group}: 이번에 분석한 표본 항목이 없다. ECOS 사용 또는 보류 항목으로, 안정성을 확인했다는 뜻은 아니다.');continue
        br=[s['bootstrap_4구간_평균변경률'] for s in sr];ar=[s['bootstrap_비교방향_평균변경률'] for s in sr];worst_loo=max(sr,key=lambda s:s['LOO_4구간_최대변경률'])
        lines.append(f"- {group}: 표본 {min(s['표본수'] for s in sr)}~{max(s['표본수'] for s in sr)}개. 네 구간 평균 변경률 {min(br):.1%}~{max(br):.1%}, 한쪽 경계 평균 변경률 {min(ar):.1%}~{max(ar):.1%}. 한 기업 제외 시 가장 큰 영향은 {worst_loo['지표']}의 {worst_loo['LOO_4구간_최대변경률']:.1%}였다. 표본이 작거나 이 변경이 크면 경계 부근 표시와 개별 자료 확인을 우선한다.")
    lines+=['',
      '## 파일','',f'- [요약 CSV](구간민감도_요약_{year}.csv)',f'- [기업별 변경빈도](구간민감도_기업별_{year}.csv)',f'- [극단값 시나리오](구간민감도_극단값시나리오_{year}.csv)',f'- [4구간 전환행렬](구간민감도_전환행렬_{year}.csv)',f'- [비교 그래프](구간민감도_{year}.png)', '',
      '## 재현 및 검증','',f'- 상위 통합 폴더에서 `py -3 .\\run_sensitivity.py --year {year}` 실행.',
      '- 회사 코드 중복·유한값·기존 분위수 일치·전환행렬 전체 건수와 변경 건수 일치를 확인했다. LOO의 빠른 계산은 실제 기업을 제거하고 다시 계산한 분위수와 대조했다.',
      '- 동일 연도·업종·지표의 난수는 고정되며 원자료 해시는 sensitivity_verification.json에 기록했다. 표본 구성의 무작위 재추출은 업종 대표성이나 계정 오류를 검증하지 않는다.']
    (out/f'구간민감도_해석_{year}.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    report={'year':year,'sample_series':len(summaries),'company_metric_rows':len(details),'iterations':args.iterations,'trim_percent':args.trim_percent,'stress_percent':args.stress_percent,'source_hashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,ci_source,ledger]},'checks':{'unique_companies':True,'matches_existing_quantiles':True,'loo_matches_explicit_deletions':True,'transition_conservation':True}}
    (base/'04_설명및검증/sensitivity_verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    write_explanation(base,json.loads((base/'04_설명및검증/verification.json').read_text(encoding='utf-8')))
    doc=base/'README.md';text=doc.read_text(encoding='utf-8');marker='\n## 구간 배정 민감도 점검\n';text=text.split(marker)[0]+marker+f'\n- [민감도 결과와 해석](05_구간민감도/구간민감도_해석_{year}.md)\n- [민감도 그래프](05_구간민감도/구간민감도_{year}.png)\n';doc.write_text(text,encoding='utf-8')
    print(json.dumps({'year':year,'series':len(summaries),'company_metric_rows':len(details),'max_bootstrap_change':worst['bootstrap_4구간_평균변경률']},ensure_ascii=True),flush=True)
    return summaries

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--year',type=int);g.add_argument('--start-year',type=int)
    p.add_argument('--end-year',type=int);p.add_argument('--eda-root',type=Path,default=ROOT/'eda');p.add_argument('--iterations',type=int,default=5000);p.add_argument('--trim-percent',type=float,default=1.);p.add_argument('--stress-percent',type=float,default=5.)
    args=p.parse_args(argv)
    if args.iterations<1000 or not(0<args.trim_percent<args.stress_percent<25):p.error('iterations >=1000 and 0 < trim-percent < stress-percent <25 required')
    if args.year is not None and args.end_year is not None:p.error('--end-year requires --start-year')
    years=[args.year] if args.year is not None else list(range(args.start_year,(args.end_year if args.end_year is not None else args.start_year)+1))
    if not years:p.error('end-year must not precede start-year')
    for y in years:
        if not (args.eda_root/f'eda_{y}/03_데이터/sample_values_{y}.csv').exists():p.error(f'Run yearly EDA for {y} first')
    configure_font()
    for year in years:process_year(year,args)
    # Aggregate saved summaries, retaining years not rerun during this invocation.
    all_summary=[]
    for folder in sorted(args.eda_root.glob('eda_*')):
        try:y=int(folder.name.split('_')[-1])
        except ValueError:continue
        file=folder/f'05_구간민감도/구간민감도_요약_{y}.csv'
        if file.exists():all_summary.extend(read(file))
    write(args.eda_root.parent/'2016-2025_구간배정민감도_요약.csv',all_summary)
    guide=['# 표본 재무비율 구간 배정 민감도 점검','',
      '실제 표본으로 채운 항목만 점검했다. ECOS·미확보·기간 미확인 항목은 제외했다. 원래 기업값을 고정하고 경계만 바꿨을 때의 구간 이동을 계산했다. 이는 표본 내 상대 위치의 불확실성이며 위험 예측 오류율이 아니다. 기존 기준값과 활용 권고는 수정하지 않았다.','','## 연도별 결과','','| 연도 | 분석 항목 | 해석 |','|---|---:|---|']
    for y in sorted({r['연도'] for r in all_summary}):guide.append(f"| {y} | {sum(r['연도']==y for r in all_summary)} | [연도별 해석]({args.eda_root.name}/eda_{y}/05_구간민감도/구간민감도_해석_{y}.md) |")
    guide+=['','## 실행','','```powershell','py -3 -m pip install numpy matplotlib','py -3 .\\run_sensitivity.py --year 2025','py -3 .\\run_sensitivity.py --start-year 2016 --end-year 2025','```','','먼저 해당 연도의 run_yearly_eda.py 결과가 있어야 한다. 연도별 입력·원본 해시·실행 설정·검증은 04_설명및검증/sensitivity_verification.json에서 확인한다. 신뢰구간/참고 기준과 마찬가지로 민감도 숫자만으로 승인·탈락 임계값을 정하지 않는다.']
    (args.eda_root.parent/'2016-2025_구간배정민감도_결과안내.md').write_text('\n'.join(guide)+'\n',encoding='utf-8')

if __name__=='__main__':main()

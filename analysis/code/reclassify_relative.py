"""Display relative position with uncertainty; no sample-size/width/sensitivity gate."""
import argparse,json
from pathlib import Path
def relative_position(value,quantiles,intervals):
 import math
 if value is None or not math.isfinite(value):return {'position':None,'boundary_notice':[]}
 q1,median,q3=quantiles
 if not all(math.isfinite(x) for x in quantiles) or not q1<=median<=q3:raise ValueError('Invalid quartiles')
 label='Q1 미만' if value<q1 else 'Q3 초과' if value>q3 else 'Q1 이상·중앙값 미만' if value<median else '중앙값 이상·Q3 이하'
 return {'position':label,'boundary_notice':[k+' 경계 부근' for k,(lo,hi) in intervals.items() if lo<=value<=hi]}
def main(argv=None):
 from run_yearly_eda import ROOT,read,write
 p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--year',type=int);g.add_argument('--start-year',type=int);p.add_argument('--end-year',type=int);p.add_argument('--eda-root',type=Path,default=ROOT/'eda')
 for name in ['min-use','min-conditional','use-width','reference-width']:p.add_argument('--'+name,type=float,help=argparse.SUPPRESS)
 a=p.parse_args(argv);years=[a.year] if a.year else list(range(a.start_year,(a.end_year or a.start_year)+1));central=a.eda_root.parent if a.eda_root.name=='eda' else a.eda_root
 recs=read(central/'2016-2025_표본EDA_화면활용권고.csv');display=[]
 for y in years:
  base=a.eda_root/f'eda_{y}';ci=read(base/f'02_부트스트랩/신뢰구간_통합_{y}.csv');ss=read(base/f'05_구간민감도/구간민감도_요약_{y}.csv')
  for r in recs:
   if r['연도']!=str(y):continue
   c=next((c for c in ci if (c['산업'],c['지표'])==(r['산업'],r['지표'])),None)
   if c:
    s=next(s for s in ss if (s['산업'],s['지표'])==(r['산업'],r['지표']));r['활용구분']='상대 구간 표시';r['이유']='수집 표본 내 위치; 표본 수·95% CI 표시. 회사값이 경계 CI 안이면 경계 부근 안내.'
    d={**r,**{k:c[k] for k in c if k not in ['연도','산업','지표']},'재추출평균구간이동률':s['bootstrap_4구간_평균변경률'],'한기업제외최대이동률':s['LOO_4구간_최대변경률'],'화면문구':f"{y}년 {r['산업']} OFS 수집 표본 내 상대 위치 (n={c['표본수']})"};display.append(d)
  yr=[r for r in recs if r['연도']==str(y)]
  text=[f'# {y}년 상대 구간 표시와 불확실성 안내','', '계산 가능한 분위수는 표본 수·CI 폭·민감도에 의한 등급 없이 표시한다. 기간 미확인·계산 불가·ECOS 분포 미완성은 보류한다. ECOS 부동산업 전체는 임대업 전용 기준이 아니다. 소표본의 CI·재추출 민감도는 탐색적 정보이며 업종 전체 대표성을 보장하지 않는다.','', '| 업종 | 지표 | 표시 | 표본 수 | 안내 |','|---|---|---|---:|---|']
  for r in yr:text.append('| '+' | '.join(r[k] for k in ['산업','지표','활용구분','표본수','이유'])+' |')
  text+=['','## 화면 동작','', '- 회사값은 Q1 미만 / Q1 이상·중앙값 미만 / 중앙값 이상·Q3 이하 / Q3 초과로 표시한다. Q1·Q3와 같은 값은 가운데 구간에 둔다. 동점으로 정확한 25%씩은 아닐 수 있다.', '- Q1·중앙값·Q3의 95% CI를 각각 표시한다. 회사값이 하나라도 해당 CI 안에 있으면 그 경계의 “경계 부근” 안내를 덧붙인다. CI는 회사값의 안전 범위가 아니다.', '- 표본 수와 실제 구간 이동률은 수치로 제공하며 통과·탈락 임계값을 적용하지 않는다.',f'- [CI 데이터](신뢰구간_통합_{y}.csv)',f'- [민감도 데이터](../05_구간민감도/구간민감도_요약_{y}.csv)']
  (base/f'02_부트스트랩/신뢰구간_통합해석_{y}.md').write_text('\n'.join(text)+'\n',encoding='utf-8')
  explanation='\n'.join(text).replace(f'(신뢰구간_통합_{y}.csv)',f'(../02_부트스트랩/신뢰구간_통합_{y}.csv)')
  (base/f'04_설명및검증/EDA_설명및검증_{y}.md').write_text(explanation+'\n',encoding='utf-8')
  rp=base/'04_설명및검증/verification.json';v=json.loads(rp.read_text(encoding='utf-8'));from collections import Counter;v['recommendation_counts']=dict(Counter(r['활용구분'] for r in yr));v['rules']={'display_policy':'relative position with n/CI/boundary notice; no quality grade'};rp.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf-8')
 write(central/'2016-2025_표본EDA_화면활용권고.csv',recs)
 previous=central/'2016-2025_상대구간_화면표시데이터.csv'
 others=[r for r in read(previous) if int(r['연도']) not in years] if previous.exists() else []
 write(previous,others+display)
 lines=['# 2016~2025년 상대 구간 표시 정책','', '표본 수·CI 폭·이동률에 의한 비교 후보/조건부/참고 등급은 제거했다. 계산 가능한 표본 분위수는 수집 표본 내 상대 위치로 표시하고 n·각 경계의 95% CI·경계 부근 안내를 제공한다. 기간 미확인·계산 불가·ECOS 일부 결측은 완성된 구간 표시를 보류한다.','', '| 연도 | 업종 | 지표 | 화면 표시 | 이유 |','|---|---|---|---|---|']
 for r in recs:lines.append('| '+' | '.join(r[k] for k in ['연도','산업','지표','활용구분','이유'])+' |')
 (central/'2016-2025_새OFS_화면비교기준_종합해석.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
 print('Relative display rows:',len(others+display))
if __name__=='__main__':main()

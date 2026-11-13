"""Independent checks for boundary conventions and leave-one-out denominators."""
import unittest
from types import SimpleNamespace
import numpy as np
from run_sensitivity import assign,direction,loo_thresholds,analyze_series

class SensitivityTests(unittest.TestCase):
    def test_boundaries(self):
        x=np.array([0.,7.5,14.,15.,22.5,30.]);q=np.array([7.5,15.,22.5])
        self.assertEqual(assign(x,q).tolist(),[0,1,1,2,2,3])
        self.assertEqual(direction(x,q,'부채비율').tolist(),[False,False,False,False,False,True])
        self.assertEqual(direction(x,q,'유동비율').tolist(),[True,False,False,False,False,False])

    def test_ties_and_every_loo_threshold(self):
        for x in [np.array([0.,0.,1.,2.,2.,50.,100.,200.,200.,500.]),np.ones(10),np.array([-50.,-3.,0.,1.,2.,3.,8.,9.,10.,100.])]:
            result=loo_thresholds(x)
            for i in range(len(x)):np.testing.assert_allclose(result[i],np.quantile(np.delete(x,i),[.25,.5,.75]))

    def test_loo_change_and_accounting(self):
        x=np.array([0.,0.,1.,2.,2.,50.,100.,200.,200.,500.]);n=len(x)
        args=SimpleNamespace(iterations=1000,trim_percent=1.,stress_percent=5.)
        result,details,scenarios,transitions=analyze_series(x,[str(i) for i in range(n)],2025,'시험업','부채비율',args)
        q=np.quantile(x,[.25,.5,.75])
        # Independent scalar classification, not the implementation's broadcasting.
        def classify(v,t):return 0 if v<t[0] else 3 if v>t[2] else 1 if v<t[1] else 2
        baseline=[classify(v,q) for v in x];rates=[]
        for i in range(n):
            t=np.quantile(np.delete(x,i),[.25,.5,.75]);changed=sum(classify(v,t)!=baseline[j] for j,v in enumerate(x) if j!=i)
            rates.append(changed/(n-1))
        self.assertAlmostEqual(result['LOO_4구간_평균변경률'],float(np.mean(rates)))
        self.assertAlmostEqual(result['LOO_4구간_최대변경률'],max(rates))
        self.assertAlmostEqual(result['bootstrap_4구간_평균변경률'],np.mean([v['bootstrap_4구간_변경빈도'] for v in details]))
        self.assertEqual(sum(t['누적배정건수'] for t in transitions),n*args.iterations)
        result2,*_=analyze_series(x,[str(i) for i in range(n)],2025,'시험업','부채비율',args)
        self.assertEqual(result,result2)

if __name__=='__main__':unittest.main()

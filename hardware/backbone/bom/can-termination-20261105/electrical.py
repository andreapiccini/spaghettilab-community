"""Nodal DC check of complete coupled chains, including output feedback and loading.
Not a SPICE device/transient model. Deliberately tests incorrect output states too.
"""
import numpy as np,json,itertools
from pathlib import Path
rng=np.random.default_rng(20261105);w=Path(__file__).parent
def solve(n,outputs,supplies,tolerance=0,grounds=None):
 grounds=np.zeros(n) if grounds is None else grounds
 names=[f'{i}:{k}' for i in range(n) for k in ['L','R','SL','SR','H','LO','O']]
 # Adjacent contact pairs are one electrical node.
 alias={f'{i}:L':f'{i-1}:R' for i in range(1,n)}
 names=list(dict.fromkeys(alias.get(k,k) for k in names));ix={k:i for i,k in enumerate(names)}
 A=np.zeros((len(names),len(names)));b=np.zeros(len(names))
 def res(a,z,r):
  r*=rng.uniform(1-tolerance,1+tolerance);g=1/r
  a=alias.get(a,a) if isinstance(a,str) else a;z=alias.get(z,z) if isinstance(z,str) else z
  if isinstance(a,str):
   A[ix[a],ix[a]]+=g
   if isinstance(z,str):A[ix[a],ix[z]]-=g
   else:b[ix[a]]+=g*z
  if isinstance(z,str):
   A[ix[z],ix[z]]+=g
   if isinstance(a,str):A[ix[z],ix[a]]-=g
   else:b[ix[z]]+=g*a
 for i in range(n):
  k=lambda x:f'{i}:{x}';g=float(grounds[i]);v=float(supplies[i]+g)
  for a,z,r in [('L',g,10000),('R',v,10000),('L','SL',20000),('SL',g,10000),('R','SR',20000),('SR',g,10000),('H',v,130000),('H','LO',20000),('LO',g,10000),('O',v,10000),('O','SL',470000),('O','H',1000000)]:res(k(a),k(z) if isinstance(z,str) else z,r)
  if outputs[i]==0:res(k('O'),g+(.7 if tolerance else .2),1)
  for node in ['SL','SR','H','LO']:
   b[ix[k(node)]]+=rng.uniform(-400e-9,400e-9) if tolerance else 0
 x=np.linalg.solve(A,b)
 return [{k:x[ix[alias.get(f'{i}:{k}',f'{i}:{k}')]]-grounds[i] for k in ['L','R','SL','SR','H','LO','O']} for i in range(n)]
minimum=99;cases=0;maxoff_vgs=0;mincommon=99
for n in [1,2,3,4,6]:
 for trial in range(600):
  supplies=rng.choice([4.,5.5],n);grounds=rng.uniform(-.025,.025,n);outputs=rng.integers(0,2,n)
  rows=solve(n,outputs,supplies,.015,grounds)
  for i,d in enumerate(rows):
   dl=d['SL']-d['LO'];dr=d['H']-d['SR']
   margins=[(-dl if i==0 else dl)-.009,(-dr if i==n-1 else dr)-.009]
   minimum=min(minimum,*margins)
   assert min(margins)>0,(n,i,d,margins)
   if outputs[i]:maxoff_vgs=max(maxoff_vgs,supplies[i]-d['O'])
   mincommon=min(mincommon,*(supplies[i]-2-d[k] for k in ['SL','SR','H','LO']))
  cases+=1
nominal={str(n):solve(n,[int(i not in [0,n-1]) for i in range(n)],np.full(n,5.)) for n in [1,2,3]}
out={'method':'3000 reproducible randomized DC nodal cases; not exhaustive corners or transient/device simulation','chains':[1,2,3,4,6],'cases':cases,'resistor_tolerance_including_drift':.015,'supply_V':[4,5.5],'adjacent_ground_difference_max_V':.05,'input_bias_budget_A':400e-9,'offset_budget_V':.009,'output_low_test_V':.7,'minimum_sampled_decision_margin_V':minimum,'maximum_sampled_off_VGS_magnitude_V':maxoff_vgs,'minimum_sampled_upper_common_mode_margin_V':mincommon,'nominal':nominal,'bench_validation':False}
(w/'electrical-verification.json').write_text(json.dumps(out,indent=2))
print(json.dumps({k:v for k,v in out.items() if k!='nominal'},indent=2))

import ctypes as c, os, json, random
from pathlib import Path
w=Path(__file__).resolve().parent
os.add_dll_directory('C:/Program Files/KiCad/10.0/bin')
d=c.CDLL('C:/Program Files/KiCad/10.0/bin/ngspice.dll'); log=[]
CB=c.CFUNCTYPE(c.c_int,c.c_char_p,c.c_int,c.c_void_p)
@CB
def cb(s,i,u):
 log.append(s.decode(errors='replace'));return 0
d.ngSpice_Init.argtypes=[CB,c.c_void_p,c.c_void_p,c.c_void_p,c.c_void_p,c.c_void_p,c.c_void_p]
d.ngSpice_Init(cb,None,None,None,None,None,None)
d.ngSpice_Command.argtypes=[c.c_char_p]
class V(c.Structure):
 _fields_=[('name',c.c_char_p),('typ',c.c_int),('flags',c.c_short),('real',c.POINTER(c.c_double)),('comp',c.c_void_p),('length',c.c_int)]
d.ngGet_Vec_Info.argtypes=[c.c_char_p];d.ngGet_Vec_Info.restype=c.POINTER(V)
def vec(n):
 v=d.ngGet_Vec_Info(n.encode());assert v,n
 return [v.contents.real[i] for i in range(v.contents.length)]
def cmd(s):return d.ngSpice_Command(s.encode())
def deck(left,right,v=5,temp=25,beta=100,tol=0,leak=0,transient=False):
 a=['TERM transistor engineering model - NOT manufacturer-qualified',f'.temp {temp}',f'.model N NPN(IS=1e-14 BF={beta} VAF=100 CJE=10p CJC=4p)',f'.model P PNP(IS=1e-14 BF={beta} VAF=100 CJE=10p CJC=4p)', '.model DD D(IS=1n N=1.8 CJO=2p)', '.model SW SW(RON=1 ROFF=1e12 VT=0.5 VH=0.1)',f'Vcc vcc 0 {v}']
 def r(name,x,y,value):a.append(f'R{name} {x} {y} {value*(1+random.uniform(-tol,tol))}')
 # Neighbours are the complementary detector halves, including their emitter/base bias.
 a += ['Qprev dump bp vcc P','Rdump dump 0 22k','Rprevbe bp vcc 100k','Rprev bp lp 10k','Qnext cn bn 0 N','Rnextc vcc cn 10k','Rnextbe bn 0 100k','Rnext rn bn 10k']
 a += [f'VL lctrl 0 {1 if left else 0}',f'VR rctrl 0 '+('PULSE(0 1 5m 1u 1u 5m 10m)' if transient else str(int(right))),'SL lp l lctrl 0 SW','SR rr rn rctrl 0 SW']
 for name,x,y,value in [('123','l','bl',1e4),('124','bl','0',1e5),('125','vcc','al',1e4),('126','rr','br',1e4),('127','br','vcc',1e5),('128','cr','bi',22e3),('129','bi','0',1e5),('130','vcc','ar',1e4),('131','orr','bc',22e3),('132','bc','0',1e5),('4','vcc','gate',1e4)]:r(name,x,y,value)
 a+=['QL al bl 0 N','QR cr br vcc P','QI ar bi 0 N','QC gate bc 0 N','D1 al orr DD','D2 ar orr DD','C139 bl 0 10n','C140 br vcc 10n','C138 vcc 0 100n','Cgate gate vcc 1n']
 # Conservative externally imposed collector leakage: can falsely imply presence or pull gate low.
 a += [f'IleakL al 0 {leak}',f'IleakR vcc cr {leak}',f'IleakI ar 0 {leak}',f'IleakC gate 0 {leak}']
 a+=['.tran 10u 20m' if transient else '.op','.end'];return '\n'.join(a)
def run(s,tran=False):
 p=w/'case.cir';p.write_text(s);cmd('destroy all');cmd('source '+p.as_posix());cmd('run')
 return {n:vec(n) for n in (['time','gate','al','ar'] if tran else ['gate','al','ar','bl','br','vcc#branch'])}
if __name__=='__main__':
 random.seed(20261105);results=[];worst_off=0;worst_on=0
 for l in [False,True]:
  for r in [False,True]:
   z=run(deck(l,r));results.append({'left':l,'right':r,'nominal':{k:v[0] for k,v in z.items()}})
   for v in [4,5,5.5]:
    for t in [-20,25,70]:
     for b in [20,100,300]:
      z=run(deck(l,r,v,t,b,.015,1e-6));g=z['gate'][0]
      if l and r:worst_off=max(worst_off,v-g);assert v-g<.3,(l,r,v,t,b,g)
      else:worst_on=max(worst_on,g);assert g<.3,(l,r,v,t,b,g)
 z=run(deck(True,False,transient=True),True)
 for time,g in zip(z['time'],z['gate']):
  if .007<time<.009:assert g>4.7
  if .012<time<.014:assert g<.3
 out={'method':'ngspice generic BJT/diode engineering models; not vendor models or hardware qualification','dc_cases':108,'supplies':[4,5,5.5],'temperatures_C':[-20,25,70],'beta':[20,100,300],'resistor_tolerance':.015,'imposed_collector_leakage_A':1e-6,'nominal_cases':results,'worst_gate_on_V':worst_on,'worst_off_abs_Vgs_V':worst_off,'transient_right_connect_disconnect_pass':True}
 (w/'simulation.json').write_text(json.dumps(out,indent=2));(w/'ngspice.log').write_text('\n'.join(log));print(json.dumps(out,indent=2))

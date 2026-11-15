import json, collections, numpy as np
rows = json.load(open('out/barnard_measure.json'))
errs = collections.Counter(r['err'][:70] for r in rows if 'err' in r); print('errors:', errs.most_common(3))
ok = [r for r in rows if 'err' not in r]
def visit(m): return 'Aug25' if m < 61000 else ('Mar26' if m < 61200 else 'Aug26')
print('\nflags at star pixel (nonzero share):', np.mean([r['star']['flag'] != 0 for r in ok if 'star' in r]).round(2),
      ' common values:', collections.Counter(r['star']['flag'] for r in ok if 'star' in r).most_common(4))
for name in ['star', 'c0', 'c1', 'c2']:
    print(f'\n== {name}: residual from Gaia-predicted position (arcsec), median ± robust scatter per visit')
    for v in ['Aug25', 'Mar26', 'Aug26']:
        d = np.array([(r[name]['dra'], r[name]['ddec']) for r in ok if name in r and visit(r['mjd']) == v])
        if len(d) == 0: print(f'  {v}: none'); continue
        med = np.median(d, 0); mad = 1.4826*np.median(np.abs(d - med), 0)
        print(f'  {v}: n={len(d):3d}  dRA={med[0]:+6.2f}±{mad[0]:.2f}  dDec={med[1]:+6.2f}±{mad[1]:.2f}  (err of median ≈ {mad.mean()/np.sqrt(len(d)):.2f})')
# the key number: measured star displacement Aug25 -> Aug26 vs prediction (prediction = 0 residual change)
for name in ['star','c0','c1','c2']:
    P = {v: np.median([(r[name]['ra'], r[name]['dec']) for r in ok if name in r and visit(r['mjd']) == v], 0) for v in ['Aug25','Aug26']}
    dra = (P['Aug26'][0]-P['Aug25'][0])*3600*np.cos(np.radians(P['Aug25'][1])); ddec = (P['Aug26'][1]-P['Aug25'][1])*3600
    print(f'{name}: measured Aug25->Aug26 shift dRA={dra:+.2f}" dDec={ddec:+.2f}"  total={np.hypot(dra,ddec):.2f}" = {np.hypot(dra,ddec)/6.15:.2f} px')

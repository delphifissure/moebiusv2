"""S59 sheet A/B: apply the stopping rule (S37 Phase C, second edition) mechanically to the user's verdicts.

  python3 sheet_ab_decide.py troll=L vermeer=none sunflowers=R starwatcher=M
Each verdict is L, M, R or none ("no clear difference", no vote). Checks the key against the hash recorded before the
frames were sent (shots/sheet_ab/compose.json), unblinds, and prints the decision:
  B chosen on >= 3 of 4          -> port the sheets
  otherwise                       -> geometry research stops; ship whichever of A and C was chosen on more pictures,
                                     C on a tie (clean by construction; combing is the known complaint)
"""
import sys, os, json, hashlib
H = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(H, 'shots', 'sheet_ab')
PICS = ['troll', 'vermeer', 'sunflowers', 'starwatcher']
v = dict(a.split('=', 1) for a in sys.argv[1:])
assert set(v) == set(PICS), 'need a verdict for each of ' + ', '.join(PICS)
assert all(x in ('L', 'M', 'R', 'none') for x in v.values()), 'verdicts are L, M, R or none'
keyf = os.path.join(SH, 'key.json'); rec = json.load(open(os.path.join(SH, 'compose.json')))['sha256']
got = hashlib.sha256(open(keyf, 'rb').read()).hexdigest()
assert got == rec, 'KEY CHANGED since the frames were sent (%s vs %s) -- the test is void' % (got, rec)
key = json.load(open(keyf))
arm = {p: (key[p][v[p]] if v[p] != 'none' else None) for p in PICS}
votes = {a: sum(1 for p in PICS if arm[p] == a) for a in 'ABC'}
if votes['B'] >= 3:
    decision = 'PORT THE SHEETS (B chosen on %d of 4)' % votes['B']
else:
    ship = 'A' if votes['A'] > votes['C'] else 'C'
    decision = 'GEOMETRY RESEARCH STOPS; SHIP %s (%s) -- votes A %d, B %d, C %d%s' % (
        ship, {'A': 'the per-line law', 'C': 'the plain fill'}[ship], votes['A'], votes['B'], votes['C'],
        ', tie -> C' if votes['A'] == votes['C'] else '')
out = {'verdicts': v, 'unblinded': arm, 'votes': votes, 'decision': decision, 'key_sha256': got}
json.dump(out, open(os.path.join(SH, 'decision.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))

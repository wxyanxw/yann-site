"""Independent native-coordinate URDF FK oracle; no application code is imported."""
from pathlib import Path
import hashlib
import json
import math
import random
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'assets/models/nero/NERO20251209URDF.urdf'
raw = source.read_bytes()
robot = ET.fromstring(raw)
by_parent = {j.find('parent').get('link'): j for j in robot.findall('joint')}
chain, node = [], 'world'
while node in by_parent:
    joint = by_parent[node]
    chain.append(joint)
    node = joint.find('child').get('link')


def matmul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def origin_matrix(joint):
    origin = joint.find('origin')
    x,y,z = map(float, origin.get('xyz', '0 0 0').split())
    r,p,yaw = map(float, origin.get('rpy', '0 0 0').split())
    cr,sr,cp,sp,cy,sy = math.cos(r),math.sin(r),math.cos(p),math.sin(p),math.cos(yaw),math.sin(yaw)
    return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr,x],
            [sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr,y],
            [-sp,cp*sr,cp*cr,z],[0,0,0,1]]


def fk(q):
    frame = [[int(i == j) for j in range(4)] for i in range(4)]
    movable = 0
    for joint in chain:
        frame = matmul(frame, origin_matrix(joint))
        if joint.get('type') != 'fixed':
            assert joint.find('axis').get('xyz') == '0 0 1'
            c,s = math.cos(q[movable]),math.sin(q[movable])
            frame = matmul(frame, [[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]])
            movable += 1
    return frame


rng = random.Random(20251209)
limits = [(float(j.find('limit').get('lower')),float(j.find('limit').get('upper')))
          for j in chain if j.get('type') != 'fixed']
cases = [[0.0]*7] + [[rng.uniform(lo,hi) for lo,hi in limits] for _ in range(30)]
reference = {'sourceSHA256': hashlib.sha256(raw).hexdigest(),
             'cases': [{'q': q, 'frame': fk(q)} for q in cases]}
directory = ROOT / 'tests/fixtures'
directory.mkdir(exist_ok=True)
(directory / 'nero-fk.json').write_text(json.dumps(reference, indent=2) + '\n')
print(f'Generated {len(cases)} independent URDF FK cases')

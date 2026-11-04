"""Extract a serial robot definition without changing URDF transforms.

Usage: python3 scripts/import_nero.py [source.urdf]
The source URDF is kept alongside the generated JSON for verification.
"""
from pathlib import Path
import hashlib
import json
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets/models/nero/NERO20251209URDF.urdf'


def vector(value, default='0 0 0'):
    return [float(x) for x in (value or default).split()]


def pose(element):
    origin = element.find('origin')
    return {'xyz': vector(origin.get('xyz') if origin is not None else None),
            'rpy': vector(origin.get('rpy') if origin is not None else None)}


def main():
    raw = SOURCE.read_bytes()
    root = ET.fromstring(raw)
    links = {link.get('name'): link for link in root.findall('link')}
    joints = {joint.find('parent').get('link'): joint for joint in root.findall('joint')}
    node = 'world'
    chain, fixed = [], []
    while node in joints:
        joint = joints[node]
        child = joint.find('child').get('link')
        if joint.get('type') == 'fixed':
            fixed.append({**pose(joint), 'name': joint.get('name')})
        else:
            assert joint.get('type') == 'revolute', 'Only revolute joints are supported'
            limit = joint.find('limit')
            inertial = links[child].find('inertial')
            inertia = inertial.find('inertia')
            chain.append({
                'kind': 'urdf', 'name': joint.get('name'), 'parent': node, 'child': child,
                'origin': pose(joint), 'axis': vector(joint.find('axis').get('xyz')),
                'prefix': fixed, 'q0': 0,
                'lower': float(limit.get('lower')), 'upper': float(limit.get('upper')),
                'sourceVelocity': float(limit.get('velocity')), 'sourceEffort': float(limit.get('effort')),
                # Zero in the exporter is not a usable actuator bound.
                'maxVelocity': float(limit.get('velocity')) or 2.0,
                'maxTorque': float(limit.get('effort')) or 30.0,
                'mass': float(inertial.find('mass').get('value')),
                'com': vector(inertial.find('origin').get('xyz')),
                'inertialRPY': vector(inertial.find('origin').get('rpy')),
                'inertia': {key: float(inertia.get(key)) for key in ('ixx','ixy','ixz','iyy','iyz','izz')},
                'configured': True,
            })
            fixed = []
        node = child
    assert len(chain) == 7, f'Expected seven movable joints, found {len(chain)}'
    destination = ROOT / 'assets/models/nero/NERO20251209URDF.urdf'
    if SOURCE.resolve() != destination.resolve():
        destination.write_bytes(raw)
    definition = {
        'schemaVersion': 1, 'id': 'nero7', 'label': 'NERO · 七轴', 'source': 'URDF',
        'sourceFile': SOURCE.name, 'sourceSHA256': hashlib.sha256(raw).hexdigest(),
        'base': {'xyz': [0, .08, 0], 'rpy': [-1.5707963267948966, 0, 0]},
        'baseNote': 'URDF Z-up 转为视图 Y-up；展示底座抬高 0.08 m，Python 返回原生 URDF 坐标。',
        'joints': chain, 'tool': fixed,
        'notes': [
            '关节 origin、axis、角度限位、质量及惯性来自源 URDF；RPY 保留原始精度。',
            'URDF 的七个 velocity/effort 均为 0，仿真替代值为 2 rad/s、30 N·m，不代表真实硬件。',
            'Link7 的质量为 0；动力学保留此质量，采用最小数值惯量保证积分稳定。',
            '未提供 package:// 引用的 STL；视图采用关节骨架，不表示真实外形。',
        ],
    }
    output = ROOT / 'assets/models/nero/definition.json'
    output.write_text(json.dumps(definition, ensure_ascii=False, indent=2) + '\n')
    print(f'{output}: {len(chain)} joints, sha256={definition["sourceSHA256"]}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Offline fixture/oracle validation. No provider, HTTP, or agent calls.

Default checks the eight main cases only. Use --suite all as the evaluation
owner to check the reserved data without exposing it to a change author.
This does not validate the product adapter and does not grade agent answers.
"""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('draft', 'source')

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))

def dec(v):
    return Decimal(str(v))

def cross(a, b, p):
    return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])

def classify(point, ring):
    """Exact-decimal ray casting with explicit boundary detection."""
    p = tuple(map(dec, point))
    vertices = [tuple(map(dec, v)) for v in ring]
    inside = False
    for a,b in zip(vertices, vertices[1:]):
        if cross(a,b,p)==0 and min(a[0],b[0])<=p[0]<=max(a[0],b[0]) and min(a[1],b[1])<=p[1]<=max(a[1],b[1]):
            return 'boundary'
        if (a[1]>p[1]) != (b[1]>p[1]):
            intersection = a[0] + (p[1]-a[1])*(b[0]-a[0])/(b[1]-a[1])
            if p[0]<intersection:
                inside = not inside
    return 'interior' if inside else 'exterior'

def rectangle_check(point, ring):
    """Second, independent oracle check for this pack's simple rectangles."""
    xs = sorted({dec(p[0]) for p in ring[:-1]})
    ys = sorted({dec(p[1]) for p in ring[:-1]})
    assert len(ring)==5 and len(xs)==2 and len(ys)==2
    assert {tuple(map(dec,p)) for p in ring[:-1]}=={(x,y) for x in xs for y in ys}
    for a,b in zip(ring,ring[1:]):
        assert (a[0]==b[0]) != (a[1]==b[1]), 'Not an axis-aligned rectangle edge'
    x,y = map(dec,point)
    if xs[0]<x<xs[1] and ys[0]<y<ys[1]:
        return 'interior'
    if xs[0]<=x<=xs[1] and ys[0]<=y<=ys[1]:
        return 'boundary'
    return 'exterior'

def segment_distance(point, a, b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0.0,min(1.0,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)

def coordinates(geometry):
    kind=geometry['type']
    assert set(geometry)=={'type','coordinates'}
    value=geometry['coordinates']
    if kind=='Point':
        points=[value]
    elif kind=='LineString':
        assert len(value)>=2
        points=value
    else:
        assert kind=='Polygon' and len(value)==1
        assert len(value[0])>=4 and value[0][0]==value[0][-1]
        points=value[0]
    for p in points:
        assert len(p)==2 and all(isinstance(x,(int,float)) and math.isfinite(x) for x in p)
        assert -180<=p[0]<=180 and -80<p[1]<80
    return points

def check_case(case, suite):
    case_id=case['id']
    fixture=read(case['fixture'])
    oracle=read(f'oracles/{suite}/{case_id}.json')
    assert fixture['case_id']==oracle['case_id']==case_id
    assert set(fixture)=={'schema_version','case_id','logical_source_system_id','business_time','draftLayers','sourceScene'}
    system_id=fixture['logical_source_system_id']
    layers=fixture['draftLayers']
    assert len({l['layerId'] for l in layers})==len(layers)==2
    assert {l['layerId'] for l in layers}=={'reference','resources'}
    draft_features=[]
    all_coordinates=[]
    for layer in layers:
        assert set(layer)=={'layerId','name','order','defaultVisible','features'}
        assert layer['defaultVisible'] is True
        for obj in layer['features']:
            assert set(obj)=={'objectId','name','kind','geometry','informationRole'}
            assert obj['informationRole']=='plan'
            assert {'point':'Point','line':'LineString','polygon':'Polygon'}[obj['kind']]==obj['geometry']['type']
            draft_features.append(obj)
            all_coordinates.extend(coordinates(obj['geometry']))
    assert len({o['objectId'] for o in draft_features})==len(draft_features)
    source=fixture['sourceScene']
    assert set(source)=={'objects','reports','asOf'} and source['reports']==[]
    assert source['asOf']==fixture['business_time']=='2026-10-30T09:00:00+08:00'
    source_objects=source['objects']
    refs={}
    for obj in source_objects:
        assert set(obj)=={'ref','name','revision','areaIds','effectiveAt','validTime','geometry','properties'}
        ref=obj['ref']
        assert set(ref)=={'systemId','objectType','objectId'} and ref['systemId']==system_id
        key=tuple(ref[k] for k in ('systemId','objectType','objectId'))
        assert key not in refs
        refs[key]=obj
        assert obj['revision']==1 and obj['validTime'] is None and obj['effectiveAt']==source['asOf']
        all_coordinates.extend(coordinates(obj['geometry']))
        if ref['objectType']=='resource':
            assert obj['geometry']['type']=='Point' and set(obj['properties'])=={'availableCount','unit'}
            assert isinstance(obj['properties']['availableCount'],int) and obj['properties']['unit']=='辆'
        elif ref['objectType']=='area':
            assert obj['geometry']['type']=='Polygon' and set(obj['properties'])=={'memberRefs'}
        else:
            assert ref['objectType']=='road' and obj['geometry']['type']=='LineString'
            assert obj['properties']=={'passability':'open'}
    assert len({o['ref']['objectId'] for o in source_objects})==len(source_objects)
    area_objects=[o for o in source_objects if o['ref']['objectType']=='area']
    assert len(area_objects)==1
    area_ids={o['ref']['objectId'] for o in area_objects}
    for obj in source_objects:
        assert set(obj['areaIds'])<=area_ids
    source_region=area_objects[0]
    expected_members=[o['ref'] for o in source_objects if o['ref']['objectType']!='area' and source_region['ref']['objectId'] in o['areaIds']]
    assert source_region['properties']['memberRefs']==expected_members
    for ref in expected_members:
        assert tuple(ref[k] for k in ('systemId','objectType','objectId')) in refs
    draft_region=next(l for l in layers if l['layerId']=='reference')['features'][0]
    assert draft_region['name']==source_region['name'] and len(next(l for l in layers if l['layerId']=='reference')['features'])==1
    regions={'draft':draft_region['geometry']['coordinates'][0], 'source':source_region['geometry']['coordinates'][0]}
    assert regions['draft']!=regions['source']
    candidates={
        'draft':[{'id':o['objectId'],'name':o['name'],'p':o['geometry']['coordinates']} for o in next(l for l in layers if l['layerId']=='resources')['features'] if o['kind']=='point'],
        'source':[{'id':o['ref']['objectId'],'name':o['name'],'p':o['geometry']['coordinates']} for o in source_objects if o['ref']['objectType']=='resource'],
    }
    assert all(4<=len(candidates[s])<=6 for s in SOURCES)
    min_distance=1.0
    for candidate in SOURCES:
        for reference in SOURCES:
            expected=oracle['combinations'][f'{candidate}->{reference}']
            points=candidates[candidate]
            ring=regions[reference]
            actual={'interior':[],'boundary':[],'exterior':[]}
            for p in points:
                result=classify(p['p'],ring)
                assert result==rectangle_check(p['p'],ring), 'Independent geometry checks disagree'
                actual[result].append(p['id'])
                min_distance=min(min_distance,min(segment_distance(p['p'],a,b) for a,b in zip(ring,ring[1:])))
            assert expected['candidate_ids']==[p['id'] for p in points]
            assert expected['candidate_count']==len(points)
            assert expected['target_id']==(draft_region['objectId'] if reference=='draft' else source_region['ref']['objectId'])
            for key in actual:
                assert expected[key+'_ids']==actual[key], (case_id,candidate,reference,key)
            assert expected['boundary_ids']==[]
            assert expected['count']==len(actual['interior'])
            assert expected['interior_names']==[p['name'] for p in points if p['id'] in actual['interior']]
    assert min_distance>=0.00045, 'Unexpected near-boundary point'
    span=[max(p[i] for p in all_coordinates)-min(p[i] for p in all_coordinates) for i in (0,1)]
    assert max(span)<0.1, 'Unexpected broad-region geometry'
    declared=oracle['declared_scope']
    unknown=[k for k in ('candidate','reference') if declared[k] is None]
    assert oracle['initial_unknown_axes']==unknown
    assert oracle['clarification']['max_new_source_clarification_turns']==len(unknown)
    pairs=[f'{c}->{r}' for c in SOURCES for r in SOURCES if (declared['candidate'] is None or declared['candidate']==c) and (declared['reference'] is None or declared['reference']==r)]
    assert pairs==oracle['required_pairs_without_clarification']
    for k in ('candidate','reference'):
        assert oracle['preferred_scope_if_asked'][k] in SOURCES
        if declared[k] is not None:
            assert oracle['preferred_scope_if_asked'][k]==declared[k]
    if case_id=='G03':
        a,b=(oracle['combinations'][p] for p in ('draft->draft','draft->source'))
        assert a['count']==b['count']==2 and set(a['interior_ids']).isdisjoint(b['interior_ids'])
    if case_id=='G04':
        diag=oracle['tag_diagnostic']
        tagged=[o for o in source_objects if o['ref']['objectType']=='resource' and area_ids & set(o['areaIds'])]
        inside=set(oracle['combinations']['source->source']['interior_ids'])
        tagged_ids={o['ref']['objectId'] for o in tagged}
        assert sorted(tagged_ids)==sorted(diag['tagged_resource_ids'])
        assert len(tagged_ids)==diag['tag_count']==2
        assert len(tagged_ids & inside)==diag['tag_then_geometry_count']==1
        assert len(inside)==diag['all_source_then_geometry_count']==3
        assert set(diag['untagged_but_inside_source_region_ids'])==inside-tagged_ids
        assert set(diag['tagged_but_outside_source_region_ids'])==tagged_ids-inside
    if case_id=='G06':
        selected=oracle['combinations']['source->source']
        assert selected['count']==2 and selected['interior_names']==['联络点','联络点']
        assert len(set(selected['interior_ids']))==2
    return {'case_id':case_id,'quadrant':[declared['candidate'] is not None,declared['reference'] is not None], 'combinations_checked':4,'candidate_points':{s:len(candidates[s]) for s in SOURCES},'minimum_boundary_distance_degrees':round(min_distance,9),'maximum_coordinate_span_degrees':round(max(span),9),'fixture_sha256':hashlib.sha256((ROOT/case['fixture']).read_bytes()).hexdigest()}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite',choices=['main','reserve','all'],default='main')
    parser.add_argument('--write-report',type=Path)
    args=parser.parse_args()
    suites=['main','reserve'] if args.suite=='all' else [args.suite]
    results=[]
    for suite in suites:
        cases=read(f'cases/{suite}.json')
        assert [c['id'] for c in cases['cases']]==cases['run_order']
        case_results=[check_case(c,suite) for c in cases['cases']]
        quadrants=Counter(tuple(r['quadrant']) for r in case_results)
        expected=2 if suite=='main' else 1
        assert len(quadrants)==4 and set(quadrants.values())=={expected}
        results.extend(case_results)
    report={'kind':'offline_fixture_and_oracle_validation','status':'pass','suites':suites,'case_count':len(results),'combination_count':4*len(results),'geometry_checks':['Decimal ray casting','Independent rectangle interval containment'],'live_agent_calls':0,'product_adapter_validated':False,'results':results}
    if args.write_report:
        args.write_report.parent.mkdir(parents=True,exist_ok=True)
        args.write_report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='results'},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()

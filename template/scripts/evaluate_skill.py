#!/usr/bin/env python3
"""Repeatable static and synthetic contract evaluation; not an app/browser test."""
import json, pathlib, re, sys, zipfile
root=pathlib.Path(__file__).resolve().parents[1]
source=(root/'SKILL.md').read_text()
refs={p.name:p.read_text() for p in (root/'references').glob('*.md')}
scenarios=json.loads((root/'evals/scenarios.json').read_text())
checks=[]
def check(group,name,pred,details=''):
    checks.append({'group':group,'name':name,'passed':bool(pred),'details':details})
check('structure','YAML frontmatter',source.startswith('---\nname: universal-admin-builder\n'))
check('structure','No bundled legacy V1/V2 directories',not (root/'V1').exists() and not (root/'V2').exists())
check('structure','Agent manifest exists',(root/'agents/openai.yaml').exists())
for ref in re.findall(r'`(references/[^`]+\.md)`',source):
    check('structure','Referenced file: '+ref,(root/ref).exists())
alltext=source+'\n'+'\n'.join(refs.values())
for term in ['tenant','metadata','Quick Comment','audit','EDA','agent','idempotent','deep link','accessibility','role','workflow','published','recovery']:
    check('contract','Contract covered: '+term,term.lower() in alltext.lower())
for key,s in scenarios.items():
    check(key,'Distinct resource fields',len(s['fields'])==len(set(s['fields'])))
    check(key,'Relationships declared',bool(s['relations']))
    check(key,'Business events declared',all('.' in e for e in s['events']))
    check(key,'Role fields all in canonical schema',all(set(cols).issubset(s['fields']) for cols in s['permissions'].values()))
    check(key,'No anonymous/guest access by default',not s['permissions'].get('guest',[]))
    check(key,'Cross-surface requirements in QA',all((f.replace('_',' ') in alltext.lower()) or f in ('grid','form','filter','inspector','audit','approval','grouped_view') for f in s['required']))
check('hrms','Salary masked from ordinary employee','salary' not in scenarios['hrms']['permissions']['employee'])
check('crm','Personal saved-view acceptance','saved view' in alltext.lower())
check('inventory','Quantity and grouping coverage','quantity' in scenarios['inventory']['fields'] and 'grouped' in scenarios['inventory']['views'])
check('safety','No API management console','no standalone api management' in alltext.lower())
check('safety','No code execution from configuration','arbitrary code' in alltext.lower())
check('safety','Preview vs actual test separation','does not mean' in refs['quality-and-evaluation.md'].lower())
failed=[c for c in checks if not c['passed']]
result={'result':'PASS' if not failed else 'FAIL','passed':len(checks)-len(failed),'total':len(checks),'failures':failed,'checks':checks,'limitations':['Static instructions and synthetic fixtures only','No independent agent generation or browser UI execution','No backend, concurrency, penetration or real integrations tested']}
output=root/'evals/results.json';output.write_text(json.dumps(result,indent=2)+'\n')
print(f"{result['result']}: {result['passed']}/{result['total']} checks")
for c in failed:print('FAIL:',c['group'],c['name'])
sys.exit(bool(failed))

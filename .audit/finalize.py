from pathlib import Path
import json
import runpy

runpy.run_path('.audit/apply.py')
p=Path('tests/backup-recovery.test.mjs')
s=p.read_text()
old='  assert.match(page, /result\\.status === "fulfilled"/);'
assert s.count(old)==1, 'Expected original aggregate publication assertion'
new='''  const packStart = page.indexOf('import("./sentence-data").then(({ loadSentencePack })');
  const publication = page.indexOf('if (active) setSentencePacks', packStart);
  const completion = page.indexOf('.then((results) =>', packStart);
  assert.ok(packStart >= 0 && publication > packStart && publication < completion, "Each successful pack must publish before aggregate completion");'''
p.write_text(s.replace(old,new,1))
p=Path('package.json')
data=json.loads(p.read_text())
data['scripts']['typecheck']='tsc --noEmit --incremental false'
p.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
p=Path('.github/workflows/validate.yml')
s=p.read_text()
old='      - name: Lint\n        run: npm run lint\n'
assert s.count(old)==1
s=s.replace(old,'      - name: TypeScript type check\n        run: npm run typecheck\n\n'+old,1)
p.write_text(s)
p=Path('TESTING.md')
s=p.read_text().replace('npm test\nnpm run lint','npm test\nnpm run typecheck\nnpm run lint',1)
p.write_text(s+'\nThe standard validation job now also runs an explicit TypeScript check (`npm run typecheck`) without emitting files or relying on the production bundler to detect type errors.\n')
print('Updated partial-load regression contract and added explicit type checking to CI.')

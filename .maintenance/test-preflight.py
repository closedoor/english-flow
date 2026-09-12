from pathlib import Path
p = Path('.maintenance/browser-audit.mjs')
s = p.read_text()
old = "    await context.addInitScript(values => {\n      for (const [key,value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));"
new = "    await context.addInitScript(values => {\n      if (sessionStorage.getItem('english-flow-audit-seeded')) return;\n      sessionStorage.setItem('english-flow-audit-seeded', '1');\n      for (const [key,value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));"
assert s.count(old) == 1
p.write_text(s.replace(old, new))
p = Path('.maintenance/apply.py')
s = p.read_text()
old = " - touchStart.current.y; touchStart.current = null; if (Math.abs(distanceX)"
new = " - touchStart.current.y; if (Math.abs(distanceX)"
assert s.count(old) == 1
s = s.replace(old, new)
old = "'(distanceX < 0 ? 1 : -1); }}'"
new = "'(distanceX < 0 ? 1 : -1); touchStart.current = null; }}'"
assert s.count(old) == 1
p.write_text(s.replace(old, new))

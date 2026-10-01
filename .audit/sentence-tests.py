from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text();assert s.count(old)==1,(path,old[:100],s.count(old));p.write_text(s.replace(old,new))
# Keep storage/navigation-focused VM harnesses explicit about their speech seam.
change('tests/product-learning-flow.test.mjs','    React, ...state, resultPrimaryRef: {},','    React, ...state, resultPrimaryRef: {},\n    sentenceItemById: new Map(), playAutomaticSentenceExample() {},')
change('tests/progress-boundaries-runtime.test.mjs','    sentenceSessionIds: snapshot.sentenceIds,','    sentenceSessionIds: snapshot.sentenceIds,\n    sentenceItemById: new Map([[2, { id: 2 }]]),\n    playAutomaticSentenceExample(item, mode) { assert.equal(item.id, snapshot.sentenceIds[snapshot.index]); assert.equal(mode, snapshot.mode); },')
change('tests/sentence-browse-runtime.test.mjs','    playAutomaticWordExample() {},','    playAutomaticWordExample() {},\n    playAutomaticSentenceExample() {},')
p=Path('tests/session-selection.test.mjs');s=p.read_text();lines=s.splitlines()
for i,line in enumerate(lines):
 if 'assert.match(page, /if \\(sentenceStage' in line and 'sentenceResumeSnapshotRef' in line:
  lines[i]='''  assert.match(page, /if \\(sentenceStage === "setup" && sentenceSessionIds\\.length && snapshot\\)/);
  assert.match(page, /snapshot\\.index > 0 \\|\\| Object\\.keys\\(snapshot\\.ratings\\)\\.length > 0/);
  assert.match(page, /setDiscardRequest\\(\\{ sentence: true, sentenceStart: \\{ reviewOnly, singleSentence \\} \\}\\)/);'''
 if 'assert.match(page, /\\[autoWordExamples,' in line:
  lines[i]='''  const speechEffect = page.slice(page.indexOf("const automatic = hydrated && autoWordExamples"), page.indexOf('window.addEventListener("pagehide", stopSpeech)'));
  for (const dependency of ["autoWordExamples", "autoSentenceExamples", "currentSentence", "sentenceMode", "sentenceStage", "hasOpenDialog", "tab"]) assert.ok(speechEffect.includes(dependency));
  assert.match(speechEffect, /stopSpeech\\(\\)/);
  assert.match(speechEffect, /if \\(alreadyStarted\\) return/);'''
p.write_text('\n'.join(lines)+'\n')
p=Path('tests/session-resume.test.mjs');s=p.read_text();s=s.replace('sentence sessions never reveal Chinese automatically','speaking-first sessions keep answers hidden while bilingual cards show Chinese directly').replace('must hide Chinese before displaying a card','must reset the speaking-first answer before displaying a card')
lines=s.splitlines()
for i,line in enumerate(lines):
 if 'assert.match(sentenceStarter, /if' in line:
  lines[i]='''  assert.match(sentenceStarter, /newestSnapshot\\(cleanSentenceSession/);
  assert.match(sentenceStarter, /sentenceSessionIds\\.length && snapshot/);
  assert.match(sentenceStarter, /sameChoices[\\s\\S]*resumeSentenceSession\\(\\)/);'''
p.write_text('\n'.join(lines)+'\n')
p=Path('scripts/browser-setup-start.mjs');s=p.read_text();start=s.index("  await check('top-start-preserves-paused-sentence-confirmation-and-resume'");end=s.index('\n  await browser.close()',start)
s=s[:start]+'''  await check('top-start-resumes-same-sentence-and-protects-explicit-replacement',async page=>{
    await nav(page,'句库');await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();await enabled(page);
    const before=await saved(page,sentenceKey);
    await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.locator('[aria-modal="true"]').count(),0);
    const after=await saved(page,sentenceKey);assert.deepEqual(after.sentenceIds,before.sentenceIds);assert.deepEqual(after.ratings,before.ratings);assert.equal(after.index,before.index);
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
    await page.getByRole('button',{name:'另开新一组',exact:true}).click();await page.locator('[aria-modal="true"]').waitFor();
    await page.keyboard.press('Escape');assert.deepEqual((await saved(page,sentenceKey)).ratings,before.ratings);
  });'''+s[end:];p.write_text(s)
p=Path('scripts/verify-live-pwa.mjs');p.write_text(p.read_text()+"\n// Verify the actual deployed sentence-card behavior, not just its assets.\nif (!process.exitCode) await import('./verify-live-sentences.mjs');\n")
print('Updated obsolete re-entry expectations, retained replacement protection, and wired the deployed sentence verifier.')

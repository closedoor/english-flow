from pathlib import Path

def once(text, old, new):
    assert text.count(old) == 1, f'Expected one target: {old[:100]}'
    return text.replace(old, new, 1)

p=Path('app/page.tsx')
s=p.read_text().replace('iOS needs the first speak() in a real input handler.', 'iOS needs the first utterance in a real input handler.')
s=once(s, 'sentenceStage, sessionPath, tab, wordSessionKind]);', 'sentenceStage, sessionPath, tab, wordSessionKind, current]);')
p.write_text(s)

# The isolated browsing test injects dependencies of extracted handlers;
# playback is independently exercised by runtime and real-browser tests.
p=Path('tests/sentence-browse-runtime.test.mjs')
s=once(p.read_text(), '    words, wordBrowserRef, wordBrowserOriginRef, wordBrowserReturnRef,', '    words, wordBrowserRef, wordBrowserOriginRef, wordBrowserReturnRef,\n    playAutomaticWordExample() {},')
p.write_text(s)
p=Path('tests/session-selection.test.mjs')
s=p.read_text()
old=r'\[current\?\.id, currentPattern\?\.id, currentReviewWordId, currentSentence\?\.id, learnStage, patternDrillIndex, patternStage, quizWord\?\.id, readingId, reviewView, sentenceSection, sentenceStage, tab\]'
new=r'\[autoWordExamples, current\?\.id, current\?\.example, currentPattern\?\.id, currentReviewWordId, currentSentence\?\.id, hasOpenDialog, hydrated, learnStage, patternDrillIndex, patternStage, quizWord\?\.id, readingId, reviewView, sentenceSection, sentenceStage, sessionPath, tab, wordSessionKind, current\]'
p.write_text(once(s, old, new))

p=Path('scripts/browser-autoplay.mjs')
s=p.read_text()
# React may delegate at document level, so its handler must run before the
# fixture's bubble cleanup. Automation evaluation may itself confer browser
# activation; model activation only from the explicitly exercised input here.
s=once(s, 'gesture:false, fail:false', 'gesture:false, activated:false, fail:false') if 'gesture:false, fail:false' in s else once(s, 'gesture:false,fail:false', 'gesture:false,activated:false,fail:false')
s=once(s, '      window.__speech=state;', '''      window.__speech=state;
      Object.defineProperty(navigator,'userActivation',{configurable:true,value:{
        get hasBeenActive(){return state.activated;},get isActive(){return state.gesture;}
      }});''')
s=once(s, "document.addEventListener(event,()=>{state.gesture=true;},true);", "document.addEventListener(event,()=>{state.gesture=true;state.activated=true;},true);")
s=once(s, "document.addEventListener(event,()=>{state.gesture=false;});", "window.addEventListener(event,()=>{state.gesture=false;});")
extra='''  await check('horizontal-swipe-starts-current-example-without-old-callbacks',async page=>{
    await begin(page);await count(page,1);
    await page.locator('.word-card').evaluate(card=>{
      const touch=(x)=>({identifier:1,clientX:x,clientY:260});
      const start=new Event('touchstart',{bubbles:true});Object.defineProperty(start,'touches',{value:[touch(270)]});card.dispatchEvent(start);
      const end=new Event('touchend',{bubbles:true});Object.defineProperty(end,'touches',{value:[]});Object.defineProperty(end,'changedTouches',{value:[touch(40)]});card.dispatchEvent(end);
    });
    await count(page,2);assert.equal((await logs(page))[1].text,await page.locator('.example-box p').innerText());
    await page.evaluate(()=>window.__speech.utterances[0].onend());assert.equal((await logs(page)).length,2);
  });
  await check('confirmation-dialog-stops-audio-and-cancel-resumes-current-card',async page=>{
    await begin(page);await page.locator('.learn-actions .primary-action').click();await count(page,2);
    await page.getByRole('button',{name:'退出本组',exact:true}).click();
    await page.locator('[role="dialog"], [role="alertdialog"]').waitFor();
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>window.__speech.utterances[1].onend());assert.equal((await logs(page)).length,2);
    await page.keyboard.press('Escape');await count(page,3);
    assert.equal((await logs(page))[2].text,await page.locator('.example-box p').innerText());
  });
'''
p.write_text(once(s, "  await check('manual-audio-interrupts-repetition-without-restarting-it'", extra + "  await check('manual-audio-interrupts-repetition-without-restarting-it'"))
print('Updated extracted-handler fixtures and added deterministic activation, swipe/modal autoplay cases without removing assertions.')

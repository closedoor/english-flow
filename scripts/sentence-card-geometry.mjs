import assert from 'node:assert/strict';

// Measure the actual text, not an expanding paragraph's empty layout box.
export async function assertSentenceCardGeometry(page, {recall=false}={}) {
  const geometry=await page.evaluate(recall=>{
    const textBox=selector=>{
      const range=document.createRange();range.selectNodeContents(document.querySelector(selector));
      const rect=range.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom};
    };
    const first=textBox(recall?'.speak-prompt p':'.sentence-english');
    const second=textBox(recall?'.speak-answer .sentence-english':'.sentence-translation');
    const replay=document.querySelector(recall?'[aria-label="播放英文"]':'[aria-label="重播本句"]');
    const rect=replay.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    return {gap:second.top-first.bottom,replayInToolbar:Boolean(replay.closest('.sentence-card-actions')),
      replay:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},replayTappable:hit===replay||replay.contains(hit),
      viewport:{width:innerWidth,height:innerHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};
  },recall);
  assert.ok(geometry.gap>=8&&geometry.gap<=64,`Bilingual text must stay together: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.replayInToolbar,true,'Replay must share the bottom navigation toolbar');
  assert.ok(geometry.replay.width>=44&&geometry.replay.height>=44,'Replay needs a full touch target');
  assert.ok(geometry.replay.y>=geometry.viewport.height*.6,'Replay must be in the lower thumb area');
  assert.ok(Math.abs(geometry.replay.x+geometry.replay.width/2-geometry.viewport.width/2)<=1,'Replay must be centered between previous and next');
  assert.equal(geometry.replayTappable,true,'Replay must receive a direct tap without scrolling');
  assert.equal(geometry.horizontalOverflow,false);
  return geometry;
}

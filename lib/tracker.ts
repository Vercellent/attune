/**
 * Injected into every rendered site. Sites report screen changes through
 * `window.__lab.view(name)` and success through `window.__lab.complete()`;
 * clicks, dead clicks, rage clicks and invalid form fields are captured
 * automatically and posted to the parent frame (the interview page).
 */
const TRACKER_SCRIPT = `<script>(function(){
var t0=Date.now(),view='start',recent=[];
function send(type,label){try{parent.postMessage({__lab:1,type:type,page:view,label:label||'',t:Date.now()-t0},'*')}catch(e){}}
window.__lab={view:function(n){n=String(n||'');if(n&&n!==view){view=n;send('page_view',view)}},complete:function(){send('complete',view)}};
document.addEventListener('click',function(e){
var el=e.target;if(!el||!el.closest)return;
var hit=el.closest('a,button,input,select,textarea,label,summary,[role=button],[onclick],[data-action]');
var src=hit||el;var label=(src.getAttribute('aria-label')||src.innerText||src.value||src.tagName||'').toString().trim().replace(/\\s+/g,' ').slice(0,60);
var now=Date.now();recent=recent.filter(function(c){return now-c.t<800&&Math.abs(c.x-e.clientX)<32&&Math.abs(c.y-e.clientY)<32});recent.push({t:now,x:e.clientX,y:e.clientY});
if(recent.length>=3){recent=[];send('rage_click',label)}else{send(hit?'click':'dead_click',label)}
if(hit&&hit.tagName==='A'){var h=hit.getAttribute('href')||'';if(h&&h.charAt(0)!=='#')e.preventDefault()}
},true);
document.addEventListener('submit',function(e){e.preventDefault()},true);
document.addEventListener('invalid',function(e){var f=e.target;send('form_error',(f&&(f.name||f.id||f.type))||'field')},true);
window.addEventListener('load',function(){if(view==='start')send('page_view','start')});
})();</script>`

export function instrument(html: string) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${TRACKER_SCRIPT}`)
  return TRACKER_SCRIPT + html
}

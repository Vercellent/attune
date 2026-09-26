/**
 * Injected into every experiment site (served in a sandboxed iframe).
 * - Behavior: page views via window.__lab.view(name), completion via __lab.complete(),
 *   clicks / dead clicks / rage clicks / invalid fields captured automatically.
 * - Recording: rrweb (DOM + mouse + scroll) starts when the parent sends {__labcmd:'start'}.
 * - Gaze: the parent forwards webcam gaze points; we resolve them to the element under the eye.
 * Everything is posted to the parent frame, which stamps time and forwards it to the server.
 */
const TRACKER_SCRIPT = `<script src="/vendor/rrweb-record.min.js"></script><script>(function(){
var view='start',recent=[],live=false,stopRec=null,buf=[],flushT=null;
function post(m){m.__lab=1;try{parent.postMessage(m,'*')}catch(e){}}
function send(type,label){if(live)post({kind:'track',type:type,page:view,label:label||''})}
function flush(){if(buf.length){post({kind:'rrweb',events:buf});buf=[]}flushT=null}
window.__lab={view:function(n){n=String(n||'');if(n&&n!==view){view=n;send('page_view',view)}},complete:function(){send('complete',view)}};
function labelOf(el){if(!el||!el.closest)return'';var hit=el.closest('a,button,input,select,textarea,label,summary,img,h1,h2,h3,p,li,[role=button],[data-action]')||el;
return (hit.getAttribute('aria-label')||hit.getAttribute('alt')||hit.innerText||hit.value||hit.tagName||'').toString().trim().replace(/\\s+/g,' ').slice(0,60)}
document.addEventListener('click',function(e){
var el=e.target;if(!el||!el.closest)return;
var hit=el.closest('a,button,input,select,textarea,label,summary,[role=button],[onclick],[data-action]');
var label=labelOf(hit||el);
var now=Date.now();recent=recent.filter(function(c){return now-c.t<800&&Math.abs(c.x-e.clientX)<32&&Math.abs(c.y-e.clientY)<32});recent.push({t:now,x:e.clientX,y:e.clientY});
if(recent.length>=3){recent=[];send('rage_click',label)}else{send(hit?'click':'dead_click',label)}
if(hit&&hit.tagName==='A'){var h=hit.getAttribute('href')||'';if(h&&h.charAt(0)!=='#')e.preventDefault()}
},true);
document.addEventListener('submit',function(e){e.preventDefault()},true);
document.addEventListener('invalid',function(e){var f=e.target;send('form_error',(f&&(f.name||f.id||f.type))||'field')},true);
window.addEventListener('keydown',function(e){if(e.shiftKey&&e.altKey&&e.code==='KeyC'){e.preventDefault();post({kind:'hotkey',name:'gaze'})}});
window.addEventListener('message',function(e){var d=e.data;if(!d||!d.__labcmd)return;
if(d.__labcmd==='start'&&!live){live=true;send('page_view',view);
if(window.rrwebRecord){stopRec=window.rrwebRecord({emit:function(ev){buf.push(ev);if(!flushT)flushT=setTimeout(flush,800)},sampling:{mousemove:50,scroll:150,input:'last'},maskAllInputs:false})}}
if(d.__labcmd==='stop'){if(stopRec){stopRec();stopRec=null}flush();live=false}
if(d.__labcmd==='gaze'&&live){var el=document.elementFromPoint(d.x,d.y);if(el)post({kind:'gaze',page:view,label:labelOf(el)||'background'})}
});
post({kind:'ready'});
})();</script>`

export function instrument(html: string) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${TRACKER_SCRIPT}`)
  return TRACKER_SCRIPT + html
}

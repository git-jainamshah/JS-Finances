import {html,Component} from '/vendor/preact-htm.mjs';
import {logoFor,prettyName} from '/insights.mjs';
export {html};
export const DEFAULT_LAYOUT=['kpis','networth','cashflow','budget','radar','subs','loans','goals','credit','projection','accounts'];
export const title=s=>prettyName(s);

const NAV_PATHS={
 overview:html`<rect x="3" y="3" width="7.5" height="9" rx="1.8"></rect><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.8"></rect><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.8"></rect><rect x="3" y="15" width="7.5" height="6" rx="1.8"></rect>`,
 spending:html`<path d="M21.2 15.9A10 10 0 1 1 8 2.8"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path>`,
 recurring:html`<path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path>`,
 loans:html`<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path>`,
 projections:html`<path d="M22 7 13.5 15.5l-5-5L2 17"></path><path d="M16 7h6v6"></path>`,
 transactions:html`<path d="M9 6h12"></path><path d="M9 12h12"></path><path d="M9 18h12"></path><path d="M4 6h.01"></path><path d="M4 12h.01"></path><path d="M4 18h.01"></path>`,
 chat:html`<path d="M9.9 15.5A2 2 0 0 0 8.5 14l-6.1-1.6a.5.5 0 0 1 0-1L8.5 10A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14 8.5a2 2 0 0 0 1.5 1.4l6.1 1.6a.5.5 0 0 1 0 1L15.5 14a2 2 0 0 0-1.4 1.5l-1.6 6.1a.5.5 0 0 1-1 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path>`,
 settings:html`<path d="M21 4h-7"></path><path d="M10 4H3"></path><path d="M21 12h-9"></path><path d="M8 12H3"></path><path d="M21 20h-5"></path><path d="M12 20H3"></path><path d="M14 2v4"></path><path d="M8 10v4"></path><path d="M16 18v4"></path>`,
 more:html`<circle cx="5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="19" cy="12" r="1.2"></circle>`
};
export const NavIcon=({id,size=20,sw=1.75})=>html`<svg aria-hidden="true" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" style="display:block">${NAV_PATHS[id]}</svg>`;

const FIELD_ICONS={
 bank:html`<path d="M3 21h18"></path><path d="M5 21V10"></path><path d="M19 21V10"></path><path d="M9.5 21v-7"></path><path d="M14.5 21v-7"></path><path d="M12 3 3 8h18z"></path>`,
 calendar:html`<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"></rect><path d="M8 2.5v4"></path><path d="M16 2.5v4"></path><path d="M3 10h18"></path>`,
 tag:html`<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"></path><circle cx="7.5" cy="7.5" r="1.2"></circle>`,
 swap:html`<path d="m8 3-4 4 4 4"></path><path d="M4 7h16"></path><path d="m16 21 4-4-4-4"></path><path d="M20 17H4"></path>`
};
const FieldIcon=({id})=>html`<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f6b5e" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex:none">${FIELD_ICONS[id]}</svg>`;

export const BrandMark=({size=38,light=false})=>html`<svg aria-hidden="true" width=${size} height=${size} viewBox="0 0 40 40" style="display:block;flex:none"><rect width="40" height="40" rx="11" fill=${light?'#d1e5a7':'#183c35'}></rect><circle cx="23.5" cy="11.5" r="3.3" fill=${light?'#183c35':'#d1e5a7'}></circle><path d="M23.5 18.5v9a6.5 6.5 0 0 1-6.5 6.5h-1.5" fill="none" stroke=${light?'#183c35':'#d1e5a7'} stroke-width="4.2" stroke-linecap="round"></path></svg>`;
export const Wordmark=({size=32,dot=5})=>html`<span style=${`display:flex;align-items:baseline;font:400 ${size}px/1 'Instrument Serif',serif;letter-spacing:-.4px;color:#183c35`}>jainam<span aria-hidden="true" style=${`display:inline-block;width:${dot}px;height:${dot}px;border-radius:50%;background:#7c9e52;margin-left:2px`}></span></span>`;

// Bank logo with a letter badge fallback when the icon cannot load.
export class BankLogo extends Component{
 state={failed:false};
 componentDidUpdate(prev){if(prev.institution!==this.props.institution&&this.state.failed)this.setState({failed:false});}
 render({institution='',size=22,radius=3}){
  const src=logoFor(institution);
  if(!src||this.state.failed){const letter=/express/i.test(institution)?'A':(institution[0]||'•');return html`<span aria-hidden="true" style=${`display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:${radius}px;background:#eef3e8;color:#2f5d3a;font-size:${Math.round(size*.55)}px;font-weight:700;flex:none`}>${letter}</span>`;}
  return html`<img src=${src} alt="" aria-hidden="true" width=${size} height=${size} onError=${()=>this.setState({failed:true})} style=${`display:block;width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:cover;flex:none`}/>`;
 }
}

export const LinkPill=({label,onClick,extra=''})=>html`<button onClick=${onClick} class="hv-pill" style=${`display:inline-flex;align-items:center;gap:8px;border:1px solid #dfe5db;background:#fff;border-radius:999px;padding:4px 4px 4px 12px;font-size:13px;font-weight:600;color:#183c35;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s;flex:none;${extra}`}>${label}<span aria-hidden="true" class="pill-arrow" style="width:24px;height:24px;border-radius:50%;background:#eef3e8;color:#183c35;display:grid;place-items:center;font-size:13px">→</span></button>`;

export const Switch=({on})=>html`<span aria-hidden="true" style=${`width:42px;height:24px;border-radius:12px;background:${on?'#315e4e':'#8f9b94'};position:relative;flex:none;transition:background .15s`}><span style=${`position:absolute;top:3px;left:${on?'21px':'3px'};width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:left .15s`}></span></span>`;

export const SR=({children})=>html`<span class="sr">${children}</span>`;

// Styled dropdown (listbox) with keyboard support: Arrow keys, Escape, Tab.
export class Select extends Component{
 state={open:false};
 componentDidMount(){this.onDoc=e=>{if(this.state.open&&this.root&&!this.root.contains(e.target))this.setState({open:false});};document.addEventListener('mousedown',this.onDoc);}
 componentWillUnmount(){document.removeEventListener('mousedown',this.onDoc);}
 opts(){return (this.props.options||[]).map(o=>typeof o==='string'?{value:o,label:o}:o);}
 focusOpt(dir){const els=[...(this.root?.querySelectorAll('[data-opt]')||[])];if(!els.length)return;const i=els.indexOf(document.activeElement),sel=Math.max(0,els.findIndex(e=>e.getAttribute('aria-selected')==='true')),n=i<0?sel:Math.min(els.length-1,Math.max(0,i+dir));els[n].focus();}
 openList(){this.setState({open:true},()=>setTimeout(()=>this.focusOpt(0),0));}
 pick(v){this.setState({open:false});this.props.onChange?.(v);this.btn?.focus();}
 onKey(e){const open=this.state.open;if(e.key==='Escape'&&open){e.stopPropagation();this.setState({open:false});this.btn?.focus();}else if(e.key==='ArrowDown'){e.preventDefault();open?this.focusOpt(1):this.openList();}else if(e.key==='ArrowUp'&&open){e.preventDefault();this.focusOpt(-1);}else if(e.key==='Tab'&&open)this.setState({open:false});}
 render(p,{open}){
  const opts=this.opts(),cur=opts.find(o=>String(o.value)===String(p.value)),sm=p.size==='sm',ic=p.icon||'',logo=cur?.logo,label=p.label||'Select';
  return html`<div ref=${el=>this.root=el} onKeyDown=${e=>this.onKey(e)} style=${`position:relative;width:${p.width||'auto'};min-width:${p.minWidth||'160px'}`}>
   ${p.label&&!p.hideLabel?html`<span style="display:block;font-size:12px;font-weight:600;color:#3d4d45;margin-bottom:5px">${p.label}</span>`:null}
   <button type="button" ref=${el=>this.btn=el} onClick=${()=>open?this.setState({open:false}):this.openList()} aria-haspopup="listbox" aria-expanded=${open} aria-label=${`${label}: ${cur?cur.label:(p.placeholder||'')}`} class="hv-border" style=${`display:flex;align-items:center;gap:9px;width:100%;background:${open?'#fafcf7':'#fff'};border:1px solid ${open?'#315e4e':'#cdd6ca'};border-radius:10px;padding:0 10px 0 12px;min-height:${sm?'36px':'42px'};font-size:14px;color:#183c35;cursor:pointer;text-align:left;box-shadow:${open?'0 0 0 3px #d1e5a799':'none'};transition:border-color .15s,box-shadow .15s`}>
    ${logo?html`<${BankLogo} institution=${cur.value} size=${18} radius=${4}/>`:ic?html`<${FieldIcon} id=${ic}/>`:null}
    <span style=${`flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:${cur?600:400}`}>${cur?cur.label:(p.placeholder||'Select')}</span>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#183c35" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style=${`flex:none;opacity:.7;transform:rotate(${open?'180deg':'0deg'});transition:transform .15s`}><path d="m6 9 6 6 6-6"></path></svg>
   </button>
   ${open?html`<div role="listbox" aria-label=${label} style=${`position:absolute;top:calc(100% + 6px);${p.align==='right'?'right':'left'}:0;min-width:100%;width:max-content;max-width:320px;max-height:320px;overflow:auto;background:#fff;border:1px solid #dfe5db;border-radius:12px;box-shadow:0 14px 36px #183c3529;padding:6px;z-index:60;display:grid;gap:2px`}>
    ${opts.map(o=>{const sel=!!(cur&&o.value===cur.value);return html`<button type="button" role="option" aria-selected=${sel} data-opt="1" onClick=${()=>this.pick(o.value)} class="hv-opt" style=${`display:flex;align-items:center;gap:10px;width:100%;border:0;background:${sel?'#eef3e8':'transparent'};padding:9px 10px;border-radius:8px;text-align:left;font-size:14px;font-weight:${sel?600:500};color:#183c35;cursor:pointer;white-space:nowrap`}>${o.logo?html`<${BankLogo} institution=${o.value} size=${18} radius=${4}/>`:null}<span style="flex:1">${o.label}</span><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#315e4e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style=${`flex:none;opacity:${sel?1:0}`}><path d="M20 6 9 17l-5-5"></path></svg></button>`;})}
   </div>`:null}
  </div>`;
 }
}

export const shortcuts=[
 ['paint','Brush','B','KeyB'],['erase','Eraser','E','KeyE'],['block','Rectangle','R','KeyR'],['select','Select / move','V','KeyV'],['pan','Hand / pan','H','KeyH'],['collision','Collision brush','C','KeyC'],['spawn','Place Max','M','KeyM'],['ladder','Add ladder','L','KeyL'],
 ['walkable','Walkable mask','1','Digit1'],['background','Background mask','2','Digit2'],['decoration','Decoration mask','3','Digit3'],['smaller','Smaller brush','[','BracketLeft'],['larger','Larger brush',']','BracketRight'],['pressure','Pen pressure','P','KeyP'],['eraseScope','Eraser: layer / all','Shift+E','KeyE','shift'],
 ['undo','Undo','Ctrl+Z','KeyZ','ctrl'],['redo','Redo','Ctrl+Shift+Z','KeyZ','ctrl','shift'],['redo','Redo','Ctrl+Y','KeyY','ctrl'],['save','Save project file','Ctrl+S','KeyS','ctrl'],['open','Open project file','Ctrl+O','KeyO','ctrl'],['export','Export ZIP','Ctrl+Shift+S','KeyS','ctrl','shift'],['import','Import images','Ctrl+I','KeyI','ctrl'],['duplicate','Duplicate piece','Ctrl+D','KeyD','ctrl'],['delete','Delete selected piece','Delete','Delete'],['delete','Delete selected piece','Backspace','Backspace'],
 ['fit','Fit level','F','KeyF'],['zoomIn','Zoom in','+','Equal'],['zoomOut','Zoom out','−','Minus'],['actualSize','Native size','0','Digit0'],['grid','Cycle grid size','G','KeyG'],['pixels','Toggle pixel view','Shift+G','KeyG','shift'],['workspace','Level / Assets','Tab','Tab'],['generate','Generate artwork in ChatGPT','Ctrl+Enter','Enter','ctrl'],['applyArtwork','Import generated artwork','Ctrl+Shift+Enter','Enter','ctrl','shift'],['commands','Commands and shortcuts','Ctrl+K','KeyK','ctrl'],['commands','Commands and shortcuts','?','Slash','shift'],['play','Play / stop','Enter','Enter'],['escape','Cancel / select','Esc','Escape']
];

export function resolveShortcut(event){
 if(event.isComposing||event.repeat)return null;
 const typing=event.target?.closest?.('input:not([type="range"]):not([type="checkbox"]),textarea,select,[contenteditable="true"]');
 if(typing)return null;
 const ctrl=!!(event.ctrlKey||event.metaKey);
 if(!event.metaKey&&(!ctrl||event.altKey)&&event.key==='[')return'smaller';
 if(!event.metaKey&&(!ctrl||event.altKey)&&event.key===']')return'larger';
 if(!ctrl&&!event.altKey&&event.key==='?')return'commands';
 if(!ctrl&&!event.altKey&&event.key==='+')return'zoomIn';
 if(!ctrl&&!event.altKey&&event.key==='-')return'zoomOut';
 if(!ctrl&&!event.altKey&&['Equal','NumpadAdd'].includes(event.code))return'zoomIn';
 if(!ctrl&&!event.altKey&&event.code==='NumpadSubtract')return'zoomOut';
 const match=shortcuts.find(([, , ,code,...mods])=>code===event.code&&mods.includes('ctrl')===ctrl&&mods.includes('shift')===!!event.shiftKey&&!event.altKey);
 return match?.[0]||null;
}

export function installCommandPalette(dialog,{perform,context=()=>true}={}){
 const search=document.getElementById('command-search'),list=document.getElementById('command-list');let entries=[],index=0;
 function run(entry){dialog.close();entry.run();}
 function render(){
  const query=search.value.trim().toLowerCase();entries=[];
  for(const [id,label,key] of shortcuts){if(entries.some(e=>e.id===id)||!context(id)||query&&!`${label} ${key}`.toLowerCase().includes(query))continue;entries.push({id,label,key,run:()=>perform(id)});}
  for(const button of document.querySelectorAll('button')){
   if(button.closest('#commands-dialog')||button.disabled||button.hidden||button.id==='commands-button'||button.id==='shortcuts-button'||button.id.startsWith('close-'))continue;
   const label=button.getAttribute('aria-label')||button.title||String(button.textContent||'').trim();if(!label||query&&!label.toLowerCase().includes(query)||entries.some(e=>e.label.toLowerCase()===label.toLowerCase()))continue;
   entries.push({id:button.id||button.dataset.tool,label,key:'',run:()=>button.click()});
  }
  index=Math.min(index,Math.max(0,entries.length-1));list.replaceChildren();
  entries.forEach((entry,i)=>{const button=document.createElement('button'),label=document.createElement('span'),key=document.createElement('kbd');button.type='button';label.textContent=entry.label;key.textContent=entry.key.replaceAll('Ctrl',navigator.platform?.includes('Mac')?'⌘':'Ctrl');button.append(label,key);button.setAttribute('aria-selected',String(i===index));button.onclick=()=>run(entry);list.append(button);});
 }
 search.oninput=()=>{index=0;render()};
 dialog.addEventListener('keydown',e=>{if(e.code==='ArrowDown'||e.code==='ArrowUp'){e.preventDefault();index=(index+(e.code==='ArrowDown'?1:-1)+entries.length)%Math.max(1,entries.length);render();list.children[index]?.scrollIntoView({block:'nearest'});}else if(e.code==='Enter'){e.preventDefault();if(entries[index])run(entries[index]);}});
 document.getElementById('close-commands').onclick=()=>dialog.close();
 return()=>{search.value='';index=0;render();dialog.showModal();search.focus();};
}

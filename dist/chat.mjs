export function installChat(api){
 const $=id=>document.querySelector('#'+id),panel=$('chat-panel'),messages=$('chat-messages'),prompt=$('chat-prompt'),send=$('chat-send'),status=$('chat-status');
 let busy=false,enabled=false,opened=false;
 function note(text){status.textContent=text;status.hidden=!text}
 function add(role,text){const p=document.createElement('p');p.className='chat-message '+role;p.textContent=text;messages.append(p);messages.scrollTop=messages.scrollHeight}
 async function open(){panel.hidden=false;$('chat-button').setAttribute('aria-pressed','true');if(opened)return;opened=true;send.disabled=true;
  try{const r=await fetch('/api/chat/status');if(!r.ok)throw Error('Chat is unavailable.');enabled=(await r.json()).enabled;note(enabled?'':'Chat needs an OpenAI connection.');if(enabled){const history=await api.history();for(const m of history)add(m.role,m.content)}}catch(error){note(error.message);opened=false}finally{send.disabled=!enabled}
 }
 function close(){panel.hidden=true;$('chat-button').setAttribute('aria-pressed','false')}
 $('chat-button').onclick=()=>panel.hidden?void open():close();$('close-chat').onclick=close;
 $('chat-form').onsubmit=async e=>{e.preventDefault();const message=prompt.value.trim();if(busy||!enabled||!message)return;busy=true;send.disabled=true;prompt.disabled=true;note('Thinking…');
  try{const result=await api.send(message);add('user',message);add('assistant',result.reply);prompt.value='';note('')}
  catch(error){note(error.message)}finally{busy=false;send.disabled=!enabled;prompt.disabled=false}
 };
 return{close};
}

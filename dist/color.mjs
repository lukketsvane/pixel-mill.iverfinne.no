export function hsbToHex(hue,saturation,brightness){
 const h=((Number(hue)%360)+360)%360,s=Math.max(0,Math.min(100,Number(saturation)))/100,v=Math.max(0,Math.min(100,Number(brightness)))/100;
 const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
 const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+[r,g,b].map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
export const validBlockColor=color=>typeof color==='string'&&/^#[0-9a-fA-F]{6}$/.test(color);

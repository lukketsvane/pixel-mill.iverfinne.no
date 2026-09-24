// Rasterize at one world pixel per buffer pixel before applying the camera.
// Bounded tiles keep a zoomed-out level from allocating a giant canvas.
export function* pixelTiles(view,size=1024){const left=Math.floor(view.x),top=Math.floor(view.y),right=Math.ceil(view.x+view.w),bottom=Math.ceil(view.y+view.h);for(let y=top;y<bottom;y+=size)for(let x=left;x<right;x+=size)yield{x,y,w:Math.min(size,right-x),h:Math.min(size,bottom-y)}}
export function paintPixelLayer(target,buffer,view,draw){
 const context=buffer.getContext('2d');target.imageSmoothingEnabled=false;
 for(const tile of pixelTiles(view)){
  if(buffer.width!==tile.w)buffer.width=tile.w;if(buffer.height!==tile.h)buffer.height=tile.h;
  context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,tile.w,tile.h);context.imageSmoothingEnabled=false;context.translate(-tile.x,-tile.y);
  draw(context,tile);target.drawImage(buffer,tile.x,tile.y);
 }
}

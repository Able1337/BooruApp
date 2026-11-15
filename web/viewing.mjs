// Keep image gestures separate from the browser's native video controls.
export function installViewerGestures(media,previous,next){
  if(media.tagName!=='IMG')return;
  const frame=media.parentElement;frame.classList.add('image-stage');
  let scale=1,x=0,y=0,startX=0,startY=0,baseX=0,baseY=0;
  let distance=0,baseScale=1,lastTap=0,lastTouchZoom=0,moved=false,pinched=false,center={x:0,y:0};
  const points=new Map();
  const draw=()=>{
    const bounds=frame.getBoundingClientRect();
    const maxX=Math.max(0,(media.offsetWidth*scale-bounds.width)/2);
    const maxY=Math.max(0,(media.offsetHeight*scale-bounds.height)/2);
    x=Math.min(maxX,Math.max(-maxX,x));y=Math.min(maxY,Math.max(-maxY,y));
    media.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
    frame.dataset.zoomed=String(scale>1);
  };
  const reset=()=>{scale=1;x=y=0;draw();};
  const zoom=()=>{scale=scale===1?2.5:1;x=y=0;draw();};
  media.draggable=false;media.tabIndex=0;
  media.setAttribute('aria-label','Изображение. Двойное нажатие — увеличить. Стрелки — соседние посты.');
  media.ondblclick=event=>{event.preventDefault();if(Date.now()-lastTouchZoom>400)zoom();};
  media.onkeydown=event=>{
    if(event.key==='+'||event.key==='='){event.preventDefault();scale=Math.min(5,scale+.5);draw();}
    if(event.key==='-'||event.key==='0'){event.preventDefault();reset();}
  };
  media.onpointerdown=event=>{
    if(event.button>0)return;
    try{media.setPointerCapture?.(event.pointerId);}catch{}
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    startX=event.clientX;startY=event.clientY;baseX=x;baseY=y;moved=false;
    if(points.size===2){
      pinched=true;lastTap=0;const[a,b]=[...points.values()];
      distance=Math.hypot(a.x-b.x,a.y-b.y);baseScale=scale;
      center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    }
  };
  media.onpointermove=event=>{
    if(!points.has(event.pointerId))return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const dx=event.clientX-startX,dy=event.clientY-startY;
    if(Math.abs(dx)+Math.abs(dy)>8)moved=true;
    if(points.size===2){
      const[a,b]=[...points.values()],bounds=frame.getBoundingClientRect();
      scale=Math.max(1,Math.min(5,baseScale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,distance)));
      const ratio=scale/baseScale;
      x=baseX*ratio+(center.x-bounds.left-bounds.width/2)*(1-ratio)+(a.x+b.x)/2-center.x;
      y=baseY*ratio+(center.y-bounds.top-bounds.height/2)*(1-ratio)+(a.y+b.y)/2-center.y;
      draw();
    }else if(scale>1){x=baseX+dx;y=baseY+dy;draw();}
  };
  media.onpointerup=event=>{
    points.delete(event.pointerId);
    if(points.size){const remaining=[...points.values()][0];startX=remaining.x;startY=remaining.y;baseX=x;baseY=y;return;}
    if(!pinched&&scale===1&&moved){
      const dx=event.clientX-startX,dy=event.clientY-startY;
      if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.4){if(dx>0)previous();else next();}
    }else if(!pinched&&!moved&&event.pointerType==='touch'){
      const now=Date.now();if(now-lastTap<300){zoom();lastTouchZoom=now;lastTap=0;}else lastTap=now;
    }
    if(moved)lastTap=0;pinched=false;
  };
  media.onpointercancel=()=>{points.clear();pinched=false;lastTap=0;};
}

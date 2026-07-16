// OpticalMeasure V3 — 5-view SPA
var currentCust=null,pdCorr=1.0;

// ====== View switching ======
function showView(id){
  document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});
  document.getElementById(id).classList.add('active')
}

// ====== Home ======
async function homeSearch(){
  var q=document.getElementById('homeSearch').value.trim();
  var d=document.getElementById('homeSearchResult');
  if(!q){d.style.display='none';currentCust=null;return}
  try{
    var r=await fetch('/api/customers?q='+encodeURIComponent(q));var cs=await r.json();
    var h='';for(var i=0;i<cs.length;i++){var c=cs[i];
      h+='<div class=item onclick="homeSelect(\''+c.id+'\',\''+c.name.replace(/'/g,"\\'")+'\')"><span class=name>'+c.name+'</span><span class=phone>'+c.phone+'</span> <span style="color:#f0ad4e;float:right">'+c.records+'次</span></div>'}
    if(!h)h='<div id=homeNewForm style="padding:6px 10px"><input id=hnName style="width:100%;padding:4px 8px;background:#0d1117;border:1px solid #30363d;color:#ccc;border-radius:3px;margin-bottom:4px;font-size:12px" value="'+q+'"><input id=hnPhone placeholder="电话(可选)" style="width:100%;padding:4px 8px;background:#0d1117;border:1px solid #30363d;color:#ccc;border-radius:3px;margin-bottom:4px;font-size:12px"><div style="display:flex;gap:6px"><button onclick="homeNewConfirm()" style="background:#3fb950;color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px;flex:1">确认</button><button onclick="homeNewCancel()" style="background:#c0392b;color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px;flex:1">取消</button></div></div>';
    d.innerHTML=h;d.style.display='block'
  }catch(e){}
}
function homeSelect(id,name){currentCust={id:id,name:name};document.getElementById('homeSearch').value=name;document.getElementById('homeSearchResult').style.display='none'}
async function homeNewConfirm(){
  var name=document.getElementById('hnName').value.trim();if(!name)return;
  var phone=(document.getElementById('hnPhone').value||'').trim();
  var r=await fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,phone:phone})});var c=await r.json();
  if(c.error){alert(c.error);return}homeSelect(c.id,c.name)
}
function homeNewCancel(){document.getElementById('homeSearchResult').style.display='none'}
function homeStart(){
  frontOk=0;sideOk=0;capPhase='live';
  frontPts=[];sidePts=[];frontStep=0;sideStep=0;annMode='f';
  if(!document.getElementById('homeSearch').value.trim())currentCust=null;
  showView('cap');
  var ct=document.getElementById('capTitle');if(ct)ct.textContent='拍摄正面';
  document.getElementById('btnShoot').style.display='inline-block';
  document.getElementById('btnRetake').style.display='none';
  document.getElementById('capBack').style.display='none';
  document.getElementById('capSkip').style.display='none';
  document.getElementById('capNext').style.display='none';
  document.getElementById('capCanvas').style.display='none';
  startPreview()
}
async function homeHistory(){
  if(!currentCust){alert('请先在首页搜索选择客户');return}
  showView('hist');histLoad(currentCust.id,currentCust.name)
}

// ====== Capture ======
var captureStream=null,capPhase='live',frontOk=0,sideOk=0;
var capPreviewReady=0;

var isTouchDevice=navigator.maxTouchPoints>0;

var streamTimer=null;

async function startPreview(){
  stopPreview();
  if(isTouchDevice){
    await fetch('/api/stream/start');
    document.getElementById('prevCenter').style.display='block';
    document.getElementById('capCanvas').style.display='none';
    document.getElementById('previewVid').style.display='none';
    capPreviewReady=1;
    streamTimer=setInterval(function(){
      document.getElementById('prevCenter').src='/api/stream/center_frame?t='+Date.now();
    },40);
    document.getElementById('btnShoot').style.display='inline-block';
    document.getElementById('btnRetake').style.display='none';
    return
  }
  // Desktop: getUserMedia for single camera preview
  try{
    var stream=null;
    try{
      // Try matching camera index from config (works on PC)
      var cfg=await (await fetch('/api/get_cams')).json();
      var devs=(await navigator.mediaDevices.enumerateDevices()).filter(function(d){return d.kind==='videoinput'});
      if(devs.length>0){
        var bm={0:0,1:1,2:2};
        try{bm=(await(await fetch('/api/br_map')).json())||bm}catch(e){}
        var dsIdx=cfg.center||0;
        var idx=Math.min(bm[dsIdx]!==undefined?bm[dsIdx]:dsIdx, devs.length-1);
        try{stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:devs[idx].deviceId},width:{ideal:1920},height:{ideal:1080}}})}catch(e){}
      }
    }catch(e){}
    // Fallback: any available camera (iPad / mobile)
    if(!stream){
      try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080}}})}catch(e){
        try{stream=await navigator.mediaDevices.getUserMedia({video:true})}catch(e2){}
      }
    }
    captureStream=stream;
    var v=document.getElementById('previewVid');v.srcObject=stream;v.style.display='block';
    v.onloadedmetadata=function(){v.play();capPreviewReady=1};
    document.getElementById('capCanvas').style.display='none';
    document.getElementById('btnShoot').style.display='inline-block';
    document.getElementById('btnRetake').style.display='none'
  }catch(e){alert('Preview error: '+e.message);stopPreview()}
}
function stopPreview(){
  capPreviewReady=0;
  if(streamTimer){clearInterval(streamTimer);streamTimer=null}
  if(isTouchDevice){
    document.getElementById('prevCenter').style.display='none';
    fetch('/api/stream/stop',{method:'GET'}).catch(function(){});
    return
  }
  if(captureStream){captureStream.getTracks().forEach(function(t){t.stop()});captureStream=null}
  var v=document.getElementById('previewVid');
  if(v){v.srcObject=null;v.style.display='none'}
}
async function capShoot(){
  if(!capPreviewReady){alert('Preview not ready');return}
  // Freeze current preview frame on canvas while capturing
  var cv2=document.getElementById('capCanvas'),ctx2=cv2.getContext('2d');
  var v2=document.getElementById('previewVid');
  cv2.style.display='block';cv2.width=v2.videoWidth||1920;cv2.height=v2.videoHeight||1080;
  ctx2.drawImage(v2,0,0,cv2.width,cv2.height);
  ctx2.font='28px sans-serif';ctx2.fillStyle='rgba(255,255,255,.5)';ctx2.textAlign='center';
  ctx2.fillText('拍摄中...',cv2.width/2,cv2.height/2);
  stopPreview();
  await new Promise(function(r){setTimeout(r,1000)});
  var mode=capPhase==='live'?'/api/capture':'/api/capture_side';
  try{
    var r=await fetch(mode,{method:'POST'});var d=await r.json();
    if(d.error){alert(d.error);startPreview();return}
    var img=new Image();
    img.onload=function(){
      var cv=document.getElementById('capCanvas'),ctx=cv.getContext('2d');
      cv.width=img.width;cv.height=img.height;ctx.drawImage(img,0,0);
    };
    img.src=(capPhase==='live'?'/api/image/center':'/api/image_side/center')+'?t='+Date.now();
    document.getElementById('btnShoot').style.display='none';
    document.getElementById('btnRetake').style.display='inline-block';
    if(capPhase==='live'){frontOk=1;document.getElementById('capSkip').style.display='inline-block'}
    document.getElementById('capNext').style.display='inline-block'
  }catch(e){alert('拍照失败: '+e.message);startPreview()}
}
function capRetake(){
  document.getElementById('capCanvas').style.display='none';
  document.getElementById('btnRetake').style.display='none';
  document.getElementById('capNext').style.display='none';
  if(capPhase==='live')document.getElementById('capSkip').style.display='none';
  startPreview()
}
function capNext(){
  stopPreview();document.getElementById('capCanvas').style.display='none';
  document.getElementById('btnShoot').style.display='none';document.getElementById('btnRetake').style.display='none';document.getElementById('capNext').style.display='none';
  if(capPhase==='live'){
    capPhase='side';var ct2=document.getElementById('capTitle');if(ct2)ct2.textContent='拍摄侧面';
    document.getElementById('capNext').textContent='完成';
    document.getElementById('capBack').style.display='inline-block';
    startPreview()
  }else{
    sideOk=1;showView('annot');initAnnot('f')
  }
}
function capSkip(){
  stopPreview();capPhase='side';sideOk=0;
  document.getElementById('capCanvas').style.display='none';
  showView('annot');initAnnot('f')
}
function capBack(){
  stopPreview();capPhase='live';
  var ct3=document.getElementById('capTitle');if(ct3)ct3.textContent='拍摄正面';
  document.getElementById('capNext').textContent='继续拍摄侧面';
  document.getElementById('capBack').style.display='none';
  document.getElementById('capSkip').style.display=frontOk?'inline-block':'none';
  document.getElementById('capNext').style.display=frontOk?'inline-block':'none';
  document.getElementById('capCanvas').style.display='none';
  startPreview()
}

// ====== Annotation ======
var annMode='f',frontPts=[],sidePts=[],frontStep=0,sideStep=0;
var annImg=new Image(),annScale=1,annOx=0,annOy=0;
var annW=0,annH=0,dpr=window.devicePixelRatio||1;
var annDragFrame=0,annDragStart=null,annDragEye=null;
var annPanning=0,annPanStart=[0,0],annPanOrig=[0,0],annSpace=0;
var mgDiv=document.getElementById('mg'),mgCvs=document.getElementById('mgc'),mgCtx=mgCvs.getContext('2d'),showMg=0;
var annDragPt=null; // drag existing point

function initAnnot(mode){
  annMode=mode;annPanning=0;annDragFrame=0;annDragPt=null;annScale=0;annOx=0;annOy=0;
  var src=mode==='f'?'/api/image/center?t='+Date.now():'/api/image_side/center?t='+Date.now();
  annImg=new Image();
  annImg.onload=function(){annW=annImg.width;annH=annImg.height;fitAnnot();drawAnnot()};
  annImg.src=src;updateTopbar()
}
function fitAnnot(){
  var body=document.querySelector('.annot-body'),r=body.getBoundingClientRect();
  var cw=r.width,ch=r.height;
  annScale=cw*.90/annW;annScale=Math.max(.1,Math.min(5,annScale));
  annOx=(annW-cw/annScale)/2;annOy=(annH-ch/annScale)/2;
  var wrap=document.querySelector('.annot-canvas-wrap');
  wrap.style.width=cw+'px';wrap.style.height=ch+'px';
  var cv=document.getElementById('annotCanvas');cv.width=cw*dpr;cv.height=ch*dpr;cv.style.width=cw+'px';cv.style.height=ch+'px'
}
function updateTopbar(){
  var skip=document.getElementById('annotSkip'),back=document.getElementById('annotBack'),
      next=document.getElementById('annotNext'),done=document.getElementById('annotDone');
  skip.style.display='none';back.style.display='none';next.style.display='none';done.style.display='none';
  if(annMode==='f'){
    if(frontStep>=2&&frontStep<4)next.style.display='inline-block',next.disabled=false,next.style.opacity='1';
    else if(frontStep<2)next.style.display='inline-block',next.disabled=true,next.style.opacity='.35';
    if(frontStep>=4){if(sideOk&&sidePts.length===0)next.style.display='inline-block',next.disabled=false,next.style.opacity='1';else done.style.display='inline-block'}
    document.getElementById('annotTitle').textContent='标注正面';
    var fl=['点击右瞳孔','点击左瞳孔','拖框标注右镜框','拖框标注左镜框'];
    document.getElementById('annotHint').textContent='Step '+(frontStep+1)+'/4: '+(frontStep<4?fl[frontStep]:'标注完成')
  }else{
    back.style.display='inline-block';
    if(sideStep>=3)done.style.display='inline-block';
    document.getElementById('annotTitle').textContent='标注侧面';
    var sl=['点击镜框上缘','点击镜框下缘','点击角膜顶点'];
    document.getElementById('annotHint').textContent='Step '+(sideStep+1)+'/3: '+(sideStep<3?sl[sideStep]:'标注完成')
  }
}
function drawAnnot(){
  var cv=document.getElementById('annotCanvas'),ctx=cv.getContext('2d');
  var r=document.querySelector('.annot-body').getBoundingClientRect();
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);
  if(!annImg.width)return;
  ctx.save();
  ctx.setTransform(annScale*dpr,0,0,annScale*dpr,-annOx*annScale*dpr,-annOy*annScale*dpr);
  ctx.drawImage(annImg,0,0,annW,annH);
  var pts=annMode==='f'?frontPts:sidePts;
  function pf(id){for(var i=0;i<pts.length;i++)if(pts[i].id===id)return pts[i];return null}
  // Draw placed points
  for(var i=0;i<pts.length;i++){var p=pts[i];
    if(p.id.indexOf('pupil')>=0){
      ctx.strokeStyle='rgba(241,196,15,.3)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.cx,p.cy,56,0,6.28);ctx.stroke();
      ctx.strokeStyle='rgba(241,196,15,.5)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.cx,p.cy,38,0,6.28);ctx.stroke();
      ctx.strokeStyle='rgba(241,196,15,.8)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.cx,p.cy,22,0,6.28);ctx.stroke();
      ctx.strokeStyle='#E74C3C';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.cx-27,p.cy);ctx.lineTo(p.cx+27,p.cy);ctx.moveTo(p.cx,p.cy-27);ctx.lineTo(p.cx,p.cy+27);ctx.stroke()
    }
    if(p.id==='side_frame_top'||p.id==='side_frame_bottom'){
      ctx.fillStyle='#F39C12';ctx.beginPath();ctx.arc(p.cx,p.cy,6,0,6.28);ctx.fill()
    }
    if(p.id==='side_cornea'){
      ctx.strokeStyle='#2ECC71';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.cx,p.cy,22,0,6.28);ctx.stroke()
    }
  }
  // Frame boxes (only for front)
  if(annMode==='f'){
    for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t=pf(eye+'_frame_top'),b=pf(eye+'_frame_bottom'),inn=pf(eye+'_frame_inner'),out=pf(eye+'_frame_outer');
      if(t&&b&&inn&&out){
        var lx=Math.min(inn.cx,out.cx),rx=Math.max(inn.cx,out.cx);
        ctx.strokeStyle='#4A90D9';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.strokeRect(lx,t.cy,rx-lx,b.cy-t.cy);ctx.setLineDash([]);
        ctx.fillStyle='rgba(74,144,217,.05)';ctx.fillRect(lx,t.cy,rx-lx,b.cy-t.cy);
        var hs=8/annScale;ctx.fillStyle='#fff';ctx.strokeStyle='#4A90D9';ctx.lineWidth=1;ctx.setLineDash([]);
        var midX=(inn.cx+out.cx)/2,midY=(t.cy+b.cy)/2;
        ctx.fillRect(midX-hs/2,t.cy-hs/2,hs,hs);ctx.strokeRect(midX-hs/2,t.cy-hs/2,hs,hs);
        ctx.fillRect(midX-hs/2,b.cy-hs/2,hs,hs);ctx.strokeRect(midX-hs/2,b.cy-hs/2,hs,hs);
        ctx.fillRect(inn.cx-hs/2,midY-hs/2,hs,hs);ctx.strokeRect(inn.cx-hs/2,midY-hs/2,hs,hs);
        ctx.fillRect(out.cx-hs/2,midY-hs/2,hs,hs);ctx.strokeRect(out.cx-hs/2,midY-hs/2,hs,hs)
      }
    }
    // Auxiliary lines
    var rp=pf('right_pupil'),lp=pf('left_pupil'),ri=pf('right_frame_inner'),li=pf('left_frame_inner');
    // Eye level line
    if(rp&&lp){ctx.strokeStyle='#27AE60';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(rp.cx,rp.cy);ctx.lineTo(lp.cx,lp.cy);ctx.stroke();ctx.setLineDash([])}
    // Frame center line
    if(ri&&li){ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1;ctx.setLineDash([6,4]);var fcx=(ri.cx+li.cx)/2;ctx.beginPath();ctx.moveTo(fcx,0);ctx.lineTo(fcx,annImg.height);ctx.stroke();ctx.setLineDash([])}
    // Edge guide lines from frame corners
    for(var ei=0;ei<2;ei++){var eye2=ei===0?'right':'left',t2=pf(eye2+'_frame_top'),b2=pf(eye2+'_frame_bottom'),inn2=pf(eye2+'_frame_inner'),out2=pf(eye2+'_frame_outer');
      if(t2&&b2&&inn2&&out2){var lx3=Math.min(inn2.cx,out2.cx),rx3=Math.max(inn2.cx,out2.cx);
        ctx.strokeStyle='rgba(149,165,166,.4)';ctx.lineWidth=.5;ctx.setLineDash([4,6]);
        ctx.beginPath();ctx.moveTo(lx3,t2.cy);ctx.lineTo(lx3,0);ctx.stroke();ctx.beginPath();ctx.moveTo(lx3,t2.cy);ctx.lineTo(0,t2.cy);ctx.stroke();
        ctx.beginPath();ctx.moveTo(rx3,t2.cy);ctx.lineTo(rx3,0);ctx.stroke();ctx.beginPath();ctx.moveTo(rx3,t2.cy);ctx.lineTo(annImg.width,t2.cy);ctx.stroke();
        ctx.beginPath();ctx.moveTo(lx3,b2.cy);ctx.lineTo(lx3,annImg.height);ctx.stroke();ctx.beginPath();ctx.moveTo(lx3,b2.cy);ctx.lineTo(0,b2.cy);ctx.stroke();
        ctx.beginPath();ctx.moveTo(rx3,b2.cy);ctx.lineTo(rx3,annImg.height);ctx.stroke();ctx.beginPath();ctx.moveTo(rx3,b2.cy);ctx.lineTo(annImg.width,b2.cy);ctx.stroke();
        ctx.setLineDash([])}
    }
  }
  // Side line
  if(annMode==='s'){var st=pf('side_frame_top'),sb=pf('side_frame_bottom');if(st&&sb){ctx.strokeStyle='#F39C12';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(st.cx,st.cy);ctx.lineTo(sb.cx,sb.cy);ctx.stroke()}}
  // Drag preview rectangle
  if(annDragFrame&&annDragStart){
    var e=annDragEye,tl2=annDragStart.x,tt2=annDragStart.y,br2=Math.max(tl2,annDragEnd?annDragEnd.x:tl2),bb2=Math.max(tt2,annDragEnd?annDragEnd.y:tt2);
    ctx.strokeStyle='#0f0';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.strokeRect(tl2,tt2,br2-tl2,bb2-tt2);ctx.setLineDash([])
  }
  ctx.restore()
}
function annXY(e){
  var c=document.getElementById('annotCanvas'),r=c.getBoundingClientRect();
  return{x:(e.clientX-r.left)/annScale+annOx, y:(e.clientY-r.top)/annScale+annOy}
}
function annP2S(px,py){
  var r=document.getElementById('annotCanvas').getBoundingClientRect();
  return{x:(px-annOx)*annScale+r.left, y:(py-annOy)*annScale+r.top}
}

var annDragEnd=null;
document.getElementById('annotCanvas').addEventListener('pointerdown',function(e){
  e.preventDefault();
  e.target.setPointerCapture(e.pointerId);
  // On touch device: finger=pans, only Pencil annotates
  if(isTouchDevice&&e.pointerType!=='pen'){
    if(e.button===0){annPanning=1;annPanStart=[e.clientX,e.clientY];annPanOrig=[annOx,annOy];e.target.style.cursor='grabbing';return}
    return
  }
  // Pencil mode: always annotate, never pan
  if(e.pointerType==='pen'&&e.button===0){annPanning=0}
  if(e.button===1||(e.button===0&&annSpace)){
    annPanning=1;annPanStart=[e.clientX,e.clientY];annPanOrig=[annOx,annOy];e.target.style.cursor='grabbing';return
  }
  if(e.button!==0)return;
  // Always check existing point drag first (allow adjustment at any time)
  var p=annXY(e);var pts=annMode==='f'?frontPts:sidePts;
  var best=null,bestD=25;for(var i=0;i<pts.length;i++){var pt=pts[i];var d=Math.sqrt((p.x-pt.cx)*(p.x-pt.cx)+(p.y-pt.cy)*(p.y-pt.cy));if(d<bestD){bestD=d;best=pt}}
  if(best){annDragPt={id:best.id,ox:p.x-best.cx,oy:p.y-best.cy};e.target.style.cursor='move';showAnnMagnifier(p.x,p.y);return}
  // Check frame handle hit
  if(annMode==='f'){var h=hitFrameHandle(p.x,p.y);if(h){annDragPt={id:h.id,ox:p.x-h.x,oy:p.y-h.y};showAnnMagnifier(p.x,p.y);return}}
  // New annotation
  var mx=annMode==='f'?4:3;var step=annMode==='f'?frontStep:sideStep;
  if(step>=mx)return;
  if(annMode==='f'&&step>=2){
    annDragFrame=1;annDragStart={x:p.x,y:p.y};annDragEye=step===2?'right':'left';annDragEnd={x:p.x,y:p.y}
  }else{
    var id;if(annMode==='f')id=step===0?'right_pupil':'left_pupil';else id=['side_frame_top','side_frame_bottom','side_cornea'][step];
    (annMode==='f'?frontPts:sidePts).push({id:id,cx:Math.round(p.x),cy:Math.round(p.y)});
    if(annMode==='f'){frontStep++;frontPts=frontPts.slice()}else{sideStep++;sidePts=sidePts.slice()}
    updateTopbar();drawAnnot()
  }
});
document.getElementById('annotCanvas').addEventListener('pointermove',function(e){
  e.preventDefault();
  if(annPanning===1){annOx=annPanOrig[0]-(e.clientX-annPanStart[0])/annScale;annOy=annPanOrig[1]-(e.clientY-annPanStart[1])/annScale;drawAnnot();return}
  if(annDragPt){
    var p=annXY(e),id=annDragPt.id;
    showAnnMagnifier(p.x,p.y);
    if(annMode==='f'){
      if(id.indexOf('frame_')>=0){moveFramePt(id,p.x,p.y)}
      else{var pt=ptfAnnot(id);if(pt){pt.cx=Math.round(p.x);pt.cy=Math.round(p.y)}}
    }else{var pt2=ptfAnnot(id);if(pt2){pt2.cx=Math.round(p.x);pt2.cy=Math.round(p.y)}}
    drawAnnot();return
  }
  if(annDragFrame){annDragEnd=annXY(e);drawAnnot();return}
});
function showAnnMagnifier(px,py){
  var s=annP2S(px,py);
  var sz=160;var l=s.x-sz-30,t=s.y-sz-30;
  if(l<0)l=s.x+30;if(t<0)t=s.y+30;if(l+180>window.innerWidth)l=s.x-180-sz;if(t+180>window.innerHeight)t=s.y-180-sz;
  mgDiv.style.left=Math.max(0,l)+'px';mgDiv.style.top=Math.max(0,t)+'px';mgDiv.style.display='block';
  mgDiv.style.width='180px';mgDiv.style.height='180px';
  mgCtx.clearRect(0,0,300,300);mgCtx.save();mgCtx.beginPath();mgCtx.arc(150,150,150,0,6.28);mgCtx.clip();
  var mz=2.5,ss=300/mz;mgCtx.drawImage(annImg,px-ss/2,py-ss/2,ss,ss,0,0,300,300);
  mgCtx.strokeStyle='rgba(255,0,0,.5)';mgCtx.lineWidth=1;mgCtx.setLineDash([4,4]);
  mgCtx.beginPath();mgCtx.moveTo(150,0);mgCtx.lineTo(150,300);mgCtx.moveTo(0,150);mgCtx.lineTo(300,150);mgCtx.stroke();mgCtx.setLineDash([]);
  mgCtx.restore()
}
document.addEventListener('pointerup',function(e){
  if(annPanning===1){annPanning=0;e.target.style.cursor=annSpace?'grab':'crosshair';return}
  if(annDragPt){annDragPt=null;mgDiv.style.display='none';showMg=0;drawAnnot();return}
  if(!annDragFrame)return;
  var p=annDragEnd||annXY(e);var eye=annDragEye;
  var tl=Math.min(annDragStart.x,p.x),tt=Math.min(annDragStart.y,p.y);
  var br=Math.max(annDragStart.x,p.x),bb=Math.max(annDragStart.y,p.y);
  var mx=(tl+br)/2,my=(tt+bb)/2,nx=eye==='right'?br:tl,ox2=eye==='right'?tl:br;
  var pts=annMode==='f'?frontPts:sidePts;
  function setP(id,x,y){var pp=ptfAnnot(id);if(pp){pp.cx=x;pp.cy=y}else{pts.push({id:id,cx:x,cy:y})}}
  setP(eye+'_frame_top',mx,tt);setP(eye+'_frame_bottom',mx,bb);setP(eye+'_frame_inner',nx,my);setP(eye+'_frame_outer',ox2,my);
  frontStep++;frontPts=pts.slice();annDragFrame=0;annDragEnd=null;updateTopbar();drawAnnot()
});
document.getElementById('annotCanvas').addEventListener('wheel',function(e){
  e.preventDefault();var r=document.getElementById('annotCanvas').getBoundingClientRect();
  var sx=e.clientX-r.left,sy=e.clientY-r.top;
  var ps=annXY(e),zs=annScale;
  annScale*=e.deltaY<0?1.09:1/1.09;annScale=Math.max(.1,Math.min(5,annScale));
  annOx=ps.x-sx/annScale;annOy=ps.y-sy/annScale;
  drawAnnot()
},{passive:false});
document.addEventListener('keydown',function(e){
  if(document.activeElement.tagName==='INPUT')return;
  if(e.ctrlKey&&e.code==='KeyZ'){e.preventDefault();annotUndo()}
  if(e.code==='Space'){e.preventDefault();annSpace=1;var c=document.getElementById('annotCanvas');c.style.cursor='grab'}
});
document.addEventListener('keyup',function(e){if(e.code==='Space'){annSpace=0;var c=document.getElementById('annotCanvas');c.style.cursor='crosshair'}});

document.getElementById('annotCanvas').addEventListener('pointerleave',function(){mgDiv.style.display='none';showMg=0});

// === Touch pinch-to-zoom ===
var annTouchDist=0,annTouchCenter=[0,0],annTouchScale=1,annTouchOx=0,annTouchOy=0;
document.getElementById('annotCanvas').addEventListener('touchstart',function(e){
  if(e.touches.length===2){
    e.preventDefault();annDragPt=null;annDragFrame=0;mgDiv.style.display='none';showMg=0;
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    annTouchDist=Math.sqrt(dx*dx+dy*dy);
    annTouchCenter=[(e.touches[0].clientX+e.touches[1].clientX)/2,(e.touches[0].clientY+e.touches[1].clientY)/2];
    annTouchScale=annScale;annTouchOx=annOx;annTouchOy=annOy
  }
},{passive:false});
document.getElementById('annotCanvas').addEventListener('touchmove',function(e){
  if(e.touches.length===2){
    e.preventDefault();
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    var d=Math.sqrt(dx*dx+dy*dy);if(annTouchDist<1)return;
    var s=annTouchScale*(d/annTouchDist);
    var r=document.getElementById('annotCanvas').getBoundingClientRect();
    var cx=(annTouchCenter[0]-r.left)/annTouchScale+annTouchOx;
    var cy=(annTouchCenter[1]-r.top)/annTouchScale+annTouchOy;
    annScale=s;annOx=cx-annTouchCenter[0]/annScale+r.left/annScale;annOy=cy-annTouchCenter[1]/annScale+r.top/annScale;
    drawAnnot()
  }
},{passive:false});
document.getElementById('annotCanvas').addEventListener('touchend',function(){annTouchDist=0});

function hitFrameHandle(px,py){
  var pts=annMode==='f'?frontPts:sidePts;var hs=12/annScale;
  for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t=ptfAnnot(eye+'_frame_top'),b=ptfAnnot(eye+'_frame_bottom'),inn=ptfAnnot(eye+'_frame_inner'),out=ptfAnnot(eye+'_frame_outer');
    if(!t||!b||!inn||!out)continue;
    var midX=(inn.cx+out.cx)/2,midY=(t.cy+b.cy)/2;
    var handles=[{id:eye+'_frame_top',x:midX,y:t.cy},{id:eye+'_frame_bottom',x:midX,y:b.cy},{id:eye+'_frame_inner',x:inn.cx,y:midY},{id:eye+'_frame_outer',x:out.cx,y:midY}];
    for(var i=0;i<4;i++){var h=handles[i];if(Math.abs(px-h.x)<hs&&Math.abs(py-h.y)<hs)return h}
  }return null
}
function moveFramePt(id,px,py){
  var pts=annMode==='f'?frontPts:sidePts,eye=id.split('_')[0];
  var t=ptfAnnot(eye+'_frame_top'),b=ptfAnnot(eye+'_frame_bottom'),inn=ptfAnnot(eye+'_frame_inner'),out=ptfAnnot(eye+'_frame_outer');
  if(!t||!b||!inn||!out)return;var pos=id.split('_').pop();
  if(pos==='top'||pos==='bottom'){t.cy=pos==='top'?py:t.cy;b.cy=pos==='bottom'?py:b.cy;t.cx=(inn.cx+out.cx)/2;b.cx=t.cx}
  else{inn.cx=pos==='inner'?px:inn.cx;out.cx=pos==='outer'?px:out.cx;inn.cy=(t.cy+b.cy)/2;out.cy=inn.cy}
}
function ptfAnnot(id){var pts=annMode==='f'?frontPts:sidePts;for(var i=0;i<pts.length;i++)if(pts[i].id===id)return pts[i];return null}
function annotUndo(){
  var pts=annMode==='f'?frontPts:sidePts;if(!pts.length)return;
  var last=pts[pts.length-1];
  if(last.id.indexOf('frame_')>=0){var eye=last.id.split('_')[0];for(var i=pts.length-1;i>=0;i--){if(pts[i].id.startsWith(eye+'_frame_')){pts.splice(i,1)}}}
  else pts.pop();
  if(annMode==='f'){frontStep=Math.max(0,frontStep-1);frontPts=pts.slice()}else{sideStep=Math.max(0,sideStep-1);sidePts=pts.slice()}
  updateTopbar();drawAnnot()
}
async function annotSkip(){showView('rpt');await doComputeAndReport()}
async function annotNext(){
  var btn=document.getElementById('annotNext');if(btn&&btn.disabled)return;
  if(annMode==='f'){
    if(sideOk&&sidePts.length===0){annMode='s';initAnnot('s')}
    else{showView('rpt');await doComputeAndReport()}
  }
}
async function annotDone(){
  if(annMode==='f'&&sideOk&&sidePts.length===0){annMode='s';frontStep=frontPts.length;initAnnot('s')}
  else{showView('rpt');await doComputeAndReport()}
}
function annotBack(){annMode='f';initAnnot('f')}

// ====== Compute + Report ======
var lastResults=null;

async function doComputeAndReport(){
  document.getElementById('rptBody').innerHTML='<div style="text-align:center;padding:40px;color:#888">计算中...</div>';
  var results={};
  if(frontOk&&frontPts.length>0){
    for(var i=0;i<frontPts.length;i++){var p=frontPts[i];
      try{var mr=await (await fetch('/api/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cx:p.cx,cy:p.cy})})).json();
        if(mr){p.lx=mr.left?mr.left.x:p.cx;p.ly=mr.left?mr.left.y:p.cy;p.rx=mr.right?mr.right.x:p.cx;p.ry=mr.right?mr.right.y:p.cy;p.p3d=mr['3d']}}catch(e){}
    }
  }
  if(sideOk&&sidePts.length>0){
    var st=ptfS('side_frame_top'),sb=ptfS('side_frame_bottom'),sc=ptfS('side_cornea');
    if(st&&sb&&sc){
      try{var sr=await (await fetch('/api/side_measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({top_x:st.cx,top_y:st.cy,bottom_x:sb.cx,bottom_y:sb.cy,cornea_x:sc.cx,cornea_y:sc.cy})})).json();
        results.tilt_angle=sr.tilt_angle;results.vertex_distance=sr.vertex_distance_mm}catch(e){}
    }
  }
  var rp=ptfF('right_pupil'),lp=ptfF('left_pupil');
  if(rp&&lp&&rp.p3d&&lp.p3d){
    var dx=lp.p3d[0]-rp.p3d[0],dy=lp.p3d[1]-rp.p3d[1];results.pd=Math.sqrt(dx*dx+dy*dy)*pdCorr;
    var ri=ptfF('right_frame_inner'),li=ptfF('left_frame_inner');
    if(ri&&li&&ri.p3d&&li.p3d){var mx=(ri.p3d[0]+li.p3d[0])/2;results.rpd=mx-rp.p3d[0];results.lpd=lp.p3d[0]-mx}
    for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',pp=ptfF(eye+'_pupil'),bb=ptfF(eye+'_frame_bottom');if(pp&&bb&&pp.p3d&&bb.p3d){if(eye==='right')results.right_ph=bb.p3d[1]-pp.p3d[1];else results.left_ph=bb.p3d[1]-pp.p3d[1]}}
    var ro=ptfF('right_frame_outer'),lo=ptfF('left_frame_outer'),rt=ptfF('right_frame_top'),rb=ptfF('right_frame_bottom'),lt=ptfF('left_frame_top'),lb=ptfF('left_frame_bottom');
    if(ri&&ro&&li&&lo&&ri.p3d&&ro.p3d&&li.p3d&&lo.p3d)results.width=(Math.abs(ro.p3d[0]-ri.p3d[0])+Math.abs(lo.p3d[0]-li.p3d[0]))/2;
    if(rt&&rb&&lt&&lb&&rt.p3d&&rb.p3d&&lt.p3d&&lb.p3d)results.height=(Math.abs(rb.p3d[1]-rt.p3d[1])+Math.abs(lb.p3d[1]-lt.p3d[1]))/2;
    if(ri&&li&&ri.p3d&&li.p3d)results.bridge=Math.abs(li.p3d[0]-ri.p3d[0])
  }
  // Build report: left column (images) + right column (data)
  var h='<div class=rpt-layout>';
  // Left column: images
  h+='<div class=rpt-col-l>';
  if(frontOk&&frontPts.length>0){
    var fi=await loadImg('/api/image/center');var fCrop='';
    if(fi){var fc=drawCrop(fi,frontPts,results,'front');if(fc.width>0)fCrop=fc.toDataURL('image/png')}
    if(fCrop)h+='<img src="'+fCrop+'">';
    else h+='<img src="/api/image/center?t='+Date.now()+'">';
  }
  if(sideOk&&sidePts.length>0){
    var si=await loadImg('/api/image_side/center');var sCrop='';
    if(si){var sc=drawCrop(si,sidePts,results,'side');if(sc.width>0)sCrop=sc.toDataURL('image/png')}
    if(sCrop)h+='<img src="'+sCrop+'">';
    else h+='<img src="/api/image_side/center?t='+Date.now()+'">';
  }
  h+='</div>';
  // Right column: measurement data
  h+='<div class=rpt-col-r>';
  h+='<h4 class=rpt-hd>中心定位参数</h4>';
  h+='<table><thead><tr><th>眼别</th><th>瞳距</th><th>瞳高</th></tr></thead><tbody>';
  h+='<tr><td>R</td><td>'+(results.rpd||0).toFixed(1)+'mm</td><td>'+(results.right_ph||0).toFixed(1)+'mm</td></tr>';
  h+='<tr><td>L</td><td>'+(results.lpd||0).toFixed(1)+'mm</td><td>'+(results.left_ph||0).toFixed(1)+'mm</td></tr>';
  h+='<tr style="border-top:2px solid #30363d"><td>总</td><td>'+(results.pd||0).toFixed(1)+'mm</td><td></td></tr>';
  h+='</tbody></table>';
  // Frame data (always visible)
  h+='<h4 class=rpt-hd style=margin-top:32px>镜架参数</h4><table><tbody>';
  h+='<tr><td>框宽</td><td>'+(results.width?results.width.toFixed(1)+'mm':'--')+'</td></tr>';
  h+='<tr><td>框高</td><td>'+(results.height?results.height.toFixed(1)+'mm':'--')+'</td></tr>';
  h+='<tr><td>中梁</td><td>'+(results.bridge?results.bridge.toFixed(1)+'mm':'--')+'</td></tr>';
  h+='<tr><td>前倾角</td><td>'+(results.tilt_angle!=null?results.tilt_angle.toFixed(1)+'°':'--')+'</td></tr>';
  h+='<tr><td>镜眼距</td><td>'+(results.vertex_distance!=null?results.vertex_distance.toFixed(1)+'mm':'--')+'</td></tr>';
  h+='</tbody></table>';
  // Suggestions
  h+='<h4 class=rpt-hd style=margin-top:32px>配镜建议</h4><ul class=rpt-sug>';
  var fw2=results.width||0;
  h+='<li>推荐镜片直径：≥ '+(Math.round(fw2+10))+' mm（框宽+余量）</li>';
  if(Math.abs((results.rpd||0)-(results.lpd||0))>1)h+='<li>左右单眼瞳距差 '+Math.abs((results.rpd||0)-(results.lpd||0)).toFixed(1)+'mm，建议加工时区分左右眼</li>';
  if(Math.abs((results.rpd||0)-(results.lpd||0))>2)h+='<li>较大单眼瞳距不对称，请确认标注准确性</li>';
  h+='</ul>';
  // Metadata
  var now=new Date();
  var rid='OM-'+now.getFullYear()+('0'+(now.getMonth()+1)).slice(-2)+('0'+now.getDate()).slice(-2)+'-'+('0'+now.getHours()).slice(-2)+('0'+now.getMinutes()).slice(-2)+('0'+now.getSeconds()).slice(-2);
  h+='<div class=rpt-bottom><div class=rpt-meta><div>测量编号：'+rid+'</div><div>测量日期：'+now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2)+'-'+('0'+now.getDate()).slice(-2)+'</div></div>';
  h+='<button class=rpt-save-btn onclick=rptSaveCust() id=rptSaveBtn2>保存到客户</button>';
  h+='</div></div></div>';
  document.getElementById('rptBody').innerHTML=h;
  lastResults=results;
  // Auto-save
  if(currentCust){
    results.front_points=frontPts.map(function(p){return{id:p.id,cx:p.cx,cy:p.cy,p3d:p.p3d||null}});
    results.side_points=sidePts.map(function(p){return{id:p.id,cx:p.cx,cy:p.cy}});
    var body={result:results};try{
      if(frontOk){var fi=await loadImg('/api/image/center');if(fi)body.front_crop=drawCrop(fi,frontPts,results,'front').toDataURL('image/png')}
      if(sideOk){var si=await loadImg('/api/image_side/center');if(si)body.side_crop=drawCrop(si,sidePts,results,'side').toDataURL('image/png')}
      await fetch('/api/customers/'+currentCust.id+'/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var sb=document.getElementById('rptSaveBtn2');if(sb)sb.style.display='none';
    }catch(e){}
  }
}
function loadImg(url){return new Promise(function(r){var i=new Image();i.crossOrigin='anonymous';i.onload=function(){r(i)};i.onerror=function(){r(null)};i.src=url+('?t='+Date.now())})}
function drawCrop(img,pts,result,mode){
  var cwC=img.width,chC=img.height,cv=document.createElement('canvas');
  if(mode==='front'){
    var rp2=ptfF('right_pupil'),lp2=ptfF('left_pupil');if(!rp2||!lp2)return cv;
    var ctrX=(rp2.cx+lp2.cx)/2,ctrY=(rp2.cy+lp2.cy)/2,ps=Math.abs(rp2.cx-lp2.cx);
    var vPadTop=ps*.4,vPadBot=ps*.6,cX=Math.max(0,ctrX-ps*1.1),cY=Math.max(0,ctrY-vPadTop);
    var cW=Math.min(cwC-cX,ps*2.2),cH=Math.min(chC-cY,vPadTop+vPadBot),s=580/cW;
    cv.width=Math.round(cW*s);cv.height=Math.round(cH*s);var rx=cv.getContext('2d');rx.drawImage(img,cX,cY,cW,cH,0,0,cv.width,cv.height);
    var xm=function(x){return(x-cX)*s},ym=function(y){return(y-cY)*s};
    for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t=ptfF(eye+'_frame_top'),b=ptfF(eye+'_frame_bottom'),inn=ptfF(eye+'_frame_inner'),out=ptfF(eye+'_frame_outer');
      if(t&&b&&inn&&out){var lx=Math.min(xm(inn.cx),xm(out.cx)),rx2=Math.max(xm(inn.cx),xm(out.cx));rx.strokeStyle='#4A90D9';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.strokeRect(lx,ym(t.cy),rx2-lx,ym(b.cy)-ym(t.cy));rx.setLineDash([])}}
    for(var i=0;i<pts.length;i++){var p=pts[i];if(p.id.indexOf('pupil')>=0){rx.strokeStyle='rgba(255,255,255,.7)';rx.lineWidth=.75;rx.setLineDash([3,4]);rx.beginPath();rx.arc(xm(p.cx),ym(p.cy),14,0,6.28);rx.stroke();rx.setLineDash([]);rx.strokeStyle='#E74C3C';rx.lineWidth=.75;rx.setLineDash([3,3]);rx.beginPath();rx.moveTo(xm(p.cx)-19,ym(p.cy));rx.lineTo(xm(p.cx)+19,ym(p.cy));rx.moveTo(xm(p.cx),ym(p.cy)-19);rx.lineTo(xm(p.cx),ym(p.cy)+19);rx.stroke();rx.setLineDash([])}}
    // Eye level line (green dash connecting pupils)
    if(rp2&&lp2){rx.strokeStyle='#27AE60';rx.lineWidth=1;rx.setLineDash([4,4]);rx.beginPath();rx.moveTo(xm(rp2.cx),ym(rp2.cy));rx.lineTo(xm(lp2.cx),ym(lp2.cy));rx.stroke();rx.setLineDash([])}
    if(rp2&&lp2&&result.pd){var midY=(ym(rp2.cy)+ym(lp2.cy))/2,aY=midY-38;rx.strokeStyle='#E74C3C';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.beginPath();rx.moveTo(xm(rp2.cx),aY);rx.lineTo(xm(lp2.cx),aY);rx.stroke();rx.setLineDash([]);rx.font='bold 13px sans-serif';rx.fillStyle='#E74C3C';rx.textAlign='center';rx.fillText('PD:'+result.pd.toFixed(1)+'mm',(xm(rp2.cx)+xm(lp2.cx))/2,aY-7)}
    // Frame center line
    var ri2=ptfF('right_frame_inner'),li2=ptfF('left_frame_inner');
    if(ri2&&li2){rx.strokeStyle='rgba(255,255,255,.4)';rx.lineWidth=.75;rx.setLineDash([6,4]);var fcx2=xm((ri2.cx+li2.cx)/2);rx.beginPath();rx.moveTo(fcx2,0);rx.lineTo(fcx2,cv.height);rx.stroke();rx.setLineDash([])}
    // PH arrows
    for(var ei=0;ei<2;ei++){var eye2=ei===0?'right':'left',pp2=ptfF(eye2+'_pupil'),bb2=ptfF(eye2+'_frame_bottom');if(pp2&&bb2&&pp2.p3d&&bb2.p3d){
      var ph2=bb2.p3d[1]-pp2.p3d[1],lx3=xm(pp2.cx)+(eye2==='right'?-25:25),tY2=ym(pp2.cy),bY2=ym(bb2.cy);
      rx.strokeStyle='#F39C12';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.beginPath();rx.moveTo(lx3,bY2);rx.lineTo(lx3,tY2);rx.stroke();rx.setLineDash([]);
      rx.fillStyle='#F39C12';rx.beginPath();rx.arc(lx3,bY2,1.5,0,6.28);rx.fill();rx.beginPath();rx.arc(lx3,tY2,1.5,0,6.28);rx.fill();
      rx.font='bold 11px sans-serif';rx.fillStyle='#F39C12';if(eye2==='right'){rx.textAlign='right';rx.fillText('PH:'+ph2.toFixed(1)+'mm',lx3-5,(tY2+bY2)/2+4)}else{rx.textAlign='left';rx.fillText('PH:'+ph2.toFixed(1)+'mm',lx3+5,(tY2+bY2)/2+4)}
    }}
  }else{
    var mrg=300,sMinX=cwC,sMaxX=0,sMinY=chC,sMaxY=0;
    var stP=ptfS('side_frame_top'),sbP=ptfS('side_frame_bottom'),scP=ptfS('side_cornea');
    if(stP){sMinX=Math.min(sMinX,stP.cx);sMaxX=Math.max(sMaxX,stP.cx);sMinY=Math.min(sMinY,stP.cy);sMaxY=Math.max(sMaxY,stP.cy)}
    if(sbP){sMinX=Math.min(sMinX,sbP.cx);sMaxX=Math.max(sMaxX,sbP.cx);sMinY=Math.min(sMinY,sbP.cy);sMaxY=Math.max(sMaxY,sbP.cy)}
    if(scP){sMinX=Math.min(sMinX,scP.cx);sMaxX=Math.max(sMaxX,scP.cx);sMinY=Math.min(sMinY,scP.cy);sMaxY=Math.max(sMaxY,scP.cy)}
    if(sMaxX===0){sMaxX=cwC;sMinX=0;sMaxY=chC;sMinY=0}
    var sCY=(sMinY+sMaxY)/2,sSpread=sMaxY-sMinY||200;
    var sRangeY=sSpread*1.5+mrg,sRangeX=sRangeY*2.2; // match front AR
    var scX=Math.max(0,(sMinX+sMaxX)/2-sRangeX/2),scY=Math.max(0,sCY-sRangeY/2);
    var scW=Math.min(cwC-scX,sRangeX),scH=Math.min(chC-scY,sRangeY);
    var sS=580/scW;cv.width=Math.round(scW*sS);cv.height=Math.round(scH*sS);
    var rx2=cv.getContext('2d');rx2.drawImage(img,scX,scY,scW,scH,0,0,cv.width,cv.height);
    function sxm(x){return(x-scX)*sS} function sym(y){return(y-scY)*sS}
    if(stP&&sbP){rx2.strokeStyle='#F39C12';rx2.lineWidth=2;rx2.beginPath();rx2.moveTo(sxm(stP.cx),sym(stP.cy));rx2.lineTo(sxm(sbP.cx),sym(sbP.cy));rx2.stroke();
      rx2.fillStyle='#F39C12';rx2.beginPath();rx2.arc(sxm(stP.cx),sym(stP.cy),5,0,6.28);rx2.fill();rx2.arc(sxm(sbP.cx),sym(sbP.cy),5,0,6.28);rx2.fill()}
    if(scP){rx2.strokeStyle='#2ECC71';rx2.lineWidth=1.5;rx2.beginPath();rx2.arc(sxm(scP.cx),sym(scP.cy),14,0,6.28);rx2.stroke();
      rx2.fillStyle='#2ECC71';rx2.beginPath();rx2.arc(sxm(scP.cx),sym(scP.cy),4,0,6.28);rx2.fill()}
    if(result.tilt_angle!=null){rx2.font='bold 20px sans-serif';rx2.fillStyle='#F39C12';rx2.fillText((result.tilt_angle||0).toFixed(1)+'°',12,30)}
    // Side auxiliary lines
    if(stP&&sbP){
      // Vertical reference through frame bottom point (blue-white dash)
      rx2.strokeStyle='rgba(100,180,255,.6)';rx2.lineWidth=1;rx2.setLineDash([3,6]);
      rx2.beginPath();rx2.moveTo(sxm(sbP.cx),0);rx2.lineTo(sxm(sbP.cx),cv.height);rx2.stroke();rx2.setLineDash([])
    }
    if(scP&&stP&&sbP){
      var fDx=sbP.cx-stP.cx,fDy=sbP.cy-stP.cy; // frame line direction
      var fLen=Math.sqrt(fDx*fDx+fDy*fDy);if(fLen>0){fDx/=fLen;fDy/=fLen}
      // Perpendicular from cornea to frame line (green dash)
      rx2.strokeStyle='rgba(46,204,113,.5)';rx2.lineWidth=1;rx2.setLineDash([3,4]);
      // Foot of perpendicular: project cornea onto frame line
      var scFtx=stP.cx+(fDx*(scP.cx-stP.cx)+fDy*(scP.cy-stP.cy))*fDx;
      var scFty=stP.cy+(fDx*(scP.cx-stP.cx)+fDy*(scP.cy-stP.cy))*fDy;
      rx2.beginPath();rx2.moveTo(sxm(scFtx),sym(scFty));rx2.lineTo(sxm(scP.cx),sym(scP.cy));rx2.stroke();rx2.setLineDash([]);
      // Parallel line through cornea (same green, shorter)
      rx2.strokeStyle='rgba(46,204,113,.35)';rx2.lineWidth=.75;rx2.setLineDash([2,6]);
      var pLen=80;rx2.beginPath();rx2.moveTo(sxm(scP.cx-fDx*pLen),sym(scP.cy-fDy*pLen));rx2.lineTo(sxm(scP.cx+fDx*pLen),sym(scP.cy+fDy*pLen));rx2.stroke();rx2.setLineDash([])
    }
  }
  return cv
}
function ptfF(id){for(var i=0;i<frontPts.length;i++)if(frontPts[i].id===id)return frontPts[i];return null}
function ptfS(id){for(var i=0;i<sidePts.length;i++)if(sidePts[i].id===id)return sidePts[i];return null}
function rptPrint(){window.print()}
function rptSaveCust(){
  if(currentCust){doReportSave(currentCust.id);return}
  document.getElementById('saveCustModal').style.display='flex';
  document.getElementById('scmSearch').value='';document.getElementById('scmNew').value='';
  scmSearch()
}
function scmClose(){document.getElementById('saveCustModal').style.display='none'}
async function scmSearch(){
  var q=document.getElementById('scmSearch').value.trim();
  var d=document.getElementById('scmList');
  try{
    var r=await fetch('/api/customers?q='+encodeURIComponent(q));var cs=await r.json();
    var h='';for(var i=0;i<cs.length;i++){var c=cs[i];
      h+='<div onclick="scmSelect(\''+c.id+'\',\''+c.name.replace(/'/g,"\\'")+'\')" style="padding:6px 10px;cursor:pointer;color:#ccc;font-size:13px;border-radius:3px" onmouseover="this.style.background=\'rgba(240,173,78,.1)\'" onmouseout="this.style.background=\'\'">'+c.name+'<span style="color:#888;margin-left:8px;font-size:11px">'+c.phone+'</span></div>'}
    if(!h)h='<div style="color:#888;padding:6px 10px;font-size:12px">无匹配，请在下方新建</div>';
    d.innerHTML=h
  }catch(e){d.innerHTML='加载失败'}
}
async function scmSelect(id,name){
  currentCust={id:id,name:name};scmClose();
  var hs=document.getElementById('homeSearch');if(hs)hs.value=name;
  await doReportSave(id)
}
async function scmCreate(){
  var name=document.getElementById('scmNew').value.trim();if(!name)return;
  try{
    var phone=(document.getElementById('scmPhone').value||'').trim();
    var r=await fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,phone:phone})});
    var c=await r.json();if(c.error){alert(c.error);return}
    scmClose();currentCust={id:c.id,name:c.name};
    var hs=document.getElementById('homeSearch');if(hs)hs.value=c.name;
    await doReportSave(c.id)
  }catch(e){alert('创建失败: '+e.message)}
}
async function doReportSave(cid){
  try{
    var result=lastResults||{};
    result.front_points=frontPts.map(function(p){return{id:p.id,cx:p.cx,cy:p.cy,p3d:p.p3d||null}});
    result.side_points=sidePts.map(function(p){return{id:p.id,cx:p.cx,cy:p.cy}});
    var body={result:result};
    if(frontOk){var fi=await loadImg('/api/image/center');if(fi)body.front_crop=drawCrop(fi,frontPts,result,'front').toDataURL('image/png')}
    if(sideOk){var si=await loadImg('/api/image_side/center');if(si)body.side_crop=drawCrop(si,sidePts,result,'side').toDataURL('image/png')}
    await fetch('/api/customers/'+cid+'/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var sb=document.getElementById('rptSaveBtn2');if(sb)sb.style.display='none'
  }catch(e){alert('保存失败: '+e.message)}
}
function goHome(){showView('home');stopPreview()}

// ====== History ======
async function histLoad(cid,cname){
  var d=document.getElementById('histBody');
  d.innerHTML='<div style="color:#888;text-align:center;padding:40px">加载中...</div>';
  try{
    var r=await fetch('/api/customers/'+cid);var c=await r.json();var recs=c.records||[];
    var h='<h2 style="color:#f0ad4e"><span id=histCustName>'+c.name+'</span> <button onclick="histDelCust(\''+cid+'\')" style="background:none;border:1px solid #c0392b;color:#c0392b;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin-left:12px">删除客户</button> <button onclick="histEdit(\''+cid+'\',\''+c.name.replace(/'/g,"\\'")+'\',\''+(c.phone||'')+'\')" style="background:none;border:1px solid #f0ad4e;color:#f0ad4e;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:12px">编辑</button></h2><div style="color:#888;margin-bottom:16px"><span id=histCustPhone>'+c.phone+'</span> — '+recs.length+' 次测量</div>';
    for(var i=0;i<recs.length;i++){var rec=recs[i],ts=rec.timestamp||'';
      var date=ts.substring(0,4)+'-'+ts.substring(4,6)+'-'+ts.substring(6,8)+' '+ts.substring(9,11)+':'+ts.substring(11,13);
      h+='<div class=hist-rec>';h+='<div class=ts>'+date+' <button onclick="histDelRec(\''+cid+'\',\''+ts+'\')" style="background:none;border:1px solid #e74c3c;color:#e74c3c;padding:1px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-left:8px">删除</button></div>';
      h+='<table><tr><td>PD</td><td class=v>'+(rec.pd||0).toFixed(1)+'mm</td><td>RPD</td><td class=v>'+(rec.rpd||0).toFixed(1)+'mm</td><td>LPD</td><td class=v>'+(rec.lpd||0).toFixed(1)+'mm</td></tr>';
      if(rec.frame_width)h+='<tr><td>片宽</td><td class=v>'+rec.frame_width.toFixed(1)+'mm</td><td>片高</td><td class=v>'+(rec.frame_height||0).toFixed(1)+'mm</td><td>中梁</td><td class=v>'+(rec.bridge||0).toFixed(1)+'mm</td></tr>';
      if(rec.tilt_angle!=null)h+='<tr><td>前倾角</td><td class=v>'+rec.tilt_angle.toFixed(1)+'°</td><td>镜眼距</td><td class=v>'+(rec.vertex_distance||0).toFixed(1)+'mm</td></tr>';
      h+='</table>';h+='<div class=imgs><img src="/api/customers/'+cid+'/records/'+ts+'/image/front" onerror="this.style.display=\'none\'"><img src="/api/customers/'+cid+'/records/'+ts+'/image/side" onerror="this.style.display=\'none\'"></div>';h+='</div>'}
    d.innerHTML='<div style="margin-bottom:12px"><input id="histSearch2" placeholder="搜索客户..." onchange="histSearch2()" style="padding:8px;background:#161b22;border:1px solid #30363d;color:#ccc;border-radius:4px;width:200px;margin-right:8px"><button class="btn-t" onclick="histSearch2()">搜索</button></div><div>'+h+'</div>'
  }catch(e){d.innerHTML='<div style="color:#f00;text-align:center;padding:40px">加载失败: '+e.message+'</div>'}
}
async function histDelCust(cid){if(confirm('确定删除该客户及全部测量记录？')){await fetch('/api/customers/'+cid,{method:'DELETE'});goHome()}}
async function histDelRec(cid,ts){if(confirm('确定删除该测量记录？')){await fetch('/api/customers/'+cid+'/records/'+ts,{method:'DELETE'});histLoad(cid,'')}}
function histEdit(cid,name,phone){
  var n=document.getElementById('histCustName'),p=document.getElementById('histCustPhone');
  n.innerHTML='<input id=histEditName value="'+name.replace(/"/g,'&quot;')+'" style="width:100px;padding:2px 6px;background:#0d1117;border:1px solid #f0ad4e;color:#f0ad4e;border-radius:3px;font-size:14px"><button onclick="histSaveEdit(\''+cid+'\')" style="background:#3fb950;color:#fff;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-left:6px">保存</button><button onclick="histLoad(\''+cid+'\',\'\')" style="background:none;border:1px solid #555;color:#888;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-left:4px">取消</button>';
  p.innerHTML='<input id=histEditPhone value="'+(phone||'')+'" placeholder=电话 style="width:100px;padding:2px 6px;background:#0d1117;border:1px solid #f0ad4e;color:#ccc;border-radius:3px;font-size:13px">'
}
async function histSaveEdit(cid){
  var name=document.getElementById('histEditName').value.trim();if(!name)return;
  var phone=(document.getElementById('histEditPhone').value||'').trim();
  await fetch('/api/customers/'+cid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,phone:phone})});
  histLoad(cid,'')
}
async function histSearch(){
  var q=document.getElementById('histSearch').value.trim();if(!q)return;
  var r=await fetch('/api/customers?q='+encodeURIComponent(q));var cs=await r.json();
  var h='';for(var i=0;i<cs.length;i++){var c=cs[i];h+='<div class=hist-item onclick="histLoad(\''+c.id+'\',\''+c.name.replace(/'/g,"\\'")+'\')"><span class=name>'+c.name+'</span> <span class=info>'+c.phone+' · '+c.records+'次</span></div>'}
  document.getElementById('histList').innerHTML=h||'<div style="color:#888;text-align:center;padding:20px">无匹配客户</div>'
}
async function histSearch2(){var q=document.getElementById('histSearch2').value.trim();if(!q)return;var r=await fetch('/api/customers?q='+encodeURIComponent(q));var cs=await r.json();if(cs.length>0)histLoad(cs[0].id,cs[0].name)}

// Init
(async function(){try{var r=await fetch('/api/user_config');var d=await r.json();pdCorr=d.pd_correction||1.0}catch(e){}})();

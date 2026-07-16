var activeTab=1;
var C=null,calibOK=false;
var W=0,H=0,capImg=new Image();

function $(id){return document.getElementById(id)}
function setStatus(msg){$('status').textContent=msg}

async function api(url, opt){
  try{var r=await fetch(url,opt||{});if(!r.ok){var t=await r.text();throw t||r.status}return await r.json()}
  catch(e){return{error:(typeof e==='string')?e:'接口调用失败: '+e}}
}

function switchTab(n){
  activeTab=n;
  for(var i=1;i<=5;i++){$('t'+i).className='tab'+(i===n?' active':'')}
  stopLivePreview();stopFocus();
  vPanActive=0; // stop verify panning
  renderTab()
}

// ====== Tab 1: Camera Setup ======
async function tab1(){
  $('content').innerHTML='<div class=row><button onclick=scanCams()>扫描摄像头</button><button onclick=saveCams() class=p>保存</button></div><div id=camGrid class=panels></div>'
}
async function scanCams(){
  $('camGrid').innerHTML='<div style=color:#888>扫描中...</div>';
  var html='';
  for(var i=0;i<3;i++){
    html+='<div class=panel id=p'+i+'><div class=lbl>摄像头 '+i+'</div><img id=img'+i+' src="/api/cam_test/'+i+'?t='+Date.now()+'" onload="assignBtns('+i+')"></div>'
  }
  $('camGrid').innerHTML=html
}
function assignBtns(idx){
  var p=$('p'+idx);
  // Remove old button bar if present
  var oldBtn=p.querySelector('.btnbar');
  if(oldBtn) oldBtn.remove();
  var div=document.createElement('div');
  div.className='btnbar';div.style.cssText='background:#222;padding:3px;text-align:center';
  var btnL=document.createElement('button');btnL.textContent='设为左';btnL.onclick=function(){setCam(idx,'left')};
  var btnC=document.createElement('button');btnC.textContent='设为中';btnC.onclick=function(){setCam(idx,'center')};
  var btnR=document.createElement('button');btnR.textContent='设为右';btnR.onclick=function(){setCam(idx,'right')};
  div.appendChild(btnL);div.appendChild(document.createTextNode(' '));
  div.appendChild(btnC);div.appendChild(document.createTextNode(' '));
  div.appendChild(btnR);
  p.appendChild(div)
}
function setCam(idx, pos){
  var labels={left:'左',center:'中',right:'右'};
  $('p'+idx).querySelector('.lbl').textContent='摄像头 '+idx+' -> '+labels[pos];
  C=C||{};C[pos]=idx
}
async function saveCams(){
  if(!C||Object.keys(C).length<3){alert('请先指定全部三个摄像头');return}
  await api('/api/set_cams',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(C)});
  setStatus('已保存: 左='+C.left+' 中='+C.center+' 右='+C.right)
}

// ====== Tab 2: Capture ======
var capStreams = null;

async function tab2(){
  $('content').innerHTML='<div class=row>'+
    '<button onclick=startLivePreview()>实时预览</button>'+
    '<button onclick=stopLivePreview()>停止预览</button>'+
    '<button onclick=captureCB() class=p>拍照 (4K)</button>'+
    '</div><div class=panels><div class=panel><div class=lbl>LEFT</div><video id=prevL autoplay playsinline muted style="width:100%;display:block;background:#000"></video></div>'+
    '<div class=panel><div class=lbl>CENTER</div><video id=prevC autoplay playsinline muted style="width:100%;display:block;background:#000"></video></div>'+
    '<div class=panel><div class=lbl>RIGHT</div><video id=prevR autoplay playsinline muted style="width:100%;display:block;background:#000"></video></div></div>'+
    '<div id=cbStatus class=result></div>'
}
async function startLivePreview(){
  stopLivePreview();
  try{
    // Read camera config from Tab 1
    var cfg = await api('/api/get_cams');
    if(!cfg || cfg.error){setStatus('请先在Tab1设置摄像头');return}
    // Trigger permission first
    var tmp = await navigator.mediaDevices.getUserMedia({video:true});
    tmp.getTracks().forEach(function(t){t.stop()});
    var cams = (await navigator.mediaDevices.enumerateDevices()).filter(function(d){return d.kind==='videoinput'});
    if(cams.length<3){setStatus('需要3个摄像头，当前: '+cams.length);return}

    // Map Python DSHOW index → browser enumerateDevices index
    // Direct mapping: browser = Python DSHOW index (same order)
    var sides = [
      {label:'left',  el:$('prevL'), id:cams[cfg.left].deviceId},
      {label:'center',el:$('prevC'), id:cams[cfg.center].deviceId},
      {label:'right', el:$('prevR'), id:cams[cfg.right].deviceId}
    ];
    capStreams = [];
    for(var i=0;i<3;i++){
      var s = sides[i];
      try{
        var stream = await navigator.mediaDevices.getUserMedia({
          video:{deviceId:{exact:s.id},width:1280,height:720}
        });
        s.el.srcObject = stream;
        s.el.parentElement.querySelector('.lbl').textContent = s.label.toUpperCase();
        capStreams.push(stream);
      }catch(e){
        setStatus(s.label+' 预览失败');
      }
    }
    setStatus('预览中 (左=Py'+cfg.left+' 中=Py'+cfg.center+' 右=Py'+cfg.right+')');
  }catch(e){setStatus('预览失败: '+e.message)}
}
function stopLivePreview(){
  if(capStreams){
    for(var i=0;i<capStreams.length;i++) capStreams[i].getTracks().forEach(function(t){t.stop()});
    capStreams = [];
    $('prevL').srcObject = null;
    $('prevC').srcObject = null;
    $('prevR').srcObject = null;
  }
  setStatus('预览已停止')
}
async function captureCB(){
  stopLivePreview(); // Free cameras for 4K capture
  await new Promise(function(r){setTimeout(r,2000)}); // Wait for browser to release cameras
  setStatus('拍照中...');
  var d=await api('/api/cap_cb',{method:'POST'});
  if(d.error){setStatus(d.error);return}
  W=d.w;H=d.h;
  $('cbStatus').innerHTML='已拍 '+d.w+'x'+d.h+' | 棋盘格: '+(d.all_cb?'<span class=good>检测通过</span>':'<span class=warn>未检测到</span>')+' | '+d.method;
  setStatus('已拍照');
  // Show captured images as static
  $('prevL').src='/api/image/left?t='+Date.now();$('prevL').srcObject=null;
  $('prevC').src='/api/image/center?t='+Date.now();$('prevC').srcObject=null;
  $('prevR').src='/api/image/right?t='+Date.now();$('prevR').srcObject=null;
}

// ====== Tab 3: Calibrate ======
var calibAbort = null;
async function tab3(){
  $('content').innerHTML='<div class=row><button onclick=runCalib() class=p id=btnCalib>开始标定</button><button onclick=stopCalib() id=btnCalibStop style=display:none>停止</button></div><div id=calibResult class=result>点击按钮执行标定。</div>'
}
async function runCalib(){
  $('btnCalib').style.display='none';$('btnCalibStop').style.display='';
  $('calibResult').innerHTML='<span style=color:#ff0>标定中，请稍候...</span>';
  setStatus('标定中...');
  try{
    calibAbort = new AbortController();
    var r = await fetch('/api/run_calib',{method:'POST',signal:calibAbort.signal});
    var d = await r.json();
    if(d.error){$('calibResult').innerHTML='<span class=bad>错误: '+d.error+'</span>';setStatus('失败')}
    else{
      $('calibResult').innerHTML='<span class=good>完成!</span> 帧数: '+d.frames+
        ' | 左-中: '+d.bl_lc+'mm | 中-右: '+d.bl_cr+'mm';
      calibOK=true;setStatus('标定完成')
    }
  }catch(e){
    if(e.name==='AbortError'){$('calibResult').innerHTML='<span class=warn>已取消</span>';setStatus('已取消')}
    else{$('calibResult').innerHTML='<span class=bad>错误: '+e.message+'</span>';setStatus('失败')}
  }
  $('btnCalib').style.display='';$('btnCalibStop').style.display='none'
}
function stopCalib(){
  if(calibAbort){calibAbort.abort();calibAbort=null}
}

// ====== Tab 4: Verify ======
var vPts=[],vLines=null,epiPts=[[],[]];
var vGroup=''; // frame group key for chessboard-based F computation
var vImgs=[null,null,null]; // Image objects for left/center/right
var vZoom=[1,1,1],vPan=[0,0,0,0,0,0]; // 3 panels: zoom, panX, panY
var vDrag=0,vDragSide=0,vPanActive=0,vPanSide=0,vPanSX=0,vPanSY=0,vPanOX=0,vPanOY=0;

async function tab4(){
  $('content').innerHTML='<div class=row>'+
    '<button onclick=loadExisting() class=p>加载已有标定帧</button>'+
    '<button onclick=cap4Capture()>新拍一张</button>'+
    '<button onclick=computeEpi() id=btnEpi disabled>计算极线</button>'+
    '<button onclick=verifyEpi() id=btnEpiErr disabled>验证误差</button>'+
    '<button onclick=verifyDist() id=btnDist disabled>距离验证</button>'+
    '</div><div class=panels><div class=panel><div class=lbl>LEFT</div><canvas id=cvVL></canvas></div>'+
    '<div class=panel><div class=lbl>CENTER</div><canvas id=cvVC></canvas></div>'+
    '<div class=panel><div class=lbl>RIGHT</div><canvas id=cvVR></canvas></div></div>'+
    '<div id=vResult class=result></div>';
  // Remove old event listeners from tab3/other tabs
  vImgs=[null,null,null];vZoom=[1,1,1];vPan=[0,0,0,0,0,0];
  addVEvents()
}

var vGlobPanMove=function(ev){
  if(!vPanActive||activeTab!==4)return;
  vPan[vPanSide*2]=vPanOX+(ev.clientX-vPanSX);
  vPan[vPanSide*2+1]=vPanOY+(ev.clientY-vPanSY);
  drawVCanvas()
};
var vGlobPanUp=function(){vPanActive=0};

function addVEvents(){
  var cvs=[$('cvVL'),$('cvVC'),$('cvVR')];
  for(var si=0;si<3;si++){
    var cv=cvs[si];
    if(!cv)continue;
    cv.setAttribute('data-vside',si);
    cv.addEventListener('wheel',vWheelHandler,{passive:false});
    cv.addEventListener('mousedown',vClickHandler);
    cv.addEventListener('contextmenu',function(e){e.preventDefault()})
  }
  if(!document._vPanAdded){document._vPanAdded=true;
    document.addEventListener('mousemove',vGlobPanMove);
    document.addEventListener('mouseup',vGlobPanUp)}
}
function vWheelHandler(ev){
  ev.preventDefault();
  var si=parseInt(this.getAttribute('data-vside'));
  var rect=this.getBoundingClientRect();
  var mx=ev.clientX-rect.left,my=ev.clientY-rect.top;
  var oz=vZoom[si];var nz=Math.max(0.3,Math.min(8,oz*(ev.deltaY<0?1.2:1/1.2)));
  var ix=(mx-vPan[si*2])/oz,iy=(my-vPan[si*2+1])/oz;
  vZoom[si]=nz;vPan[si*2]=mx-ix*nz;vPan[si*2+1]=my-iy*nz;
  drawVCanvas()
}
function vClickHandler(ev){
  if(!W)return;
  var si=parseInt(this.getAttribute('data-vside'));
  var rect=this.getBoundingClientRect();
  var mx=ev.clientX-rect.left,my=ev.clientY-rect.top;
  // Middle-click: start panning
  if(ev.button===1){
    ev.preventDefault();
    vPanActive=1;vPanSide=si;
    vPanSX=ev.clientX;vPanSY=ev.clientY;
    vPanOX=vPan[si*2];vPanOY=vPan[si*2+1];
    return
  }
  if(ev.button!==0)return; // only left click for annotation
  var z=vZoom[si],px=vPan[si*2],py=vPan[si*2+1];
  var cx=Math.round((mx-px)/z),cy=Math.round((my-py)/z);
  if(cx<0||cx>=W||cy<0||cy>=H)return;
  if(si===1){
    vPts.push({cx:cx,cy:cy});drawVCanvas();
    $('btnEpi').disabled=vPts.length<2
  }else if(vLines){
    var epIdx=si===0?0:1;
    epiPts[epIdx].push({cx:cx,cy:cy});drawVCanvas()
  }
}

function drawVCanvas(){
  if(activeTab!==4)return;
  var cvs=[$('cvVL'),$('cvVC'),$('cvVR')];
  if(!cvs[0]||!cvs[1]||!cvs[2])return;
  var sides=['left','center','right'];
  for(var pi=0;pi<3;pi++){
    var pn=cvs[pi].parentElement;
    var pw=pn.clientWidth,ph=pn.clientHeight;
    cvs[pi].width=pw;cvs[pi].height=ph;
    var ctx=cvs[pi].getContext('2d');ctx.clearRect(0,0,pw,ph);
    var z=vZoom[pi],px=vPan[pi*2],py=vPan[pi*2+1];
    // Auto-fit on first draw
    if(z===1&&px===0&&py===0&&W>0){
      z=Math.min(pw/W,ph/H);vZoom[pi]=z;
      px=(pw-W*z)/2;vPan[pi*2]=px;
      py=(ph-H*z)/2;vPan[pi*2+1]=py
    }
    // Draw image
    if(vImgs[pi]&&vImgs[pi].complete&&vImgs[pi].naturalWidth>0){
      ctx.save();ctx.translate(px,py);ctx.scale(z,z);
      ctx.drawImage(vImgs[pi],0,0,W,H);ctx.restore()
    }
    ctx.save();ctx.translate(px,py);ctx.scale(z,z);
    // Epipolar lines
    if(vLines)for(var li=0;li<vLines.length;li++){
      var sd=sides[pi];
      if(!vLines[li][sd])continue;
      var ln=vLines[li][sd];
      ctx.strokeStyle='rgba(255,255,0,0.65)';ctx.lineWidth=2/z;
      ctx.beginPath();
      for(var si=0;si<ln.pts.length;si+=2){
        var x1=ln.pts[si][0],y1=ln.pts[si][1];
        if(si+1<ln.pts.length){var x2=ln.pts[si+1][0],y2=ln.pts[si+1][1];ctx.moveTo(x1,y1);ctx.lineTo(x2,y2)}
      }
      ctx.stroke()
    }
    // Center pupil points
    if(pi===1)for(var vi=0;vi<vPts.length;vi++){
      ctx.strokeStyle='#0f0';ctx.lineWidth=2/z;ctx.beginPath();
      ctx.arc(vPts[vi].cx,vPts[vi].cy,14,0,6.28);ctx.stroke();
      ctx.fillStyle='#0f0';ctx.font=(11/z)+'px monospace';ctx.fillText('P'+(vi+1),vPts[vi].cx+16,vPts[vi].cy-8)
    }
    // Manual epipolar points
    var epIdx=pi===0?0:(pi===2?1:-1);
    if(epIdx>=0)for(var ei=0;ei<epiPts[epIdx].length;ei++){
      var ex=epiPts[epIdx][ei].cx,ey=epiPts[epIdx][ei].cy;
      ctx.strokeStyle='#f0f';ctx.lineWidth=2/z;ctx.beginPath();
      ctx.arc(ex,ey,10,0,6.28);ctx.stroke();
      ctx.fillStyle='#f0f';ctx.font=(10/z)+'px monospace';ctx.fillText('M'+(ei+1),ex-22,ey-12)
    }
    ctx.restore();
    // Zoom indicator
    ctx.fillStyle='#ff0';ctx.font='11px monospace';ctx.fillText(Math.round(z*100)+'%',5,12)
  }
}

async function loadExisting(){
  setStatus('加载中...');
  var d=await api('/api/existing_capture',{method:'POST'});
  if(d.error){setStatus(d.error);return}
  W=d.w;H=d.h;vPts=[];vLines=null;epiPts=[[],[]];vGroup=d.group||'';
  vZoom=[1,1,1];vPan=[0,0,0,0,0,0];
  $('btnEpi').disabled=true;$('btnDist').disabled=false;$('btnEpiErr').disabled=true;
  // Load images
  var loaded=0;
  function onOne(){loaded++;if(loaded>=3)drawVCanvas()}
  for(var i=0;i<3;i++){
    vImgs[i]=new Image();vImgs[i].onload=onOne;vImgs[i].onerror=onOne;
    vImgs[i].src='/api/image/'+(i===0?'left':i===1?'center':'right')+'?t='+Date.now()
  }
  setStatus('已加载: '+W+'x'+H)
}
async function cap4Capture(){
  setStatus('拍照中...');
  var d=await api('/api/cap_cb?detect=0',{method:'POST'});
  if(d.error){setStatus(d.error);return}
  W=d.w;H=d.h;vPts=[];vLines=null;epiPts=[[],[]];vGroup=d.group||'';
  vZoom=[1,1,1];vPan=[0,0,0,0,0,0];
  $('btnEpi').disabled=true;$('btnDist').disabled=false;$('btnEpiErr').disabled=true;
  var loaded=0;
  function onOne(){loaded++;if(loaded>=3)drawVCanvas()}
  for(var i=0;i<3;i++){
    vImgs[i]=new Image();vImgs[i].onload=onOne;vImgs[i].onerror=onOne;
    vImgs[i].src='/api/image/'+(i===0?'left':i===1?'center':'right')+'?t='+Date.now()
  }
  setStatus('已拍 '+W+'x'+H)
}

async function computeEpi(){
  if(vPts.length<2){alert('请先在中间画面点两个瞳孔');return}
  var allLines=[];
  for(var i=0;i<vPts.length;i++){
    var body=Object.assign({},vPts[i],vGroup?{group:vGroup}:{});
    var d=await api('/api/epiline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    allLines.push(d)
  }
  vLines=allLines;drawVCanvas();$('btnEpiErr').disabled=false;
  setStatus('极线已绘制。在左/右图标出瞳孔实际位置，然后点验证误差。')
}

async function verifyEpi(){
  if(!vLines||epiPts[0].length===0&&epiPts[1].length===0){alert('请先绘制极线并标注瞳孔位置');return}
  var html='<b>极线误差验证</b><br>';
  var total=0,count=0,maxErr=0;
  for(var vi=0;vi<vLines.length;vi++){
    for(var si=0;si<2;si++){
      var side=si===0?'left':'right';
      if(!vLines[vi][side]||!epiPts[si][vi])continue;
      var ln=vLines[vi][side];
      var pt=epiPts[si][vi];
      var d=await api('/api/epi_error',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({a:ln.a,b:ln.b,c:ln.c,x:pt.cx,y:pt.cy})});
      var cls=d.dist_px<3?'good':d.dist_px<5?'warn':'bad';
      html+='瞳孔'+(vi+1)+' '+side+'图: '+d.dist_px+'px / '+d.dist_mm+'mm <span class='+cls+'>'+(d.dist_px<3?'✅':d.dist_px<5?'⚠️':'❌')+'</span><br>';
      total+=d.dist_px;count++;if(d.dist_px>maxErr)maxErr=d.dist_px
    }
  }
  if(count>0){var avg=total/count;html+='<br>平均: '+avg.toFixed(1)+'px 最大: '+maxErr.toFixed(1)+'px ';html+=avg<3?'<span class=good>标定精度合格 ✅</span>':avg<5?'<span class=warn>可接受 ⚠️</span>':'<span class=bad>建议重标 ❌</span>'}
  $('vResult').innerHTML=html;
  setStatus('极线验证完成')
}

async function verifyDist(){
  setStatus('距离验证中...');
  var d=await api('/api/dist_verify',{method:'POST'});
  if(d.error){setStatus(d.error);return}
  var html='<b>距离验证</b><br>';
  html+='样本数: '+d.samples+' | 预期: '+d.expected+'mm | 实测均值: '+d.avg_measured+'mm<br>';
  html+='平均误差: <span class="'+(d.pass?'good':'warn')+'">'+d.avg_error_pct+'%</span> ';
  html+=d.pass?'<span class=good>通过</span>':'<span class=warn>需检查</span>';
  if(d.detail){
    html+='<br>前5对:<br>';
    for(var i=0;i<d.detail.length;i++)html+='  '+d.detail[i].expected+'mm -> '+d.detail[i].measured+'mm ('+d.detail[i].error_pct+'%)<br>'
  }
  $('vResult').innerHTML=html;
  setStatus(d.pass?'距离验证通过':'距离偏差需检查')
}

function renderTab(){
  if(activeTab===1)tab1();else if(activeTab===2)tab2();else if(activeTab===3)tab3();else if(activeTab===4)tab4();else tab5()
}

var focusStream = null;

async function tab5(){
  // Read saved camera config
  var cfg = {};
  try{var d=await api('/api/get_cams');if(d&&!d.error)cfg=d}catch(e){}
  var opts = '';
  if(Object.keys(cfg).length===3){
    opts += '<option value='+cfg.center+'>中摄 (Py'+cfg.center+')</option>';
    opts += '<option value='+cfg.left+'>左摄 (Py'+cfg.left+')</option>';
    opts += '<option value='+cfg.right+'>右摄 (Py'+cfg.right+')</option>';
  }else{
    opts += '<option value=0>摄像头 0</option>';
    opts += '<option value=1>摄像头 1</option>';
    opts += '<option value=2>摄像头 2</option>';
  }
  $('content').innerHTML='<div class=row>'+
    '<select id=fsCam>'+opts+'</select>'+
    '<button onclick=startFocus()>预览</button>'+
    '<button onclick=stopFocus()>停止</button>'+
    '<span style="font-size:11px;color:#888">全分辨率实时取景</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:center;background:#000">'+
      '<video id=fsVideo autoplay playsinline muted style="max-width:100%;max-height:82vh;object-fit:contain"></video>'+
    '</div>'+
    '<div id=fsStatus class=result style="margin-top:4px"></div>'
}
async function startFocus(){
  stopFocus();
  try{
    var tmp = await navigator.mediaDevices.getUserMedia({video:true});
    tmp.getTracks().forEach(function(t){t.stop()});
    var cams = (await navigator.mediaDevices.enumerateDevices()).filter(function(d){return d.kind==='videoinput'});
    var idx = parseInt($('fsCam').value);
    // Map Python DSHOW index → browser enumerateDevices index
    var brIdx = (idx + 1) % 3;
    if(brIdx >= cams.length){setStatus('摄像头不存在');return}
    // Try 4K first, fall back to 1080p
    try{
      focusStream = await navigator.mediaDevices.getUserMedia({
        video:{deviceId:{exact:cams[brIdx].deviceId},width:3840,height:2160}
      });
    }catch(e){
      try{
        focusStream = await navigator.mediaDevices.getUserMedia({
          video:{deviceId:{exact:cams[brIdx].deviceId},width:1920,height:1080}
        });
      }catch(e2){
        focusStream = await navigator.mediaDevices.getUserMedia({
          video:{deviceId:{exact:cams[brIdx].deviceId},width:1280,height:720}
        });
      }
    }
    $('fsVideo').srcObject = focusStream;
    var t = focusStream.getVideoTracks()[0];
    $('fsStatus').innerHTML='<span class=good>预览中</span>: '+t.label+' @ '+t.getSettings().width+'x'+t.getSettings().height;
  }catch(e){setStatus('预览失败: '+e.message)}
}
function stopFocus(){
  if(focusStream){
    focusStream.getTracks().forEach(function(t){t.stop()});
    focusStream = null;
    $('fsVideo').srcObject = null;
    $('fsStatus').innerHTML='已停止'
  }
  setStatus('已停止')
}
switchTab(1);
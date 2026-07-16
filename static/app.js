// ====== State ======
var W=0,H=0,img=new Image(),pts=[],step=0;
var curMode='f'; // 'f'=front annotation, 's'=side annotation
var frontPts=[], sidePts=[], frontStep=0, sideStep=0;
var frontCaptured=0, sideCaptured=0;
var scale=1,ox=0,oy=0,panning=0,panSX=0,panSY=0,panOX=0,panOY=0,space=0;
var drag=0,ds=null,de=null,deye=null;
var hdrag=0,hdragPt=null,hdragId=null;
var dragPtId=null;
var mouseX=0,mouseY=0,mouseOnCanvas=0;
var showHint=0,mgTimer=null,showMg=0,mgX=0,mgY=0;
var dpr=window.devicePixelRatio||1;
var pdCorr=1.0;
var currentCust=null;
(async function(){try{var r=await fetch('/api/user_config');var d=await r.json();pdCorr=d.pd_correction||1.0}catch(e){console.log('pd_correction load failed:',e)}})();

// ====== Customer management ======
async function toggleCustList(){
  var d=document.getElementById('custDrop');
  if(d.style.display==='block'){d.style.display='none';return}
  d.style.display='block';await searchCustomers()
}
async function searchCustomers(){
  var q=document.getElementById('custSearch').value;
  var list=document.getElementById('custList');
  try{
    var r=await fetch('/api/customers?q='+encodeURIComponent(q)); var cs=await r.json();
    var h=''; for(var i=0;i<cs.length;i++){var c=cs[i];h+='<div onclick="loadCustomerRecords(\''+c.id+'\',\''+c.name.replace(/'/g,"\\'")+'\')" style="padding:4px 8px;cursor:pointer;color:#ccc;border-radius:3px;font-size:13px" onmouseover="this.style.background=\'rgba(240,173,78,.2)\'" onmouseout="this.style.background=\'\'">'+c.name+'<span style="color:#888;float:right;font-size:11px">'+c.records+'次</span></div>'}
    if(!h)h='<div style="color:#888;padding:4px 8px;font-size:12px">无客户，请在下方新建</div>';
    list.innerHTML=h
  }catch(e){list.innerHTML='加载失败'}
}
function selectCustomer(id,name){
  currentCust={id:id,name:name};
  document.getElementById('btnCust').textContent=name;document.getElementById('btnCust').style.color='#f0ad4e';document.getElementById('btnCust').style.borderColor='#f0ad4e';
  document.getElementById('custDrop').style.display='none'
}
async function loadCustomerRecords(cid,cname){
  selectCustomer(cid,cname);
  var list=document.getElementById('custList');
  list.innerHTML='<div style="color:#888;padding:4px 8px">加载中...</div>';
  try{
    var r=await fetch('/api/customers/'+cid); var c=await r.json();
    var recs=c.records||[];
    if(recs.length===0){list.innerHTML='<div style="color:#888;padding:4px 8px;font-size:12px">暂无测量记录</div>';return}
    var h='<div style="color:#f0ad4e;padding:4px 8px;font-size:12px;border-bottom:1px solid #444;margin-bottom:4px">← 返回客户列表</div><div style="cursor:pointer;color:#f0ad4e;padding:2px 8px;font-size:12px;margin-bottom:4px" onclick="searchCustomers()">← 返回客户列表</div>';
    for(var i=0;i<recs.length;i++){
      var rec=recs[i];var ts=rec.timestamp||'';
      var date=ts.substring(0,4)+'-'+ts.substring(4,6)+'-'+ts.substring(6,8)+' '+ts.substring(9,11)+':'+ts.substring(11,13);
      h+='<div onclick="loadRecord(\''+cid+'\',\''+ts+'\')" style="padding:4px 8px;cursor:pointer;color:#ccc;border-radius:3px;font-size:12px" onmouseover="this.style.background=\'rgba(240,173,78,.2)\'" onmouseout="this.style.background=\'\'">'+date+'<span style="color:#f0ad4e;float:right">PD '+(rec.pd||'--')+'mm</span></div>'
    }
    list.innerHTML=h
  }catch(e){list.innerHTML='<div style="color:#f00;padding:4px 8px">加载失败</div>'}
}
async function loadRecord(cid,ts){
  document.getElementById('custDrop').style.display='none';
  document.getElementById('custModal').style.display='none';
  document.getElementById('st').textContent='加载历史记录...';
  try{
    var r=await fetch('/api/customers/'+cid+'/records/'+ts); var rec=await r.json();
    // Restore front points (discard current)
    frontPts=(rec.front_points||[]).map(function(p){return Object.assign({},p)});
    frontStep=frontPts.length;frontCaptured=1;
    sidePts=(rec.side_points||[]).map(function(p){return Object.assign({},p)});
    sideStep=sidePts.length;sideCaptured=sidePts.length>0?1:0;
    // Restore results panel
    document.getElementById('vp').textContent=(rec.pd||0).toFixed(1)+' mm';
    document.getElementById('vr').textContent=(rec.rpd||0).toFixed(1)+' mm';
    document.getElementById('vl').textContent=(rec.lpd||0).toFixed(1)+' mm';
    document.getElementById('vw').textContent=(rec.width||0).toFixed(1)+' mm';
    document.getElementById('vh').textContent=(rec.height||0).toFixed(1)+' mm';
    document.getElementById('vb').textContent=(rec.bridge||0).toFixed(1)+' mm';
    if(rec.tilt_angle!=null)document.getElementById('va').textContent=(rec.tilt_angle||0).toFixed(1)+'°';
    if(rec.vertex_distance!=null)document.getElementById('vd').textContent=(rec.vertex_distance||0).toFixed(1)+' mm';
    curMode='f';loadMode('f');
    document.getElementById('btnAnnotF').style.background='#f0ad4e';
    document.getElementById('btnAnnotS').style.background='';
    document.getElementById('btnAnnotS').disabled=!sideCaptured;
    var ccDiv=document.getElementById('cc');ccDiv.innerHTML='';ccDiv.appendChild(cv);
    img=new Image();
    img.onload=function(){fitImage();draw()};
    img.src='/api/image/center?t='+Date.now();
    document.getElementById('st').textContent='已加载 '+currentCust.name+' 的记录';
    document.getElementById('btnReview').disabled=false
  }catch(e){alert('加载失败: '+e.message)}
}

async function toggleCustView(){
  if(!currentCust){
    // Show search
    if(document.getElementById('custModal').style.display==='block'){document.getElementById('custModal').style.display='none';return}
    document.getElementById('custModal').style.display='block';
    var v=document.getElementById('custView');
    v.innerHTML='<div style="padding:20px"><input id=custViewSearch placeholder="搜索客户姓名或电话..." style="width:100%;background:#333;border:1px solid #555;color:#ccc;padding:8px;border-radius:4px;margin-bottom:12px" oninput="searchCustView()"><div id=custViewList></div></div>';
    await searchCustView()
  }else{
    await showCustomerRecords(currentCust.id,currentCust.name)
  }
}

async function searchCustView(){
  var q=document.getElementById('custViewSearch')?document.getElementById('custViewSearch').value:'';
  var r=await fetch('/api/customers?q='+encodeURIComponent(q));var cs=await r.json();
  var h='';for(var i=0;i<cs.length;i++){var c=cs[i];
    h+='<div onclick="showCustomerRecords(\''+c.id+'\',\''+c.name.replace(/'/g,"\\'")+'\')" style="padding:8px;cursor:pointer;border-bottom:1px solid #333;color:#ccc" onmouseover="this.style.background=\'rgba(240,173,78,.1)\'" onmouseout="this.style.background=\'\'"><b>'+c.name+'</b> <span style="color:#888">'+c.phone+'</span> <span style="color:#f0ad4e">'+c.records+'次</span></div>'}
  if(!h)h='<div style="color:#888;padding:20px;text-align:center">无匹配客户</div>';
  document.getElementById('custViewList').innerHTML=h
}

async function showCustomerRecords(cid,cname){
  selectCustomer(cid,cname);
  document.getElementById('custModal').style.display='block';
  var v=document.getElementById('custView');
  v.innerHTML='<div style="color:#888;padding:20px;text-align:center">加载中...</div>';
  try{
  var r=await fetch('/api/customers/'+cid);var c=await r.json();
  var recs=c.records||[];
  var h='<h2 style="color:#f0ad4e;margin-bottom:4px">'+c.name+'</h2>';
  h+='<div style="color:#888;margin-bottom:16px">'+c.phone+' &nbsp;共 '+recs.length+' 次测量</div>';
  h+='<button onclick="toggleCustView()" style="background:none;border:1px solid #f0ad4e;color:#f0ad4e;padding:4px 12px;border-radius:3px;cursor:pointer;margin-bottom:16px">← 返回客户列表</button>';
  for(var i=0;i<recs.length;i++){
    var rec=recs[i];var ts=rec.timestamp||'';
    var date=ts.substring(0,4)+'-'+ts.substring(4,6)+'-'+ts.substring(6,8)+' '+ts.substring(9,11)+':'+ts.substring(11,13);
    h+='<div style="background:#1a1a1a;border-radius:8px;padding:12px;margin-bottom:12px">';
    h+='<div style="color:#f0ad4e;margin-bottom:8px;font-size:14px">'+date+' &nbsp; <button onclick="loadRecord(\''+cid+'\',\''+ts+'\')" style="background:#f0ad4e;color:#000;border:none;padding:2px 10px;border-radius:3px;cursor:pointer;font-size:12px">还原</button></div>';
    h+='<table style="color:#ccc;font-size:13px"><tr><td>PD</td><td style="color:#f0ad4e;padding:2px 12px">'+(rec.pd||0).toFixed(1)+'mm</td><td>RPD</td><td>'+(rec.rpd||0).toFixed(1)+'mm</td><td>LPD</td><td>'+(rec.lpd||0).toFixed(1)+'mm</td></tr>';
    h+='<tr><td>片宽</td><td>'+(rec.frame_width||0).toFixed(1)+'mm</td><td>片高</td><td>'+(rec.frame_height||0).toFixed(1)+'mm</td><td>中梁</td><td>'+(rec.bridge||0).toFixed(1)+'mm</td></tr>';
    if(rec.tilt_angle!=null)h+='<tr><td>前倾角</td><td>'+(rec.tilt_angle||0).toFixed(1)+'°</td><td>镜眼距</td><td>'+(rec.vertex_distance||0).toFixed(1)+'mm</td></tr>';
    h+='</table>';
    h+='<div style="margin-top:10px;display:flex;gap:12px">';
    h+='<img src="/api/customers/'+cid+'/records/'+ts+'/image/front" style="max-width:60%;border-radius:4px;border:1px solid #333" onerror="this.style.display=\'none\'">';
    h+='<img src="/api/customers/'+cid+'/records/'+ts+'/image/side" style="max-width:38%;border-radius:4px;border:1px solid #333" onerror="this.style.display=\'none\'">';
    h+='</div></div>'
  }
  v.innerHTML=h
  }catch(e){v.innerHTML='<div style="color:#f00;padding:20px;text-align:center">加载失败: '+e.message+'</div>'}
}
async function createCustomer(){
  var inp=document.getElementById('custNewName');var name=inp.value.trim();
  if(!name){alert('请输入姓名');return}
  try{
    var r=await fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})});
    var c=await r.json();if(c.error){alert(c.error);return}
    inp.value='';selectCustomer(c.id,c.name);await searchCustomers()
  }catch(e){alert('创建失败: '+e.message)}
}
async function saveToCustomer(){
  if(!currentCust){alert('请先在工具栏选择客户');return}
  if(frontPts.length===0||!frontCaptured){alert('请先标注并计算');return}
  var result={pd:parseFloat(document.getElementById('vp').textContent)||0,
    rpd:parseFloat(document.getElementById('vr').textContent)||0,
    lpd:parseFloat(document.getElementById('vl').textContent)||0,
    width:parseFloat(document.getElementById('vw').textContent)||0,
    height:parseFloat(document.getElementById('vh').textContent)||0,
    bridge:parseFloat(document.getElementById('vb').textContent)||0};
  var vaEl=document.getElementById('va'),vdEl=document.getElementById('vd');
  if(vaEl&&vaEl.textContent!=='--')result.tilt_angle=parseFloat(vaEl.textContent)||0;
  if(vdEl&&vdEl.textContent!=='--')result.vertex_distance=parseFloat(vdEl.textContent)||0;
  result.front_points=frontPts.map(function(p){return{id:p.id,cx:p.cx,cy:p.cy,p3d:p.p3d||null}});
  result.side_points=sidePts.map(function(p){return{id:p.id,cx:p.cx,cy:p.cy}});

  document.getElementById('st').textContent='生成标注图...';
  var body={result:result};

  // Front annotated crop
  var fpt2=function(id){for(var i=0;i<frontPts.length;i++)if(frontPts[i].id===id)return frontPts[i];return null};
  var rp2=fpt2('right_pupil'),lp2=fpt2('left_pupil');
  if(rp2&&lp2){
    var fi=await new Promise(function(res){var im=new Image();im.crossOrigin='anonymous';im.onload=function(){res(im)};im.src='/api/image/center?t='+Date.now()});
    if(fi){body.front_crop=drawAnnotatedCrop(fi,frontPts,result,'front').toDataURL('image/png')}
  }
  // Side annotated crop
  if(sideCaptured&&sidePts.length>0){
    var si=await new Promise(function(res){var im=new Image();im.crossOrigin='anonymous';im.onload=function(){res(im)};im.src='/api/image_side/center?t='+Date.now()});
    if(si){body.side_crop=drawAnnotatedCrop(si,sidePts,result,'side').toDataURL('image/png')}
  }

  try{
    var r=await fetch('/api/customers/'+currentCust.id+'/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();if(d.ok)document.getElementById('st').textContent='已保存到 '+currentCust.name
  }catch(e){alert('保存失败: '+e.message)}
}

var _tplDrawAnnotated=1;
function drawAnnotatedCrop(img, pts, result, mode){
  var fpt=function(id){for(var i=0;i<pts.length;i++)if(pts[i].id===id)return pts[i];return null};
  var rp=fpt('right_pupil'),lp=fpt('left_pupil');
  var cwC=img.width,chC=img.height;
  var cv=document.createElement('canvas');
  if(mode==='front'&&rp&&lp){
    var ctrX=(rp.cx+lp.cx)/2,ctrY=(rp.cy+lp.cy)/2;
    var pupilSpan=Math.abs(rp.cx-lp.cx);
    var vPadTop=pupilSpan*.4,vPadBot=pupilSpan*.6;
    var cX=Math.max(0,ctrX-pupilSpan*1.1),cY=Math.max(0,ctrY-vPadTop);
    var cW=Math.min(cwC-cX,pupilSpan*2.2),cH=Math.min(chC-cY,vPadTop+vPadBot);
    var s=580/cW;cv.width=Math.round(cW*s);cv.height=Math.round(cH*s);
    var rx=cv.getContext('2d');rx.drawImage(img,cX,cY,cW,cH,0,0,cv.width,cv.height);
    function xm(x){return(x-cX)*s} function ym(y){return(y-cY)*s}
    // Frame boxes
    for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t2=fpt(eye+'_frame_top'),b2=fpt(eye+'_frame_bottom'),inn=fpt(eye+'_frame_inner'),out=fpt(eye+'_frame_outer');
      if(t2&&b2&&inn&&out){
        var lx2=Math.min(xm(inn.cx),xm(out.cx)),rx2=Math.max(xm(inn.cx),xm(out.cx)),ty2=ym(t2.cy),by2=ym(b2.cy);
        rx.fillStyle='rgba(74,144,217,.08)';rx.fillRect(lx2,ty2,rx2-lx2,by2-ty2);
        rx.strokeStyle='#4A90D9';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.strokeRect(lx2,ty2,rx2-lx2,by2-ty2);rx.setLineDash([])}}
    // Pupils
    for(var i=0;i<pts.length;i++){var p=pts[i];if(p.id.indexOf('pupil')>=0){var px2=xm(p.cx),py2=ym(p.cy);
      rx.setLineDash([3,3]);rx.strokeStyle='rgba(255,255,255,.7)';rx.lineWidth=.75;rx.beginPath();rx.arc(px2,py2,14,0,6.283);rx.stroke();
      rx.strokeStyle='rgba(241,196,15,.8)';rx.lineWidth=.5;rx.beginPath();rx.arc(px2,py2,4,0,6.283);rx.stroke();
      rx.strokeStyle='#E74C3C';rx.lineWidth=.75;rx.beginPath();rx.moveTo(px2-19,py2);rx.lineTo(px2+19,py2);rx.moveTo(px2,py2-19);rx.lineTo(px2,py2+19);rx.stroke();rx.setLineDash([])}}
    // Eye level
    if(rp&&lp){rx.strokeStyle='#27AE60';rx.lineWidth=1;rx.setLineDash([4,4]);rx.beginPath();rx.moveTo(xm(rp.cx),ym(rp.cy));rx.lineTo(xm(lp.cx),ym(lp.cy));rx.stroke();rx.setLineDash([])}
    // Frame center
    var ri2=fpt('right_frame_inner'),li2=fpt('left_frame_inner');
    if(ri2&&li2){rx.strokeStyle='rgba(255,255,255,.5)';rx.lineWidth=.75;rx.setLineDash([6,4]);var fcx2=xm((ri2.cx+li2.cx)/2);rx.beginPath();rx.moveTo(fcx2,0);rx.lineTo(fcx2,cv.height);rx.stroke();rx.setLineDash([])}
    // PD
    if(rp&&lp&&result.pd){var midY2=(ym(rp.cy)+ym(lp.cy))/2,aY=midY2-38;rx.strokeStyle='#E74C3C';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.beginPath();rx.moveTo(xm(rp.cx),aY);rx.lineTo(xm(lp.cx),aY);rx.stroke();rx.setLineDash([]);
      rx.fillStyle='#E74C3C';rx.beginPath();rx.arc(xm(rp.cx),aY,1.5,0,6.283);rx.fill();rx.beginPath();rx.arc(xm(lp.cx),aY,1.5,0,6.283);rx.fill();
      rx.font='bold 13px "Microsoft YaHei",sans-serif';rx.fillStyle='#E74C3C';rx.textAlign='center';rx.fillText('PD:'+result.pd.toFixed(1)+'mm',(xm(rp.cx)+xm(lp.cx))/2,aY-7)}
    // PH
    for(var ei=0;ei<2;ei++){var eye2=ei===0?'right':'left',pp2=fpt(eye2+'_pupil'),bb2=fpt(eye2+'_frame_bottom');if(pp2&&bb2&&pp2.p3d){var ph2=pp2.p3d[1]?bb2.p3d[1]-pp2.p3d[1]:0;var lx3=xm(pp2.cx)+(eye2==='right'?-25:25),tY2=ym(pp2.cy),bY2=ym(bb2.cy);
      rx.strokeStyle='#F39C12';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.beginPath();rx.moveTo(lx3,bY2);rx.lineTo(lx3,tY2);rx.stroke();rx.setLineDash([]);
      rx.fillStyle='#F39C12';rx.beginPath();rx.arc(lx3,bY2,1.5,0,6.283);rx.fill();rx.beginPath();rx.arc(lx3,tY2,1.5,0,6.283);rx.fill();
      rx.font='bold 11px "Microsoft YaHei",sans-serif';rx.fillStyle='#F39C12';if(eye2==='right'){rx.textAlign='right';rx.fillText('PH:'+ph2.toFixed(1)+'mm',lx3-5,(tY2+bY2)/2+4)}else{rx.textAlign='left';rx.fillText('PH:'+ph2.toFixed(1)+'mm',lx3+5,(tY2+bY2)/2+4)}}}
  }else if(mode==='side'){
    var mrg=300; var sMinX=cwC,sMaxX=0,sMinY=cwC,sMaxY=0;
    var stP=fpt('side_frame_top'),sbP=fpt('side_frame_bottom'),scP=fpt('side_cornea');
    if(stP){sMinX=Math.min(sMinX,stP.cx);sMaxX=Math.max(sMaxX,stP.cx);sMinY=Math.min(sMinY,stP.cy);sMaxY=Math.max(sMaxY,stP.cy)}
    if(sbP){sMinX=Math.min(sMinX,sbP.cx);sMaxX=Math.max(sMaxX,sbP.cx);sMinY=Math.min(sMinY,sbP.cy);sMaxY=Math.max(sMaxY,sbP.cy)}
    if(scP){sMinX=Math.min(sMinX,scP.cx);sMaxX=Math.max(sMaxX,scP.cx);sMinY=Math.min(sMinY,scP.cy);sMaxY=Math.max(sMaxY,scP.cy)}
    var scX=Math.max(0,sMinX-mrg),scY=Math.max(0,sMinY-mrg);
    var scW=Math.min(cwC-scX,(sMaxX+2*mrg)-scX),scH=Math.min(chC-scY,(sMaxY+2*mrg)-scY);
    var sS=580/scW;cv.width=Math.round(scW*sS);cv.height=Math.round(scH*sS);
    var srx=cv.getContext('2d');srx.drawImage(img,scX,scY,scW,scH,0,0,cv.width,cv.height);
    function sxm(x){return(x-scX)*sS} function sym(y){return(y-scY)*sS}
    if(stP&&sbP){srx.strokeStyle='#F39C12';srx.lineWidth=2;srx.beginPath();srx.moveTo(sxm(stP.cx),sym(stP.cy));srx.lineTo(sxm(sbP.cx),sym(sbP.cy));srx.stroke();
      srx.fillStyle='#F39C12';srx.beginPath();srx.arc(sxm(stP.cx),sym(stP.cy),5,0,6.283);srx.fill();srx.arc(sxm(sbP.cx),sym(sbP.cy),5,0,6.283);srx.fill()}
    if(scP){srx.strokeStyle='#2ECC71';srx.lineWidth=1.5;srx.beginPath();srx.arc(sxm(scP.cx),sym(scP.cy),14,0,6.283);srx.stroke();
      srx.fillStyle='#2ECC71';srx.beginPath();srx.arc(sxm(scP.cx),sym(scP.cy),4,0,6.283);srx.fill()}
    if(result.tilt_angle!=null){srx.font='bold 20px "Microsoft YaHei",sans-serif';srx.fillStyle='#F39C12';srx.fillText((result.tilt_angle||0).toFixed(1)+'°',12,30)}
  }
  return cv
}

var cv=document.getElementById('cv'),ctx=cv.getContext('2d');
var cc=document.getElementById('cc'),hint=document.getElementById('hint');
var mgDiv=document.getElementById('mg'),mgCvs=document.getElementById('mgc'),mgCtx=mgCvs.getContext('2d');

// ====== Coordinate transforms ======
function s2p(sx,sy){return{x:sx/scale+ox,y:sy/scale+oy}}
function p2s(px,py){return{x:(px-ox)*scale,y:(py-oy)*scale}}
function canvasRect(){return cv.getBoundingClientRect()}

// ====== API calls ======
async function apiMatch(cx,cy){try{var d=await(await fetch('/api/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cx:cx,cy:cy})})).json();return{lx:d.left?d.left.x:cx,ly:d.left?d.left.y:cy,rx:d.right?d.right.x:cx,ry:d.right?d.right.y:cy,p3d:d['3d']}}catch(e){return{lx:cx,ly:cy,rx:cx,ry:cy,p3d:[0,0,0]}}}
function getPt(id){for(var i=0;i<pts.length;i++){if(pts[i].id===id)return pts[i]}return null}
function getPtS(id){for(var i=0;i<sidePts.length;i++){if(sidePts[i].id===id)return sidePts[i]}return null}

var prepared=0,previewStream=null,camDevices=[];
var canvasOut=null; // preview video element hidden

async function prepare(){
  document.getElementById('st').textContent='Requesting...';
  document.getElementById('btnCap').disabled=true;document.getElementById('btnReview').disabled=true;
  try{
    var ts=await navigator.mediaDevices.getUserMedia({video:true});ts.getTracks().forEach(function(t){t.stop()});
    camDevices=(await navigator.mediaDevices.enumerateDevices()).filter(function(d){return d.kind==='videoinput'});
    if(camDevices.length<1){alert('No camera');return}
    // Read camera config to find center camera's browser index
    var centerBr = 1; // default
    try{
      var cfgResp=await fetch('/api/get_cams');
      var cfg=await cfgResp.json();
      if(cfg&&cfg.center!==undefined){
        var bm={0:0,1:1,2:2};
        try{bm=(await(await fetch('/api/br_map')).json())||bm}catch(e){}
        var dsIdx=cfg.center;
        centerBr = bm[dsIdx]!==undefined?bm[dsIdx]:dsIdx;
      }
    }catch(e){}
    previewStream=await navigator.mediaDevices.getUserMedia({
      video:{deviceId:{exact:camDevices[centerBr].deviceId},width:1920,height:1080}
    });
    // Show preview video directly in canvas container
    var pv=document.createElement('video');
    pv.id='previewVid';pv.autoplay=true;pv.playsInline=true;pv.muted=true;
    pv.srcObject=previewStream;
    pv.style.cssText='width:100%;height:100%;object-fit:contain;background:#000';
    var ccDiv=document.getElementById('cc');
    ccDiv.innerHTML='';ccDiv.appendChild(pv);
    prepared=1;document.getElementById('btnCap').disabled=false;
    document.getElementById('st').textContent='Ready. Capture when positioned.';
  }catch(e){document.getElementById('st').textContent='Error: '+e.message}
}

async function captureFront(){
  if(!prepared){alert('Click Prepare first');return}
  document.getElementById('st').textContent='Capturing front...';
  var pv=document.getElementById('previewVid');
  if(pv){
    var cw2=cc.clientWidth,ch2=cc.clientHeight;
    cv.width=cw2;cv.height=ch2;
    cv.getContext('2d').drawImage(pv,0,0,cw2,ch2);
    cc.innerHTML='';cc.appendChild(cv);
  }
  if(previewStream){previewStream.getTracks().forEach(function(t){t.stop()});previewStream=null}
  canvasOut=null;prepared=0;
  await new Promise(function(r){setTimeout(r,300)});
  try{
    var resp=await fetch('/api/capture',{method:'POST'});
    var d=await resp.json();
    if(d.error){alert(d.error);return}
    frontCaptured=1; W=d.w;H=d.h;
    frontPts=[];frontStep=0;curMode='f';await loadMode('f');
    var ccDiv=document.getElementById('cc');ccDiv.innerHTML='';ccDiv.appendChild(cv);
    img=new Image();
    img.onload=function(){
      fitImage();draw();
      document.getElementById('st').textContent='标注正面: 点右瞳孔';showHintMsg('Step 1/4: Click RIGHT pupil')
    };
    img.src='/api/image/center?t='+Date.now();
    document.getElementById('btnCapSide').disabled=false
  }catch(e){alert('Capture failed: '+e.message)}
  document.getElementById('btnCap').disabled=true
}

async function captureSide(){
  // Close preview stream to free camera for capture_three.exe
  var pv=document.getElementById('previewVid');
  if(pv){pv.srcObject=null; pv.remove()}
  if(previewStream){previewStream.getTracks().forEach(function(t){t.stop()});previewStream=null}
  prepared=0; document.getElementById('btnCap').disabled=true;
  await new Promise(function(r){setTimeout(r,500)});
  try{
    var resp=await fetch('/api/capture_side',{method:'POST'});
    var d=await resp.json();
    if(d.error){alert(d.error);return}
    sideCaptured=1; sidePts=[];sideStep=0;
    W=d.w;H=d.h;
    curMode='s';await loadMode('s');
    var ccDiv=document.getElementById('cc');ccDiv.innerHTML='';ccDiv.appendChild(cv);
    img=new Image();
    img.onload=function(){fitImage();draw()};
    img.src='/api/image_side/center?t='+Date.now();
    document.getElementById('btnAnnotS').disabled=false;
    document.getElementById('st').textContent='侧面已就绪，标注侧面'
  }catch(e){alert('Side capture failed: '+e.message)}
}

function switchAnnotation(mode){
  saveMode(); curMode=mode; loadMode(mode);
  var ccDiv=document.getElementById('cc');ccDiv.innerHTML='';ccDiv.appendChild(cv);
  if(mode==='f'){
    document.getElementById('btnAnnotF').style.background='#f0ad4e';
    document.getElementById('btnAnnotS').style.background='';
    if(!img.src||img.src===''){img.src='/api/image/center?t='+Date.now(); img.onload=function(){fitImage();draw()}}
    else{
      img.src='/api/image/center?t='+Date.now(); img.onload=function(){fitImage();draw()}
    }
    document.getElementById('st').textContent='标注正面: '+(frontStep<4?('Step '+(frontStep+1)+'/4'):'完成');
  }else{
    document.getElementById('btnAnnotF').style.background='';
    document.getElementById('btnAnnotS').style.background='#f0ad4e';
    img.src='/api/image_side/center?t='+Date.now(); img.onload=function(){fitImage();draw()};
    document.getElementById('st').textContent='标注侧面: '+(sideStep<3?('Step '+(sideStep+1)+'/3'):'完成')
  }
  hideHint(); draw();
  document.getElementById('btnAnnotF').disabled=mode==='f';
  document.getElementById('btnAnnotS').disabled=mode==='s'
}

function saveMode(){
  if(curMode==='f'){frontPts=pts.slice(); frontStep=step}
  else{sidePts=pts.slice(); sideStep=step}
}
function loadMode(mode){
  curMode=mode;
  if(mode==='f'){pts=frontPts.slice(); step=frontStep}
  else{pts=sidePts.slice(); step=sideStep}
}

function fitImage(){
  var r=cc.getBoundingClientRect();var cw=r.width,ch=r.height;scale=cw*.85/W;scale=Math.max(.1,Math.min(5,scale));ox=(W-cw/scale)/2;oy=(H-ch/scale)/2
}
function showHintMsg(msg){hint.textContent=msg;hint.style.opacity='1';showHint=1}
function hideHint(){hint.style.opacity='0';showHint=0}

// ====== Magnifier ======
function showMagnifier(px,py){
  var s=p2s(px,py),rect=canvasRect();
  mgX=s.x+rect.left;mgY=s.y+rect.top;
  var sz=150;var l=mgX-sz-20,t=mgY-sz-20;
  if(l<0)l=mgX+20;if(t<0)t=mgY+20;if(l+sz>window.innerWidth)l=mgX-sz-20;if(t+sz>window.innerHeight)t=mgY-sz-20;
  mgDiv.style.left=Math.max(0,l)+'px';mgDiv.style.top=Math.max(0,t)+'px';mgDiv.style.display='block';
  mgCtx.clearRect(0,0,300,300);mgCtx.save();mgCtx.beginPath();mgCtx.arc(150,150,150,0,6.283);mgCtx.clip();
  var mz=4,ss=300/mz;mgCtx.drawImage(img,px-ss/2,py-ss/2,ss,ss,0,0,300,300);
  mgCtx.strokeStyle='rgba(255,0,0,.5)';mgCtx.lineWidth=1;mgCtx.setLineDash([4,4]);
  mgCtx.beginPath();mgCtx.moveTo(150,0);mgCtx.lineTo(150,300);mgCtx.moveTo(0,150);mgCtx.lineTo(300,150);mgCtx.stroke();mgCtx.setLineDash([]);
  mgCtx.restore();showMg=1
}
function hideMagnifier(){mgDiv.style.display='none';showMg=0}
function findNearby(px,py){var thr=30/scale,best=null,bestD=thr;for(var i=0;i<pts.length;i++){var p=pts[i];var dx=p.cx-px,dy=p.cy-py;var d=Math.sqrt(dx*dx+dy*dy);if(d<bestD){bestD=d;best=p}}return best}

// ====== Drawing ======
function draw(){
  var r=cc.getBoundingClientRect();cv.width=r.width*dpr;cv.height=r.height*dpr;cv.style.width=r.width+'px';cv.style.height=r.height+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);
  ctx.save();ctx.setTransform(scale*dpr,0,0,scale*dpr,-ox*scale*dpr,-oy*scale*dpr);
  ctx.drawImage(img,0,0,W,H);
  // Helper: look up front points
  function fpt(id){for(var i=0;i<frontPts.length;i++)if(frontPts[i].id===id)return frontPts[i];return null}
  if(curMode==='f'){
  // Frame center line
  var ri=fpt('right_frame_inner'),li=fpt('left_frame_inner');
  if(ri&&li){ctx.strokeStyle='rgba(255,255,255,.4)';ctx.lineWidth=1;ctx.setLineDash([6,4]);ctx.beginPath();var fcx=(ri.cx+li.cx)/2;ctx.moveTo(fcx,0);ctx.lineTo(fcx,H);ctx.stroke();ctx.setLineDash([])}
  // Eye level line
  var rp=fpt('right_pupil'),lp=fpt('left_pupil');
  if(rp&&lp){ctx.strokeStyle='#27AE60';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(rp.cx,rp.cy);ctx.lineTo(lp.cx,lp.cy);ctx.stroke()}
  // Frame boxes
  for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t=fpt(eye+'_frame_top'),b=fpt(eye+'_frame_bottom'),inn=fpt(eye+'_frame_inner'),out=fpt(eye+'_frame_outer');
    if(t&&b&&inn&&out){
      var lx=Math.min(inn.cx,out.cx),rx=Math.max(inn.cx,out.cx),ty=t.cy,by=b.cy;
      ctx.fillStyle='rgba(74,144,217,.08)';ctx.fillRect(lx,ty,rx-lx,by-ty);ctx.strokeStyle='#4A90D9';ctx.lineWidth=1.5;ctx.strokeRect(lx,ty,rx-lx,by-ty);
      // Handles
      var hs=8/scale;ctx.fillStyle='#fff';ctx.strokeStyle='#4A90D9';ctx.lineWidth=1.5;ctx.setLineDash([]);
      var midX=(inn.cx+out.cx)/2,midY=(t.cy+b.cy)/2;
      var hx=[midX,midX,inn.cx,out.cx],hy=[t.cy,b.cy,midY,midY];
      for(var hi=0;hi<4;hi++){ctx.fillRect(hx[hi]-hs/2,hy[hi]-hs/2,hs,hs);ctx.strokeRect(hx[hi]-hs/2,hy[hi]-hs/2,hs,hs)}
      // Edge guide lines
      ctx.strokeStyle='rgba(149,165,166,.5)';ctx.lineWidth=1;ctx.setLineDash([4,6]);
      ctx.beginPath();ctx.moveTo(lx,ty);ctx.lineTo(lx,0);ctx.stroke();ctx.beginPath();ctx.moveTo(lx,ty);ctx.lineTo(0,ty);ctx.stroke();
      ctx.beginPath();ctx.moveTo(rx,ty);ctx.lineTo(rx,0);ctx.stroke();ctx.beginPath();ctx.moveTo(rx,ty);ctx.lineTo(W,ty);ctx.stroke();
      ctx.beginPath();ctx.moveTo(lx,by);ctx.lineTo(lx,H);ctx.stroke();ctx.beginPath();ctx.moveTo(lx,by);ctx.lineTo(0,by);ctx.stroke();
      ctx.beginPath();ctx.moveTo(rx,by);ctx.lineTo(rx,H);ctx.stroke();ctx.beginPath();ctx.moveTo(rx,by);ctx.lineTo(W,by);ctx.stroke();
      ctx.setLineDash([])
    }
  }
  // Pupil icons (from frontPts)
  for(var i=0;i<frontPts.length;i++){var p=frontPts[i];if(p.id.indexOf('pupil')>=0){var or=22,ir=7;ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.cx,p.cy,or,0,6.283);ctx.stroke();ctx.strokeStyle='rgba(241,196,15,.8)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.cx,p.cy,ir,0,6.283);ctx.stroke();ctx.strokeStyle='#E74C3C';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(p.cx-or-5,p.cy);ctx.lineTo(p.cx+or+5,p.cy);ctx.moveTo(p.cx,p.cy-or-5);ctx.lineTo(p.cx,p.cy+or+5);ctx.stroke();ctx.fillStyle='#E74C3C';ctx.beginPath();ctx.arc(p.cx,p.cy,3,0,6.283);ctx.fill()}}
  } // end front annotation block
  // Side annotation drawing
  if(curMode==='s'){var st=getPtS('side_frame_top'),sb=getPtS('side_frame_bottom'),sc=getPtS('side_cornea');
    if(st&&sb){ctx.strokeStyle='#F39C12';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(st.cx,st.cy);ctx.lineTo(sb.cx,sb.cy);ctx.stroke();
      ctx.fillStyle='#F39C12';ctx.beginPath();ctx.arc(st.cx,st.cy,6/scale,0,6.283);ctx.fill();ctx.arc(sb.cx,sb.cy,6/scale,0,6.283);ctx.fill()}
    if(sc){ctx.strokeStyle='rgba(46,204,113,.9)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(sc.cx,sc.cy,20/scale,0,6.283);ctx.stroke();
      ctx.fillStyle='#2ECC71';ctx.beginPath();ctx.arc(sc.cx,sc.cy,5/scale,0,6.283);ctx.fill()}
  }
  // Drag preview
  if(drag&&ds&&de){ctx.strokeStyle='#0f0';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.strokeRect(Math.min(ds.x,de.x),Math.min(ds.y,de.y),Math.abs(de.x-ds.x),Math.abs(de.y-ds.y));ctx.setLineDash([])}
  ctx.restore();
  // Results overlay
  if(rp&&lp&&rp.p3d&&lp.p3d){ctx.fillStyle='#0f0';ctx.font='bold 14px monospace';ctx.fillText('PD:'+Math.sqrt(Math.pow(lp.p3d[0]-rp.p3d[0],2)+Math.pow(lp.p3d[1]-rp.p3d[1],2)).toFixed(1)+'mm',r.width-170,22)}
  updateStatusBar();updateResults()
}

// ====== Handle detection (in screen coords) ======
function hitHandle(sx,sy){
  for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t=getPt(eye+'_frame_top'),b=getPt(eye+'_frame_bottom'),inn=getPt(eye+'_frame_inner'),out=getPt(eye+'_frame_outer');
    if(!t||!b||!inn||!out)continue;
    var midX=(inn.cx+out.cx)/2,midY=(t.cy+b.cy)/2;
    var hs=12;
    var hd=[
      {id:eye+'_frame_top',    x:p2s(midX,0).x,    y:p2s(0,t.cy).y},
      {id:eye+'_frame_bottom', x:p2s(midX,0).x,    y:p2s(0,b.cy).y},
      {id:eye+'_frame_inner',  x:p2s(inn.cx,0).x,  y:p2s(0,midY).y},
      {id:eye+'_frame_outer',  x:p2s(out.cx,0).x,  y:p2s(0,midY).y}
    ];
    for(var hi=0;hi<4;hi++){var h=hd[hi];if(sx>h.x-hs/2&&sx<h.x+hs/2&&sy>h.y-hs/2&&sy<h.y+hs/2)return{id:h.id}}
  }return null
}

// ====== Mouse events ======
cv.addEventListener('mousedown',async function(e){
  var rect=canvasRect(),sx=e.clientX-rect.left,sy=e.clientY-rect.top;
  var photo=s2p(sx,sy);
  if(e.button===1||(e.button===0&&space)){panning=1;panSX=e.clientX;panSY=e.clientY;panOX=ox;panOY=oy;cv.style.cursor='grabbing';return}
  if(e.button!==0)return;
  // Handle hit?
  var h=hitHandle(sx,sy);if(h){hdrag=1;hdragId=h.id;hdragPt=s2p(sx,sy);return}
  // Draggable placed point?
  var near=findNearby(photo.x,photo.y);if(near){dragPtId=near.id;hideMagnifier();return}
  // New annotation
  if(curMode==='s'){
    if(step>=3)return;
    var ids=['side_frame_top','side_frame_bottom','side_cornea'];
    var labels=['标注镜框上缘','标注镜框下缘','标注角膜顶点'];
    pts.push({id:ids[step],cx:Math.round(photo.x),cy:Math.round(photo.y)});
    step++; sideStep=step; sidePts=pts.slice(); draw();
    var msg=step<3?'Step '+(step+1)+'/3: '+labels[step]:'3/3 完成';
    showHintMsg(msg); document.getElementById('st').textContent=msg
  }else{
    if(step>=4)return;
    if(step<2){var id=step===0?'right_pupil':'left_pupil';pts.push({id:id,cx:Math.round(photo.x),cy:Math.round(photo.y)});step++;frontStep=step;frontPts=pts.slice();draw();showHintMsg('Step '+(step+1)+'/4: '+(step===1?'Click LEFT pupil':(step===2?'Drag RIGHT frame':'Drag LEFT frame')));document.getElementById('st').textContent='Step '+step+'/4'}
    else{drag=1;deye=step===2?'right':'left';ds={x:photo.x,y:photo.y};de={x:photo.x,y:photo.y}}
  }
});
cv.addEventListener('mousemove',async function(e){
  var rect=canvasRect(),sx=e.clientX-rect.left,sy=e.clientY-rect.top;mouseX=sx;mouseY=sy;
  var photo=s2p(sx,sy);
  if(panning){ox=panOX-(e.clientX-panSX)/scale;oy=panOY-(e.clientY-panSY)/scale;draw();return}
  if(hdrag&&hdragId){handleMove(sx,sy);showMagnifier(photo.x,photo.y);return}
  if(dragPtId){var pt=getPt(dragPtId);if(pt){pt.cx=Math.round(photo.x);pt.cy=Math.round(photo.y)};draw();showMagnifier(photo.x,photo.y);return}
  if(drag){de={x:photo.x,y:photo.y};draw();return}
  // Cursor + magnifier
  var near=findNearby(photo.x,photo.y);cv.style.cursor=near?'grab':'crosshair';
  if(near){if(!showMg&&!mgTimer){var px=photo.x,py=photo.y;mgTimer=setTimeout(function(){if(Math.abs(mouseX-sx)<3&&Math.abs(mouseY-sy)<3)showMagnifier(px,py);mgTimer=null},300)};if(showMg)showMagnifier(photo.x,photo.y)}
  else{hideMagnifier();if(mgTimer){clearTimeout(mgTimer);mgTimer=null}}
});
window.addEventListener('mouseup',async function(e){
  if(panning){panning=0;cv.style.cursor='crosshair';return}
  if(hdrag){var hid=hdragId;hdrag=0;hdragId=null;draw();return}
  if(dragPtId){dragPtId=null;return}
  if(!drag)return;drag=0;var eye=deye;deye=null;
  // Use actual mouse event position (e.clientX, e.clientY) for final rect, not de
  var rect2=canvasRect();
  var endPos=s2p(e.clientX-rect2.left,e.clientY-rect2.top);
  var lx=Math.min(ds.x,endPos.x),rx=Math.max(ds.x,endPos.x),ty=Math.min(ds.y,endPos.y),by=Math.max(ds.y,endPos.y);
  var mx=(lx+rx)/2,my=(ty+by)/2,nx=eye==='right'?rx:lx,ox=eye==='right'?lx:rx;
  document.getElementById('st').textContent='Matching frame...';
  var corners=[[eye+'_frame_top',mx,ty],[eye+'_frame_bottom',mx,by],[eye+'_frame_inner',nx,my],[eye+'_frame_outer',ox,my]],batch=[];
  for(var ci=0;ci<4;ci++){batch.push({id:corners[ci][0],cx:Math.round(corners[ci][1]),cy:Math.round(corners[ci][2])})}
  pts=pts.concat(batch);step++;frontStep=step;frontPts=pts.slice();draw();document.getElementById('st').textContent=step>=4?'All done! Click Compute or drag handles.':'Step '+(step+1)+'/4';showHintMsg(step>=4?'Click Compute for results.':'Step '+(step+1)+'/4')
});
cv.addEventListener('wheel',function(e){e.preventDefault();var rect=canvasRect(),sx=e.clientX-rect.left,sy=e.clientY-rect.top;var ps=s2p(sx,sy),zs=scale;scale*=e.deltaY<0?1.09:1/1.09;scale=Math.max(.1,Math.min(5,scale));ox=ps.x-sx/scale;oy=ps.y-sy/scale;draw()},{passive:false});
cv.addEventListener('contextmenu',function(e){e.preventDefault()});
cv.addEventListener('mouseenter',function(){mouseOnCanvas=1;if(showHint)hint.style.opacity='1'});
cv.addEventListener('mouseleave',function(){mouseOnCanvas=0;hideMagnifier();if(mgTimer){clearTimeout(mgTimer);mgTimer=null}panning=0;dragPtId=null;cv.style.cursor='default'});

function handleMove(sx,sy){
  var pt=getPt(hdragId);if(!pt)return;var eye=hdragId.split('_')[0],t=getPt(eye+'_frame_top'),b=getPt(eye+'_frame_bottom'),inn=getPt(eye+'_frame_inner'),out=getPt(eye+'_frame_outer');if(!t||!b||!inn||!out)return;
  var ip=s2p(sx,sy),pos=hdragId.split('_').pop();
  if(pos==='top'||pos==='bottom'){pt.cy=Math.round(ip.y);pt.cx=Math.round((inn.cx+out.cx)/2);if(pos==='top'&&pt.cy>b.cy-2)pt.cy=b.cy-2;if(pos==='bottom'&&pt.cy<t.cy+2)pt.cy=t.cy+2;t.cx=pt.cx;b.cx=pt.cx}
  else{pt.cx=Math.round(ip.x);pt.cy=Math.round((t.cy+b.cy)/2);
    if(pos==='inner'){if(eye==='right'&&pt.cx<out.cx+2)pt.cx=out.cx+2;if(eye==='left'&&pt.cx>out.cx-2)pt.cx=out.cx-2}
    else{if(eye==='right'&&pt.cx>inn.cx-2)pt.cx=inn.cx-2;if(eye==='left'&&pt.cx<inn.cx+2)pt.cx=inn.cx+2}
    inn.cy=pt.cy;out.cy=pt.cy}
  draw()
}

// ====== Keyboard ======
window.addEventListener('keydown',function(e){if(e.code==='Space'){e.preventDefault();space=1;cv.style.cursor='grab'}if(e.ctrlKey&&e.code==='KeyZ'){e.preventDefault();undo()}});
window.addEventListener('keyup',function(e){if(e.code==='Space'){space=0;if(!panning)cv.style.cursor='crosshair'}});

// ====== Results update ======
function updateResults(){
  // Front measurements (from frontPts)
  var fp=frontPts;
  function fpt(id){for(var i=0;i<fp.length;i++){if(fp[i].id===id)return fp[i]}return null}
  var rp=fpt('right_pupil'),lp=fpt('left_pupil'),ri=fpt('right_frame_inner'),li=fpt('left_frame_inner');
  if(rp&&lp&&rp.p3d&&lp.p3d){var dx=lp.p3d[0]-rp.p3d[0],dy=lp.p3d[1]-rp.p3d[1],pd=Math.sqrt(dx*dx+dy*dy)*pdCorr;document.getElementById('vp').textContent=pd.toFixed(1)+' mm';
    if(ri&&li&&ri.p3d&&li.p3d){var mx=(ri.p3d[0]+li.p3d[0])/2;document.getElementById('vr').textContent=(mx-rp.p3d[0]).toFixed(1)+' mm';document.getElementById('vl').textContent=(lp.p3d[0]-mx).toFixed(1)+' mm'}
    for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',pp=fpt(eye+'_pupil'),bb=fpt(eye+'_frame_bottom');if(pp&&bb&&pp.p3d&&bb.p3d){document.getElementById('vp'+(eye==='right'?'r':'l')).textContent=(bb.p3d[1]-pp.p3d[1]).toFixed(1)+' mm'}}
  }
  var ro=fpt('right_frame_outer'),lo=fpt('left_frame_outer'),
      rt=fpt('right_frame_top'),rb=fpt('right_frame_bottom'),
      lt=fpt('left_frame_top'),lb=fpt('left_frame_bottom');
  if(ri&&ro&&li&&lo&&ri.p3d&&ro.p3d&&li.p3d&&lo.p3d){
    var rw=Math.abs(ro.p3d[0]-ri.p3d[0]),lw=Math.abs(lo.p3d[0]-li.p3d[0]);
    document.getElementById('vw').textContent=((rw+lw)/2).toFixed(1)+' mm';
    document.getElementById('vb').textContent=Math.abs(li.p3d[0]-ri.p3d[0]).toFixed(1)+' mm'
  }
  if(rt&&rb&&lt&&lb&&rt.p3d&&rb.p3d&&lt.p3d&&lb.p3d){
    var rh=Math.abs(rb.p3d[1]-rt.p3d[1]),lh=Math.abs(lb.p3d[1]-lt.p3d[1]);
    document.getElementById('vh').textContent=((rh+lh)/2).toFixed(1)+' mm'
  }
}
function updateStatusBar(){
  document.getElementById('ss').textContent=Math.round(scale*100)+'%';document.getElementById('sp').textContent='('+Math.round(s2p(mouseX,mouseY).x)+','+Math.round(s2p(mouseX,mouseY).y)+')';
  document.getElementById('sz').textContent=W+'x'+H;document.getElementById('sm').textContent=step+'/'+(curMode==='s'?3:4)
}
var rvData=null;var rvZoom=[1,1,1];var rvPan=[0,0,0,0,0,0]; // 3 panels: zoom, panX, panY each
var rvImgs=[new Image(),new Image(),new Image()];
var rvDrag=null,rvDragSide=null;var rvPanning=0,rvPanStart=[0,0],rvPanOrig=[0,0];

function review(){
  if(frontPts.length===0){alert('No points to review');return}
  rvData=JSON.parse(JSON.stringify(frontPts));rvDrag=null;rvDragSide=null;rvZoom=[1,1,1];rvPan=[0,0,0,0,0,0];rvFitDone=false;
  var loaded=0;
  function tryDraw(){loaded++;if(loaded>=3){drawRV()}setTimeout(drawRV,500)}
  for(var si=0;si<3;si++){(function(idx){
    rvImgs[idx]=new Image();rvImgs[idx].onload=tryDraw;rvImgs[idx].onerror=tryDraw;
    rvImgs[idx].src='/api/image/'+(idx===0?'left':idx===1?'center':'right')+'?t='+Date.now()
  })(si)}
  document.getElementById('rvModal').classList.add('show')
}

function rvPtAt(side,cvx,cvy){
  // cvx,cvy are canvas pixel coords. Convert to image coords using zoom/pan
  var si=side==='left'?0:side==='center'?1:2;
  var z=rvZoom[si],px=rvPan[si*2],py=rvPan[si*2+1];
  var ix=(cvx-px)/z,iy=(cvy-py)/z;
  if(ix<0||ix>=W||iy<0||iy>=H)return null;
  var best=null,bestD=25/z;
  for(var i=0;i<rvData.length;i++){
    var p=rvData[i];var ppx=side==='left'?p.lx:side==='center'?p.cx:p.rx;
    var ppy=side==='left'?p.ly:side==='center'?p.cy:p.ry;
    if(typeof ppx==='undefined'||ppx===null)continue;
    var d=Math.sqrt((ix-ppx)*(ix-ppx)+(iy-ppy)*(iy-ppy));
    if(d<bestD){bestD=d;best=i}
  }
  return best
}

var rvFitDone=false;

function drawRV(){
  var cvs=[document.getElementById('rvCvL'),document.getElementById('rvCvC'),document.getElementById('rvCvR')];
  var sides=['left','center','right'];
  var dws=[250,250,250];var dhs=[250,250,250];
  var panels=document.querySelectorAll('.rvP');
  for(var pi=0;pi<3;pi++){
    if(panels[pi]){dws[pi]=panels[pi].clientWidth;dhs[pi]=panels[pi].clientHeight}
    // Auto-fit zoom on first draw
    if(!rvFitDone&&dws[pi]>0&&dhs[pi]>0){
      var fit=Math.min(dws[pi]/W,dhs[pi]/H);
      rvZoom[pi]=fit;rvPan[pi*2]=(dws[pi]-W*fit)/2;rvPan[pi*2+1]=(dhs[pi]-H*fit)/2
    }
    cvs[pi].width=dws[pi];cvs[pi].height=dhs[pi];var ctx=cvs[pi].getContext('2d');ctx.clearRect(0,0,dws[pi],dhs[pi]);
    var z=rvZoom[pi],px=rvPan[pi*2],py=rvPan[pi*2+1];
    if(rvImgs[pi]&&rvImgs[pi].complete&&rvImgs[pi].naturalWidth>0){
      ctx.save();ctx.translate(px,py);ctx.scale(z,z);ctx.drawImage(rvImgs[pi],0,0,W,H);ctx.restore()
    }
    // Draw points
    ctx.save();ctx.translate(px,py);ctx.scale(z,z);
    for(var i=0;i<rvData.length;i++){
      var p=rvData[i];var ppx,pppy,id=p.id;
      if(pi===0){ppx=p.lx;pppy=p.ly}else if(pi===1){ppx=p.cx;pppy=p.cy}else{ppx=p.rx;pppy=p.ry}
      if(typeof ppx==='undefined'||ppx===null)continue;
      var isP=id.indexOf('pupil')>=0,isSel=(rvDrag!==null&&rvDrag===i&&rvDragSide===sides[pi]);
      ctx.strokeStyle=isSel?'#f00':isP?'#0f0':'#4af';ctx.lineWidth=isSel?3/z:isP?2/z:1.5/z;
      ctx.beginPath();ctx.arc(ppx,pppy,isP?14:8,0,6.28);ctx.stroke();
      if(isSel){ctx.fillStyle='#f00';ctx.beginPath();ctx.arc(ppx,pppy,3,0,6.28);ctx.fill()}
      var short=id.replace('right_','R').replace('left_','L').replace('_frame','').replace('_pupil','P');
      ctx.fillStyle=isSel?'#ff0':'#0f0';ctx.font=(10/z)+'px monospace';ctx.fillText(short,ppx+isP?16:10,pppy-10)
    }
    ctx.restore();
    // Zoom indicator
    ctx.fillStyle='#ff0';ctx.font='11px monospace';ctx.fillText(Math.round(z*100)+'%',5,15)
  }
  rvFitDone=true
}

// Panel interaction: wheel=zoom, drag=pan, click near point=adjust
document.querySelectorAll('.rvP canvas').forEach(function(cvs,si){
  var side=si===0?'left':si===1?'center':'right';
  cvs.addEventListener('wheel',function(e){
    e.preventDefault();var rect=cvs.getBoundingClientRect();
    var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var oz=rvZoom[si];var nz=Math.max(0.5,Math.min(5,oz*(e.deltaY<0?1.2:1/1.2)));
    var ix=(mx-rvPan[si*2])/oz,iy=(my-rvPan[si*2+1])/oz;
    rvZoom[si]=nz;rvPan[si*2]=mx-ix*nz;rvPan[si*2+1]=my-iy*nz;
    drawRV()
  },{passive:false});
  cvs.addEventListener('mousedown',function(e){
    var rect=cvs.getBoundingClientRect();var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var idx=rvPtAt(side,mx,my);
    if(idx!==null){rvDrag=idx;rvDragSide=side;drawRV();return}
    // Pan
    rvPanning=1;rvPanStart=[e.clientX,e.clientY];rvPanOrig=[rvPan[si*2],rvPan[si*2+1]]
  });
  cvs.addEventListener('mousemove',function(e){
    var rect=cvs.getBoundingClientRect();var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    if(rvPanning){rvPan[si*2]=rvPanOrig[0]+(e.clientX-rvPanStart[0]);rvPan[si*2+1]=rvPanOrig[1]+(e.clientY-rvPanStart[1]);drawRV();return}
    if(rvDrag!==null&&rvDragSide===side){
      var z=rvZoom[si];var ix=(mx-rvPan[si*2])/z,iy=(my-rvPan[si*2+1])/z;
      if(side==='left'){rvData[rvDrag].lx=Math.round(ix);rvData[rvDrag].ly=Math.round(iy)}
      else if(side==='center'){rvData[rvDrag].cx=Math.round(ix);rvData[rvDrag].cy=Math.round(iy)}
      else{rvData[rvDrag].rx=Math.round(ix);rvData[rvDrag].ry=Math.round(iy)}
      drawRV()
    }
  })
});

document.addEventListener('mouseup',function(){
  if(rvDrag!==null){rvDrag=null;rvDragSide=null;drawRV()}
  rvPanning=0
});

function rvSwapLR(){
  var tmp=rvImgs[0];rvImgs[0]=rvImgs[2];rvImgs[2]=tmp;
  for(var i=0;i<rvData.length;i++){
    var p=rvData[i];var tlx=p.lx,tly=p.ly,trx=p.rx,try2=p.ry;
    p.lx=trx;p.ly=try2;p.rx=tlx;p.ry=tly
  }
  drawRV()
}

async function rvRecalc(){
  document.getElementById('rvResult').textContent='复核计算中...';
  for(var i=0;i<rvData.length;i++){
    var p=rvData[i];
    var resp=await fetch('/api/tri',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lx:p.lx,ly:p.ly,cx:p.cx,cy:p.cy,rx:p.rx,ry:p.ry})});
    var d=await resp.json();if(!d.error)p.p3d=d['3d']
  }
  frontPts=JSON.parse(JSON.stringify(rvData)); if(curMode==='f')pts=frontPts.slice();
  var rp=getPt('right_pupil'),lp=getPt('left_pupil');
  var info='';
  if(rp&&lp&&rp.p3d&&lp.p3d){
    var dx=lp.p3d[0]-rp.p3d[0],dy=lp.p3d[1]-rp.p3d[1],pd=Math.sqrt(dx*dx+dy*dy);
    info='复核 PD: '+pd.toFixed(1)+'mm';
  }
  document.getElementById('rvModal').classList.remove('show');
  document.getElementById('st').textContent=info||'复核完成';
  updateResults();draw()
}

function undo(){if(pts.length>0){var last=pts[pts.length-1];if(last.id.indexOf('side_')>=0){pts.pop();step--;sideStep=step;sidePts=pts.slice()}else if(last.id.indexOf('frame_')>=0){var eye=last.id.split('_')[0];['_frame_top','_frame_bottom','_frame_inner','_frame_outer'].forEach(function(s){var k=eye+s;if(getPt(k)){for(var i=pts.length-1;i>=0;i--){if(pts[i].id===k){pts.splice(i,1);break}}}});step--;frontStep=step;frontPts=pts.slice()}else{pts.pop();step--;if(curMode==='f'){frontStep=step;frontPts=pts.slice()}else{sideStep=step;sidePts=pts.slice()}}draw()}}

async function compute(){
  saveMode();
  
  // Front compute
  if(frontCaptured && frontPts.length>0){
    document.getElementById('st').textContent='Computing front...';
    pts=frontPts; step=frontStep;
    for(var i=0;i<pts.length;i++){var p=pts[i];var m=await apiMatch(p.cx,p.cy);p.lx=m.lx;p.ly=m.ly;p.rx=m.rx;p.ry=m.ry;p.p3d=m.p3d}
    frontPts=pts; frontStep=step;
    document.getElementById('btnReview').disabled=false
  }
  
  // Side compute
  if(sideCaptured && sidePts.length>0){
    document.getElementById('st').textContent='Computing side...';
    var t2=getPtS('side_frame_top'),b2=getPtS('side_frame_bottom'),c2=getPtS('side_cornea');
    if(t2&&b2&&c2){
      var r=await fetch('/api/side_measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        top_x:t2.cx,top_y:t2.cy,bottom_x:b2.cx,bottom_y:b2.cy,cornea_x:c2.cx,cornea_y:c2.cy
      })});
      var d=await r.json();
      document.getElementById('va').textContent=d.tilt_angle.toFixed(1)+'°';
      document.getElementById('vd').textContent=d.vertex_distance_mm.toFixed(1)+' mm'
    }
  }
  
  await loadMode(curMode);
  draw();updateResults();
  document.getElementById('st').textContent='计算完成';
  document.getElementById('btnReview').disabled=false
}

async function report(){
  function fpt(id){for(var i=0;i<frontPts.length;i++)if(frontPts[i].id===id)return frontPts[i];return null}
  var rp=fpt('right_pupil'),lp=fpt('left_pupil'),ri=fpt('right_frame_inner'),li=fpt('left_frame_inner');
  if(!rp||!lp||!rp.p3d||!lp.p3d){alert('Annotate pupils first');return}
  
  // Compute results from frontPts
  var dx=lp.p3d[0]-rp.p3d[0],dy=lp.p3d[1]-rp.p3d[1],pd=Math.sqrt(dx*dx+dy*dy);
  var mxMono=(ri&&li&&ri.p3d&&li.p3d)?(ri.p3d[0]+li.p3d[0])/2:0;
  var rpd=ri&&ri.p3d?(mxMono-rp.p3d[0]):0,lpd=li&&li.p3d?(lp.p3d[0]-mxMono):0;
  
  // Clear report area
  document.getElementById('rimg').innerHTML='<div style=color:#888>生成中...</div>';
  
  // Generate front annotated image
  var frontImg=await new Promise(function(resolve){
    var im=new Image(); im.crossOrigin='anonymous';
    im.onload=function(){resolve(im)}; im.onerror=function(){resolve(null)};
    im.src='/api/image/center?t='+Date.now()
  });
  
  if(frontImg){
    // Crop anchored on pupils, sized by interpupillary span
    var ctrX=(rp.cx+lp.cx)/2, ctrY=(rp.cy+lp.cy)/2;
    var pupilSpan=Math.abs(rp.cx-lp.cx);
    var vPadTop=pupilSpan*.4, vPadBot=pupilSpan*.6;
    var cX=Math.max(0,ctrX-pupilSpan*1.1),cY=Math.max(0,ctrY-vPadTop);
    var cW=Math.min(frontImg.width-cX,pupilSpan*2.2),cH=Math.min(frontImg.height-cY,vPadTop+vPadBot);
    
    var rcv=document.createElement('canvas');
    var s=580/cW;rcv.width=Math.round(cW*s);rcv.height=Math.round(cH*s);
    var rx=rcv.getContext('2d');
    rx.drawImage(frontImg,cX,cY,cW,cH,0,0,rcv.width,rcv.height);
    function xm(x){return(x-cX)*s} function ym(y){return(y-cY)*s}
    // Frame boxes
    for(var ei=0;ei<2;ei++){var eye=ei===0?'right':'left',t=fpt(eye+'_frame_top'),b=fpt(eye+'_frame_bottom'),inn=fpt(eye+'_frame_inner'),out=fpt(eye+'_frame_outer');
      if(t&&b&&inn&&out){
        var lx2=Math.min(xm(inn.cx),xm(out.cx)),rx2=Math.max(xm(inn.cx),xm(out.cx)),ty2=ym(t.cy),by2=ym(b.cy);
        rx.fillStyle='rgba(74,144,217,.08)';rx.fillRect(lx2,ty2,rx2-lx2,by2-ty2);
        rx.strokeStyle='#4A90D9';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.strokeRect(lx2,ty2,rx2-lx2,by2-ty2);rx.setLineDash([])
      }}
    // Pupils
    for(var i=0;i<frontPts.length;i++){var p=frontPts[i];if(p.id.indexOf('pupil')>=0){var px2=xm(p.cx),py2=ym(p.cy);
      rx.setLineDash([3,3]);rx.strokeStyle='rgba(255,255,255,.7)';rx.lineWidth=.75;rx.beginPath();rx.arc(px2,py2,14,0,6.283);rx.stroke();
      rx.strokeStyle='rgba(241,196,15,.8)';rx.lineWidth=.5;rx.beginPath();rx.arc(px2,py2,4,0,6.283);rx.stroke();
      rx.strokeStyle='#E74C3C';rx.lineWidth=.75;rx.beginPath();rx.moveTo(px2-19,py2);rx.lineTo(px2+19,py2);rx.moveTo(px2,py2-19);rx.lineTo(px2,py2+19);rx.stroke();rx.setLineDash([])}}
    // Eye level
    if(rp&&lp){rx.strokeStyle='#27AE60';rx.lineWidth=1;rx.setLineDash([4,4]);rx.beginPath();rx.moveTo(xm(rp.cx),ym(rp.cy));rx.lineTo(xm(lp.cx),ym(lp.cy));rx.stroke();rx.setLineDash([])}
    // Frame center
    if(ri&&li){rx.strokeStyle='rgba(255,255,255,.5)';rx.lineWidth=.75;rx.setLineDash([6,4]);var fcx2=xm((ri.cx+li.cx)/2);rx.beginPath();rx.moveTo(fcx2,0);rx.lineTo(fcx2,rcv.height);rx.stroke();rx.setLineDash([])}
    // PD arrow
    if(rp&&lp){var midY2=(ym(rp.cy)+ym(lp.cy))/2,aY=midY2-38;rx.strokeStyle='#E74C3C';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.beginPath();rx.moveTo(xm(rp.cx),aY);rx.lineTo(xm(lp.cx),aY);rx.stroke();rx.setLineDash([]);
      rx.fillStyle='#E74C3C';rx.beginPath();rx.arc(xm(rp.cx),aY,1.5,0,6.283);rx.fill();rx.beginPath();rx.arc(xm(lp.cx),aY,1.5,0,6.283);rx.fill();
      rx.font='bold 13px "Microsoft YaHei",sans-serif';rx.fillStyle='#E74C3C';rx.textAlign='center';rx.fillText('PD: '+pd.toFixed(1)+'mm',(xm(rp.cx)+xm(lp.cx))/2,aY-7)}
    // PH arrows
    for(var ei=0;ei<2;ei++){var eye2=ei===0?'right':'left',pp2=fpt(eye2+'_pupil'),bb2=fpt(eye2+'_frame_bottom');if(pp2&&bb2&&pp2.p3d&&bb2.p3d){var ph2=bb2.p3d[1]-pp2.p3d[1];var lx3=xm(pp2.cx)+(eye2==='right'?-25:25),tY2=ym(pp2.cy),bY2=ym(bb2.cy);
      rx.strokeStyle='#F39C12';rx.lineWidth=.75;rx.setLineDash([4,3]);rx.beginPath();rx.moveTo(lx3,bY2);rx.lineTo(lx3,tY2);rx.stroke();rx.setLineDash([]);
      rx.fillStyle='#F39C12';rx.beginPath();rx.arc(lx3,bY2,1.5,0,6.283);rx.fill();rx.beginPath();rx.arc(lx3,tY2,1.5,0,6.283);rx.fill();
      rx.font='bold 11px "Microsoft YaHei",sans-serif';rx.fillStyle='#F39C12';if(eye2==='right'){rx.textAlign='right';rx.fillText('PH: '+ph2.toFixed(1)+'mm',lx3-5,(tY2+bY2)/2+4)}else{rx.textAlign='left';rx.fillText('PH: '+ph2.toFixed(1)+'mm',lx3+5,(tY2+bY2)/2+4)}}}
    document.getElementById('rimg').innerHTML='';
    document.getElementById('rimg').appendChild(rcv);
    
    // Side image if available
    if(sideCaptured){
      var sideImg=await new Promise(function(resolve){
        var si=new Image(); si.crossOrigin='anonymous';
        si.onload=function(){resolve(si)}; si.onerror=function(){resolve(null)};
        si.src='/api/image_side/center?t='+Date.now()
      });
      if(sideImg){
        var stP=getPtS('side_frame_top'),sbP=getPtS('side_frame_bottom'),scP=getPtS('side_cornea');
        // Crop center point (midpoint of annotations)
        var sidePts=[];
        if(stP)sidePts.push({x:stP.cx,y:stP.cy});if(sbP)sidePts.push({x:sbP.cx,y:sbP.cy});if(scP)sidePts.push({x:scP.cx,y:scP.cy});
        var sMinX=Infinity,sMaxX=-Infinity,sMinY=Infinity,sMaxY=-Infinity;
        for(var i=0;i<sidePts.length;i++){var sp=sidePts[i];if(sp.x<sMinX)sMinX=sp.x;if(sp.x>sMaxX)sMaxX=sp.x;if(sp.y<sMinY)sMinY=sp.y;if(sp.y>sMaxY)sMaxY=sp.y}
        var sCX=(sMinX+sMaxX)/2, sCY=(sMinY+sMaxY)/2;
        // Use front crop aspect ratio
        var frontAR=cW/Math.max(cH,1);
        var sRangeX=(sMaxX-sMinX)*2+600; var sRangeY=sRangeX/frontAR; // match front proportions, wider view
        var scX=Math.max(0,sCX-sRangeX),scY=Math.max(0,sCY-sRangeY);
        var scW=Math.min(sideImg.width-scX,sRangeX*2),scH=Math.min(sideImg.height-scY,sRangeY*2);
        // Scale to exactly match front canvas size
        var srcv=document.createElement('canvas');
        srcv.width=rcv.width;srcv.height=rcv.height;
        var srx=srcv.getContext('2d');
        srx.drawImage(sideImg,scX,scY,scW,scH,0,0,srcv.width,srcv.height);
        function sxm(x){return(x-scX)/scW*srcv.width} function sym(y){return(y-scY)/scH*srcv.height}
        if(stP&&sbP){
          srx.strokeStyle='#F39C12';srx.lineWidth=2;srx.beginPath();srx.moveTo(sxm(stP.cx),sym(stP.cy));srx.lineTo(sxm(sbP.cx),sym(sbP.cy));srx.stroke();
          srx.fillStyle='#F39C12';srx.beginPath();srx.arc(sxm(stP.cx),sym(stP.cy),5,0,6.283);srx.fill();srx.arc(sxm(sbP.cx),sym(sbP.cy),5,0,6.283);srx.fill();
        }
        if(scP){srx.strokeStyle='#2ECC71';srx.lineWidth=1.5;srx.beginPath();srx.arc(sxm(scP.cx),sym(scP.cy),14,0,6.283);srx.stroke();
          srx.fillStyle='#2ECC71';srx.beginPath();srx.arc(sxm(scP.cx),sym(scP.cy),4,0,6.283);srx.fill()}
        srcv.style.maxWidth='100%';srcv.style.marginTop='12px';
        var hdr=document.createElement('div');hdr.textContent='侧面测量';hdr.style.cssText='font-weight:bold;margin-top:12px;color:#f0ad4e;font-size:14px';
        document.getElementById('rimg').appendChild(hdr);
        document.getElementById('rimg').appendChild(srcv)
      }
    }
  }
  
  // Data table
  var rows=[ ['瞳距',pd.toFixed(1)+' mm','立体测量'],['右单眼瞳距',rpd.toFixed(1)+' mm',''],['左单眼瞳距',lpd.toFixed(1)+' mm',''] ];
  for(var ei=0;ei<2;ei++){var eyeE=ei===0?'right':'left',ppE=fpt(eyeE+'_pupil'),bbE=fpt(eyeE+'_frame_bottom');if(ppE&&bbE&&ppE.p3d&&bbE.p3d)rows.push([eyeE==='right'?'右眼瞳高':'左眼瞳高',(bbE.p3d[1]-ppE.p3d[1]).toFixed(1)+' mm',''])}
  // Averaged frame metrics
  var roF=fpt('right_frame_outer'),loF=fpt('left_frame_outer');
  var rtF=fpt('right_frame_top'),rbF=fpt('right_frame_bottom'),ltF=fpt('left_frame_top'),lbF=fpt('left_frame_bottom');
  if(ri&&roF&&li&&loF&&ri.p3d&&roF.p3d&&li.p3d&&loF.p3d){
    var rw2=Math.abs(roF.p3d[0]-ri.p3d[0]),lw2=Math.abs(loF.p3d[0]-li.p3d[0]);
    rows.push(['片宽',((rw2+lw2)/2).toFixed(1)+' mm','']);
    rows.push(['中梁',Math.abs(li.p3d[0]-ri.p3d[0]).toFixed(1)+' mm','']);
  }
  if(rtF&&rbF&&ltF&&lbF&&rtF.p3d&&rbF.p3d&&ltF.p3d&&lbF.p3d){
    var rh2=Math.abs(rbF.p3d[1]-rtF.p3d[1]),lh2=Math.abs(lbF.p3d[1]-ltF.p3d[1]);
    rows.push(['片高',((rh2+lh2)/2).toFixed(1)+' mm','']);
  }
  // Side data
  var vaEl=document.getElementById('va'),vdEl=document.getElementById('vd');
  if(vaEl&&vaEl.textContent!=='--')rows.push(['前倾角',vaEl.textContent,'侧面测量']);
  if(vdEl&&vdEl.textContent!=='--')rows.push(['镜眼距',vdEl.textContent,'侧面测量']);
  var h='<thead><tr><th>参数</th><th>测量值</th><th>备注</th></tr></thead><tbody>';
  for(var ri2=0;ri2<rows.length;ri2++){h+='<tr><td>'+rows[ri2][0]+'</td><td>'+rows[ri2][1]+'</td><td>'+rows[ri2][2]+'</td></tr>'}
  h+='</tbody>';document.getElementById('rtable').innerHTML=h;
  
  // Suggestions
  var sug=[],fw=roF&&ri&&roF.p3d&&ri.p3d?Math.abs(roF.p3d[0]-ri.p3d[0]):0;
  sug.push('推荐镜片直径：≥ '+(Math.round(fw+10))+' mm（框宽+余量）');
  if(Math.abs(rpd-lpd)>1)sug.push('左右单眼瞳距差 '+Math.abs(rpd-lpd).toFixed(1)+'mm，建议加工时区分左右眼');
  if(Math.abs(rpd-lpd)>2)sug.push('较大单眼瞳距不对称，请确认标注准确性');
  document.getElementById('rsug').innerHTML='';for(var si=0;si<sug.length;si++){var li=document.createElement('li');li.textContent=sug[si];document.getElementById('rsug').appendChild(li)}
  
  // Metadata
  var now=new Date();document.getElementById('rid').textContent='OM-'+now.getFullYear()+('0'+(now.getMonth()+1)).slice(-2)+('0'+now.getDate()).slice(-2)+'-'+('0'+now.getHours()).slice(-2)+('0'+now.getMinutes()).slice(-2)+('0'+now.getSeconds()).slice(-2);
  document.getElementById('rdt').textContent=now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2)+'-'+('0'+now.getDate()).slice(-2);
  document.getElementById('modal').classList.add('show')
}

async function saveReport(){
  var close=document.getElementById('rclose'),save=document.getElementById('rsave');
  close.style.display='none';save.style.display='none';
  try{var c=await html2canvas(document.getElementById('rpt'),{scale:2,backgroundColor:'#fff',useCORS:true,allowTaint:true});close.style.display='';save.style.display='';
    var a=document.createElement('a');a.download='戴镜测量AI分析报告_'+document.getElementById('rid').textContent+'.png';a.href=c.toDataURL('image/png');a.click()}
  catch(e){close.style.display='';save.style.display='';alert('Save failed: '+e.message)}
}
var setData = {};

async function toggleSettings(){
  var m = document.getElementById('setModal');
  if(m.classList.contains('show')){m.classList.remove('show');return}
  m.classList.add('show');
  document.getElementById('setContent').innerHTML='';
  document.getElementById('setLoading').style.display='block';
  try{
    var r = await fetch('/api/cam_props'); setData = await r.json();
    // Refresh pd_correction from server
    try{var rc=await fetch('/api/user_config');var dc=await rc.json();pdCorr=dc.pd_correction||1.0}catch(e){}
    document.getElementById('setLoading').style.display='none';
    buildSettingsUI()
  }catch(e){
    document.getElementById('setLoading').style.display='none';
    document.getElementById('setContent').innerHTML='<span style=color:#f00>'+e.message+'</span>'
  }
}

function buildSettingsUI(){
  var sides = ['left','center','right'];
  var labels = {'whitebalance':'色温','brightness':'亮度','saturation':'饱和度','exposure':'曝光'};
  var names = {'left':'左摄','center':'中摄','right':'右摄'};
  var html = '';
  for(var si=0;si<sides.length;si++){
    var side = sides[si];
    var props = setData[side];
    if(!props){continue}
    html += '<div class=camBlock><h4>'+names[side]+'</h4>';
    for(var pk in labels){
      var p = props[pk];
      if(!p) continue;
      var v = p.value, mn = p.min, mx = p.max;
      html += '<div class=row><span class=lbl>'+labels[pk]+'</span>';
      html += '<input type=range min='+mn+' max='+mx+' value='+v+' data-side='+side+' data-prop='+pk+' oninput=rangeUpdate(this)>';
      html += '<span class=val>'+v+(p.unit||'')+'</span>';
      html += '<button class=btn onclick=setOneProp("'+side+'","'+pk+'")>应用</button>';
      html += '</div>';
    }
    html += '</div>';
  }
  document.getElementById('setContent').innerHTML = html;
  // Add PD correction section
  var pdHtml = '<div class=camBlock style="margin-top:12px"><h4>瞳距校正</h4>';
  pdHtml += '<div class=row><span class=lbl>校正系数</span>';
  pdHtml += '<input type=number id=pdCorrInp value='+pdCorr.toFixed(4)+' step=0.001 min=0.9 max=1.2 style="width:80px;text-align:center">';
  pdHtml += '<span class=val style=margin-left:4px>（系数 = 真实PD � 实测PD）</span>';
  pdHtml += '</div>';
  pdHtml += '<div style=color:#888;font-size:11px;margin-top:4px>1m测试距离建议系数 ≈ 1.012，系数直接生效无需重启</div>';
  pdHtml += '</div>';
  document.getElementById('setContent').innerHTML += pdHtml
}

function rangeUpdate(el){
  var row = el.parentElement;
  var valEl = row.querySelector('.val');
  if(valEl){
    var u = '';
    var props = setData[el.dataset.side];
    if(props && props[el.dataset.prop]){
      u = props[el.dataset.prop].unit || ''
    }
    valEl.textContent = el.value + u
  }
}

async function setOneProp(side, prop){
  var inp = document.querySelector('input[data-side='+side+'][data-prop='+prop+']');
  if(!inp) return;
  try{
    var r = await fetch('/api/cam_set',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({side:side,prop:prop,value:parseInt(inp.value)})
    });
    var d = await r.json();
    if(d.error){alert(d.error)}
  }catch(e){alert(e.message)}
}

async function saveAllSettings(){
  var inputs = document.querySelectorAll('#setContent input[type=range]');
  for(var i=0;i<inputs.length;i++){
    var inp = inputs[i];
    try{
      await fetch('/api/cam_set',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({side:inp.dataset.side,prop:inp.dataset.prop,value:parseInt(inp.value)})
      })
    }catch(e){}
  }
  // Also save WB to config file for capture exe
  var wbInp = document.querySelector('input[data-prop=whitebalance]');
  if(wbInp){
    try{
      await fetch('/api/save_wb',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({wb:parseInt(wbInp.value)})
      })
    }catch(e){}
  }
  // Save PD correction
  var pcInp = document.getElementById('pdCorrInp');
  if(pcInp){
    var v = parseFloat(pcInp.value);
    if(!isNaN(v) && v>=0.9 && v<=1.2){
      pdCorr = v;
      try{
        await fetch('/api/user_config',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({pd_correction:v})
        })
      }catch(e){console.log('pd save failed:',e)}
    }
  }
  alert('设置已保存')
}
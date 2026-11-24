'use strict';
const el = id => document.getElementById(id);
let cloud = new Map();
const measures = [], photos = [];
const tell = message => { el('status').textContent = message; };
function download(content, ext, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = (el('room').value.trim() || 'Ambiente') + ext;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
el('measure').onsubmit = event => {
  event.preventDefault();
  const nome = el('label').value.trim(), mm = el('mm').valueAsNumber;
  if (!nome || !Number.isFinite(mm) || mm <= 0) return;
  measures.push({nome, mm, origem:'trena'});
  const li = document.createElement('li'); li.textContent = nome + ' · ' + mm + ' mm';
  el('list').append(li); event.target.reset();
};
el('photo').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, 1440 / Math.max(img.width,img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(scale*img.width)); canvas.height = Math.max(1,Math.round(scale*img.height));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const src = canvas.toDataURL('image/jpeg',0.82);
    photos.push(src); const thumb = new Image(); thumb.src = src; thumb.alt = 'Foto ' + photos.length; el('strip').append(thumb);
  } catch { tell('Foto incompatível. Tente uma foto JPEG.'); }
  finally { URL.revokeObjectURL(url); event.target.value = ''; }
};
el('report').onclick = () => download(JSON.stringify({ambiente:el('room').value,medidas:measures,fotosJPEG:photos},null,2),'.json','application/json');
el('ply').onclick = () => {
  const header = 'ply\nformat ascii 1.0\ncomment meters Z up\nelement vertex '+cloud.size+'\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
  download(header+Array.from(cloud.values(),p=>p.join(' ')).join('\n')+'\n','.ply','application/octet-stream');
};
async function detect() {
  let ok = false;
  try { ok = await navigator.xr?.isSessionSupported('immersive-ar'); } catch {}
  el('scan').disabled = !ok;
  tell(ok ? 'Realidade aumentada disponível. A profundidade será verificada ao iniciar.' : 'Este navegador permite usar a ficha de campo. Captura 3D por profundidade indisponível.');
}
el('scan').onclick = async () => {
  if (cloud.size && !confirm('Começar outra nuvem e substituir os pontos da sessão anterior?')) return;
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar',{
      requiredFeatures:['depth-sensing','dom-overlay'],domOverlay:{root:el('hud')},
      depthSensing:{usagePreference:['cpu-optimized'],dataFormatPreference:['luminance-alpha','float32']}
    });
    const gl = document.createElement('canvas').getContext('webgl',{xrCompatible:true,alpha:true});
    if (!gl) throw Error('WebGL indisponível');
    await gl.makeXRCompatible();
    const layer = new XRWebGLLayer(session,gl);
    session.updateRenderState({baseLayer:layer});
    const space = await session.requestReferenceSpace('local');
    cloud = new Map(); el('ply').disabled = true;
    const count = document.createElement('span'), done = document.createElement('button');
    done.textContent = 'Concluir'; done.onclick = () => session.end();
    el('hud').replaceChildren(count,done);
    session.addEventListener('end',()=>{
      el('hud').replaceChildren(); el('ply').disabled = !cloud.size;
      tell(cloud.size ? cloud.size+' pontos em memória. Toque em Salvar nuvem PLY.' : 'Captura encerrada sem amostras de profundidade.');
    },{once:true});
    let last = -1000;
    function frame(time,frame) {
      session.requestAnimationFrame(frameLoop);
      gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (time-last < 180 || cloud.size >= 200000) return;
      last = time;
      const view = frame.getViewerPose(space)?.views[0]; if (!view) return;
      const depth = frame.getDepthInformation(view); if (!depth) return;
      const inv = DOMMatrix.fromFloat32Array(view.projectionMatrix).inverse();
      const world = DOMMatrix.fromFloat32Array(view.transform.matrix);
      for(let j=0;j<32;j++) for(let i=0;i<40;i++) {
        const u=(i+.5)/40, v=(j+.5)/32;
        const d=depth.getDepthInMeters(u,v);
        if (!(d>.2 && d<6)) continue;
        const ray=inv.transformPoint(new DOMPoint(2*u-1,1-2*v,-1,1));
        const p=world.transformPoint(new DOMPoint(-ray.x*d/ray.z,-ray.y*d/ray.z,-d,1));
        const xyz=[p.x,-p.z,p.y];
        cloud.set(xyz.map(n=>Math.floor(n/.025)).join(','),xyz.map(n=>+n.toFixed(4)));
      }
      count.textContent=cloud.size+' pontos · ';
    }
    const frameLoop = (time,f) => { try { frame(time,f); } catch { session.end().catch(()=>{}); } };
    session.requestAnimationFrame(frameLoop);
  } catch(e) {
    if(session) await session.end().catch(()=>{});
    tell('Captura 3D indisponível ou permissão recusada ('+e.name+'). Você pode registrar fotos e medidas abaixo.');
  }
};
detect();

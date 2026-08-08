import { chromium } from 'playwright';
for (const [label, args] of [
  ['default', ['--no-sandbox']],
  ['gpu-forced', ['--no-sandbox','--ignore-gpu-blocklist','--enable-gpu-rasterization','--enable-zero-copy','--use-gl=angle','--use-angle=swiftshader']],
]) {
  const b = await chromium.launch({ args });
  const p = await (await b.newContext()).newPage();
  await p.setContent('<canvas id=c width=1200 height=800></canvas>');
  const info = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const c = document.getElementById('c');
    const ctx = c.getContext('2d');
    // Time 60 full-canvas multiply blits.
    const src = document.createElement('canvas'); src.width=1200; src.height=800;
    const sc = src.getContext('2d'); sc.fillStyle='#808080'; sc.fillRect(0,0,1200,800);
    const t0 = performance.now();
    for (let i=0;i<60;i++){ ctx.globalCompositeOperation='multiply'; ctx.drawImage(src,0,0); }
    ctx.getImageData(0,0,1,1);
    const ms = performance.now()-t0;
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl-no-dbg' : 'no-webgl'),
      msPer60Blits: +ms.toFixed(1),
      mpxPerSec: +((60*1200*800/1e6)/(ms/1000)).toFixed(0),
    };
  });
  console.log(label, JSON.stringify(info));
  await b.close();
}

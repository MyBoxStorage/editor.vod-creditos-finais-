import fs from "fs";
import { spawnSync } from "child_process";
const exportPath = "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/data/v2820282061/prontos/run_2026-07-22_15h03_semantic/3c8e4c22-5448-4011-b9d3-04bed71c6fcf_final.mp4";
const OX=0.55, OY=0.60, OW=0.35, OH=0.25;
const IX=0.1, IY=0.15, IW=0.37, IH=0.18;
function sample(videoPath, t, ox, oy, ow, oh) {
  const png = `C:/Users/pc/AppData/Local/Temp/frame-${t}.png`;
  spawnSync("ffmpeg", ["-y","-ss",String(t),"-i",videoPath,"-frames:v","1",png], {stdio:"ignore"});
  const probe = spawnSync("ffprobe", ["-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",png], {encoding:"utf8"});
  const j = JSON.parse(probe.stdout);
  const w = j.streams[0].width, h = j.streams[0].height;
  const cx = Math.round(w*(ox+ow/2)), cy = Math.round(h*(oy+oh/2));
  const cropW = Math.max(8, Math.round(w*ow*0.5)), cropH = Math.max(8, Math.round(h*oh*0.5));
  const cropX = Math.max(0, cx-Math.floor(cropW/2)), cropY = Math.max(0, cy-Math.floor(cropH/2));
  const raw = spawnSync("ffmpeg", ["-i",png,"-vf",`crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1:1`,"-f","rawvideo","-pix_fmt","rgb24","-"], {encoding:"buffer"});
  const buf = raw.stdout;
  let r=0,g=0,b=0,px=buf.length/3, varSum=0;
  for (let i=0;i<buf.length;i+=3){r+=buf[i];g+=buf[i+1];b+=buf[i+2];}
  const rMean=r/px,gMean=g/px,bMean=b/px;
  for (let i=0;i<buf.length;i+=3){varSum += Math.abs(buf[i]-rMean)+Math.abs(buf[i+1]-gMean)+Math.abs(buf[i+2]-bMean);}
  return {t,rMean:Math.round(rMean),gMean:Math.round(gMean),bMean:Math.round(bMean),colorVar:Math.round(varSum/px)};
}
const times=[4.0,5.5,6.5,7.0,7.5,8.0,8.5,9.0];
const out={};
for (const t of times){
  out[t]={ imageRegion: sample(exportPath,t,IX,IY,IW,IH), videoRegion: sample(exportPath,t,OX,OY,OW,OH) };
}
console.log(JSON.stringify(out,null,2));

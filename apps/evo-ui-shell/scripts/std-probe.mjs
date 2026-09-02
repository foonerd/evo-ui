import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { extname, join, normalize } from "node:path"; import { chromium } from "playwright-core";
const DIST=process.argv[2]; const OUT=process.argv[3]; const ORIENT=process.argv[4]||"landscape"; const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".json":"application/json"};
const s=http.createServer((q,r)=>{const p=decodeURIComponent((q.url||"/").split("?")[0]);let f=join(DIST,normalize(p));if(!existsSync(f)||p==="/")f=join(DIST,"index.html");try{r.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"});r.end(readFileSync(f));}catch{r.writeHead(404);r.end("x");}});
await new Promise(r=>s.listen(0,"127.0.0.1",r)); const base=`http://127.0.0.1:${s.address().port}/`;
const b=await chromium.launch({headless:true,args:["--no-sandbox"]}); const pg=await b.newPage({viewport:{width:1400,height:900}});
await pg.goto(base+"?designer=1&mock=1",{waitUntil:"networkidle",timeout:15000}); await pg.waitForTimeout(1100);
if(ORIENT==="portrait"){ await pg.getByText("Portrait",{exact:true}).first().click().catch(()=>{}); await pg.waitForTimeout(600); }
const info=await pg.evaluate(()=>{
  const root=document.querySelector(".designer-device-screen");
  const sb=document.querySelector(".designer-device-screen .app-sidebar");
  const layout=document.querySelector(".designer-device-screen .app-layout");
  const cs=layout?getComputedStyle(layout):null;
  return {
    interaction:document.documentElement.getAttribute("data-interaction"),
    deviceScreen: root?`${Math.round(root.getBoundingClientRect().width)}x${Math.round(root.getBoundingClientRect().height)}`:null,
    layoutCols: cs?cs.gridTemplateColumns:null,
    sidebarPresent: !!sb,
    sidebarText: sb?(sb.textContent||"").replace(/\s+/g," ").trim().slice(0,200):null,
    sidebarW: sb?Math.round(sb.getBoundingClientRect().width):null
  };
});
await pg.screenshot({path:join(OUT,`std-${ORIENT}-full.png`)});
const dev=await pg.$(".designer-device-screen");
if(dev) await dev.screenshot({path:join(OUT,`std-${ORIENT}-screen.png`)}).catch(()=>{});
console.log(JSON.stringify(info,null,2)); await b.close(); s.close();

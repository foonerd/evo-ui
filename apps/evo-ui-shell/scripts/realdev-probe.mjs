import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { extname, join, normalize } from "node:path"; import { chromium } from "playwright-core";
const DIST=process.argv[2]; const W=Number(process.argv[3]); const H=Number(process.argv[4]); const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".json":"application/json"};
const s=http.createServer((q,r)=>{const p=decodeURIComponent((q.url||"/").split("?")[0]);let f=join(DIST,normalize(p));if(!existsSync(f)||p==="/")f=join(DIST,"index.html");try{r.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"});r.end(readFileSync(f));}catch{r.writeHead(404);r.end("x");}});
await new Promise(r=>s.listen(0,"127.0.0.1",r)); const base=`http://127.0.0.1:${s.address().port}/`;
const b=await chromium.launch({headless:true,args:["--no-sandbox"]}); const pg=await b.newPage({viewport:{width:W,height:H}});
await pg.goto(base,{waitUntil:"networkidle",timeout:15000}); await pg.waitForTimeout(800);
const out=await pg.evaluate(()=>{const l=document.querySelector(".app-layout");const sb=document.querySelector(".app-sidebar");return{interaction:document.documentElement.getAttribute("data-interaction"),cols:l?getComputedStyle(l).gridTemplateColumns:null,sidebarDisplay:sb?getComputedStyle(sb).display:null,sidebarPos:sb?getComputedStyle(sb).position:null};});
console.log(JSON.stringify(out)); await b.close(); s.close();

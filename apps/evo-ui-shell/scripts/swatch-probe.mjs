import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { extname, join, normalize } from "node:path"; import { chromium } from "playwright-core";
const DIST=process.argv[2]; const OUT=process.argv[3]; const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".json":"application/json"};
const s=http.createServer((q,r)=>{const p=decodeURIComponent((q.url||"/").split("?")[0]);let f=join(DIST,normalize(p));if(!existsSync(f)||p==="/")f=join(DIST,"index.html");try{r.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"});r.end(readFileSync(f));}catch{r.writeHead(404);r.end("x");}});
await new Promise(r=>s.listen(0,"127.0.0.1",r)); const base=`http://127.0.0.1:${s.address().port}/`;
const b=await chromium.launch({headless:true,args:["--no-sandbox"]}); const pg=await b.newPage({viewport:{width:1280,height:850}});
await pg.goto(base+"?designer=1&mock=1",{waitUntil:"networkidle",timeout:15000}); await pg.waitForTimeout(1100);
await pg.getByText("Home",{exact:true}).first().click().catch(()=>{}); await pg.waitForTimeout(300);
const swatches=await pg.locator(".designer-theme-swatch").count();
await pg.locator('.designer-theme-swatch[aria-label="Air"]').click().catch(()=>{}); await pg.waitForTimeout(400);
const cls=await pg.evaluate(()=>{const sh=document.querySelector(".designer-device-screen .app-shell");return (sh?.className||"").toString().match(/theme-[a-z-]+/g)||[];});
// crop the appearance section for a clean look
await pg.screenshot({path:join(OUT,"theme-swatches-full.png")});
const panel=await pg.$(".designer-panel");
if(panel) await panel.screenshot({path:join(OUT,"theme-swatches-panel.png")}).catch(()=>{});
console.log(JSON.stringify({swatchCount:swatches, appShellThemeAfterAir:cls},null,2)); await b.close(); s.close();

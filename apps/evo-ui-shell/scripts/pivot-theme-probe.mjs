import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { extname, join, normalize } from "node:path"; import { chromium } from "playwright-core";
const DIST=process.argv[2]; const OUT=process.argv[3]; const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".json":"application/json"};
const s=http.createServer((q,r)=>{const p=decodeURIComponent((q.url||"/").split("?")[0]);let f=join(DIST,normalize(p));if(!existsSync(f)||p==="/")f=join(DIST,"index.html");try{r.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"});r.end(readFileSync(f));}catch{r.writeHead(404);r.end("x");}});
await new Promise(r=>s.listen(0,"127.0.0.1",r)); const base=`http://127.0.0.1:${s.address().port}/`;
const b=await chromium.launch({headless:true,args:["--no-sandbox"]}); const pg=await b.newPage({viewport:{width:1280,height:850}});
await pg.goto(base+"?designer=1&mock=1",{waitUntil:"networkidle",timeout:15000}); await pg.waitForTimeout(1100);
// choose 480x272 target
const pk=pg.locator(".designer-picker"); await pg.getByText("Change",{exact:false}).first().click().catch(()=>{}); await pg.waitForTimeout(400);
await pk.getByText("480x272",{exact:false}).first().click().catch(()=>{}); await pg.waitForTimeout(300);
await pk.getByText("4.3in",{exact:false}).first().click().catch(()=>{}); await pg.waitForTimeout(700);
// Scale tab -> theme air
await pg.getByText("Scale",{exact:true}).first().click().catch(()=>{}); await pg.waitForTimeout(300);
await pg.locator("select").first().selectOption("air").catch(()=>{}); await pg.waitForTimeout(400);
// open track
await pg.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch(()=>{}); await pg.waitForTimeout(500);
const out=await pg.evaluate(()=>{const sh=document.querySelector(".designer-device-screen .app-shell");const r=sh?getComputedStyle(sh):null;return{appShellThemeCls:(sh?.className||"").toString().match(/theme-[a-z-]+/g)||[],appShellBgVar:r?r.getPropertyValue("--background").trim():null,appShellBgImage:r?(r.backgroundImage||"").slice(0,40):null,hasGradient:r?/gradient/.test(r.backgroundImage):null};});
await pg.screenshot({path:join(OUT,"pivot-theme-air.png")});
console.log(JSON.stringify(out,null,2)); await b.close(); s.close();

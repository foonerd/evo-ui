import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { extname, join, normalize } from "node:path"; import { chromium } from "playwright-core";
const DIST=process.argv[2]; const OUT=process.argv[3]; const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".json":"application/json"};
const s=http.createServer((q,r)=>{const p=decodeURIComponent((q.url||"/").split("?")[0]);let f=join(DIST,normalize(p));if(!existsSync(f)||p==="/")f=join(DIST,"index.html");try{r.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"});r.end(readFileSync(f));}catch{r.writeHead(404);r.end("x");}});
await new Promise(r=>s.listen(0,"127.0.0.1",r)); const base=`http://127.0.0.1:${s.address().port}/`;
const b=await chromium.launch({headless:true,args:["--no-sandbox"]}); const pg=await b.newPage({viewport:{width:1280,height:850}});
await pg.goto(base+"?designer=1&mock=1",{waitUntil:"networkidle",timeout:15000}); await pg.waitForTimeout(1100);
// Home tab
await pg.getByText("Home",{exact:true}).first().click().catch(()=>{}); await pg.waitForTimeout(300);
const onScale=await pg.locator(".designer-scale select").count();
const themeOnHome=await pg.locator("select").count();
await pg.locator("select").first().selectOption("air").catch(()=>{}); await pg.waitForTimeout(400);
const cls=await pg.evaluate(()=>{const sh=document.querySelector(".designer-device-screen .app-shell");return (sh?.className||"").toString().match(/theme-[a-z-]+/g)||[];});
// check Scale tab no longer has the select
await pg.getByText("Scale",{exact:true}).first().click().catch(()=>{}); await pg.waitForTimeout(200);
const scaleHasSelect=await pg.locator(".designer-scale select, .designer-panel .designer-scale select").count();
await pg.screenshot({path:join(OUT,"home-theme.png")});
console.log(JSON.stringify({themeSelectCountOnHome:themeOnHome, appShellThemeAfterAir:cls, scaleSelectCount:scaleHasSelect},null,2)); await b.close(); s.close();

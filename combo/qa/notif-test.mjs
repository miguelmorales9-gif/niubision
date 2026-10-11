import vm from "node:vm"; import fs from "node:fs";
const src=fs.readFileSync("/tmp/nb-combo/sw.js","utf8"); const L={};
const self={location:new URL("https://combo.niubision-ui-preview.pages.dev/sw.js"),addEventListener:(t,f)=>L[t]=f,skipWaiting(){},clients:{}};
vm.runInNewContext(src,{self,caches:{},fetch(){},URL,Response,console,setTimeout,Promise,location:self.location,clients:self.clients});
const cases=[[undefined,"/app/"],["/","/app/"],["/?view=inbox","/app/?view=inbox"],["?view=work","/app/?view=work"],["bandeja","/app/?view=inbox"],["hoy","/app/?view=work"],["/app/?view=people","/app/?view=people"],["https://niubision.com/?view=inbox","https://niubision.com/?view=inbox"]];
let fail=0;
for(const [url,want] of cases){ let opened; self.clients.matchAll=async()=>[]; self.clients.openWindow=async t=>{opened=t};
  let p; L.notificationclick({notification:{close(){},data:url?{url}:{}},waitUntil:x=>p=x}); await p;
  const okk=opened===want; if(!okk)fail++; console.log(okk?"PASS":"FAIL",JSON.stringify(url),"->",opened); }
// existing window gets navigate()
let nav; self.clients.matchAll=async()=>[{url:"x",focus(){return 1},navigate(t){nav=t}}]; let p;L.notificationclick({notification:{close(){},data:{url:"inbox"}},waitUntil:x=>p=x});await p;console.log(nav==="/app/?view=inbox"?"PASS":"FAIL","existing window navigate ->",nav);
process.exit(fail);

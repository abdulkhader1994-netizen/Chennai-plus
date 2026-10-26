// Temporary check of map services for Near me.
import { writeFile } from "node:fs/promises";
const q=`[out:json][timeout:20];(nwr["amenity"="fuel"](around:1500,13.0418,80.2341););out center tags 60;`;
const EP=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter","https://overpass.private.coffee/api/interpreter"];
const out={};
for(const u of EP){
  for(const mode of ["post","get"]){
    try{
      const r=mode==="post"?await fetch(u,{method:"POST",body:"data="+encodeURIComponent(q),headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"ChennaiPlus/1.0"},signal:AbortSignal.timeout(25000)})
        :await fetch(u+"?data="+encodeURIComponent(q),{headers:{"User-Agent":"ChennaiPlus/1.0"},signal:AbortSignal.timeout(25000)});
      const t=await r.text();let c=null;try{c=JSON.parse(t).elements.length}catch{}
      out[u+" "+mode]={status:r.status,cors:r.headers.get("access-control-allow-origin"),count:c,head:c==null?t.slice(0,160):undefined};
    }catch(e){out[u+" "+mode]={error:e.message}}
  }
}
await writeFile("data/probe.json",JSON.stringify(out,null,1));console.log(out);

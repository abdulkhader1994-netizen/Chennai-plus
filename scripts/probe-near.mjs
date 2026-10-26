// Temporary check: runs the app's Near me queries for T. Nagar and saves counts.
import { writeFile } from "node:fs/promises";
const Q={petrol:'nwr["amenity"="fuel"]',station:'node["railway"~"^(station|halt)$"];node["station"="subway"];node["public_transport"="station"]["railway"]',bus:'node["highway"="bus_stop"]',hotel:'nwr["tourism"~"^(hotel|guest_house|motel|hostel)$"]',food:'nwr["amenity"~"^(restaurant|fast_food)$"]',tea:'nwr["amenity"="cafe"];nwr["shop"="tea"]'};
const out={};
for(const [k,v] of Object.entries(Q)){
  const q=`[out:json][timeout:20];(${v.split(";").map(x=>x+`(around:1500,13.0418,80.2341)`).join(";")};);out center tags 60;`;
  try{const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:"data="+encodeURIComponent(q),headers:{"Content-Type":"application/x-www-form-urlencoded"}});
    const j=await r.json();out[k]={status:r.status,count:j.elements.length,sample:j.elements.slice(0,4).map(e=>e.tags?.name||"(no name)")};}
  catch(e){out[k]={error:e.message}}
  await new Promise(r=>setTimeout(r,1500));
}
await writeFile("data/probe.json",JSON.stringify(out,null,1));console.log(out);

import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
it("observes disjoint near cuts",()=>{
 const read=(name:string)=> { const b=readFileSync(`C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-nearby-short-disjoint-20261105/${name}`); return parseMesh(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),"stl"); };
 const result=runScanEdit({kind:"scanEdit",action:"split",positions:read("source.stl"),target:read("cutter.stl")});
 writeFileSync("C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-nearby-short-disjoint-20261105/prototype.json",JSON.stringify({parts:result.diagnostics.parts,positions:Array.from(result.positions!)}));
});

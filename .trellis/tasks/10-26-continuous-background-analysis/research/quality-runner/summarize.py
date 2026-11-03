from pathlib import Path
import json,sys,hashlib
base=Path(__file__).resolve().parent
for p in sorted((base/"evidence").glob("*/validation.json")):
 d=json.loads(p.read_text()); ids={v["id"]:k for k,v in d.get("initialTasks",{}).items()}
 if d.get("createdTask"):ids[d["createdTask"]["id"]]="D"
 rows=[]; seen=set(); messages=[]; calls=[]
 for s in d.get("steps",[]):
  snap=s.get("snapshot") or {}; rnd=s.get("round") or s.get("detail") or {}; job=s.get("job") or {}
  msgs=[m for m in snap.get("messages",[]) if m.get("requestId")==job.get("requestId")]
  discovery=[m.get("taskDiscovery") for m in msgs if m.get("taskDiscovery")]
  errors=[{"tool":m.get("toolName"),"text":m.get("text")} for m in msgs if m.get("isError")]
  for m in msgs:
   if m.get("id") not in seen:seen.add(m.get("id"));messages.append(m)
  rows.append({"name":s["name"],"jobId":job.get("id"),"status":job.get("status"),"publication":rnd.get("publication"),"error":job.get("error"),"text":rnd.get("text"),"update":rnd.get("update"),"baseline":s.get("currentBaselines"),"deliveries":s.get("deliveries"),"usage":snap.get("lastResult",{}).get("usageSummary"),"repairs":[m["text"] for m in msgs if "[系统补做提示" in m.get("text","") and m.get("role")=="user"],"errors":errors,"discovery":[{"tasks":x["tasks"],"inputs":x["inputs"],"spatialResults":[{k:v for k,v in r.items() if k in ["resultRef","operation","values","warnings","summary","provenance"]} for r in x.get("spatialResults",[])]} for x in discovery],"duplicate":{k:s[k] for k in ["jobsBefore","jobsAfter","deliveriesBefore","deliveriesAfter"] if k in s}})
 result={"run":p.parent.name,"sourceRevision":d.get("sourceRevision"),"fixtureHash":d.get("fixtureHash"),"runnerHash":d.get("runnerHash"),"startedAt":d.get("startedAt"),"endedAt":d.get("endedAt"),"mechanismChecksPassed":d.get("mechanismChecksPassed"),"failure":d.get("failure"),"providerRequestCount":d.get("providerRequestCount"),"taskKeys":ids,"steps":rows}
 (p.parent/"review.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
 text=["# "+p.parent.name,"", "任务映射："+json.dumps(ids,ensure_ascii=False)]
 for s in rows:
  text.extend(["","## "+s["name"],"",s.get("text") or "（未发布正文）","","记录：",json.dumps(s.get("update"),ensure_ascii=False,indent=2)])
 (p.parent/"answers.md").write_text("\n".join(text)+"\n")
 print(json.dumps({"run":p.parent.name,"steps":len(rows),"mechanism":result["mechanismChecksPassed"],"failure":result["failure"]},ensure_ascii=False))

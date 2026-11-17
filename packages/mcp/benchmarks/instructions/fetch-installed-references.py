import argparse
import json
import os
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
parser = argparse.ArgumentParser(description="Fetch shared documentation for the 60 library cases.")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
suite = [r for r in json.loads(Path(__file__).with_name("trigger-eval-all.json").read_text())
         if r["set"] == "heldout"]
lib_names="""Kysely|Pinia|NestJS|Socket.IO|Vercel AI SDK|XState|Mapbox GL JS|Meilisearch|Nuxt|Mock Service Worker|Storybook|Chakra UI|Sentry JavaScript|Jotai|Ruby on Rails Solid Queue|Auth.js|Inngest|PostHog|sharp|Algolia Vue InstantSearch|ExcelJS|Twilio Verify|Sanity GROQ Portable Text|Temporal TypeScript SDK|Cypress|Electron|KafkaJS|Pino|Turborepo|MikroORM|Tauri|Three.js|Lit|Elysia|Motion React|Payload CMS|Apache ECharts|htmx|go-chi chi|clap Rust|HTTPX|Quarkus|Jetpack Compose Lifecycle|Laravel Livewire|Oban|Entity Framework Core|Knex.js|Mantine|GORM|Biome|pytest-asyncio|Valibot|AWS SAM CLI|Netlify CLI|Azure CLI|Pulumi|Railway CLI|Pino|Google BigQuery|Recharts""".split("|")
assert len(lib_names)==60
key = os.environ.get("CONTEXT7_API_KEY")
if not key:
    parser.error("Set CONTEXT7_API_KEY.")


def fetch(path, query):
 req=urllib.request.Request('https://context7.com/api/v2/'+path+'?'+urllib.parse.urlencode(query),headers={'Authorization':'Bearer '+key})
 with urllib.request.urlopen(req,timeout=35) as r: return r.read().decode()
def get(i):
 q=suite[i-1]["query"]
 lib=lib_names[i-1]
 try:
  r=json.loads(fetch('libs/search',{'libraryName':lib,'query':q}))['results'][0]
  lid=r['id']
  docs=fetch('context',{'libraryId':lid,'query':q})
  return str(i),dict(lib=lib,id=lid,docs=docs[:15000])
 except Exception as e:
  return str(i),dict(lib=lib,error=type(e).__name__+': '+str(e))
with ThreadPoolExecutor(max_workers=12) as pool:
 result=dict(pool.map(get,range(1,61)))
with args.output.open("x") as output:
    json.dump(result, output)
print('References',sum('docs' in x for x in result.values()),'/ 60')
print('Unavailable',[(i,x['lib'],x.get('error')) for i,x in result.items() if 'docs' not in x])

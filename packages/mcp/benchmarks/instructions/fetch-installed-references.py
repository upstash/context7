#!/usr/bin/env python3
"""Fetch shared documentation references for the held-out library cases.

Each held-out case with a `library` field gets the top Context7 match for that
name and the docs Context7 returns for the case's prompt. The output is keyed by
held-out case number, as in run-installed.py and grade-installed.py.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

API = "https://context7.com/api/v2/"


def heldout_cases():
    cases = json.loads(Path(__file__).with_name("trigger-eval-all.json").read_text())
    return [case for case in cases if case.get("set") == "heldout"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    key = os.environ.get("CONTEXT7_API_KEY")
    if not key:
        parser.error("Set CONTEXT7_API_KEY.")

    def fetch(path, query):
        request = urllib.request.Request(
            API + path + "?" + urllib.parse.urlencode(query),
            headers={"Authorization": "Bearer " + key},
        )
        with urllib.request.urlopen(request, timeout=35) as response:
            return response.read().decode()

    def reference(number, case):
        library = case["library"]
        try:
            match = json.loads(
                fetch("libs/search", {"libraryName": library, "query": case["query"]})
            )["results"][0]
            docs = fetch("context", {"libraryId": match["id"], "query": case["query"]})
            return str(number), {"lib": library, "id": match["id"], "docs": docs[:15000]}
        except Exception as error:
            return str(number), {"lib": library, "error": f"{type(error).__name__}: {error}"}

    jobs = [(number, case) for number, case in enumerate(heldout_cases(), 1) if "library" in case]
    with ThreadPoolExecutor(max_workers=12) as pool:
        result = dict(pool.map(lambda job: reference(*job), jobs))
    with args.output.open("x") as output:
        json.dump(result, output)
    print("References", sum("docs" in ref for ref in result.values()), "/", len(result))
    print(
        "Unavailable",
        [(number, ref["lib"], ref.get("error")) for number, ref in result.items() if "docs" not in ref],
    )


if __name__ == "__main__":
    main()

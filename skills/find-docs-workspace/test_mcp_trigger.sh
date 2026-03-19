#!/bin/bash
# Test whether Context7 MCP tools trigger for each query
# Checks for resolve-library-id or query-docs tool calls

EVAL_SET="$1"
MODEL="${2:-claude-sonnet-4-6}"
RESULTS_FILE="/Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/mcp-trigger-results.jsonl"

> "$RESULTS_FILE"

total=0
passed=0
triggered_count=0
should_trigger_count=0

while IFS= read -r line; do
    query=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['query'])")
    should_trigger=$(echo "$line" | python3 -c "import sys,json; print('true' if json.load(sys.stdin)['should_trigger'] else 'false')")

    total=$((total + 1))
    [ "$should_trigger" = "true" ] && should_trigger_count=$((should_trigger_count + 1))

    echo "[$total/20] Testing: ${query:0:60}..."

    # Run claude -p and check for MCP tool calls
    output=$(CLAUDECODE= claude -p "$query" --output-format stream-json --max-turns 1 --model "$MODEL" 2>/dev/null)

    triggered="false"
    if echo "$output" | grep -q 'resolve-library-id\|query-docs\|resolve_library_id\|query_docs'; then
        triggered="true"
        triggered_count=$((triggered_count + 1))
    fi

    if [ "$triggered" = "$should_trigger" ]; then
        status="PASS"
        passed=$((passed + 1))
    else
        status="FAIL"
    fi

    echo "  -> triggered=$triggered expected=$should_trigger [$status]"

    # Write result
    python3 -c "
import json
print(json.dumps({
    'query': '''$query''',
    'should_trigger': $should_trigger,
    'triggered': $triggered,
    'pass': '$status' == 'PASS'
}))" >> "$RESULTS_FILE" 2>/dev/null

done < <(python3 -c "
import json
data = json.load(open('$EVAL_SET'))
for item in data:
    print(json.dumps(item))
")

echo ""
echo "=== MCP Trigger Results (model: $MODEL) ==="
echo "Total: $total  Passed: $passed  Failed: $((total - passed))"
echo "Should-trigger queries: $should_trigger_count  Actually triggered: $triggered_count"
if [ "$should_trigger_count" -gt 0 ]; then
    echo "Recall: $triggered_count / $should_trigger_count"
fi
echo "Results saved to $RESULTS_FILE"

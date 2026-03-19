#!/bin/bash
# Test whether find-docs skill triggers for each query
# Checks for Skill("find-docs") invocation in claude -p output

EVAL_SET="/Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/trigger-eval.json"
RESULTS_FILE="/Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/trigger-results.jsonl"

> "$RESULTS_FILE"

# Read queries from eval set
queries=$(python3 -c "
import json
data = json.load(open('$EVAL_SET'))
for item in data:
    q = item['query'].replace('\n', ' ')
    st = 'true' if item['should_trigger'] else 'false'
    print(f'{st}\t{q}')
")

i=0
while IFS=$'\t' read -r should_trigger query; do
    i=$((i + 1))
    echo "[$i/20] Testing: ${query:0:60}..."

    # Run claude -p and check if it invokes the find-docs skill
    triggered="false"
    output=$(CLAUDECODE= claude -p "$query" --output-format stream-json --max-turns 1 2>/dev/null)

    # Check for Skill tool call with "find-docs"
    if echo "$output" | grep -q '"name":"Skill"'; then
        if echo "$output" | grep -q '"find-docs"'; then
            triggered="true"
        fi
    fi

    # Determine pass/fail
    if [ "$triggered" = "$should_trigger" ]; then
        status="PASS"
    else
        status="FAIL"
    fi

    echo "  -> triggered=$triggered expected=$should_trigger [$status]"
    echo "{\"query\":$(python3 -c "import json; print(json.dumps('$query'))"), \"should_trigger\":$should_trigger, \"triggered\":$triggered, \"pass\":$([ "$status" = "PASS" ] && echo true || echo false)}" >> "$RESULTS_FILE"

done <<< "$queries"

echo ""
echo "=== Summary ==="
total=$(wc -l < "$RESULTS_FILE")
passed=$(grep '"pass":true' "$RESULTS_FILE" | wc -l)
failed=$(grep '"pass":false' "$RESULTS_FILE" | wc -l)
echo "Total: $total  Passed: $passed  Failed: $failed"
echo "Results saved to $RESULTS_FILE"

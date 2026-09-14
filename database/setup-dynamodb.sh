#!/usr/bin/env bash
# =============================================================================
# BASH SCRIPT: INITIALIZE NoSQL TABLE ON AWS DYNAMODB (SINGLE-TABLE DESIGN)
# Hybrid Architecture:
#   - MySQL (schema.sql): Manages `users` table (auth, account, ACID)
#   - AWS DynamoDB: Manages single table `Problems` (Single-Table Design) containing:
#       + Problem details & embedded test cases (sk = 'METADATA')
#       + All Submissions (sk = 'SUBMISSION#<submission_id>')
#   - Global Secondary Indexes (GSI):
#       + GSI `user-submissions-index`: Query submission history by `user_id`
#       + GSI `category-difficulty-index`: Filter problems by `category` & `difficulty`
# =============================================================================
# Usage:
#   1. Grant execution permissions and run:
#        chmod +x setup-dynamodb.sh
#        ./setup-dynamodb.sh
#
#   * If using DynamoDB Local:
#        ENDPOINT_URL="http://localhost:8000" ./setup-dynamodb.sh
# =============================================================================

set -e

REGION="${AWS_REGION:-us-east-1}"
EXTRA_ARGS=()

if [ -n "$ENDPOINT_URL" ]; then
    EXTRA_ARGS+=(--endpoint-url "$ENDPOINT_URL")
    echo "[*] Connecting to Endpoint: $ENDPOINT_URL"
else
    EXTRA_ARGS+=(--region "$REGION")
    echo "[*] Using AWS Region: $REGION"
fi

echo "=========================================================="
echo "1. CREATING NoSQL TABLE 'Problems' (SINGLE-TABLE DESIGN)..."
echo "=========================================================="

# Create Problems table managing: Problem Metadata, Embedded Test Cases & Submissions
# Primary Key: problem_id (HASH) + sk (RANGE)
# GSI 1: user-submissions-index (user_id HASH, created_at RANGE)
# GSI 2: category-difficulty-index (category HASH, difficulty RANGE)
aws dynamodb create-table "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --attribute-definitions \
        AttributeName=problem_id,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=user_id,AttributeType=S \
        AttributeName=created_at,AttributeType=S \
        AttributeName=category,AttributeType=S \
        AttributeName=difficulty,AttributeType=S \
    --key-schema \
        AttributeName=problem_id,KeyType=HASH \
        AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes '[
        {
            "IndexName": "user-submissions-index",
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "created_at", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        },
        {
            "IndexName": "category-difficulty-index",
            "KeySchema": [
                {"AttributeName": "category", "KeyType": "HASH"},
                {"AttributeName": "difficulty", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        }
    ]' \
    --billing-mode PAY_PER_REQUEST || echo "Table Problems may already exist, continuing..."

echo ""
echo "Waiting for table Problems to become ACTIVE..."
if [ -z "$ENDPOINT_URL" ]; then
    aws dynamodb wait table-exists --table-name Problems "${EXTRA_ARGS[@]}"
fi

echo "=========================================================="
echo "2. SEEDING SAMPLE DATA..."
echo "=========================================================="

# 2.1 Seed sample problem: Two Sum (sk = METADATA)
echo "-> Adding sample problem Two Sum (problem_id: prob_1, sk: METADATA)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_1"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "PROBLEM"},
        "title": {"S": "Two Sum"},
        "description": {"S": "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nExample:\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]"},
        "difficulty": {"S": "EASY"},
        "category": {"S": "Array"},
        "starter_code": {"S": "def two_sum(nums, target):\n    # Write your code here\n    pass"},
        "test_cases": {"L": [
            {"M": {"id": {"N": "1"}, "input": {"S": "[2,7,11,15]\n9"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "2"}, "input": {"S": "[3,2,4]\n6"}, "output": {"S": "[1,2]"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "3"}, "input": {"S": "[3,3]\n6"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": false}}}
        ]},
        "created_at": {"S": "2026-09-07T10:10:00Z"}
    }'

# 2.2 Seed sample problem: Valid Palindrome (sk = METADATA)
echo "-> Adding sample problem Valid Palindrome (problem_id: prob_2, sk: METADATA)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_2"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "PROBLEM"},
        "title": {"S": "Valid Palindrome"},
        "description": {"S": "Given a string s, return true if it is a palindrome, or false otherwise.\n\nExample:\nInput: s = \"A man, a plan, a canal: Panama\"\nOutput: true"},
        "difficulty": {"S": "EASY"},
        "category": {"S": "String"},
        "starter_code": {"S": "def is_palindrome(s: str) -> bool:\n    # Write your code here\n    pass"},
        "test_cases": {"L": [
            {"M": {"id": {"N": "1"}, "input": {"S": "A man, a plan, a canal: Panama"}, "output": {"S": "true"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "2"}, "input": {"S": "race a car"}, "output": {"S": "false"}, "is_sample": {"BOOL": true}}}
        ]},
        "created_at": {"S": "2026-09-07T10:15:00Z"}
    }'

# 2.3 Seed sample submission 1 for Two Sum (sk = SUBMISSION#sub_1725700000001, user_id = 2)
echo "-> Adding submission for Two Sum (user_id: 2, sub_id: sub_1725700000001)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_1"},
        "sk": {"S": "SUBMISSION#sub_1725700000001"},
        "entity_type": {"S": "SUBMISSION"},
        "submission_id": {"S": "sub_1725700000001"},
        "user_id": {"S": "2"},
        "language": {"S": "python"},
        "code": {"S": "def two_sum(nums, target):\n    lookup = {}\n    for i, n in enumerate(nums):\n        if target - n in lookup:\n            return [lookup[target - n], i]\n        lookup[n] = i\n    return []"},
        "status": {"S": "ACCEPTED"},
        "execution_time_ms": {"N": "45"},
        "created_at": {"S": "2026-09-07T10:30:00Z"}
    }'

# 2.4 Seed sample submission 2 for Valid Palindrome (sk = SUBMISSION#sub_1725700000002, user_id = 2)
echo "-> Adding submission for Valid Palindrome (user_id: 2, sub_id: sub_1725700000002)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_2"},
        "sk": {"S": "SUBMISSION#sub_1725700000002"},
        "entity_type": {"S": "SUBMISSION"},
        "submission_id": {"S": "sub_1725700000002"},
        "user_id": {"S": "2"},
        "language": {"S": "python"},
        "code": {"S": "def is_palindrome(s: str) -> bool:\n    clean = [c.lower() for c in s if c.isalnum()]\n    return clean == clean[::-1]"},
        "status": {"S": "ACCEPTED"},
        "execution_time_ms": {"N": "32"},
        "created_at": {"S": "2026-09-07T10:45:00Z"}
    }'

echo ""
echo "=========================================================="
echo "3. DEMO ACCESS PATTERNS (QUERY EXAMPLES)..."
echo "=========================================================="

echo "-> [AP1] Get Two Sum problem details (GetItem problem_id='prob_1', sk='METADATA'):"
aws dynamodb get-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --key '{"problem_id": {"S": "prob_1"}, "sk": {"S": "METADATA"}}' \
    --projection-expression "problem_id, title, difficulty, category" || true

echo ""
echo "-> [AP2] Get submissions for Two Sum (Query problem_id='prob_1' & sk begins_with 'SUBMISSION#'):"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --key-condition-expression "problem_id = :pid and begins_with(sk, :prefix)" \
    --expression-attribute-values '{":pid": {"S": "prob_1"}, ":prefix": {"S": "SUBMISSION#"}}' \
    --projection-expression "submission_id, user_id, status, execution_time_ms" || true

echo ""
echo "-> [AP3] USE GSI 'user-submissions-index': Get all submissions by user_id = '2' across all problems:"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --index-name user-submissions-index \
    --key-condition-expression "user_id = :uid" \
    --expression-attribute-values '{":uid": {"S": "2"}}' \
    --projection-expression "problem_id, submission_id, status, created_at" || true

echo ""
echo "-> [AP4] USE GSI 'category-difficulty-index': Filter problems by category 'Array' and difficulty 'EASY':"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --index-name category-difficulty-index \
    --key-condition-expression "category = :cat and difficulty = :diff" \
    --expression-attribute-values '{":cat": {"S": "Array"}, ":diff": {"S": "EASY"}}' \
    --projection-expression "problem_id, title, difficulty, category" || true

echo ""
echo "=========================================================="
echo "[SUCCESS] Configured Single-Table Design for Problems table with GSIs successfully."
echo "=========================================================="

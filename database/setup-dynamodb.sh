#!/usr/bin/env bash
# =============================================================================
# BASH SCRIPT: INITIALIZE ALL NoSQL TABLES ON AWS DYNAMODB (SINGLE-TABLE DESIGN)
# Hybrid Architecture:
#   - MySQL (schema.sql): Manages `users` table (auth, account, profile, ACID)
#   - AWS DynamoDB Table 1: `Problems` (Single-Table Design) containing:
#       + Problem details & embedded test cases (sk = 'METADATA')
#       + All Submissions (sk = 'SUBMISSION#<submission_id>')
#       + GSI: `user-submissions-index`, `category-difficulty-index`
#   - AWS DynamoDB Table 2: `Interviews` (Single-Table Design) containing:
#       + Interview Session Metadata (sk = 'METADATA')
#       + Chat Messages (sk = 'MSG#<timestamp>#<msg_id>')
#       + Code Snapshots (sk = 'CODE#<timestamp>')
#       + AI Evaluation (sk = 'EVAL#<eval_id>')
#       + GSI: `user-interviews-index`, `problem-interviews-index`
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

# ---------------------------------------------------------------------------
# Load .env file if it exists (auto-detect from project root or workspace root)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "[*] Loading environment from $PROJECT_ROOT/.env"
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
elif [ -f "$WORKSPACE_ROOT/.env" ]; then
    echo "[*] Loading environment from $WORKSPACE_ROOT/.env"
    set -a
    source "$WORKSPACE_ROOT/.env"
    set +a
fi

# Support both DYNAMODB_ENDPOINT_URL (.env) and ENDPOINT_URL (CLI override)
ENDPOINT_URL="${ENDPOINT_URL:-$DYNAMODB_ENDPOINT_URL}"

REGION="${AWS_REGION:-us-east-1}"
EXTRA_ARGS=()

if [ -n "$ENDPOINT_URL" ]; then
    EXTRA_ARGS+=(--endpoint-url "$ENDPOINT_URL")
    echo "[*] Connecting to DynamoDB Endpoint: $ENDPOINT_URL"
else
    EXTRA_ARGS+=(--region "$REGION")
    echo "[*] Using AWS Region: $REGION"
fi

# #############################################################################
#  PART 1: TABLE "Problems" — Problems, Test Cases & Submissions
# #############################################################################

echo ""
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
echo "2. SEEDING SAMPLE DATA FOR 'Problems'..."
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
        "hints": {"L": [
            {"S": "Thử dùng hashmap để lưu giá trị đã duyệt"},
            {"S": "Xem xét complement = target - nums[i]"}
        ]},
        "tags": {"L": [
            {"S": "hashmap"}, {"S": "array"}, {"S": "two-pointer"}
        ]},
        "companies": {"L": [
            {"S": "Google"}, {"S": "Amazon"}, {"S": "Meta"}, {"S": "Apple"}
        ]},
        "interview_frequency": {"N": "95"},
        "constraints": {"S": "1 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9\nOnly one valid answer exists."},
        "follow_up_questions": {"L": [
            {"S": "Nếu array đã sorted thì approach thay đổi thế nào?"},
            {"S": "Nếu có nhiều hơn 2 số (3Sum, 4Sum) thì giải quyết ra sao?"},
            {"S": "Time/Space trade-off: có approach nào O(1) space không?"}
        ]},
        "supported_languages": {"L": [
            {"S": "python"}, {"S": "javascript"}, {"S": "java"}, {"S": "cpp"}
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
        "hints": {"L": [
            {"S": "Chỉ xét ký tự alphanumeric, bỏ qua ký tự đặc biệt"},
            {"S": "So sánh chuỗi đã xử lý với reversed version"}
        ]},
        "tags": {"L": [
            {"S": "string"}, {"S": "two-pointer"}
        ]},
        "companies": {"L": [
            {"S": "Meta"}, {"S": "Microsoft"}, {"S": "Amazon"}
        ]},
        "interview_frequency": {"N": "80"},
        "constraints": {"S": "1 <= s.length <= 2 * 10^5\ns consists only of printable ASCII characters."},
        "follow_up_questions": {"L": [
            {"S": "Giải bằng two-pointer thay vì tạo chuỗi mới?"},
            {"S": "Nếu cho phép xóa tối đa 1 ký tự thì sao? (Valid Palindrome II)"},
            {"S": "So sánh space complexity giữa các approach?"}
        ]},
        "supported_languages": {"L": [
            {"S": "python"}, {"S": "javascript"}, {"S": "java"}, {"S": "cpp"}
        ]},
        "created_at": {"S": "2026-09-07T10:15:00Z"}
    }'

# 2.3 Seed sample submission 1 for Two Sum
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
        "memory_usage_kb": {"N": "14200"},
        "test_cases_passed": {"N": "3"},
        "total_test_cases": {"N": "3"},
        "error_message": {"NULL": true},
        "ai_review": {"S": "Code sử dụng hashmap approach tối ưu O(n). Biến đặt tên rõ ràng. Nên thêm xử lý edge case khi không tìm thấy kết quả."},
        "interview_id": {"S": "intv_1725700000001"},
        "created_at": {"S": "2026-09-07T10:30:00Z"}
    }'

# 2.4 Seed sample submission 2 for Valid Palindrome
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
        "memory_usage_kb": {"N": "12800"},
        "test_cases_passed": {"N": "2"},
        "total_test_cases": {"N": "2"},
        "error_message": {"NULL": true},
        "ai_review": {"S": "Code sử dụng list comprehension ngắn gọn. Tuy nhiên tạo list mới tốn O(n) space, có thể dùng two-pointer để đạt O(1) space."},
        "interview_id": {"NULL": true},
        "created_at": {"S": "2026-09-07T10:45:00Z"}
    }'

echo ""
echo "=========================================================="
echo "3. DEMO ACCESS PATTERNS FOR 'Problems'..."
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
    --expression-attribute-values '":pid": {"S": "prob_1"}, ":prefix": {"S": "SUBMISSION#"}}' \
    --projection-expression "submission_id, user_id, status, execution_time_ms" || true

echo ""
echo "-> [AP3] USE GSI 'user-submissions-index': Get all submissions by user_id = '2' across all problems:"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --index-name user-submissions-index \
    --key-condition-expression "user_id = :uid" \
    --expression-attribute-values '":uid": {"S": "2"}}' \
    --projection-expression "problem_id, submission_id, status, created_at" || true

echo ""
echo "-> [AP4] USE GSI 'category-difficulty-index': Filter problems by category 'Array' and difficulty 'EASY':"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --index-name category-difficulty-index \
    --key-condition-expression "category = :cat and difficulty = :diff" \
    --expression-attribute-values '":cat": {"S": "Array"}, ":diff": {"S": "EASY"}}' \
    --projection-expression "problem_id, title, difficulty, category" || true

# #############################################################################
#  PART 2: TABLE "Interviews" — Sessions, Chat, Code Snapshots & AI Evaluation
# #############################################################################

echo ""
echo ""
echo "=========================================================="
echo "4. CREATING NoSQL TABLE 'Interviews' (SINGLE-TABLE DESIGN)..."
echo "=========================================================="

# Create Interviews table managing: Session Metadata, Chat Messages, Code Snapshots & AI Evaluations
# Primary Key: interview_id (HASH) + sk (RANGE)
# GSI 1: user-interviews-index (user_id HASH, started_at RANGE)
# GSI 2: problem-interviews-index (problem_id HASH, started_at RANGE)
aws dynamodb create-table "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --attribute-definitions \
        AttributeName=interview_id,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=user_id,AttributeType=S \
        AttributeName=started_at,AttributeType=S \
        AttributeName=problem_id,AttributeType=S \
    --key-schema \
        AttributeName=interview_id,KeyType=HASH \
        AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes '[
        {
            "IndexName": "user-interviews-index",
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "started_at", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        },
        {
            "IndexName": "problem-interviews-index",
            "KeySchema": [
                {"AttributeName": "problem_id", "KeyType": "HASH"},
                {"AttributeName": "started_at", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        }
    ]' \
    --billing-mode PAY_PER_REQUEST || echo "Table Interviews may already exist, continuing..."

echo ""
echo "Waiting for table Interviews to become ACTIVE..."
if [ -z "$ENDPOINT_URL" ]; then
    aws dynamodb wait table-exists --table-name Interviews "${EXTRA_ARGS[@]}"
fi

echo "=========================================================="
echo "5. SEEDING SAMPLE DATA FOR 'Interviews'..."
echo "=========================================================="

# --------------------------------------------------------------------------
# 5.1 Seed Interview Session Metadata (sk = METADATA)
# --------------------------------------------------------------------------
echo "-> Adding interview session (interview_id: intv_1725700000001, sk: METADATA)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "INTERVIEW"},
        "user_id": {"S": "2"},
        "problem_id": {"S": "prob_1"},
        "interview_type": {"S": "CODING"},
        "difficulty": {"S": "EASY"},
        "status": {"S": "COMPLETED"},
        "ai_model": {"S": "gpt-4o"},
        "duration_seconds": {"N": "2700"},
        "overall_score": {"N": "78"},
        "started_at": {"S": "2026-09-07T10:00:00Z"},
        "completed_at": {"S": "2026-09-07T10:45:00Z"}
    }'

# --------------------------------------------------------------------------
# 5.2 Seed Chat Messages (sk = MSG#<timestamp>#<msg_id>)
# --------------------------------------------------------------------------
echo "-> Adding chat message 1: AI greeting (MSG#...#msg_001)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "MSG#2026-09-07T10:01:00Z#msg_001"},
        "entity_type": {"S": "MESSAGE"},
        "sender": {"S": "AI"},
        "content": {"S": "Chào bạn! Hôm nay chúng ta sẽ cùng giải bài Two Sum. Trước khi bắt đầu code, bạn có thể mô tả approach của mình không?"},
        "message_type": {"S": "QUESTION"},
        "created_at": {"S": "2026-09-07T10:01:00Z"}
    }'

echo "-> Adding chat message 2: User response (MSG#...#msg_002)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "MSG#2026-09-07T10:02:30Z#msg_002"},
        "entity_type": {"S": "MESSAGE"},
        "sender": {"S": "USER"},
        "content": {"S": "Em sẽ dùng brute force trước, duyệt 2 vòng lặp lồng nhau để tìm cặp số có tổng bằng target. Time complexity là O(n²)."},
        "message_type": {"S": "ANSWER"},
        "created_at": {"S": "2026-09-07T10:02:30Z"}
    }'

echo "-> Adding chat message 3: AI follow-up (MSG#...#msg_003)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "MSG#2026-09-07T10:03:00Z#msg_003"},
        "entity_type": {"S": "MESSAGE"},
        "sender": {"S": "AI"},
        "content": {"S": "Tốt lắm! Bạn đã nhận ra brute force có O(n²). Có cách nào giảm xuống O(n) không? Gợi ý: hãy nghĩ về cấu trúc dữ liệu nào hỗ trợ lookup O(1)."},
        "message_type": {"S": "HINT"},
        "created_at": {"S": "2026-09-07T10:03:00Z"}
    }'

echo "-> Adding chat message 4: User improved approach (MSG#...#msg_004)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "MSG#2026-09-07T10:04:00Z#msg_004"},
        "entity_type": {"S": "MESSAGE"},
        "sender": {"S": "USER"},
        "content": {"S": "Dạ em nghĩ có thể dùng hashmap. Duyệt qua mảng, với mỗi phần tử kiểm tra xem complement (target - num) đã có trong map chưa. Nếu có thì return, nếu chưa thì thêm vào map."},
        "message_type": {"S": "ANSWER"},
        "created_at": {"S": "2026-09-07T10:04:00Z"}
    }'

# --------------------------------------------------------------------------
# 5.3 Seed Code Snapshot (sk = CODE#<timestamp>)
# --------------------------------------------------------------------------
echo "-> Adding code snapshot (CODE#2026-09-07T10:15:00Z)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "CODE#2026-09-07T10:15:00Z"},
        "entity_type": {"S": "CODE_SNAPSHOT"},
        "language": {"S": "python"},
        "code": {"S": "def two_sum(nums, target):\n    lookup = {}\n    for i, n in enumerate(nums):\n        complement = target - n\n        if complement in lookup:\n            return [lookup[complement], i]\n        lookup[n] = i\n    return []"},
        "test_results": {"M": {
            "passed": {"N": "3"},
            "total": {"N": "3"},
            "details": {"L": [
                {"M": {"test_id": {"N": "1"}, "status": {"S": "PASSED"}, "execution_time_ms": {"N": "12"}}},
                {"M": {"test_id": {"N": "2"}, "status": {"S": "PASSED"}, "execution_time_ms": {"N": "8"}}},
                {"M": {"test_id": {"N": "3"}, "status": {"S": "PASSED"}, "execution_time_ms": {"N": "10"}}}
            ]}
        }},
        "ai_code_review": {"S": "Code tốt! Sử dụng hashmap đạt O(n) time và O(n) space. Biến đặt tên rõ ràng. Có thể cải thiện: thêm xử lý edge case khi input rỗng."},
        "created_at": {"S": "2026-09-07T10:15:00Z"}
    }'

# --------------------------------------------------------------------------
# 5.4 Seed AI Evaluation (sk = EVAL#<eval_id>)
# --------------------------------------------------------------------------
echo "-> Adding AI evaluation (EVAL#eval_001)..."
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --item '{
        "interview_id": {"S": "intv_1725700000001"},
        "sk": {"S": "EVAL#eval_001"},
        "entity_type": {"S": "EVALUATION"},
        "scores": {"M": {
            "problem_solving": {"N": "80"},
            "code_quality": {"N": "85"},
            "communication": {"N": "75"},
            "time_management": {"N": "85"},
            "optimization": {"N": "70"}
        }},
        "overall_score": {"N": "78"},
        "strengths": {"L": [
            {"S": "Giải thích approach rõ ràng, từ brute force đến optimal"},
            {"S": "Code clean, biến đặt tên có ý nghĩa"},
            {"S": "Tất cả test cases đều pass"}
        ]},
        "weaknesses": {"L": [
            {"S": "Cần được gợi ý mới nghĩ ra hashmap approach"},
            {"S": "Chưa tự hỏi clarifying questions trước khi code"},
            {"S": "Chưa phân tích edge cases (mảng rỗng, không có kết quả)"}
        ]},
        "suggestions": {"L": [
            {"S": "Luyện tập phân tích bài trước khi code: hỏi constraints, edge cases"},
            {"S": "Tập thói quen nghĩ nhiều hơn 1 approach trước khi chọn"},
            {"S": "Chủ động trade-off analysis giữa time vs space complexity"}
        ]},
        "hire_recommendation": {"S": "LEAN_YES"},
        "created_at": {"S": "2026-09-07T10:46:00Z"}
    }'

echo ""
echo "=========================================================="
echo "6. DEMO ACCESS PATTERNS FOR 'Interviews'..."
echo "=========================================================="

echo "-> [AP5] Get interview session details (GetItem interview_id='intv_1725700000001', sk='METADATA'):"
aws dynamodb get-item "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --key '{"interview_id": {"S": "intv_1725700000001"}, "sk": {"S": "METADATA"}}' \
    --projection-expression "interview_id, user_id, problem_id, interview_type, #s, overall_score" \
    --expression-attribute-names '{"#s": "status"}' || true

echo ""
echo "-> [AP6] Get all chat messages for interview (Query sk begins_with 'MSG#'):"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --key-condition-expression "interview_id = :iid and begins_with(sk, :prefix)" \
    --expression-attribute-values '{":iid": {"S": "intv_1725700000001"}, ":prefix": {"S": "MSG#"}}' \
    --projection-expression "sk, sender, content, message_type" || true

echo ""
echo "-> [AP7] Get AI evaluation for interview (Query sk begins_with 'EVAL#'):"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --key-condition-expression "interview_id = :iid and begins_with(sk, :prefix)" \
    --expression-attribute-values '{":iid": {"S": "intv_1725700000001"}, ":prefix": {"S": "EVAL#"}}' \
    --projection-expression "scores, overall_score, strengths, weaknesses, hire_recommendation" || true

echo ""
echo "-> [AP8] USE GSI 'user-interviews-index': Get all interviews by user_id = '2':"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --index-name user-interviews-index \
    --key-condition-expression "user_id = :uid" \
    --expression-attribute-values '{":uid": {"S": "2"}}' \
    --projection-expression "interview_id, problem_id, interview_type, #s, overall_score, started_at" \
    --expression-attribute-names '{"#s": "status"}' || true

echo ""
echo "-> [AP9] USE GSI 'problem-interviews-index': Get all interviews for problem 'prob_1':"
aws dynamodb query "${EXTRA_ARGS[@]}" \
    --table-name Interviews \
    --index-name problem-interviews-index \
    --key-condition-expression "problem_id = :pid" \
    --expression-attribute-values '{":pid": {"S": "prob_1"}}' \
    --projection-expression "interview_id, user_id, #s, overall_score, started_at" \
    --expression-attribute-names '{"#s": "status"}' || true

echo ""
echo "=========================================================="
echo "[SUCCESS] All DynamoDB tables initialized successfully!"
echo "  - Table 'Problems' with GSIs: user-submissions-index, category-difficulty-index"
echo "  - Table 'Interviews' with GSIs: user-interviews-index, problem-interviews-index"
echo "=========================================================="

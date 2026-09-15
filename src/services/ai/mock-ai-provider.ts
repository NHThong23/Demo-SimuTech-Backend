// =============================================================================
// MOCK AI PROVIDER
//
// Triển khai mock thông minh để demo và test FE trước khi có model thật.
// Sử dụng template pools + random variation để response realistic hơn.
// Phân tích keyword từ input để đưa ra phản hồi phù hợp ngữ cảnh.
//
// Khi đã chọn model AI thực: implement IAIProvider mới, đổi AI_PROVIDER env.
// =============================================================================

import type {
  IAIProvider,
  GenerateGreetingInput,
  GenerateInterviewResponseInput,
  GenerateInterviewResponseOutput,
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
  ReviewCodeInput,
  EvaluateSystemDesignInput,
  EvaluateSystemDesignOutput,
  InterviewScores,
  HireRecommendation,
  BottleneckAnalysis,
} from './ai-provider.interface';

// ─── Utility Helpers ─────────────────────────────────────────────────────────

/** Chọn ngẫu nhiên 1 phần tử trong mảng */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Random số nguyên trong khoảng [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Kiểm tra text có chứa bất kỳ keyword nào không (case-insensitive) */
function hasKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// ─── Template Pools ───────────────────────────────────────────────────────────

const GREETING_TEMPLATES: Record<string, string[]> = {
  CODING: [
    `Chào bạn! Tôi là AI Interviewer của bạn hôm nay. Chúng ta sẽ cùng giải quyết bài toán "{problem}". Trước khi bắt đầu code, bạn hãy chia sẻ hướng tiếp cận ban đầu và phân tích sơ bộ về độ phức tạp thuật toán nhé!`,
    `Xin chào! Rất vui được phỏng vấn bạn hôm nay. Đề bài của chúng ta là "{problem}". Bạn có thể bắt đầu bằng cách trình bày cách hiểu bài toán và hướng tiếp cận đầu tiên của mình không?`,
    `Chào mừng đến với buổi phỏng vấn! Bài toán hôm nay là "{problem}". Hãy cùng bắt đầu — bạn quan sát thấy đặc điểm gì của bài toán này và muốn giải quyết theo hướng nào?`,
  ],
  SYSTEM_DESIGN: [
    `Chào bạn! Trong buổi phỏng vấn hôm nay, chúng ta sẽ thiết kế hệ thống "{problem}". Bạn hãy bắt đầu bằng cách đặt câu hỏi làm rõ yêu cầu (functional & non-functional requirements) trước khi thiết kế nhé!`,
    `Xin chào! Bài toán system design hôm nay là "{problem}". Trước tiên, bạn hãy ước tính scale của hệ thống và xác định các yêu cầu quan trọng nhất nhé.`,
  ],
  BEHAVIORAL: [
    `Chào bạn! Hôm nay chúng ta sẽ có một buổi phỏng vấn behavioral về "{problem}". Hãy thoải mái và chia sẻ thật lòng — không có câu trả lời đúng hay sai tuyệt đối.`,
  ],
};

// Phản hồi dựa trên keyword phát hiện trong câu trả lời
const RESPONSE_TEMPLATES = {
  brute_force: [
    'Tốt! Bạn đã xác định được phương pháp brute force. Giờ thử suy nghĩ xem có cách nào cải thiện độ phức tạp không? Gợi ý: liệu có cấu trúc dữ liệu nào hỗ trợ tra cứu O(1)?',
    'Đúng rồi, brute force là điểm khởi đầu tốt. Bây giờ, bạn có thể phân tích tại sao O(n²) không đủ hiệu quả và đề xuất cách tối ưu không?',
    'Phương pháp brute force O(n²) chính xác về mặt logic. Thử nghĩ xem chúng ta có thể đánh đổi thêm không gian lưu trữ để giảm thời gian không?',
  ],
  optimal: [
    'Xuất sắc! Hash Map/Hash Table là lựa chọn tối ưu cho bài này. Bạn đã nắm được insight quan trọng. Hãy triển khai code và chú ý xử lý edge cases!',
    'Rất tốt! Bạn đã nhận ra cách tối ưu. Bây giờ hãy bắt đầu code và giải thích từng bước trong khi viết nhé.',
    'Đúng hướng! Approach này cho O(n) về time và O(n) về space. Bây giờ bạn hãy implement và chú ý các trường hợp đặc biệt như input rỗng hay không tìm thấy kết quả.',
  ],
  edge_case: [
    'Rất tốt khi bạn chủ động nghĩ đến edge cases! Đó là tư duy của một kỹ sư giỏi. Hãy liệt kê thêm các trường hợp đặc biệt khác mà bạn sẽ kiểm tra.',
    'Chính xác, edge cases quan trọng trong phỏng vấn. Ngoài trường hợp đó, bạn còn nghĩ đến input nào khác không bình thường không?',
  ],
  complexity: [
    'Phân tích complexity rất chuẩn xác! Time O(n) và Space O(n) là optimal cho bài này. Bạn có thể giải thích tại sao không thể làm tốt hơn về space không?',
    'Đúng rồi! Phân tích Big-O của bạn chính xác. Trong thực tế, đây là trade-off chấp nhận được. Hãy tiếp tục implement.',
  ],
  code_written: [
    'Code nhìn sạch sẽ! Bạn có thể walk-through qua logic để tôi hiểu rõ hơn không? Đặc biệt phần xử lý edge case.',
    'Implementation trông khá tốt. Thử chạy qua test case đầu tiên trong đầu xem kết quả có đúng không?',
    'Tốt lắm! Bây giờ hãy chạy thử code với các test case mẫu và xem kết quả ra sao.',
  ],
  generic: [
    'Cảm ơn chia sẻ của bạn! Hướng tiếp cận này có vẻ hợp lý. Bạn có thể giải thích thêm tại sao lại chọn cách này không?',
    'Interesting! Bạn có thể phân tích độ phức tạp (time & space complexity) của approach này không?',
    'Ý tưởng hay đó. Hãy tiếp tục — bạn sẽ bắt đầu implement từ đâu?',
    'Được rồi! Bạn đang tiến triển đúng hướng. Hãy code và giải thích logic trong quá trình viết nhé.',
  ],
};

// Template đánh giá điểm mạnh
const STRENGTH_POOL = [
  'Tư duy thuật toán rõ ràng, biết phân tích từ brute force lên tối ưu một cách có hệ thống',
  'Giao tiếp tốt, giải thích ý tưởng mạch lạc trước khi bắt tay vào code',
  'Code sạch sẽ, cấu trúc tốt và đặt tên biến có nghĩa',
  'Chủ động nhận diện và xử lý các edge cases',
  'Nắm vững cấu trúc dữ liệu và biết chọn cấu trúc phù hợp với bài toán',
  'Quản lý thời gian tốt, hoàn thành trong khung thời gian hợp lý',
  'Biết phân tích trade-off giữa Time Complexity và Space Complexity',
  'Phong thái tự tin, không bị áp lực khi gặp câu hỏi khó',
];

// Template điểm yếu cần cải thiện
const WEAKNESS_POOL = [
  'Cần đặt câu hỏi làm rõ yêu cầu (clarifying questions) trước khi bắt đầu giải',
  'Nên phân tích và liệt kê edge cases một cách có hệ thống hơn',
  'Có thể giải thích code nhiều hơn trong khi viết (thinking out loud)',
  'Cần rèn thêm kỹ năng tối ưu hóa Space Complexity',
  'Nên kiểm tra lại code bằng cách trace qua test case trước khi submit',
  'Cần tự tin hơn khi giải thích các quyết định kỹ thuật',
];

// Template gợi ý cải thiện
const SUGGESTION_POOL = [
  'Luyện tập thói quen clarify requirements trước mỗi bài',
  'Thực hành "think out loud" — giải thích mọi bước trong khi code',
  'Ôn tập lại các pattern phổ biến: Sliding Window, Two Pointers, BFS/DFS',
  'Rèn luyện thêm kỹ năng phân tích Big-O, đặc biệt với các bài Recursion',
  'Thực hành mock interview thường xuyên để quen với áp lực thời gian',
  'Tập thói quen viết test cases trước khi code (TDD mindset)',
];

// ─── Mock AI Provider Implementation ─────────────────────────────────────────

export class MockAIProvider implements IAIProvider {
  /** Thời gian delay giả lập để trông như đang "suy nghĩ" (ms) */
  private readonly thinkingDelayMs: number;

  constructor(thinkingDelayMs = 0) {
    this.thinkingDelayMs = thinkingDelayMs;
  }

  private async delay(): Promise<void> {
    if (this.thinkingDelayMs > 0) {
      await new Promise((res) => setTimeout(res, this.thinkingDelayMs));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  async generateGreeting(input: GenerateGreetingInput): Promise<string> {
    await this.delay();
    const templates = GREETING_TEMPLATES[input.interviewType] ?? GREETING_TEMPLATES.CODING;
    const template = pick(templates);
    return template.replace('{problem}', input.problemTitle);
  }

  // ──────────────────────────────────────────────────────────────────────────
  async generateInterviewResponse(
    input: GenerateInterviewResponseInput
  ): Promise<GenerateInterviewResponseOutput> {
    await this.delay();
    const msg = input.userMessage;

    // Phân tích keyword để đưa ra phản hồi phù hợp context
    if (hasKeyword(msg, ['brute force', 'o(n^2)', 'o(n2)', 'n bình phương', 'vòng lặp lồng'])) {
      return { content: pick(RESPONSE_TEMPLATES.brute_force), messageType: 'FEEDBACK' };
    }

    if (hasKeyword(msg, ['hashmap', 'hash map', 'dictionary', 'map', 'set', 'o(n)', 'linear'])) {
      return { content: pick(RESPONSE_TEMPLATES.optimal), messageType: 'FEEDBACK' };
    }

    if (hasKeyword(msg, ['edge case', 'corner case', 'mảng rỗng', 'null', 'undefined', 'âm'])) {
      return { content: pick(RESPONSE_TEMPLATES.edge_case), messageType: 'QUESTION' };
    }

    if (hasKeyword(msg, ['độ phức tạp', 'complexity', 'big-o', 'big o', 'time complexity', 'space'])) {
      return { content: pick(RESPONSE_TEMPLATES.complexity), messageType: 'FEEDBACK' };
    }

    if (hasKeyword(msg, ['code', 'viết xong', 'implement', 'xong rồi', 'function', 'def ', 'class '])) {
      return { content: pick(RESPONSE_TEMPLATES.code_written), messageType: 'FEEDBACK' };
    }

    // Default: generic encouraging response
    return { content: pick(RESPONSE_TEMPLATES.generic), messageType: 'FEEDBACK' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  async evaluateInterview(input: EvaluateInterviewInput): Promise<EvaluateInterviewOutput> {
    await this.delay();

    const { codeSnapshots, messages } = input;

    // Tính toán score dựa trên dữ liệu thực: pass ratio của test cases
    const latestSnapshot = codeSnapshots[0] ?? null;
    const passRatio =
      latestSnapshot && latestSnapshot.test_results.total > 0
        ? latestSnapshot.test_results.passed / latestSnapshot.test_results.total
        : 0.6;

    // Đánh giá giao tiếp dựa trên số tin nhắn và độ dài
    const userMessages = messages.filter((m) => m.sender === 'USER');
    const avgMsgLength =
      userMessages.length > 0
        ? userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length
        : 50;
    const communicationBonus = Math.min(Math.floor(avgMsgLength / 20), 15); // max +15 điểm

    const scores: InterviewScores = {
      problem_solving: randInt(65, 75) + Math.round(passRatio * 15),
      code_quality: randInt(70, 80) + Math.round(passRatio * 10),
      communication: Math.min(60 + communicationBonus + randInt(0, 10), 95),
      time_management: randInt(70, 90),
      optimization: randInt(60, 80) + Math.round(passRatio * 10),
    };

    const overall_score = Math.round(
      scores.problem_solving * 0.3 +
        scores.code_quality * 0.25 +
        scores.communication * 0.2 +
        scores.time_management * 0.1 +
        scores.optimization * 0.15
    );

    // Chọn ngẫu nhiên từ pool để tránh hardcoded
    const strengths = this.pickUnique(STRENGTH_POOL, 3);
    const weaknesses = this.pickUnique(WEAKNESS_POOL, 2);
    const suggestions = this.pickUnique(SUGGESTION_POOL, 2);

    const hire_recommendation = this.calcHireRecommendation(overall_score);

    return { scores, overall_score, strengths, weaknesses, suggestions, hire_recommendation };
  }

  // ──────────────────────────────────────────────────────────────────────────
  async reviewCode(input: ReviewCodeInput): Promise<string> {
    await this.delay();

    const reviews = [
      `Code ${input.language} của bạn có cấu trúc rõ ràng. Tuy nhiên, nên thêm type hints và xử lý edge cases kỹ hơn.`,
      `Logic cơ bản chính xác. Xem xét tách function nhỏ hơn để tăng tính reusable và dễ test.`,
      `Implementation đúng yêu cầu bài "${input.problemTitle}". Có thể tối ưu thêm về memory allocation.`,
      `Code readable và clean. Đặt tên biến tốt. Nên bổ sung comments cho các logic phức tạp.`,
      `Approach đúng hướng. Xem lại phần xử lý empty input và null checks để robust hơn.`,
    ];

    return pick(reviews);
  }

  // ──────────────────────────────────────────────────────────────────────────
  async evaluateSystemDesign(
    input: EvaluateSystemDesignInput
  ): Promise<EvaluateSystemDesignOutput> {
    await this.delay();

    const { architecture } = input;
    const nodeCount = architecture.nodes.length;

    // Phân tích kiến trúc thực sự từ nodes
    const hasCache = architecture.nodes.some((n) => n.data?.nodeType === 'cache_redis');
    const hasQueue = architecture.nodes.some((n) => n.data?.nodeType === 'message_queue');
    const hasLB = architecture.nodes.some((n) => n.data?.nodeType === 'load_balancer');
    const hasCDN = architecture.nodes.some((n) => n.data?.nodeType === 'cdn');
    const hasDB = architecture.nodes.some(
      (n) => n.data?.nodeType === 'database_sql' || n.data?.nodeType === 'database_nosql'
    );
    const hasMicroservices = architecture.nodes.filter(
      (n) => n.data?.nodeType === 'microservice'
    ).length;

    // Tính score có trọng số dựa trên kiến trúc thực
    let score = 50; // base score
    score += Math.min(nodeCount * 4, 20); // node diversity (max +20)
    if (hasLB) score += 8;
    if (hasCache) score += 8;
    if (hasQueue) score += 6;
    if (hasCDN) score += 4;
    if (hasDB) score += 4;
    if (hasMicroservices > 1) score += 5;
    score = Math.min(score, 97);

    // Xây dựng danh sách bottlenecks dựa trên những gì còn thiếu
    const bottlenecks: BottleneckAnalysis[] = [];

    if (!hasCache && nodeCount > 2) {
      bottlenecks.push({
        componentId: 'missing-cache',
        componentName: 'Caching Layer',
        severity: 'high',
        issue:
          'Hệ thống thiếu tầng đệm cache — mọi request đọc đều hit thẳng vào database. Với lưu lượng cao, database sẽ trở thành bottleneck I/O.',
        recommendation:
          'Thêm Redis Cache trước database để phục vụ các read-heavy workloads. Có thể cache session, frequently-queried objects với TTL phù hợp.',
      });
    }

    if (!hasLB && nodeCount > 3) {
      bottlenecks.push({
        componentId: 'missing-lb',
        componentName: 'Load Balancer',
        severity: 'high',
        issue:
          'Không có Load Balancer, tất cả traffic đổ vào một điểm duy nhất — không có high availability và không thể scale ngang.',
        recommendation:
          'Thêm Load Balancer (NGINX, AWS ALB) để phân phối traffic, kết hợp với multiple service instances để đạt HA.',
      });
    }

    if (!hasQueue && nodeCount > 4) {
      bottlenecks.push({
        componentId: 'sync-processing',
        componentName: 'Synchronous Processing',
        severity: 'medium',
        issue:
          'Tất cả operations đang chạy đồng bộ — các tác vụ nặng (gửi email, xử lý ảnh, report...) kéo dài latency cho user.',
        recommendation:
          'Bổ sung Message Queue (Kafka, RabbitMQ, SQS) để xử lý async tasks, giải phóng response nhanh hơn cho người dùng.',
      });
    }

    // Gợi ý bổ sung dựa trên context
    const suggestions = [
      !hasCDN ? 'Thêm CDN (CloudFront, Cloudflare) để giảm latency cho static assets và tăng trải nghiệm người dùng toàn cầu' : null,
      !hasQueue ? 'Sử dụng Event-Driven Architecture với Message Queue để tách biệt producer/consumer và tăng resilience' : null,
      'Thiết lập Multi-AZ deployment cho database để đảm bảo High Availability và disaster recovery',
      'Thêm Circuit Breaker pattern (Hystrix, Resilience4j) để ngăn lỗi dây chuyền giữa các microservices',
      'Implement API Rate Limiting tại Gateway layer để bảo vệ hệ thống khỏi abuse và DDoS',
    ].filter(Boolean) as string[];

    const scalabilityFeedback =
      score >= 80
        ? `Kiến trúc "${input.scenarioTitle}" được thiết kế tốt với ${nodeCount} components phân tầng rõ ràng. Hệ thống có thể mở rộng theo chiều ngang (horizontal scaling) hiệu quả.`
        : `Kiến trúc hiện tại cần bổ sung thêm các tầng trung gian (cache, queue, LB) để xử lý tải cao. Với scale như "${input.scenarioTitle}" yêu cầu, hệ thống hiện tại sẽ gặp bottleneck sớm.`;

    const availabilityFeedback =
      hasLB && hasDB
        ? 'Thiết kế có điểm khởi đầu tốt cho High Availability. Cần bổ sung database replication và health check mechanism để đạt SLA 99.9%.'
        : 'Cần thiết lập redundancy cho tất cả single-point-of-failure: database replication, multi-instance services, và automated failover.';

    return { score, scalabilityFeedback, availabilityFeedback, bottlenecks, suggestedAdditions: suggestions };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /** Chọn n phần tử khác nhau từ pool */
  private pickUnique<T>(pool: T[], n: number): T[] {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  }

  private calcHireRecommendation(score: number): HireRecommendation {
    if (score >= 85) return 'STRONG_YES';
    if (score >= 70) return 'LEAN_YES';
    if (score >= 55) return 'LEAN_NO';
    return 'STRONG_NO';
  }
}

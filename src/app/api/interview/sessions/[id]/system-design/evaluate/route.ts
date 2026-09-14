import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { architecture } = body;
    const nodeCount = architecture?.nodes?.length || 0;

    const hasCache = architecture?.nodes?.some((n: any) => n.data?.nodeType === 'cache_redis');
    const hasQueue = architecture?.nodes?.some((n: any) => n.data?.nodeType === 'message_queue');
    const hasLB = architecture?.nodes?.some((n: any) => n.data?.nodeType === 'load_balancer');

    let score = Math.min(60 + nodeCount * 5, 95);
    if (hasCache) score += 5;
    if (hasQueue) score += 5;
    if (hasLB) score += 5;
    score = Math.min(score, 98);

    const bottlenecks = [];
    if (!hasCache) {
      bottlenecks.push({
        componentId: 'db-bottleneck',
        componentName: 'Database Layer',
        severity: 'high' as const,
        issue: 'Truy vấn đọc trực tiếp vào database mà không có tầng đệm Redis Cache có thể gây quá tải I/O khi lưu lượng truy cập tăng đột biến.',
        recommendation: 'Bổ sung Redis Cache phía trước database để đệm các dữ liệu nóng (frequently queried items).',
      });
    }

    if (!hasQueue && nodeCount > 3) {
      bottlenecks.push({
        componentId: 'sync-call-bottleneck',
        componentName: 'Synchronous Processing',
        severity: 'medium' as const,
        issue: 'Các tiến trình xử lý nặng thực hiện đồng bộ (synchronous) có thể kéo dài latency của người dùng.',
        recommendation: 'Sử dụng Message Queue (Kafka / RabbitMQ) để xử lý các tác vụ nền bất đồng bộ (async tasks).',
      });
    }

    const response = {
      score,
      scalabilityFeedback:
        score >= 80
          ? 'Kiến trúc được phân tách tốt với các tầng độc lập, có thể mở rộng theo chiều ngang (Horizontal Scaling).'
          : 'Hệ thống cần bổ sung cơ chế phân tải và tách biệt các thành phần xử lý nặng để đảm bảo mở rộng hiệu quả.',
      availabilityFeedback:
        'Cần thiết lập cơ chế Multi-AZ hoặc Replication cho database để bảo đảm khả năng chịu lỗi (High Availability & Fault Tolerance).',
      bottlenecks,
      suggestedAdditions: [
        'Cân nhắc bổ sung CDN cho tài nguyên tĩnh để giảm tải cho API Gateway',
        'Thêm Circuit Breaker pattern để ngăn chặn lỗi dây chuyền giữa các microservices',
      ],
    };

    return NextResponse.json(response);
  } catch (err: any) {
    return apiError(err.message || 'Evaluate system design failed', 400, 'EVALUATION_FAILED');
  }
}

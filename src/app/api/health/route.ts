import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { query } from '@/lib/db/mysql';
import { docClient } from '@/lib/db/dynamodb';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET() {
  const status = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    databases: {
      mysql: { status: 'DISCONNECTED', message: '' },
      dynamodb: { status: 'DISCONNECTED', message: '' },
    },
  };

  // 1. Check MySQL
  try {
    await query('SELECT 1');
    status.databases.mysql.status = 'CONNECTED';
  } catch (err: any) {
    status.databases.mysql.status = 'ERROR';
    status.databases.mysql.message = err.message || 'MySQL connection failed';
  }

  // 2. Check DynamoDB
  try {
    const listCmd = new ListTablesCommand({});
    const res = await (docClient as any).send(listCmd);
    status.databases.dynamodb.status = 'CONNECTED';
    status.databases.dynamodb.message = `Tables: ${(res.TableNames || []).join(', ')}`;
  } catch (err: any) {
    status.databases.dynamodb.status = 'ERROR';
    status.databases.dynamodb.message = err.message || 'DynamoDB connection failed';
  }

  const isHealthy =
    status.databases.mysql.status === 'CONNECTED' &&
    status.databases.dynamodb.status === 'CONNECTED';

  if (!isHealthy) {
    return apiError('One or more database services are unhealthy', 503, 'SERVICE_UNHEALTHY', status);
  }

  return apiSuccess(status);
}

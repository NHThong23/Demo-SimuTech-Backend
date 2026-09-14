import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { env } from '@/config/env';

/**
 * AWS DynamoDB Client & Document Client (Singleton)
 * Uses globalThis caching pattern to avoid duplicate instances during Next.js HMR.
 */
declare global {
  // eslint-disable-next-line no-var
  var __dynamoDocClient: DynamoDBDocumentClient | undefined;
}

function createDynamoClient(): DynamoDBDocumentClient {
  const clientConfig: any = {
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  };

  if (env.DYNAMODB_ENDPOINT_URL) {
    clientConfig.endpoint = env.DYNAMODB_ENDPOINT_URL;
  }

  const baseClient = new DynamoDBClient(clientConfig);

  return DynamoDBDocumentClient.from(baseClient, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  });
}

export const docClient: DynamoDBDocumentClient =
  global.__dynamoDocClient ?? createDynamoClient();

if (process.env.NODE_ENV !== 'production') {
  global.__dynamoDocClient = docClient;
}

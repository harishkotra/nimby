import { parseProductRequest, searchListings } from './product-search.mjs';

export function createHandler({ reserve, getKey, search = searchListings }) {
  return async (event) => {
    const reply = (statusCode, body) => ({
      statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify(body),
    });
    if (event.requestContext?.http?.method !== 'POST' || event.rawPath !== '/product-search') {
      return reply(404, { error: 'Not found.' });
    }
    if (event.headers?.origin || !/^application\/json(?:\s*;|$)/i.test(event.headers?.['content-type'] ?? '')) {
      return reply(415, { error: 'Expected a Nimby JSON request.' });
    }
    const query = !event.isBase64Encoded && typeof event.body === 'string' ? parseProductRequest(event.body) : null;
    if (!query) return reply(400, { error: 'Enter a product name or model.' });
    try {
      if (!await reserve()) return reply(429, { error: 'Today’s retailer search limit has been reached. Try Google Shopping.' });
      const key = await getKey();
      return reply(200, { listings: await search(query, key) });
    } catch {
      return reply(502, { error: 'Retailer search is unavailable. Try Google Shopping.' });
    }
  };
}

let runtime;

async function setup() {
  // The managed Node.js Lambda runtime supplies these SDK clients.
  const { DynamoDBClient, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const config = { region: process.env.AWS_REGION, maxAttempts: 1 };
  const dynamo = new DynamoDBClient(config);
  const secrets = new SecretsManagerClient(config);
  let cached;
  return createHandler({
    async reserve() {
      const now = new Date();
      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: process.env.QUOTA_TABLE,
          Key: { day: { S: now.toISOString().slice(0, 10) } },
          UpdateExpression: 'SET expires = if_not_exists(expires, :expires) ADD hits :one',
          ConditionExpression: 'attribute_not_exists(hits) OR hits < :limit',
          ExpressionAttributeValues: {
            ':one': { N: '1' }, ':limit': { N: process.env.DAILY_LIMIT },
            ':expires': { N: String(Math.floor(now.getTime() / 1000) + 172_800) },
          },
        }), { abortSignal: AbortSignal.timeout(1500) });
        return true;
      } catch (error) {
        if (error?.name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },
    async getKey() {
      if (cached?.until > Date.now()) return cached.value;
      const secret = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.TAVILY_SECRET_ARN }),
        { abortSignal: AbortSignal.timeout(1500) });
      const value = secret.SecretString?.trim();
      if (!value) throw new Error('Missing retailer search credential');
      cached = { value, until: Date.now() + 300_000 };
      return value;
    },
  });
}

export async function handler(event) {
  runtime ??= await setup();
  return runtime(event);
}

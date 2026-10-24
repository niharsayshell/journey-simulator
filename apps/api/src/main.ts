import { prisma } from "@js/database";
import { createQueues, redisConnection } from "@js/queue";
import { createSecretBox } from "@js/security";
import { createStorageFromEnv } from "@js/storage";
import { buildApp } from "./app";
import { loadApiConfig } from "./config";

const config = loadApiConfig();
const redis = redisConnection(config.redisUrl);
const queues = createQueues(redisConnection(config.redisUrl));
const app = await buildApp({
  config,
  redis,
  createSubscriber: () => redisConnection(config.redisUrl),
  queues,
  storage: createStorageFromEnv(),
  secrets: createSecretBox(config.encryptionKey),
});

const close = async () => {
  await app.close();
  await queues.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: config.port, host: config.host });

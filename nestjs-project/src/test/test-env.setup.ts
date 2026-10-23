// Jest setupFile (runs after dotenv/config, before any test module loads).
// Tests run inside the Compose network next to a possibly running video-worker:
// - a dedicated queue prefix keeps that worker away from the jobs tests assert on;
// - the public S3 host (localhost:9000) is unreachable from the container, so
//   presigned client URLs are signed for the internal endpoint instead.
process.env.QUEUE_PREFIX = 'streamtube-test';
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT;

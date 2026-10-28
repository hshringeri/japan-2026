// Where the trip's Worker lives (worker/). This address isn't a secret: the Anthropic key is a
// Cloudflare secret inside the Worker and never reaches this file, the repo or anyone's phone.
// After `npx wrangler deploy`, paste the *.workers.dev address it prints into DEPLOYED.
const DEPLOYED = "https://japan-2026.raghav-japan.workers.dev";
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const API = LOCAL ? `http://${location.hostname}:8787` : DEPLOYED;

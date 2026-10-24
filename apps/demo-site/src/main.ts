import { createDemoSite } from "./server";

const port = Number(process.env.DEMO_SITE_PORT ?? 4100);
const site = createDemoSite({
  port,
  host: process.env.DEMO_SITE_HOST ?? "127.0.0.1",
  verificationValues: (process.env.DEMO_VERIFICATION_VALUES ?? "").split(",").filter(Boolean),
});
site.listen().then((p) => console.log(JSON.stringify({ level: "info", msg: `Demo Shop listening on http://localhost:${p}` })));

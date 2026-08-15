import { randomBytes } from "node:crypto";
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`MASTER_KEY=${randomBytes(32).toString("hex")}`);

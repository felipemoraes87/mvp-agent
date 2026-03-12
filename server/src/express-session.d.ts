import "express-session";
import type { SessionUser } from "./types.js";

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    csrfToken?: string;
  }
}

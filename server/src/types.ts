import type { Request } from "express";
import type { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  teamId: string | null;
};

export type AuthedRequest = Request & {
  user?: SessionUser;
  correlationId: string;
};
